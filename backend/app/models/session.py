from pydantic import BaseModel


class LoginCodeIn(BaseModel):
    """One-time code from the OAuth callback redirect."""

    code: str


class SessionOut(BaseModel):
    """A fresh access token; the refresh credential travels as a cookie."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int
