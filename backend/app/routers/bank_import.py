"""Bank statement import: preview what is new, already entered, or needs a look."""

from datetime import date as date_type, datetime, time
from typing import Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field

from app.core.security import get_current_user
from app.database import get_database
from app.models.account import FinancialAccountKind
from app.models.ledger import (
    TRANSFER_CATEGORY,
    TRANSFER_SUB_ACCOUNT_TRANSFER,
    TRANSFER_SUB_CARD_REPAYMENT,
    TRANSFER_SUB_SHARED_FUNDING,
    TRANSFER_SUB_SHARED_WITHDRAWAL,
)
from app.models.transaction import AccountType, Currency, TransactionCreate, TransactionType
from app.models.user import UserOut
from app.routers.settings import _get_or_create, _parse_custom
from app.services import bank_classify, bank_import
from app.services.access import (
    assert_can_access_doc,
    owner_match,
    require_shared_group_for_write,
    resolve_owner_ids,
    shared_scope,
)
from app.services.transaction_links import is_paired_transfer, twin_document
from app.services.validation import validate_transaction_payload

from app.routers.transactions import _document_from_payload  # noqa: E402

router = APIRouter(prefix="/api/import/bank", tags=["import"])

MAX_BYTES = 1_000_000
MAX_ROWS = 2000


def _decode(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "Could not read the file")


def _bucket(row: dict, is_card: bool) -> str:
    """auto: safe to save as suggested; review: the user decides; duplicate: skip."""
    if row["status"] == bank_import.STATUS_DUPLICATE:
        return "duplicate"
    if row["status"] == bank_import.STATUS_REVIEW or row["hint"] != bank_import.HINT_NORMAL:
        return "review"
    suggestion = row["suggestion"]
    if suggestion and suggestion["confidence"] >= bank_classify.AUTO_CONFIDENCE:
        return "auto"
    return "review"


@router.post("/preview")
async def preview_bank_csv(
    account_id: str = Form(...),
    file: UploadFile = File(...),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    try:
        account = await db["accounts"].find_one({"_id": ObjectId(account_id)})
    except InvalidId:
        account = None
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    await assert_can_access_doc(db, current_user, account)

    raw = await file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File is too large")
    rows = bank_import.parse_bank_csv(_decode(raw))
    if not rows:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No transactions found")
    if len(rows) > MAX_ROWS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Too many rows")

    is_card = account.get("kind") == FinancialAccountKind.CREDIT_CARD.value
    ledger = AccountType(account["account_type"])
    owner_ids = await resolve_owner_ids(db, current_user, ledger)
    start, end = bank_import.window_for(rows)
    # Older entries may not carry an account, so they stay candidates too.
    existing = await db["transactions"].find(
        {
            **owner_match(owner_ids),
            "account_type": ledger.value,
            **shared_scope(ledger.value, current_user.shared_group_id),
            "currency": account["currency"],
            "date": {
                "$gte": datetime.combine(start, time.min),
                "$lte": datetime.combine(end, time.max),
            },
            "$or": [
                {"account_id": account_id},
                # A transfer entered from the other account's side.
                {"counter_account_id": account_id},
                {"account_id": None},
                {"account_id": {"$exists": False}},
            ],
        }
    ).to_list(length=None)
    by_id = {str(d["_id"]): d for d in existing}
    matches = bank_import.match_existing(rows, existing, is_card=is_card)

    out = []
    for row, match in zip(rows, matches):
        hit = by_id.get(match["match_id"]) if match["match_id"] else None
        out.append(
            {
                "index": row.index,
                "date": row.date.isoformat(),
                "description": row.description,
                "amount": row.amount,
                "direction": row.direction,
                "balance": row.balance,
                "hint": bank_import.classify_hint(row, is_card=is_card),
                "counterpart": bank_import.transfer_counterpart(row),
                "status": match["status"],
                "reason": match["reason"],
                "match": (
                    {
                        "id": match["match_id"],
                        "date": hit["date"].date().isoformat(),
                        "merchant": hit.get("merchant"),
                        "amount": hit.get("amount"),
                    }
                    if hit
                    else None
                ),
            }
        )

    # Rows that could be saved as an ordinary entry get a suggested category,
    # including ones marked as already entered, in case the user says they are new.
    to_label = [
        r
        for r in out
        if r["hint"] in (bank_import.HINT_NORMAL, bank_import.HINT_E_TRANSFER)
    ]
    custom = _parse_custom(await _get_or_create(db, current_user.id))
    suggestions = await bank_classify.classify_rows(
        db,
        current_user.id,
        owner_ids,
        ledger.value,
        shared_scope(ledger.value, current_user.shared_group_id),
        to_label,
        custom,
    )
    for r in out:
        r["suggestion"] = suggestions.get(r["index"])
        r["bucket"] = _bucket(r, is_card)

    summary = {
        b: sum(1 for r in out if r["bucket"] == b) for b in ("auto", "review", "duplicate")
    }
    return {"account_id": account_id, "rows": out, "summary": summary}


class ImportItem(BaseModel):
    date: date_type
    amount: float = Field(gt=0)
    direction: Literal["out", "in"]
    merchant: str = Field(min_length=1, max_length=120)
    category: str = ""
    sub_category: str = ""
    # card_repayment: money from this bank account paying off a card account.
    # account_move: money from this account into another of the user's accounts.
    kind: Literal["normal", "card_repayment", "account_move"] = "normal"
    counter_account_id: str | None = None
    note: str | None = Field(default=None, max_length=200)


class CommitBody(BaseModel):
    account_id: str
    items: list[ImportItem] = Field(min_length=1, max_length=MAX_ROWS)


def _payload(account: dict, item: ImportItem, counter: dict | None = None) -> TransactionCreate:
    base = {
        "date": datetime.combine(item.date, time.min),
        "amount": item.amount,
        "currency": Currency(account["currency"]),
        "account_type": AccountType(account["account_type"]),
        "account_id": str(account["_id"]),
        "merchant": item.merchant,
        "note": item.note,
    }
    if item.kind == "card_repayment":
        if item.direction != "out" or not item.counter_account_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Card payment needs a card")
        return TransactionCreate(
            **base,
            type=TransactionType.EXPENSE,
            category=TRANSFER_CATEGORY,
            sub_category=TRANSFER_SUB_CARD_REPAYMENT,
            counter_account_id=item.counter_account_id,
        )
    if item.kind == "account_move":
        if counter is None or str(counter["_id"]) == str(account["_id"]):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Account move needs another account"
            )
        own, other = account["account_type"], counter["account_type"]
        if own == other:
            # Between two accounts of one ledger, only the sending side is entered here.
            if item.direction != "out":
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "Enter this move from the sending account",
                )
            sub = TRANSFER_SUB_ACCOUNT_TRANSFER
        elif (own == "personal") == (item.direction == "out"):
            sub = TRANSFER_SUB_SHARED_FUNDING
        else:
            sub = TRANSFER_SUB_SHARED_WITHDRAWAL
        return TransactionCreate(
            **base,
            type=TransactionType.EXPENSE if item.direction == "out" else TransactionType.INCOME,
            category=TRANSFER_CATEGORY,
            sub_category=sub,
            counter_account_id=str(counter["_id"]),
        )
    if item.category == TRANSFER_CATEGORY:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Transfers cannot be imported this way"
        )
    return TransactionCreate(
        **base,
        type=TransactionType.EXPENSE if item.direction == "out" else TransactionType.INCOME,
        category=item.category,
        sub_category=item.sub_category,
    )


@router.post("/commit", status_code=status.HTTP_201_CREATED)
async def commit_bank_rows(
    body: CommitBody,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    """Save the chosen rows. Nothing is saved unless every row is valid."""
    try:
        account = await db["accounts"].find_one({"_id": ObjectId(body.account_id)})
    except InvalidId:
        account = None
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    await assert_can_access_doc(db, current_user, account)

    ledger = AccountType(account["account_type"])
    require_shared_group_for_write(current_user, ledger)
    owner_ids = await resolve_owner_ids(db, current_user, ledger)

    documents = []
    for item in body.items:
        counter = None
        if item.kind == "account_move" and item.counter_account_id:
            try:
                counter = await db["accounts"].find_one({"_id": ObjectId(item.counter_account_id)})
            except InvalidId:
                counter = None
            if counter is not None:
                await assert_can_access_doc(db, current_user, counter)
        payload = _payload(account, item, counter)
        await validate_transaction_payload(
            payload, db, current_user.id, owner_ids=owner_ids, current_user=current_user
        )
        document = _document_from_payload(
            payload, owner_id=current_user.id, shared_group_id=current_user.shared_group_id
        )
        documents.append(document)
        if is_paired_transfer(document):
            # A move between the personal and shared ledgers is stored as a linked pair.
            document["_id"] = ObjectId()
            twin = twin_document(document, shared_group_id=current_user.shared_group_id)
            twin["_id"] = ObjectId()
            document["linked_transaction_id"] = str(twin["_id"])
            twin["linked_transaction_id"] = str(document["_id"])
            documents.append(twin)
    batch_id = str(ObjectId())
    for document in documents:
        document["import_batch_id"] = batch_id
    await db["transactions"].insert_many(documents)
    return {"created": len(body.items), "batch_id": batch_id}


@router.delete("/batch/{batch_id}")
async def undo_bank_import(
    batch_id: str,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    """Remove what one import saved, so a wrong import can be redone cleanly."""
    query = {"import_batch_id": batch_id, "owner_id": current_user.id}
    ids = [str(d["_id"]) async for d in db["transactions"].find(query, {"_id": 1})]
    if not ids:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import not found")
    if await db["transactions"].count_documents({"settles_expense_id": {"$in": ids}}):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Some entries are already settled and cannot be undone"
        )
    result = await db["transactions"].delete_many(query)
    return {"deleted": result.deleted_count}
