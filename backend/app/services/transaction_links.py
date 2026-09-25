"""Validate server-managed personal expense / shared income relationships."""

from bson import ObjectId
from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.ledger import (
    TRANSFER_CATEGORY,
    is_shared_funding_sub,
    normalize_transfer_category,
)
from app.models.user import UserOut
from app.services.access import assert_can_access_doc


def is_shared_funding(doc: dict) -> bool:
    return (
        normalize_transfer_category(doc.get("category", "")) == TRANSFER_CATEGORY
        and is_shared_funding_sub(doc.get("sub_category", ""))
    )


async def authorized_funding_twin(
    db: AsyncIOMotorDatabase, user: UserOut, doc: dict
) -> dict | None:
    """Authorize both entries before any mutation, including category changes.

    A shared ledger grants no write access to a partner's personal expense.
    Invalid legacy links fail closed instead of deleting unrelated records.
    """
    linked_id = doc.get("linked_transaction_id")
    if linked_id is None:
        return None
    if not isinstance(linked_id, str) or not ObjectId.is_valid(linked_id):
        raise HTTPException(status_code=409, detail="Invalid transaction link.")

    twin = await db["transactions"].find_one({"_id": ObjectId(linked_id)})
    await assert_can_access_doc(
        db, user, twin, not_found_detail="Linked transaction not found or not accessible."
    )
    roles = {
        (doc.get("account_type"), doc.get("type")),
        (twin.get("account_type"), twin.get("type")),
    }
    if (
        str(doc["_id"]) == linked_id
        or twin.get("linked_transaction_id") != str(doc["_id"])
        or twin.get("owner_id") != doc.get("owner_id")
        or roles != {("personal", "expense"), ("shared", "income")}
        or not is_shared_funding(doc)
        or not is_shared_funding(twin)
        or not doc.get("account_id")
        or not doc.get("counter_account_id")
        or doc["account_id"] == doc["counter_account_id"]
        or doc["account_id"] != twin.get("counter_account_id")
        or doc["counter_account_id"] != twin.get("account_id")
        or doc.get("currency") != twin.get("currency")
    ):
        raise HTTPException(status_code=409, detail="Invalid transaction link.")
    return twin
