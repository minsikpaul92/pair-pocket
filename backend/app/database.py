from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import get_settings


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
    await db.database["user_settings"].create_index("owner_id", unique=True)
    await db.database["transactions"].create_index(
        [("owner_id", 1), ("date", -1)]
    )
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
