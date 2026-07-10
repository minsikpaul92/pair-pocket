"""Partner invitation models."""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, EmailStr, Field


class InvitationStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REVOKED = "revoked"
    EXPIRED = "expired"


class InvitationCreate(BaseModel):
    invitee_email: EmailStr


class InvitationAccept(BaseModel):
    token: str = Field(min_length=16, max_length=128)


class PartnerSummary(BaseModel):
    id: str
    email: EmailStr
    name: str
    picture: str | None = None


class InvitationOut(BaseModel):
    id: str
    invitee_email: EmailStr
    status: InvitationStatus
    created_at: datetime
    expires_at: datetime
    email_sent: bool = False
    accept_url: str | None = None


class InvitationMeOut(BaseModel):
    shared_group_id: str | None = None
    partner: PartnerSummary | None = None
    pending_invite: InvitationOut | None = None
