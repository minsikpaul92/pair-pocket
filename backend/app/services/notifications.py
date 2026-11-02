"""In-app notifications for entries added to the shared ledger.

Only the shared ledger notifies: a personal entry is invisible to the partner.
Every member of the group gets one row per entry; the member who made it has it
marked read, so only the partner sees it as unread. Rows are upserted by
(recipient, transaction), so an entry never notifies twice.
"""

import logging
from datetime import datetime

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.transaction import AccountType

COLLECTION = "notifications"
logger = logging.getLogger(__name__)


async def notify_transaction(
    db: AsyncIOMotorDatabase, doc: dict | None, *, actor_id: str | None = None
) -> None:
    """Record a new entry for the group. Never raises: it must not fail the write."""
    try:
        await _notify(db, doc, actor_id or (doc or {}).get("owner_id"))
    except Exception:  # noqa: BLE001
        logger.exception("Could not create notifications")


async def _notify(db: AsyncIOMotorDatabase, doc: dict | None, actor_id: str | None) -> None:
    if not doc or not actor_id:
        return
    group_id = doc.get("shared_group_id")
    if doc.get("account_type") != AccountType.SHARED.value or not group_id:
        return

    members = await db.users.find({"shared_group_id": group_id}).to_list(length=None)
    actor_name = next(
        (m.get("name") or "" for m in members if str(m["_id"]) == actor_id), ""
    )
    transaction_id = str(doc["_id"])
    now = datetime.utcnow()
    for member in members:
        recipient_id = str(member["_id"])
        await db[COLLECTION].update_one(
            {"recipient_id": recipient_id, "transaction_id": transaction_id},
            {
                "$setOnInsert": {
                    "recipient_id": recipient_id,
                    "transaction_id": transaction_id,
                    "shared_group_id": group_id,
                    "actor_id": actor_id,
                    "actor_name": actor_name,
                    "merchant": doc.get("merchant", ""),
                    "amount": doc.get("amount", 0),
                    "currency": doc.get("currency", ""),
                    "tx_type": doc.get("type", ""),
                    "tx_date": doc.get("date"),
                    "category": doc.get("category", ""),
                    "sub_category": doc.get("sub_category", ""),
                    "is_read": recipient_id == actor_id,
                    "created_at": now,
                }
            },
            upsert=True,
        )


def serialize(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "transaction_id": doc["transaction_id"],
        "actor_id": doc["actor_id"],
        "actor_name": doc.get("actor_name", ""),
        "merchant": doc.get("merchant", ""),
        "amount": doc.get("amount", 0),
        "currency": doc.get("currency", ""),
        "tx_type": doc.get("tx_type", ""),
        "tx_date": doc.get("tx_date"),
        "category": doc.get("category", ""),
        "sub_category": doc.get("sub_category", ""),
        "is_read": bool(doc.get("is_read")),
        "created_at": doc["created_at"],
    }


async def unread_count(db: AsyncIOMotorDatabase, user_id: str) -> int:
    return await db[COLLECTION].count_documents(
        {"recipient_id": user_id, "is_read": False}
    )


async def remove_for_transactions(
    db: AsyncIOMotorDatabase, transaction_ids: list[str]
) -> None:
    """Drop the notifications of deleted entries. Never raises."""
    try:
        await db[COLLECTION].delete_many({"transaction_id": {"$in": transaction_ids}})
    except Exception:  # noqa: BLE001
        logger.exception("Could not remove notifications")


async def list_for(db: AsyncIOMotorDatabase, user_id: str, limit: int = 50) -> list[dict]:
    docs = (
        await db[COLLECTION]
        .find({"recipient_id": user_id})
        .sort("created_at", -1)
        .to_list(length=limit)
    )
    # Entries deleted before notifications were cleaned up have nothing to open.
    ids = [ObjectId(d["transaction_id"]) for d in docs if ObjectId.is_valid(d["transaction_id"])]
    alive = {
        str(d["_id"])
        async for d in db["transactions"].find({"_id": {"$in": ids}}, {"_id": 1})
    }
    return [serialize(d) for d in docs if d["transaction_id"] in alive]


async def mark_read(db: AsyncIOMotorDatabase, user_id: str, notification_id: str) -> bool:
    if not ObjectId.is_valid(notification_id):
        return False
    result = await db[COLLECTION].update_one(
        {"_id": ObjectId(notification_id), "recipient_id": user_id},
        {"$set": {"is_read": True}},
    )
    return result.matched_count > 0


async def mark_all_read(db: AsyncIOMotorDatabase, user_id: str) -> int:
    result = await db[COLLECTION].update_many(
        {"recipient_id": user_id, "is_read": False}, {"$set": {"is_read": True}}
    )
    return result.modified_count
