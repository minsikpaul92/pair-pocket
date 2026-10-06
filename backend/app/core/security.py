from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import get_settings
from app.core.errors import AppError
from app.database import get_database
from app.models.user import UserOut

bearer_scheme = HTTPBearer(auto_error=True)


def create_access_token(subject: str, session_id: str) -> str:
    """Issue an app JWT whose `sub` is the user's Mongo id (as a string).

    `sid` names the sign-in session family that issued it.
    """
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload = {"sub": subject, "sid": session_id, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    settings = get_settings()
    try:
        return jwt.decode(
            token, settings.secret_key, algorithms=[settings.jwt_algorithm]
        )
    except jwt.PyJWTError:
        raise AppError(status.HTTP_401_UNAUTHORIZED, "sessionExpired")


def _decode_token(token: str) -> str:
    payload = decode_access_token(token)
    subject = payload.get("sub")
    if not subject:
        raise AppError(status.HTTP_401_UNAUTHORIZED, "sessionExpired")
    return subject


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> UserOut:
    from bson import ObjectId
    from bson.errors import InvalidId

    user_id = _decode_token(credentials.credentials)
    try:
        object_id = ObjectId(user_id)
    except InvalidId:
        raise AppError(status.HTTP_401_UNAUTHORIZED, "sessionExpired")

    document = await db["users"].find_one({"_id": object_id})
    if document is None:
        raise AppError(status.HTTP_401_UNAUTHORIZED, "sessionExpired")

    return UserOut(
        id=str(document["_id"]),
        google_id=document["google_id"],
        email=document["email"],
        name=document["name"],
        picture=document.get("picture"),
        shared_group_id=document.get("shared_group_id"),
    )
