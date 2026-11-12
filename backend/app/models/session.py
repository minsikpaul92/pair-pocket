from pydantic import BaseModel


class LoginCodeIn(BaseModel):
    """One-time code from the OAuth callback redirect."""

    code: str


class SignupIn(BaseModel):
    """Finish a first sign-in: the pending token plus the user's agreement."""

    token: str
    agree: bool


class SessionOut(BaseModel):
    """A fresh access token; the refresh credential travels as a cookie."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int
