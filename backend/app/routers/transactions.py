import re
from datetime import datetime

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


@router.get("/merchants/all", response_model=list[str])
async def all_merchants(
    account_type: AccountType = AccountType.PERSONAL,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[str]:
    """Return all unique merchant names ever used by the user, most recent first."""
    owner_ids = await resolve_owner_ids(db, current_user, account_type)
    pipeline = [
        {"$match": {**owner_match(owner_ids), "merchant": {"$nin": [None, "", "미지정"]}}},
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
    from app.models.category_preset import is_non_cashflow_transfer
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
            or is_non_cashflow_transfer(
                doc.get("category", ""), doc.get("sub_category", "")
            )
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
    from app.models.ledger import (
        TransactionKind,
        is_cashflow_transfer_sub,
        is_shared_funding_sub,
        normalize_transfer_category,
        normalize_transfer_sub_category,
    )
    from app.models.category_preset import is_transfer_expense

    document = payload.model_dump(exclude={"effective_amount", "settled_amount"})
    document["category"] = normalize_transfer_category(payload.category)
    document["sub_category"] = normalize_transfer_sub_category(payload.sub_category)
    document["currency"] = payload.currency.value
    document["type"] = payload.type.value
    document["account_type"] = payload.account_type.value

    cat = document["category"]
    sub = document["sub_category"]
    if is_transfer_expense(cat) and not is_cashflow_transfer_sub(sub):
        document["kind"] = TransactionKind.TRANSFER.value
    else:
        document["kind"] = TransactionKind.NORMAL.value
        if not is_shared_funding_sub(sub):
            document["counter_account_id"] = None

    document["owner_id"] = owner_id
    if not document.get("merchant"):
        document["merchant"] = "미지정"
    return document


def _shared_funding_income_doc(
    expense_doc: dict, *, linked_expense_id: str
) -> dict:
    """Build the shared-ledger income twin for 공용 계좌 입금."""
    from app.models.ledger import TransactionKind

    return {
        "date": expense_doc["date"],
        "amount": expense_doc["amount"],
        "currency": expense_doc["currency"],
        "type": TransactionType.INCOME.value,
        "account_type": AccountType.SHARED.value,
        "category": expense_doc["category"],
        "sub_category": expense_doc["sub_category"],
        "merchant": expense_doc.get("merchant") or "미지정",
        "institution": None,
        "settles_expense_id": None,
        "account_id": expense_doc.get("counter_account_id"),
        "counter_account_id": expense_doc.get("account_id"),
        "linked_transaction_id": linked_expense_id,
        "kind": TransactionKind.NORMAL.value,
        "owner_id": expense_doc["owner_id"],
        "subscription_billing_cycle": None,
        "subscription_id": None,
        "is_stock_trade": False,
        "trade_type": None,
        "ticker": None,
        "shares": None,
        "price": None,
        "fee": None,
        "items": None,
    }


def _shared_funding_expense_fields_from_income(
    income_doc: dict,
) -> dict:
    """Map shared income edit back onto the personal expense twin."""
    return {
        "date": income_doc["date"],
        "amount": income_doc["amount"],
        "currency": income_doc["currency"],
        "merchant": income_doc.get("merchant") or "미지정",
        # income.account_id = shared; income.counter = personal
        "account_id": income_doc.get("counter_account_id"),
        "counter_account_id": income_doc.get("account_id"),
    }


async def _link_pair(
    db: AsyncIOMotorDatabase, expense_id: ObjectId, income_id: ObjectId
) -> None:
    await db[COLLECTION].update_one(
        {"_id": expense_id},
        {"$set": {"linked_transaction_id": str(income_id)}},
    )
    await db[COLLECTION].update_one(
        {"_id": income_id},
        {"$set": {"linked_transaction_id": str(expense_id)}},
    )


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


@router.post("", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    payload: TransactionCreate,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    from app.models.ledger import is_shared_funding_sub

    require_shared_group_for_write(current_user, payload.account_type)
    owner_ids = await resolve_owner_ids(db, current_user, payload.account_type)
    await validate_transaction_payload(
        payload,
        db,
        current_user.id,
        owner_ids=owner_ids,
        current_user=current_user,
    )
    document = _document_from_payload(payload, owner_id=current_user.id)

    if (
        is_shared_funding_sub(document["sub_category"])
        and document["type"] == TransactionType.EXPENSE.value
    ):
        require_shared_group_for_write(current_user, AccountType.SHARED)
        result = await db[COLLECTION].insert_one(document)
        expense_id = result.inserted_id
        income_doc = _shared_funding_income_doc(
            {**document, "_id": expense_id},
            linked_expense_id=str(expense_id),
        )
        income_result = await db[COLLECTION].insert_one(income_doc)
        await _link_pair(db, expense_id, income_result.inserted_id)
        created = await db[COLLECTION].find_one({"_id": expense_id})
        return _serialize(created)

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
    from app.models.ledger import is_shared_funding_sub

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
        current_user=current_user,
    )
    # Keep original owner so partner edits don't reassign ownership.
    document = _document_from_payload(payload, owner_id=existing["owner_id"])
    # Preserve link unless this is no longer shared funding.
    if is_shared_funding_sub(document["sub_category"]) and existing.get(
        "linked_transaction_id"
    ):
        document["linked_transaction_id"] = existing["linked_transaction_id"]
    elif not is_shared_funding_sub(document["sub_category"]):
        document["linked_transaction_id"] = None

    await db[COLLECTION].update_one(
        {"_id": ObjectId(transaction_id)}, {"$set": document}
    )
    updated = await db[COLLECTION].find_one({"_id": ObjectId(transaction_id)})

    # Sync linked twin for 공용 계좌 입금.
    linked_id = existing.get("linked_transaction_id") or (
        updated.get("linked_transaction_id") if updated else None
    )
    if (
        linked_id
        and ObjectId.is_valid(linked_id)
        and is_shared_funding_sub(document["sub_category"])
    ):
        twin = await db[COLLECTION].find_one({"_id": ObjectId(linked_id)})
        if twin:
            if updated.get("type") == TransactionType.EXPENSE.value:
                twin_patch = _shared_funding_income_doc(
                    updated, linked_expense_id=transaction_id
                )
                # Don't overwrite twin owner_id / linked id incorrectly
                twin_patch["linked_transaction_id"] = transaction_id
                twin_patch["owner_id"] = twin.get("owner_id", updated["owner_id"])
                await db[COLLECTION].update_one(
                    {"_id": ObjectId(linked_id)}, {"$set": twin_patch}
                )
            elif updated.get("type") == TransactionType.INCOME.value:
                expense_patch = _shared_funding_expense_fields_from_income(updated)
                expense_patch["category"] = updated["category"]
                expense_patch["sub_category"] = updated["sub_category"]
                expense_patch["kind"] = updated["kind"]
                expense_patch["type"] = TransactionType.EXPENSE.value
                expense_patch["account_type"] = AccountType.PERSONAL.value
                expense_patch["linked_transaction_id"] = transaction_id
                await db[COLLECTION].update_one(
                    {"_id": ObjectId(linked_id)}, {"$set": expense_patch}
                )
    elif linked_id and ObjectId.is_valid(linked_id) and not is_shared_funding_sub(
        document["sub_category"]
    ):
        # Category changed away from shared funding — drop the orphan twin.
        await db[COLLECTION].delete_one({"_id": ObjectId(linked_id)})

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

    # Cascade-delete 공용 계좌 입금 twin.
    twin_id = existing.get("linked_transaction_id")
    if twin_id and ObjectId.is_valid(twin_id):
        await db[COLLECTION].delete_one({"_id": ObjectId(twin_id)})

    result = await db[COLLECTION].delete_one({"_id": ObjectId(transaction_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Transaction not found.")

    await _sync_stock_holding(db, existing)
