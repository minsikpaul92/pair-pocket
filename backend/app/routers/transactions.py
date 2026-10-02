import re
from datetime import date, datetime

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from app.core.security import get_current_user
from app.database import get_database
from app.models.transaction import (
    AccountType,
    Currency,
    TransactionCreate,
    TransactionOut,
    TransactionType,
)
from app.models.user import UserOut
from app.services.access import (
    assert_can_access_doc,
    owner_match,
    shared_scope,
    require_shared_group_for_write,
    resolve_owner_ids,
)
from app.services import db_transactions
from app.services.settlement import (
    SETTLEMENT_EPSILON,
    check_settlement,
    get_settled_amounts,
    settled_total,
)
from app.services.stats import resolve_date_range
from app.services.transaction_links import (
    authorized_funding_twin,
    is_paired_transfer,
    twin_document,
)
from app.services.validation import validate_transaction_payload

router = APIRouter(prefix="/api/transactions", tags=["transactions"])

COLLECTION = "transactions"


class SettleableExpenseOut(BaseModel):
    id: str
    date: datetime
    merchant: str
    amount: float
    settled_amount: float
    remaining_amount: float
    category: str
    sub_category: str


def _serialize(document: dict) -> dict:
    """Shape a raw MongoDB document into the TransactionOut schema."""
    from app.models.ledger import TransactionKind

    return {
        "id": str(document["_id"]),
        "date": document["date"],
        "amount": document["amount"],
        "currency": document["currency"],
        "type": document["type"],
        "account_type": document["account_type"],
        "category": document.get("category", ""),
        "sub_category": document.get("sub_category", ""),
        "merchant": document.get("merchant", "미지정"),
        "institution": document.get("institution"),
        "settles_expense_id": document.get("settles_expense_id"),
        "account_id": document.get("account_id"),
        "counter_account_id": document.get("counter_account_id"),
        "linked_transaction_id": document.get("linked_transaction_id"),
        "kind": document.get("kind", TransactionKind.NORMAL.value),
        "owner_id": document["owner_id"],
        "subscription_billing_cycle": document.get("subscription_billing_cycle"),
        "subscription_id": document.get("subscription_id"),
        "is_stock_trade": document.get("is_stock_trade", False),
        "trade_type": document.get("trade_type"),
        "ticker": document.get("ticker"),
        "shares": document.get("shares"),
        "price": document.get("price"),
        "fee": document.get("fee"),
        "items": document.get("items"),
        "tip_amount": document.get("tip_amount"),
        "tip_percent": document.get("tip_percent"),
        "subtotal": document.get("subtotal"),
        "tax_amount": document.get("tax_amount"),
        "note": document.get("note"),
    }


def _month_range(month: str) -> tuple[datetime, datetime]:
    """Return [start, end) datetimes for a 'YYYY-MM' string."""
    try:
        year, mon = (int(part) for part in month.split("-"))
        start = datetime(year, mon, 1)
        end = datetime(year + 1, 1, 1) if mon == 12 else datetime(year, mon + 1, 1)
        return start, end
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="month must be in 'YYYY-MM' format.",
        )


@router.get("", response_model=list[TransactionOut])
async def list_transactions(
    account_type: AccountType = AccountType.PERSONAL,
    currency: Currency | None = None,
    month: str | None = Query(default=None, description="Filter by 'YYYY-MM'."),
    start: date | None = Query(default=None, description="Inclusive 'YYYY-MM-DD'."),
    end: date | None = Query(default=None, description="Inclusive 'YYYY-MM-DD'."),
    type: TransactionType | None = None,
    category: str | None = None,
    sub_category: str | None = None,
    merchant: str | None = None,
    institution: str | None = None,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[dict]:
    """Return transactions with multi-level category filtering."""
    date_range = resolve_date_range(start, end, month=month)
    owner_ids = await resolve_owner_ids(db, current_user, account_type)
    query: dict = {
        **owner_match(owner_ids),
        "account_type": account_type.value,
        **shared_scope(account_type.value, current_user.shared_group_id),
    }
    if currency is not None:
        query["currency"] = currency.value
    if month is not None:
        month_start, month_end = _month_range(month)
        query["date"] = {"$gte": month_start, "$lt": month_end}
    elif date_range is not None:
        query["date"] = {"$gte": date_range[0], "$lt": date_range[1]}
    if type is not None:
        query["type"] = type.value
    if category is not None:
        query["category"] = category
    if sub_category is not None:
        query["sub_category"] = sub_category
    if merchant is not None:
        query["merchant"] = merchant
    if institution is not None:
        query["institution"] = institution

    documents = await db[COLLECTION].find(query).sort("date", -1).to_list(length=500)
    settled_map = await get_settled_amounts(
        db,
        owner_ids=owner_ids,
        account_type=account_type,
        shared_group_id=current_user.shared_group_id,
    )

    results: list[dict] = []
    for doc in documents:
        row = _serialize(doc)
        if doc.get("type") == TransactionType.EXPENSE.value:
            exp_id = str(doc["_id"])
            settled = settled_map.get(exp_id, 0.0)
            row["settled_amount"] = settled
            row["effective_amount"] = max(float(doc["amount"]) - settled, 0.0)
        results.append(row)
    return results


@router.get("/merchants", response_model=list[str])
async def merchant_suggestions(
    category: str,
    sub_category: str | None = None,
    currency: Currency | None = None,
    account_type: AccountType = AccountType.PERSONAL,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[str]:
    """Merchants used under this category/sub_category, most recently used first."""
    owner_ids = await resolve_owner_ids(db, current_user, account_type)
    match: dict = {
        **owner_match(owner_ids),
        "account_type": account_type.value,
        **shared_scope(account_type.value, current_user.shared_group_id),
        "category": category,
        "merchant": {"$nin": [None, "", "미지정"]},
    }
    if sub_category is not None:
        match["sub_category"] = sub_category
    if currency is not None:
        match["currency"] = currency.value

    pipeline = [
        {"$match": match},
        {
            "$group": {
                "_id": "$merchant",
                "last_used": {"$max": "$date"},
            }
        },
        {"$sort": {"last_used": -1}},
        {"$limit": 30},
    ]
    docs = await db[COLLECTION].aggregate(pipeline).to_list(length=30)
    return [d["_id"] for d in docs if d["_id"]]


@router.get("/merchants/all", response_model=list[str])
async def all_merchants(
    account_type: AccountType = AccountType.PERSONAL,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[str]:
    """Return all unique merchant names ever used by the user, most recent first."""
    owner_ids = await resolve_owner_ids(db, current_user, account_type)
    pipeline = [
        {
            "$match": {
                **owner_match(owner_ids),
                "account_type": account_type.value,
                **shared_scope(account_type.value, current_user.shared_group_id),
                "merchant": {"$nin": [None, "", "미지정"]},
            }
        },
        {
            "$group": {
                "_id": "$merchant",
                "count": {"$sum": 1},
                "last_used": {"$max": "$date"},
            }
        },
        {"$sort": {"count": -1, "last_used": -1}},
        {"$limit": 100},
    ]
    docs = await db[COLLECTION].aggregate(pipeline).to_list(length=100)
    return [d["_id"] for d in docs if d["_id"]]


@router.get("/merchants/lookup")
async def lookup_merchant(
    name: str,
    account_type: AccountType = AccountType.PERSONAL,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    """Lookup category and sub_category for a given merchant name from past transactions."""
    if not name or not name.strip():
        return {"found": False}
    owner_ids = await resolve_owner_ids(db, current_user, account_type)
    escaped_name = re.escape(name.strip())
    doc = await db[COLLECTION].find_one(
        {
            **owner_match(owner_ids),
            "account_type": account_type.value,
            **shared_scope(account_type.value, current_user.shared_group_id),
            "merchant": {"$regex": f"^{escaped_name}$", "$options": "i"},
        },
        sort=[("date", -1)],
    )
    if doc and doc.get("category") and doc.get("sub_category"):
        return {
            "found": True,
            "category": doc["category"],
            "sub_category": doc["sub_category"],
        }
    return {"found": False}


@router.get("/institutions", response_model=list[str])
async def institution_suggestions(
    sub_category: str | None = None,
    currency: Currency | None = None,
    account_type: AccountType = AccountType.PERSONAL,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[str]:
    """Saved + frequently used financial institutions for [투자/저축]."""
    from app.routers.settings import _get_or_create

    doc = await _get_or_create(db, current_user.id)
    saved = doc.get("institutions", [])

    owner_ids = await resolve_owner_ids(db, current_user, account_type)
    match: dict = {
        **owner_match(owner_ids),
        "account_type": account_type.value,
        **shared_scope(account_type.value, current_user.shared_group_id),
        "category": "투자/저축",
        "institution": {"$exists": True, "$nin": [None, ""]},
    }
    if sub_category is not None:
        match["sub_category"] = sub_category
    if currency is not None:
        match["currency"] = currency.value

    pipeline = [
        {"$match": match},
        {"$group": {"_id": "$institution", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 8},
    ]
    docs = await db[COLLECTION].aggregate(pipeline).to_list(length=8)
    from_history = [d["_id"] for d in docs if d["_id"]]

    merged: list[str] = []
    seen: set[str] = set()
    for name in saved + from_history:
        if name and name not in seen:
            merged.append(name)
            seen.add(name)
    return merged[:12]


@router.get("/settleable", response_model=list[SettleableExpenseOut])
async def list_settleable_expenses(
    currency: Currency,
    account_type: AccountType = AccountType.PERSONAL,
    exclude_settlement_id: str | None = Query(
        default=None,
        description="When editing a settlement, exclude it from remaining calc.",
    ),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[dict]:
    """Expenses with remaining balance that can still be N빵-settled."""
    from app.models.category_preset import is_non_cashflow_transfer
    from app.models.ledger import TransactionKind

    owner_ids = await resolve_owner_ids(db, current_user, account_type)
    settled_map = await get_settled_amounts(
        db,
        owner_ids=owner_ids,
        account_type=account_type,
        shared_group_id=current_user.shared_group_id,
    )
    exclude_amount = 0.0
    exclude_expense_id: str | None = None
    if exclude_settlement_id and ObjectId.is_valid(exclude_settlement_id):
        existing = await db[COLLECTION].find_one(
            {
                "_id": ObjectId(exclude_settlement_id),
                **owner_match(owner_ids),
                "account_type": account_type.value,
                **shared_scope(account_type.value, current_user.shared_group_id),
            }
        )
        if existing and existing.get("settles_expense_id"):
            exclude_expense_id = existing["settles_expense_id"]
            exclude_amount = float(existing["amount"])

    query = {
        **owner_match(owner_ids),
        "account_type": account_type.value,
        **shared_scope(account_type.value, current_user.shared_group_id),
        "type": TransactionType.EXPENSE.value,
        "currency": currency.value,
    }
    expenses = await db[COLLECTION].find(query).sort("date", -1).to_list(length=200)

    results: list[dict] = []
    for doc in expenses:
        if doc.get(
            "kind"
        ) == TransactionKind.TRANSFER.value or is_non_cashflow_transfer(
            doc.get("category", ""), doc.get("sub_category", "")
        ):
            continue
        exp_id = str(doc["_id"])
        settled = settled_map.get(exp_id, 0.0)
        if exclude_expense_id == exp_id:
            settled = max(settled - exclude_amount, 0.0)
        remaining = max(doc["amount"] - settled, 0.0)
        if remaining <= 0:
            continue
        results.append(
            {
                "id": exp_id,
                "date": doc["date"],
                "merchant": doc.get("merchant", "미지정"),
                "amount": doc["amount"],
                "settled_amount": settled,
                "remaining_amount": remaining,
                "category": doc.get("category", ""),
                "sub_category": doc.get("sub_category", ""),
            }
        )
    return results


def _document_from_payload(
    payload: TransactionCreate, *, owner_id: str, shared_group_id: str | None = None
) -> dict:
    from app.models.ledger import (
        TransactionKind,
        is_cashflow_transfer_sub,
        normalize_transfer_category,
        normalize_transfer_sub_category,
        paired_transfer_ledgers,
    )
    from app.models.category_preset import is_transfer_expense

    document = payload.model_dump(
        exclude={"effective_amount", "settled_amount", "linked_transaction_id"}
    )
    document["category"] = normalize_transfer_category(payload.category)
    document["sub_category"] = normalize_transfer_sub_category(payload.sub_category)
    document["currency"] = payload.currency.value
    document["type"] = payload.type.value
    document["account_type"] = payload.account_type.value
    document["shared_group_id"] = (
        shared_group_id if payload.account_type == AccountType.SHARED else None
    )

    cat = document["category"]
    sub = document["sub_category"]
    if is_transfer_expense(cat) and not is_cashflow_transfer_sub(sub):
        document["kind"] = TransactionKind.TRANSFER.value
    else:
        document["kind"] = TransactionKind.NORMAL.value
        if not (is_transfer_expense(cat) and paired_transfer_ledgers(sub)):
            document["counter_account_id"] = None

    document["owner_id"] = owner_id
    if not document.get("merchant"):
        document["merchant"] = "미지정"
    return document


async def _sync_stock_holding(db: AsyncIOMotorDatabase, doc: dict | None) -> None:
    if not doc:
        return
    if doc.get("is_stock_trade") and doc.get("account_id") and doc.get("ticker"):
        from app.services.stocks import sync_holding_from_transactions

        await sync_holding_from_transactions(
            db,
            owner_id=doc["owner_id"],
            account_id=doc["account_id"],
            ticker=doc["ticker"],
        )


def _is_settlement(doc: dict) -> bool:
    return bool(doc.get("settles_expense_id")) and doc.get("type") == (
        TransactionType.INCOME.value
    )


async def _lock_settlement(
    db, session, user: UserOut, doc: dict, *, exclude_settlement_id=None
) -> None:
    """Re-check the remaining amount inside the transaction, locking the expense."""
    account_type = AccountType(doc["account_type"])
    await check_settlement(
        db,
        expense_id=doc["settles_expense_id"],
        amount=float(doc["amount"]),
        currency=doc["currency"],
        owner_ids=await resolve_owner_ids(db, user, account_type),
        account_type=account_type,
        shared_group_id=user.shared_group_id,
        exclude_settlement_id=exclude_settlement_id,
        lock=True,
        session=session,
    )


async def _guard_settled_expense(db, session, existing: dict, document: dict) -> None:
    """An expense with settlements keeps its ledger, currency, and covers them."""
    if existing.get("type") != TransactionType.EXPENSE.value:
        return
    settled = await settled_total(db, str(existing["_id"]), session=session)
    if settled <= 0:
        return
    if (
        document["type"] != TransactionType.EXPENSE.value
        or document["account_type"] != existing.get("account_type")
        or document["currency"] != existing.get("currency")
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="N빵 정산이 연결된 지출은 장부, 통화, 지출/수입 구분을 바꿀 수 없습니다.",
        )
    if float(document["amount"]) + SETTLEMENT_EPSILON < settled:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"이미 정산된 금액({settled:.2f})보다 작게 바꿀 수 없습니다.",
        )


@router.post("", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    payload: TransactionCreate,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    require_shared_group_for_write(current_user, payload.account_type)
    owner_ids = await resolve_owner_ids(db, current_user, payload.account_type)
    await validate_transaction_payload(
        payload,
        db,
        current_user.id,
        owner_ids=owner_ids,
        current_user=current_user,
    )
    document = _document_from_payload(
        payload, owner_id=current_user.id, shared_group_id=current_user.shared_group_id
    )

    if is_paired_transfer(document) or _is_settlement(document):

        async def write(session):
            if _is_settlement(document):
                await _lock_settlement(db, session, current_user, document)
            result = await db[COLLECTION].insert_one(dict(document), session=session)
            if is_paired_transfer(document):
                twin = twin_document(
                    {**document, "_id": result.inserted_id},
                    shared_group_id=current_user.shared_group_id,
                )
                twin["linked_transaction_id"] = str(result.inserted_id)
                twin_result = await db[COLLECTION].insert_one(twin, session=session)
                await db[COLLECTION].update_one(
                    {"_id": result.inserted_id},
                    {"$set": {"linked_transaction_id": str(twin_result.inserted_id)}},
                    session=session,
                )
            return result.inserted_id

        inserted_id = await db_transactions.run_in_transaction(db, write)
        return _serialize(await db[COLLECTION].find_one({"_id": inserted_id}))

    result = await db[COLLECTION].insert_one(document)
    created = await db[COLLECTION].find_one({"_id": result.inserted_id})
    await _sync_stock_holding(db, created)
    return _serialize(created)


@router.put("/{transaction_id}", response_model=TransactionOut)
async def update_transaction(
    transaction_id: str,
    payload: TransactionCreate,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    if not ObjectId.is_valid(transaction_id):
        raise HTTPException(status_code=404, detail="Transaction not found.")

    existing = await db[COLLECTION].find_one({"_id": ObjectId(transaction_id)})
    await assert_can_access_doc(
        db, current_user, existing, not_found_detail="Transaction not found."
    )
    twin = await authorized_funding_twin(db, current_user, existing)
    if (
        existing["owner_id"] != current_user.id
        and payload.account_type.value != existing["account_type"]
    ):
        raise HTTPException(
            status_code=403, detail="Only the owner can change the ledger scope."
        )
    require_shared_group_for_write(current_user, payload.account_type)
    owner_ids = await resolve_owner_ids(db, current_user, payload.account_type)

    await validate_transaction_payload(
        payload,
        db,
        current_user.id,
        owner_ids=owner_ids,
        exclude_settlement_id=transaction_id,
        current_user=current_user,
    )
    # Keep original owner so partner edits don't reassign ownership.
    document = _document_from_payload(
        payload,
        owner_id=existing["owner_id"],
        shared_group_id=current_user.shared_group_id,
    )
    paired = is_paired_transfer(document)
    if (
        twin
        and paired
        and (
            document["account_type"] != existing["account_type"]
            or document["type"] != existing["type"]
        )
    ):
        raise HTTPException(
            status_code=422,
            detail="Linked funding entries cannot change ledger or direction.",
        )
    if paired and not twin and existing["owner_id"] != current_user.id:
        # The other side would land in the owner's books; only they may do that.
        raise HTTPException(status_code=403, detail="Only the owner can link this entry.")
    document["linked_transaction_id"] = str(twin["_id"]) if twin and paired else None

    oid = ObjectId(transaction_id)

    async def write(session):
        await _guard_settled_expense(db, session, existing, document)
        if _is_settlement(document):
            await _lock_settlement(
                db,
                session,
                current_user,
                document,
                exclude_settlement_id=transaction_id,
            )
        await db[COLLECTION].update_one({"_id": oid}, {"$set": document}, session=session)
        if twin and paired:
            patch = twin_document(
                {**document, "_id": oid}, shared_group_id=twin.get("shared_group_id")
            )
            patch["owner_id"] = twin["owner_id"]
            patch["linked_transaction_id"] = transaction_id
            await db[COLLECTION].update_one(
                {"_id": twin["_id"]}, {"$set": patch}, session=session
            )
        elif twin:
            # No longer a ledger transfer — remove the other side.
            await db[COLLECTION].delete_one({"_id": twin["_id"]}, session=session)
        elif paired:
            # Converting an ordinary entry into a ledger transfer.
            new_twin = twin_document(
                {**document, "_id": oid}, shared_group_id=current_user.shared_group_id
            )
            new_twin["linked_transaction_id"] = transaction_id
            created = await db[COLLECTION].insert_one(new_twin, session=session)
            await db[COLLECTION].update_one(
                {"_id": oid},
                {"$set": {"linked_transaction_id": str(created.inserted_id)}},
                session=session,
            )

    has_settlements = (
        existing.get("type") == TransactionType.EXPENSE.value
        and await settled_total(db, transaction_id) > 0
    )
    if twin is not None or paired or _is_settlement(document) or has_settlements:
        await db_transactions.run_in_transaction(db, write)
    else:
        await write(None)

    updated = await db[COLLECTION].find_one({"_id": oid})
    await _sync_stock_holding(db, existing)
    await _sync_stock_holding(db, updated)
    return _serialize(updated)


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    transaction_id: str,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> None:
    if not ObjectId.is_valid(transaction_id):
        raise HTTPException(status_code=404, detail="Transaction not found.")

    existing = await db[COLLECTION].find_one({"_id": ObjectId(transaction_id)})
    await assert_can_access_doc(
        db, current_user, existing, not_found_detail="Transaction not found."
    )
    twin = await authorized_funding_twin(db, current_user, existing)
    oid = ObjectId(transaction_id)

    async def write(session):
        # Block deleting an expense that still has linked N빵 settlements.
        if existing.get("type") == TransactionType.EXPENSE.value:
            if await settled_total(db, transaction_id, session=session) > 0:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        "이 지출에 연결된 N빵 정산이 있어 삭제할 수 없습니다. "
                        "정산을 먼저 삭제해 주세요."
                    ),
                )
        if twin:
            await db[COLLECTION].delete_one({"_id": twin["_id"]}, session=session)
        result = await db[COLLECTION].delete_one({"_id": oid}, session=session)
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Transaction not found.")

    if twin:
        await db_transactions.run_in_transaction(db, write)
    else:
        await write(None)

    await _sync_stock_holding(db, existing)
