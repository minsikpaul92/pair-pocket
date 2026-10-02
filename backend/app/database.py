from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

from app.config import get_settings
from app.services.subscriptions import dedupe_subscription_transactions


class MongoDB:
    """Holds the shared Motor client/database instances for the app lifespan."""

    client: AsyncIOMotorClient | None = None
    database: AsyncIOMotorDatabase | None = None


db = MongoDB()


async def connect_to_mongo() -> None:
    settings = get_settings()
    db.client = AsyncIOMotorClient(settings.mongodb_uri)
    db.database = db.client[settings.mongodb_db_name]
    await _ensure_indexes()


async def _ensure_indexes() -> None:
    """Create the indexes that back our uniqueness / lookup guarantees."""
    assert db.database is not None
    await db.database["users"].create_index("google_id", unique=True)
    await db.database["users"].create_index("email", unique=True)
    await db.database["users"].create_index("shared_group_id", sparse=True)
    await db.database["user_settings"].create_index("owner_id", unique=True)
    await db.database["invitations"].create_index("token", unique=True)
    await db.database["invitations"].create_index([("inviter_id", 1), ("status", 1)])
    await db.database["transactions"].create_index([("owner_id", 1), ("date", -1)])
    await db.database["transactions"].create_index(
        [("owner_id", 1), ("category", 1), ("sub_category", 1)]
    )
    await db.database["transactions"].create_index(
        [("owner_id", 1), ("institution", 1)],
        sparse=True,
    )
    await db.database["transactions"].create_index(
        [("owner_id", 1), ("settles_expense_id", 1)],
        sparse=True,
    )

    # One document per default slot: switching a default can never leave two.
    await db.database["account_defaults"].create_index(
        [("scope_key", 1), ("currency", 1), ("role", 1)], unique=True
    )
    await db.database["account_defaults"].create_index(
        [("scope_key", 1), ("account_id", 1)]
    )

    group_scoped = (
        "transactions",
        "accounts",
        "subscriptions",
        "subscription_occurrences",
        "holdings",
    )
    for collection in group_scoped:
        await db.database[collection].create_index(
            [("shared_group_id", 1), ("owner_id", 1), ("account_type", 1)]
        )

    # Sign-in sessions: lookups by credential hash; Mongo drops expired rows.
    for collection, key in (
        ("auth_sessions", "token_hash"),
        ("auth_login_codes", "code_hash"),
        ("auth_legacy_upgrades", "token_hash"),
    ):
        await db.database[collection].create_index(key, unique=True)
        await db.database[collection].create_index("expires_at", expireAfterSeconds=0)
    await db.database["auth_sessions"].create_index("family_id")

    # Clean up legacy duplicate auto-generated expenses before unique index.
    await dedupe_subscription_transactions(db.database)
    try:
        await db.database["transactions"].create_index(
            "subscription_occurrence_id",
            unique=True,
            sparse=True,
        )
    except DuplicateKeyError:
        await dedupe_subscription_transactions(db.database)
        await db.database["transactions"].create_index(
            "subscription_occurrence_id",
            unique=True,
            sparse=True,
        )


async def close_mongo_connection() -> None:
    if db.client is not None:
        db.client.close()
        db.client = None
        db.database = None


def get_database() -> AsyncIOMotorDatabase:
    """FastAPI dependency that returns the active database handle."""
    if db.database is None:
        raise RuntimeError("Database connection is not initialized.")
    return db.database
