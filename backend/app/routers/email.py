"""Email test endpoint."""

from fastapi import APIRouter, Depends, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from app.config import get_settings
from app.core.errors import AppError
from app.core.i18n import translate
from app.core.security import get_current_user
from app.database import get_database
from app.models.user import UserOut
from app.services.email import email_configured, recipient_locale, send_email

router = APIRouter(prefix="/api/email", tags=["email"])


class EmailTestResult(BaseModel):
    sent: bool
    to: str
    provider: str
    message: str


@router.post("/test", response_model=EmailTestResult)
async def send_test_email(
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> EmailTestResult:
    """Send a test email to the logged-in user's Google account address."""
    if not email_configured():
        # Set RESEND_API_KEY (https://resend.com) or SMTP_HOST in backend/.env.
        raise AppError(status.HTTP_503_SERVICE_UNAVAILABLE, "emailNotConfigured")

    settings = get_settings()
    provider = "resend" if settings.resend_api_key else "smtp"

    locale = await recipient_locale(db, current_user.id)
    body = (
        f"{translate(locale, 'email.test.body', name=current_user.name)}\n\n"
        f"{translate(locale, 'email.signature')}"
    )
    sent = send_email(
        to=current_user.email,
        subject=translate(locale, "email.test.subject"),
        body=body,
    )
    if not sent:
        raise AppError(status.HTTP_502_BAD_GATEWAY, "emailSendFailed")

    return EmailTestResult(
        sent=True,
        to=current_user.email,
        provider=provider,
        message="Test email sent. Check the inbox, including spam.",
    )
