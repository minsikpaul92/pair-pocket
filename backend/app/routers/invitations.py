"""Partner invitation endpoints — link two users via shared_group_id."""

import secrets
from datetime import datetime, timedelta

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import get_settings
from app.core.security import get_current_user
from app.database import get_database
from app.models.invitation import (
    InvitationAccept,
    InvitationCreate,
    InvitationMeOut,
    InvitationOut,
    InvitationStatus,
    PartnerSummary,
)
from app.models.user import UserOut
from app.services.email import email_configured, send_email
from app.services.partnerships import accept_partner_invitation, archive_partnership

router = APIRouter(prefix="/api/invitations", tags=["invitations"])

COLLECTION = "invitations"
USERS_COL = "users"
INVITE_TTL_DAYS = 7


def _serialize_invite(
    doc: dict,
    *,
    email_sent: bool = False,
    accept_url: str | None = None,
) -> dict:
    return {
        "id": str(doc["_id"]),
        "invitee_email": doc["invitee_email"],
        "status": InvitationStatus(doc["status"]),
        "created_at": doc["created_at"],
        "expires_at": doc["expires_at"],
        "email_sent": email_sent,
        "accept_url": accept_url,
        "shared_ledger_start_date": doc.get("shared_ledger_start_date"),
    }


def _valid_start(value: str) -> bool:
    return len(value) == 10 and value[4] == "-" and value[7] == "-"


def _invite_email_body(
    *,
    inviter_name: str,
    accept_url: str,
    shared_start: str | None = None,
) -> str:
    start_line = f"공유 가계부 시작일: {shared_start}\n\n" if shared_start else ""
    return (
        f"{inviter_name}님이 PairPocket 공유 가계부에 초대했습니다.\n\n"
        f"{start_line}"
        f"아래 링크를 열고 Google로 로그인한 뒤 초대를 수락하세요.\n"
        f"(초대받은 Google 계정 이메일과 초대 이메일이 같아야 합니다.)\n\n"
        f"{accept_url}\n\n"
        f"이 링크는 {INVITE_TTL_DAYS}일 후 만료됩니다.\n"
    )


@router.get("/me", response_model=InvitationMeOut)
async def invitation_status(
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    partner: dict | None = None
    if current_user.shared_group_id:
        partner_doc = await db[USERS_COL].find_one(
            {
                "shared_group_id": current_user.shared_group_id,
                "_id": {"$ne": ObjectId(current_user.id)},
            }
        )
        if partner_doc:
            partner = {
                "id": str(partner_doc["_id"]),
                "email": partner_doc["email"],
                "name": partner_doc["name"],
                "picture": partner_doc.get("picture"),
            }

    pending = await db[COLLECTION].find_one(
        {
            "inviter_id": current_user.id,
            "status": InvitationStatus.PENDING.value,
            "expires_at": {"$gt": datetime.utcnow()},
        }
    )

    settings = get_settings()
    pending_out = None
    if pending:
        pending_url = f"{settings.frontend_url.rstrip('/')}/invite/{pending['token']}"
        pending_out = _serialize_invite(pending, accept_url=pending_url)

    return {
        "shared_group_id": current_user.shared_group_id,
        "partner": PartnerSummary(**partner) if partner else None,
        "pending_invite": pending_out,
    }


@router.post("", response_model=InvitationOut, status_code=status.HTTP_201_CREATED)
async def create_invitation(
    payload: InvitationCreate,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    if current_user.shared_group_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미 파트너와 연결되어 있습니다.",
        )

    invitee_email = payload.invitee_email.lower().strip()
    if invitee_email == current_user.email.lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="자기 자신은 초대할 수 없습니다.",
        )

    shared_start = payload.shared_ledger_start_date.strip()
    if not _valid_start(shared_start):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="shared_ledger_start_date must be YYYY-MM-DD",
        )

    existing_user = await db[USERS_COL].find_one({"email": invitee_email})
    if existing_user and existing_user.get("shared_group_id"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="상대방이 이미 다른 파트너와 연결되어 있습니다.",
        )

    # One active pending invite per inviter.
    await db[COLLECTION].update_many(
        {
            "inviter_id": current_user.id,
            "status": InvitationStatus.PENDING.value,
        },
        {"$set": {"status": InvitationStatus.REVOKED.value}},
    )

    now = datetime.utcnow()
    token = secrets.token_urlsafe(32)
    doc = {
        "inviter_id": current_user.id,
        "invitee_email": invitee_email,
        "token": token,
        "status": InvitationStatus.PENDING.value,
        "created_at": now,
        "expires_at": now + timedelta(days=INVITE_TTL_DAYS),
        "shared_ledger_start_date": shared_start,
    }
    result = await db[COLLECTION].insert_one(doc)
    created = await db[COLLECTION].find_one({"_id": result.inserted_id})

    settings = get_settings()
    accept_url = f"{settings.frontend_url.rstrip('/')}/invite/{token}"
    email_sent = False
    if email_configured():
        email_sent = send_email(
            to=invitee_email,
            subject=f"{current_user.name}님이 PairPocket에 초대했습니다",
            body=_invite_email_body(
                inviter_name=current_user.name,
                accept_url=accept_url,
                shared_start=shared_start,
            ),
        )
        if not email_sent:
            import logging

            logging.getLogger(__name__).warning(
                "Invite email failed; returning accept URL for manual share: %s",
                accept_url,
            )
    else:
        import logging

        logging.getLogger(__name__).warning(
            "Email not configured; invite created. Accept URL: %s", accept_url
        )

    # Always succeed once the invite exists — share accept_url if email failed.
    return _serialize_invite(
        created,
        email_sent=email_sent,
        accept_url=None if email_sent else accept_url,
    )


@router.post("/accept", response_model=InvitationMeOut)
async def accept_invitation(
    payload: InvitationAccept,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    group_id, inviter = await accept_partner_invitation(db, current_user, payload.token)

    partner = {
        "id": str(inviter["_id"]),
        "email": inviter["email"],
        "name": inviter["name"],
        "picture": inviter.get("picture"),
    }
    return {
        "shared_group_id": group_id,
        "partner": PartnerSummary(**partner),
        "pending_invite": None,
    }


@router.delete("/pending", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_pending_invitation(
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> None:
    result = await db[COLLECTION].update_many(
        {
            "inviter_id": current_user.id,
            "status": InvitationStatus.PENDING.value,
        },
        {"$set": {"status": InvitationStatus.REVOKED.value}},
    )
    if result.modified_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="취소할 대기 중 초대가 없습니다.",
        )


@router.delete("/partnership", response_model=InvitationMeOut)
async def unlink_partnership(
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    """Archive the old group; a subsequent invitation always creates a new group."""
    await archive_partnership(db, current_user)
    return {
        "shared_group_id": None,
        "partner": None,
        "pending_invite": None,
    }
