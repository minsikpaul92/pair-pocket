"""Helpers for N빵 settlement linking to original expenses."""

from bson import ObjectId
from bson.errors import InvalidId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.category_preset import (
    INCOME_CATEGORY_SETTLEMENT,
    SUB_CATEGORY_SETTLEMENT,
    is_settlement_income,
)

COLLECTION = "transactions"


async def get_settled_amounts(
    db: AsyncIOMotorDatabase,
    owner_id: str | None = None,
    *,
    owner_ids: list[str] | None = None,
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
    docs = await db[COLLECTION].aggregate(pipeline).to_list(length=500)
    return {d["_id"]: d["total"] for d in docs if d["_id"]}


async def get_remaining_settlement(
    db: AsyncIOMotorDatabase,
    owner_id: str | None,
    expense_id: str,
    *,
    owner_ids: list[str] | None = None,
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
        {"_id": oid, **owner_clause, "type": "expense"}
    )
    if expense is None:
        return None

    settled_map = await get_settled_amounts(db, owner_ids=ids)
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
