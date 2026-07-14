from urllib.parse import urlencode

from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import get_settings
from app.core.security import create_access_token, get_current_user
from app.database import get_database
from app.models.user import UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])

settings = get_settings()

oauth = OAuth()
oauth.register(
    name="google",
    client_id=settings.google_client_id,
    client_secret=settings.google_client_secret,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


@router.get("/login")
async def login(request: Request):
    """Kick off the Google OAuth flow by redirecting to the consent screen."""
    if not settings.google_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google OAuth is not configured. Set GOOGLE_CLIENT_ID/SECRET.",
        )
    return await oauth.google.authorize_redirect(request, settings.oauth_redirect_uri)


@router.get("/callback")
async def callback(request: Request, db: AsyncIOMotorDatabase = Depends(get_database)):
    """Handle Google's redirect: exchange the code, upsert the user, issue a JWT."""
    try:
        token = await oauth.google.authorize_access_token(request)
    except OAuthError:
        return _redirect_to_frontend(error="oauth_failed")

    userinfo = token.get("userinfo")
    if not userinfo:
        userinfo = await oauth.google.userinfo(token=token)

    google_id = userinfo["sub"]
    google_tokens = {
        "access_token": token.get("access_token"),
        "refresh_token": token.get("refresh_token"),
        "expires_at": token.get("expires_at"),
    }

    # Upsert the user, keeping any existing shared_group_id intact.
    await db["users"].update_one(
        {"google_id": google_id},
        {
            "$set": {
                "email": userinfo.get("email"),
                "name": userinfo.get("name"),
                "picture": userinfo.get("picture"),
                "google_tokens": google_tokens,
            },
            "$setOnInsert": {
                "google_id": google_id,
                "shared_group_id": None,
            },
        },
        upsert=True,
    )

    document = await db["users"].find_one({"google_id": google_id})
    user_id = str(document["_id"])

    # Ensure a settings document exists for merchant/institution autocomplete hints.
    await db["user_settings"].update_one(
        {"owner_id": user_id},
        {
            "$setOnInsert": {
                "owner_id": user_id,
                "merchants": [],
                "institutions": [],
                "custom_categories": {"expense": {}, "income": {}},
                "category_colors": {},
            }
        },
        upsert=True,
    )

    access_token = create_access_token(subject=user_id)
    return _redirect_to_frontend(token=access_token)


@router.get("/me", response_model=UserOut)
async def read_me(current_user: UserOut = Depends(get_current_user)) -> UserOut:
    return current_user


def _redirect_to_frontend(
    *, token: str | None = None, error: str | None = None
) -> RedirectResponse:
    params = {}
    if token:
        params["token"] = token
    if error:
        params["error"] = error
    query = f"?{urlencode(params)}" if params else ""
    return RedirectResponse(url=f"{settings.frontend_url}/auth/callback{query}")
