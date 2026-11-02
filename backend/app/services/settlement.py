"""Helpers for N빵 settlement linking to original expenses."""

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.category_preset import (
    INCOME_CATEGORY_SETTLEMENT,
    SUB_CATEGORY_SETTLEMENT,
)

from app.models.transaction import AccountType
from app.models.user import UserOut
from app.services.access import assert_can_access_doc, shared_scope

COLLECTION = "transactions"


async def get_settled_amounts(
    db: AsyncIOMotorDatabase,
    owner_id: str | None = None,
    *,
    owner_ids: list[str] | None = None,
    account_type: AccountType = AccountType.PERSONAL,
    shared_group_id: str | None = None,
    session=None,
) -> dict[str, float]:
    """Map expense_id → total settlement income already received."""
    ids = owner_ids if owner_ids is not None else ([owner_id] if owner_id else [])
    if not ids:
        return {}
    owner_filter: dict = (
        {"owner_id": ids[0]} if len(ids) == 1 else {"owner_id": {"$in": ids}}
    )
    pipeline = [
        {
            "$match": {
                **owner_filter,
                "account_type": account_type.value,
                **shared_scope(account_type, shared_group_id),
                "type": "income",
                "category": INCOME_CATEGORY_SETTLEMENT,
                "sub_category": SUB_CATEGORY_SETTLEMENT,
                "settles_expense_id": {"$exists": True, "$ne": None},
            }
        },
        {
            "$group": {
                "_id": "$settles_expense_id",
                "total": {"$sum": "$amount"},
            }
        },
    ]
    docs = await db[COLLECTION].aggregate(pipeline, session=session).to_list(
        length=500
    )
    return {d["_id"]: d["total"] for d in docs if d["_id"]}


async def get_remaining_settlement(
    db: AsyncIOMotorDatabase,
    owner_id: str | None,
    expense_id: str,
    *,
    owner_ids: list[str] | None = None,
    account_type: AccountType = AccountType.PERSONAL,
    shared_group_id: str | None = None,
    exclude_settlement_id: str | None = None,
) -> float | None:
    """Return how much of an expense can still be settled, or None if not found.

    When editing an existing settlement, pass exclude_settlement_id so that
    settlement's own amount is not counted against the remaining balance.
    """
    try:
        oid = ObjectId(expense_id)
    except InvalidId:
        return None

    ids = owner_ids if owner_ids is not None else ([owner_id] if owner_id else [])
    if not ids:
        return None
    owner_clause: dict = (
        {"owner_id": ids[0]} if len(ids) == 1 else {"owner_id": {"$in": ids}}
    )

    expense = await db[COLLECTION].find_one(
        {
            "_id": oid,
            **owner_clause,
            "type": "expense",
            "account_type": account_type.value,
            **shared_scope(account_type, shared_group_id),
        }
    )
    if expense is None:
        return None

    settled_map = await get_settled_amounts(
        db,
        owner_ids=ids,
        account_type=account_type,
        shared_group_id=shared_group_id,
    )
    already = settled_map.get(expense_id, 0.0)

    if exclude_settlement_id and ObjectId.is_valid(exclude_settlement_id):
        existing = await db[COLLECTION].find_one(
            {
                "_id": ObjectId(exclude_settlement_id),
                **owner_clause,
                "settles_expense_id": expense_id,
            }
        )
        if existing:
            already = max(already - float(existing["amount"]), 0.0)

    return max(expense["amount"] - already, 0.0)


SETTLEMENT_EPSILON = 0.001


async def settled_total(
    db: AsyncIOMotorDatabase,
    expense_id: str,
    *,
    exclude_settlement_id: str | None = None,
    session=None,
) -> float:
    """Sum of settlement income linked to one expense."""
    query: dict = {
        "type": "income",
        "category": INCOME_CATEGORY_SETTLEMENT,
        "sub_category": SUB_CATEGORY_SETTLEMENT,
        "settles_expense_id": expense_id,
    }
    if exclude_settlement_id and ObjectId.is_valid(exclude_settlement_id):
        query["_id"] = {"$ne": ObjectId(exclude_settlement_id)}
    total = 0.0
    async for doc in db[COLLECTION].find(query, {"amount": 1}, session=session):
        total += float(doc["amount"])
    return total


async def check_settlement(
    db: AsyncIOMotorDatabase,
    *,
    expense_id: str,
    amount: float,
    currency: str,
    owner_ids: list[str],
    account_type: AccountType,
    shared_group_id: str | None,
    exclude_settlement_id: str | None = None,
    lock: bool = False,
    session=None,
) -> float:
    """Validate a settlement against its expense; return the remaining amount.

    The expense must be accessible, in the same ledger, and in the same
    currency. With `lock` (inside a transaction) the expense document is
    written first, so concurrent settlements of the same expense conflict
    and are retried against the updated total instead of over-settling.
    """
    try:
        oid = ObjectId(expense_id)
    except (InvalidId, TypeError):
        oid = None
    expense = None
    if oid and owner_ids:
        expense = await db[COLLECTION].find_one(
            {
                "_id": oid,
                "owner_id": {"$in": owner_ids},
                "type": "expense",
                "account_type": account_type.value,
                **shared_scope(account_type, shared_group_id),
            },
            session=session,
        )
    if expense is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="정산 대상 지출을 찾을 수 없습니다.",
        )
    if expense.get("currency") != currency:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="정산 통화가 원래 지출의 통화와 일치하지 않습니다.",
        )
    if lock:
        await db[COLLECTION].update_one(
            {"_id": oid}, {"$inc": {"settlement_lock_rev": 1}}, session=session
        )
    already = await settled_total(
        db, expense_id, exclude_settlement_id=exclude_settlement_id, session=session
    )
    remaining = max(float(expense["amount"]) - already, 0.0)
    if amount > remaining + SETTLEMENT_EPSILON:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"정산 금액이 남은 지출({remaining:.2f})을 초과합니다.",
        )
    return remaining


def _object_ids(values) -> list[ObjectId]:
    return [ObjectId(v) for v in values if isinstance(v, str) and ObjectId.is_valid(v)]


async def load_settlement_origins(
    db: AsyncIOMotorDatabase, user: UserOut, docs: list[dict]
) -> dict[str, dict]:
    """Map entry id -> the expense it settles, for settlement entries in `docs`.

    A settlement income points at its expense directly. The expense paid from
    the other ledger reaches it through its linked income. An expense the user
    may not open (a partner's personal one) is left out.
    """
    expense_of: dict[str, str] = {}
    via_twin: dict[str, str] = {}
    for doc in docs:
        entry_id = str(doc["_id"])
        if doc.get("settles_expense_id"):
            expense_of[entry_id] = doc["settles_expense_id"]
        elif doc.get("pair_kind") == "settlement" and doc.get("linked_transaction_id"):
            via_twin[entry_id] = doc["linked_transaction_id"]

    if via_twin:
        twins = await db[COLLECTION].find(
            {"_id": {"$in": _object_ids(via_twin.values())}},
            {"settles_expense_id": 1},
        ).to_list(length=len(via_twin))
        settled_by_twin = {str(t["_id"]): t.get("settles_expense_id") for t in twins}
        for entry_id, twin_id in via_twin.items():
            if settled_by_twin.get(twin_id):
                expense_of[entry_id] = settled_by_twin[twin_id]

    if not expense_of:
        return {}
    expenses = {
        str(e["_id"]): e
        for e in await db[COLLECTION]
        .find({"_id": {"$in": _object_ids(expense_of.values())}})
        .to_list(length=len(expense_of))
    }
    origins: dict[str, dict] = {}
    for entry_id, expense_id in expense_of.items():
        expense = expenses.get(expense_id)
        if expense is None:
            continue
        try:
            await assert_can_access_doc(db, user, expense)
        except HTTPException:
            continue
        origins[entry_id] = {
            "id": expense_id,
            "date": expense["date"],
            "amount": expense["amount"],
            "currency": expense["currency"],
            "account_type": expense["account_type"],
            "category": expense.get("category", ""),
            "sub_category": expense.get("sub_category", ""),
            "merchant": expense.get("merchant", "미지정"),
        }
    return origins
