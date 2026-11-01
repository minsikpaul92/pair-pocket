from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from app.core.security import get_current_user
from app.database import get_database
from app.models.user import UserOut
from app.services import notifications

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class NotificationOut(BaseModel):
    id: str
    transaction_id: str
    actor_id: str
    actor_name: str
    merchant: str
    amount: float
    currency: str
    tx_type: str
    tx_date: datetime | None = None
    category: str
    sub_category: str
    is_read: bool
    created_at: datetime


class UnreadCountOut(BaseModel):
    count: int


@router.get("", response_model=list[NotificationOut])
async def list_notifications(
    limit: int = Query(default=50, ge=1, le=200),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[dict]:
    return await notifications.list_for(db, current_user.id, limit)


@router.get("/unread-count", response_model=UnreadCountOut)
async def get_unread_count(
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    return {"count": await notifications.unread_count(db, current_user.id)}


@router.post("/read-all", response_model=UnreadCountOut)
async def read_all(
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    await notifications.mark_all_read(db, current_user.id)
    return {"count": 0}


@router.post("/{notification_id}/read", response_model=UnreadCountOut)
async def read_one(
    notification_id: str,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    if not await notifications.mark_read(db, current_user.id, notification_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found.")
    return {"count": await notifications.unread_count(db, current_user.id)}
