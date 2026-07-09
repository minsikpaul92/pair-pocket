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
    query: dict = {
        "owner_id": current_user.id,
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
    settled_map = await get_settled_amounts(db, current_user.id)

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
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[str]:
    """Merchants used under this category/sub_category, most recently used first."""
    match: dict = {
        "owner_id": current_user.id,
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
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[str]:
    """Saved + frequently used financial institutions for [투자/저축]."""
    from app.routers.settings import _get_or_create

    doc = await _get_or_create(db, current_user.id)
    saved = doc.get("institutions", [])

    match: dict = {
        "owner_id": current_user.id,
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
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[dict]:
    """Expenses with remaining balance that can still be N빵-settled."""
    settled_map = await get_settled_amounts(db, current_user.id)
    query = {
        "owner_id": current_user.id,
        "account_type": account_type.value,
        "type": TransactionType.EXPENSE.value,
        "currency": currency.value,
    }
    expenses = (
        await db[COLLECTION].find(query).sort("date", -1).to_list(length=200)
    )

    results: list[dict] = []
    from app.models.category_preset import is_transfer_expense
    from app.models.ledger import TransactionKind

    for doc in expenses:
        if (
            doc.get("kind") == TransactionKind.TRANSFER.value
            or is_transfer_expense(doc.get("category", ""))
        ):
            continue
        exp_id = str(doc["_id"])
        settled = settled_map.get(exp_id, 0.0)
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


@router.post("", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    payload: TransactionCreate,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    await validate_transaction_payload(payload, db, current_user.id)

    from app.models.category_preset import is_transfer_expense
    from app.models.ledger import TransactionKind

    document = payload.model_dump(exclude={"effective_amount", "settled_amount"})
    document["currency"] = payload.currency.value
    document["type"] = payload.type.value
    document["account_type"] = payload.account_type.value
    # Asset moves always store kind=transfer so stats/balance logic stay consistent.
    if is_transfer_expense(payload.category):
        document["kind"] = TransactionKind.TRANSFER.value
    else:
        document["kind"] = TransactionKind.NORMAL.value
        document["counter_account_id"] = None
    document["owner_id"] = current_user.id
    if not document.get("merchant"):
        document["merchant"] = "미지정"

    result = await db[COLLECTION].insert_one(document)
    created = await db[COLLECTION].find_one({"_id": result.inserted_id})
    return _serialize(created)
