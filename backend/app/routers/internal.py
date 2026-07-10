"""Internal endpoints for scheduled jobs (cron)."""

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import get_settings
from app.database import get_database
from app.services.subscriptions import run_all_reminder_jobs

router = APIRouter(prefix="/api/internal", tags=["internal"])


async def verify_cron_secret(
    x_cron_secret: str = Header(alias="X-Cron-Secret"),
) -> None:
    settings = get_settings()
    if not settings.cron_secret or x_cron_secret != settings.cron_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )


@router.post("/cron/subscription-reminders")
async def cron_subscription_reminders(
    as_of: str | None = Query(default=None, description="YYYY-MM-DD"),
    _: None = Depends(verify_cron_secret),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    """Daily job: send promo/end email reminders for all users."""
    return await run_all_reminder_jobs(db, as_of=as_of)
