"""Transactional email via Resend API (or SMTP fallback)."""

import logging

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


def email_configured() -> bool:
    settings = get_settings()
    return bool(settings.resend_api_key or settings.smtp_host)


def _send_via_resend(*, to: str, subject: str, body: str) -> bool:
    settings = get_settings()
    try:
        response = httpx.post(
            RESEND_API_URL,
            headers={
                "Authorization": f"Bearer {settings.resend_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "from": settings.email_from,
                "to": [to],
                "subject": subject,
                "text": body,
            },
            timeout=15.0,
        )
        if response.is_success:
            return True
        logger.error(
            "Resend API error %s: %s", response.status_code, response.text
        )
        return False
    except Exception:
        logger.exception("Failed to send email via Resend to %s", to)
        return False


def _send_via_smtp(*, to: str, subject: str, body: str) -> bool:
    import smtplib
    from email.message import EmailMessage

    settings = get_settings()
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from or settings.smtp_user or "pairpocket@localhost"
    msg["To"] = to
    msg.set_content(body)

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_user and settings.smtp_password:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
        return True
    except Exception:
        logger.exception("Failed to send email via SMTP to %s", to)
        return False


def send_email(*, to: str, subject: str, body: str) -> bool:
    settings = get_settings()
    if settings.resend_api_key:
        return _send_via_resend(to=to, subject=subject, body=body)
    if settings.smtp_host:
        return _send_via_smtp(to=to, subject=subject, body=body)
    logger.info("Email not configured — skipping mail to %s: %s", to, subject)
    return False
