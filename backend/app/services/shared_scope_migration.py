"""Explicit migration for legacy shared records that predate group scoping."""

from datetime import datetime, timezone
from pathlib import Path

from bson import ObjectId, json_util


GROUP_SCOPED_COLLECTIONS = (
    "transactions",
    "accounts",
    "subscriptions",
    "subscription_occurrences",
    "holdings",
)


def legacy_shared_filter(member_ids: list[str]) -> dict:
    return {
        "owner_id": {"$in": member_ids},
        "account_type": "shared",
        "$or": [
            {"shared_group_id": {"$exists": False}},
            {"shared_group_id": None},
        ],
    }


async def inspect_legacy_shared_records(db, member_ids: list[str]) -> dict[str, int]:
    query = legacy_shared_filter(member_ids)
    return {
        collection: await db[collection].count_documents(query)
        for collection in GROUP_SCOPED_COLLECTIONS
    }


async def migrate_legacy_shared_records(
    db,
    *,
    group_id: str,
    member_ids: list[str],
    backup_path: Path,
) -> dict[str, int]:
    """Back up and tag only records explicitly assigned to an active group."""
    if len(set(member_ids)) != 2 or not all(
        ObjectId.is_valid(value) for value in member_ids
    ):
        raise ValueError("Exactly two valid member IDs are required.")

    users = await db.users.find(
        {
            "_id": {"$in": [ObjectId(value) for value in member_ids]},
            "shared_group_id": group_id,
        }
    ).to_list(length=3)
    if len(users) != 2:
        raise ValueError("Both members must currently belong to the requested group.")

    query = legacy_shared_filter(member_ids)
    backup = {
        "created_at": datetime.now(timezone.utc),
        "group_id": group_id,
        "member_ids": member_ids,
        "collections": {},
    }
    for collection in GROUP_SCOPED_COLLECTIONS:
        backup["collections"][collection] = (
            await db[collection].find(query).to_list(length=None)
        )

    backup_path.parent.mkdir(parents=True, exist_ok=True)
    backup_path.write_text(json_util.dumps(backup, indent=2), encoding="utf-8")

    migrated: dict[str, int] = {}
    for collection in GROUP_SCOPED_COLLECTIONS:
        result = await db[collection].update_many(
            query, {"$set": {"shared_group_id": group_id}}
        )
        migrated[collection] = result.modified_count

    await db.shared_groups.update_one(
        {"_id": group_id},
        {
            "$setOnInsert": {
                "members": member_ids,
                "status": "active",
                "created_at": datetime.now(timezone.utc),
                "source": "legacy_migration",
            }
        },
        upsert=True,
    )
    return migrated
