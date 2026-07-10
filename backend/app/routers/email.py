"""Email test endpoint."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.config import get_settings
from app.core.security import get_current_user
from app.models.user import UserOut
from app.services.email import email_configured, send_email

router = APIRouter(prefix="/api/email", tags=["email"])


class EmailTestResult(BaseModel):
    sent: bool
    to: str
    provider: str
    message: str


@router.post("/test", response_model=EmailTestResult)
async def send_test_email(
    current_user: UserOut = Depends(get_current_user),
) -> EmailTestResult:
    """Send a test email to the logged-in user's Google account address."""
    if not email_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "이메일 발송이 설정되지 않았습니다. "
                "backend/.env에 RESEND_API_KEY를 추가하세요. "
                "(https://resend.com 에서 무료 발급)"
            ),
        )

    settings = get_settings()
    provider = "resend" if settings.resend_api_key else "smtp"

    subject = "[PairPocket] 테스트 이메일"
    body = (
        f"안녕하세요 {current_user.name}님,\n\n"
        "PairPocket 이메일 알림이 정상적으로 동작합니다.\n"
        "구독 프로모션/종료 알림도 이 주소로 발송됩니다.\n\n"
        "PairPocket"
    )
    sent = send_email(to=current_user.email, subject=subject, body=body)
    if not sent:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="메일 발송에 실패했습니다. RESEND_API_KEY를 확인하세요.",
        )

    return EmailTestResult(
        sent=True,
        to=current_user.email,
        provider=provider,
        message="테스트 메일을 발송했습니다. 받은편지함(스팸함 포함)을 확인하세요.",
    )
