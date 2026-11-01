"""Bank statement import: preview what is new, already entered, or needs a look."""

from datetime import datetime, time

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.security import get_current_user
from app.database import get_database
from app.models.account import FinancialAccountKind
from app.models.transaction import AccountType
from app.models.user import UserOut
from app.services import bank_import
from app.services.access import assert_can_access_doc, owner_match, resolve_owner_ids, shared_scope

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
    summary = {
        s: sum(1 for r in out if r["status"] == s)
        for s in (bank_import.STATUS_NEW, bank_import.STATUS_DUPLICATE, bank_import.STATUS_REVIEW)
    }
    return {"account_id": account_id, "rows": out, "summary": summary}
