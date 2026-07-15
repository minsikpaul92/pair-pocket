from datetime import datetime

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
    require_shared_group_for_write,
    resolve_owner_ids,
)
from app.services.settlement import get_settled_amounts
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
    type: TransactionType | None = None,
    category: str | None = None,
    sub_category: str | None = None,
    merchant: str | None = None,
    institution: str | None = None,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[dict]:
    """Return transactions with multi-level category filtering."""
    owner_ids = await resolve_owner_ids(db, current_user, account_type)
    query: dict = {
        **owner_match(owner_ids),
        "account_type": account_type.value,
    }
    if currency is not None:
        query["currency"] = currency.value
    if month is not None:
        start, end = _month_range(month)
        query["date"] = {"$gte": start, "$lt": end}
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
    settled_map = await get_settled_amounts(db, owner_ids=owner_ids)

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
        "category": "투자/저축",
        "institution": {"$exists": True, "$ne": None, "$ne": ""},
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
    from bson import ObjectId

    from app.models.category_preset import is_transfer_expense
    from app.models.ledger import TransactionKind

    owner_ids = await resolve_owner_ids(db, current_user, account_type)
    settled_map = await get_settled_amounts(db, owner_ids=owner_ids)
    exclude_amount = 0.0
    exclude_expense_id: str | None = None
    if exclude_settlement_id and ObjectId.is_valid(exclude_settlement_id):
        existing = await db[COLLECTION].find_one(
            {
                "_id": ObjectId(exclude_settlement_id),
                **owner_match(owner_ids),
            }
        )
        if existing and existing.get("settles_expense_id"):
            exclude_expense_id = existing["settles_expense_id"]
            exclude_amount = float(existing["amount"])

    query = {
        **owner_match(owner_ids),
        "account_type": account_type.value,
        "type": TransactionType.EXPENSE.value,
        "currency": currency.value,
    }
    expenses = (
        await db[COLLECTION].find(query).sort("date", -1).to_list(length=200)
    )

    results: list[dict] = []
    for doc in expenses:
        if (
            doc.get("kind") == TransactionKind.TRANSFER.value
            or is_transfer_expense(doc.get("category", ""))
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
    payload: TransactionCreate, *, owner_id: str
) -> dict:
    from app.models.category_preset import is_transfer_expense
    from app.models.ledger import TransactionKind, normalize_transfer_category

    document = payload.model_dump(exclude={"effective_amount", "settled_amount"})
    document["category"] = normalize_transfer_category(payload.category)
    document["currency"] = payload.currency.value
    document["type"] = payload.type.value
    document["account_type"] = payload.account_type.value
    # Asset moves always store kind=transfer so stats/balance logic stay consistent.
    if is_transfer_expense(document["category"]):
        document["kind"] = TransactionKind.TRANSFER.value
    else:
        document["kind"] = TransactionKind.NORMAL.value
        document["counter_account_id"] = None
    document["owner_id"] = owner_id
    if not document.get("merchant"):
        document["merchant"] = "미지정"
    return document


@router.post("", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    payload: TransactionCreate,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    require_shared_group_for_write(current_user, payload.account_type)
    owner_ids = await resolve_owner_ids(db, current_user, payload.account_type)
    await validate_transaction_payload(
        payload, db, current_user.id, owner_ids=owner_ids
    )
    document = _document_from_payload(payload, owner_id=current_user.id)
    result = await db[COLLECTION].insert_one(document)
    created = await db[COLLECTION].find_one({"_id": result.inserted_id})

    if created.get("is_stock_trade") and created.get("account_id") and created.get("ticker"):
        from app.services.stocks import sync_holding_from_transactions
        await sync_holding_from_transactions(
            db,
            owner_id=created["owner_id"],
            account_id=created["account_id"],
            ticker=created["ticker"]
        )

    return _serialize(created)


@router.put("/{transaction_id}", response_model=TransactionOut)
async def update_transaction(
    transaction_id: str,
    payload: TransactionCreate,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    from bson import ObjectId

    if not ObjectId.is_valid(transaction_id):
        raise HTTPException(status_code=404, detail="Transaction not found.")

    existing = await db[COLLECTION].find_one({"_id": ObjectId(transaction_id)})
    await assert_can_access_doc(
        db, current_user, existing, not_found_detail="Transaction not found."
    )
    require_shared_group_for_write(current_user, payload.account_type)
    owner_ids = await resolve_owner_ids(db, current_user, payload.account_type)

    await validate_transaction_payload(
        payload,
        db,
        current_user.id,
        owner_ids=owner_ids,
        exclude_settlement_id=transaction_id,
    )
    # Keep original owner so partner edits don't reassign ownership.
    document = _document_from_payload(payload, owner_id=existing["owner_id"])
    await db[COLLECTION].update_one(
        {"_id": ObjectId(transaction_id)}, {"$set": document}
    )
    updated = await db[COLLECTION].find_one({"_id": ObjectId(transaction_id)})

    # Trigger stock sync for old state and new state
    from app.services.stocks import sync_holding_from_transactions
    if existing.get("is_stock_trade") and existing.get("account_id") and existing.get("ticker"):
        await sync_holding_from_transactions(
            db,
            owner_id=existing["owner_id"],
            account_id=existing["account_id"],
            ticker=existing["ticker"]
        )
    if updated.get("is_stock_trade") and updated.get("account_id") and updated.get("ticker"):
        await sync_holding_from_transactions(
            db,
            owner_id=updated["owner_id"],
            account_id=updated["account_id"],
            ticker=updated["ticker"]
        )

    return _serialize(updated)


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    transaction_id: str,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> None:
    from bson import ObjectId

    if not ObjectId.is_valid(transaction_id):
        raise HTTPException(status_code=404, detail="Transaction not found.")

    existing = await db[COLLECTION].find_one({"_id": ObjectId(transaction_id)})
    await assert_can_access_doc(
        db, current_user, existing, not_found_detail="Transaction not found."
    )

    # Block deleting an expense that still has linked N빵 settlements.
    if existing.get("type") == TransactionType.EXPENSE.value:
        owner_ids = await resolve_owner_ids(
            db, current_user, AccountType(existing["account_type"])
        )
        linked = await db[COLLECTION].count_documents(
            {
                **owner_match(owner_ids),
                "settles_expense_id": transaction_id,
            }
        )
        if linked > 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="이 지출에 연결된 N빵 정산이 있어 삭제할 수 없습니다. 정산을 먼저 삭제해 주세요.",
            )

    result = await db[COLLECTION].delete_one({"_id": ObjectId(transaction_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Transaction not found.")

    if existing.get("is_stock_trade") and existing.get("account_id") and existing.get("ticker"):
        from app.services.stocks import sync_holding_from_transactions
        await sync_holding_from_transactions(
            db,
            owner_id=existing["owner_id"],
            account_id=existing["account_id"],
            ticker=existing["ticker"]
        )
