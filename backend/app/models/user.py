from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class UserBase(BaseModel):
    """Profile fields sourced from the Google account (PRD.md §4 `users`)."""

    email: EmailStr
    name: str
    picture: str | None = None


class GoogleTokens(BaseModel):
    """OAuth tokens returned by Google, persisted on the user document."""

    access_token: str | None = None
    refresh_token: str | None = None
    expires_at: int | None = None


class UserInDB(UserBase):
    """Full user document as stored in MongoDB."""

    google_id: str  # Google's stable subject identifier ("sub")
    shared_group_id: str | None = None
    google_tokens: GoogleTokens = Field(default_factory=GoogleTokens)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class UserOut(UserBase):
    """User payload safe to return to the client (no OAuth tokens)."""

    id: str
    google_id: str
    shared_group_id: str | None = None
