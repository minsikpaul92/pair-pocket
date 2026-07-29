"""Lightweight audit log writes for onboarding and settings changes."""

from datetime import datetime

from motor.motor_asyncio import AsyncIOMotorDatabase

AUDIT_COL = "audit_logs"


async def write_audit_log(
    db: AsyncIOMotorDatabase,
    *,
    owner_id: str,
    action: str,
    entity: str,
    entity_id: str | None = None,
    detail: dict | None = None,
) -> None:
    await db[AUDIT_COL].insert_one(
        {
            "owner_id": owner_id,
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "detail": detail or {},
            "timestamp": datetime.utcnow(),
        }
    )
