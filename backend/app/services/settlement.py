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
    db: AsyncIOMotorDatabase, owner_id: str
) -> dict[str, float]:
    """Map expense_id → total settlement income already received."""
    pipeline = [
        {
            "$match": {
                "owner_id": owner_id,
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
    db: AsyncIOMotorDatabase, owner_id: str, expense_id: str
) -> float | None:
    """Return how much of an expense can still be settled, or None if not found."""
    try:
        oid = ObjectId(expense_id)
    except InvalidId:
        return None

    expense = await db[COLLECTION].find_one(
        {"_id": oid, "owner_id": owner_id, "type": "expense"}
    )
    if expense is None:
        return None

    settled_map = await get_settled_amounts(db, owner_id)
    already = settled_map.get(expense_id, 0.0)
    return max(expense["amount"] - already, 0.0)
