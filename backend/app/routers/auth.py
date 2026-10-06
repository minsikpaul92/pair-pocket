from datetime import datetime, timezone
from urllib.parse import urlencode

from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import get_settings
from app.core.errors import AppError, error_body
from app.core.security import (
    bearer_scheme,
    create_access_token,
    decode_access_token,
    get_current_user,
)
from app.database import get_database
from app.models.session import LoginCodeIn, SessionOut
from app.models.user import UserOut
from app.services.sessions import (
    IssuedSession,
    SessionError,
    claim_legacy_upgrade,
    create_login_code,
    redeem_login_code,
    revoke_session,
    rotate_session,
    start_session,
)

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

DEV_GOOGLE_ID = "dev-local-preview"
DEV_EMAIL = "dev@example.com"
DEV_NAME = "Dev Preview"

# Scoped to the auth routes, which the frontend reaches through its own
# origin (see frontend/next.config.js) so the cookie is first-party.
REFRESH_COOKIE = "pp_refresh"
REFRESH_COOKIE_PATH = "/api/auth"


@router.get("/login")
async def login(
    request: Request, db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Kick off Google OAuth, or local preview login when OAuth is unset."""
    if settings.google_client_id:
        return await oauth.google.authorize_redirect(
            request, settings.oauth_redirect_uri
        )

    if settings.allow_dev_login:
        return await _dev_login_redirect(db)

    # Prefer a frontend redirect over a raw JSON 503 in the browser.
    return _redirect_to_frontend(error="oauth_not_configured")


async def _dev_login_redirect(db: AsyncIOMotorDatabase) -> RedirectResponse:
    """Upsert a stable local preview user and redirect with a JWT."""
    await db["users"].update_one(
        {"google_id": DEV_GOOGLE_ID},
        {
            "$set": {
                "email": DEV_EMAIL,
                "name": DEV_NAME,
                "picture": None,
                "google_tokens": {},
            },
            "$setOnInsert": {
                "google_id": DEV_GOOGLE_ID,
                "shared_group_id": None,
            },
        },
        upsert=True,
    )

    document = await db["users"].find_one({"google_id": DEV_GOOGLE_ID})
    user_id = str(document["_id"])

    await db["user_settings"].update_one(
        {"owner_id": user_id},
        {
            "$set": {
                "onboarding_personal_completed": True,
            },
            "$setOnInsert": {
                "owner_id": user_id,
                "merchants": [],
                "institutions": [],
                "custom_categories": {"expense": {}, "income": {}},
                "category_colors": {},
                "onboarding_personal_step": 0,
            },
        },
        upsert=True,
    )

    return _redirect_to_frontend(code=await create_login_code(db, user_id))


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
                "onboarding_personal_completed": False,
                "onboarding_personal_step": 0,
            }
        },
        upsert=True,
    )

    # A one-time code, not a token: URLs end up in history and logs.
    return _redirect_to_frontend(code=await create_login_code(db, user_id))


@router.post("/session", response_model=SessionOut)
async def create_session(
    body: LoginCodeIn,
    request: Request,
    response: Response,
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> SessionOut:
    """Redeem the callback's login code: set the refresh cookie, return a token."""
    _require_trusted_origin(request)
    try:
        user_id = await redeem_login_code(db, body.code)
    except SessionError as exc:
        raise AppError(status.HTTP_401_UNAUTHORIZED, "signInFailed") from exc
    issued = await start_session(
        db, user_id, user_agent=request.headers.get("user-agent")
    )
    return _issue(response, issued)


@router.post("/refresh", response_model=SessionOut)
async def refresh_session(
    request: Request,
    response: Response,
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Rotate the refresh cookie and return a new access token."""
    _require_trusted_origin(request)
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        return _session_ended()
    try:
        issued = await rotate_session(
            db, token, user_agent=request.headers.get("user-agent")
        )
    except SessionError:
        return _session_ended()
    return _issue(response, issued)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request, db: AsyncIOMotorDatabase = Depends(get_database)
) -> Response:
    _require_trusted_origin(request)
    token = request.cookies.get(REFRESH_COOKIE)
    if token:
        await revoke_session(db, token)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_refresh_cookie(response)
    return response


@router.post("/session/upgrade", response_model=SessionOut)
async def upgrade_legacy_session(
    request: Request,
    response: Response,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> SessionOut:
    """Give a pre-session 7-day token a renewable session, once.

    Only tokens without a session id qualify, so a short-lived session token
    cannot be stretched into a new session. Remove once those have expired.
    """
    payload = decode_access_token(credentials.credentials)
    if payload.get("sid"):
        raise AppError(status.HTTP_409_CONFLICT, "sessionAlreadyRenewable")
    expires_at = datetime.fromtimestamp(payload["exp"], timezone.utc)
    try:
        await claim_legacy_upgrade(
            db, credentials.credentials, expires_at.replace(tzinfo=None)
        )
    except SessionError as exc:
        raise AppError(status.HTTP_409_CONFLICT, "sessionUpgradeFailed") from exc
    issued = await start_session(
        db, current_user.id, user_agent=request.headers.get("user-agent")
    )
    return _issue(response, issued)


@router.get("/me", response_model=UserOut)
async def read_me(current_user: UserOut = Depends(get_current_user)) -> UserOut:
    return current_user


def _require_trusted_origin(request: Request) -> None:
    """Cookie-authenticated routes reject requests from other sites."""
    origin = request.headers.get("origin")
    if origin and origin not in settings.cors_origins_list:
        raise AppError(status.HTTP_403_FORBIDDEN, "untrustedOrigin")


def _issue(response: Response, issued: IssuedSession) -> SessionOut:
    if issued.refresh_token is not None:
        response.set_cookie(
            REFRESH_COOKIE,
            issued.refresh_token,
            max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
            path=REFRESH_COOKIE_PATH,
            httponly=True,
            secure=settings.session_cookie_secure,
            samesite="lax",
        )
    return SessionOut(
        access_token=create_access_token(issued.user_id, issued.family_id),
        expires_in=settings.access_token_expire_minutes * 60,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        REFRESH_COOKIE,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
    )


def _session_ended() -> JSONResponse:
    response = JSONResponse(
        error_body("sessionExpired"), status_code=status.HTTP_401_UNAUTHORIZED
    )
    _clear_refresh_cookie(response)
    return response


def _redirect_to_frontend(
    *, code: str | None = None, error: str | None = None
) -> RedirectResponse:
    params = {}
    if code:
        params["code"] = code
    if error:
        params["error"] = error
    query = f"?{urlencode(params)}" if params else ""
    return RedirectResponse(url=f"{settings.frontend_url}/auth/callback{query}")
