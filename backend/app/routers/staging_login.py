"""Staging-only sign-in with built-in test accounts.

Everything here answers 404 unless test login is enabled for this deployment
(see app/services/staging_login.py). The login code it returns is redeemed at
POST /api/auth/session like a Google sign-in.
"""

import asyncio
from typing import Literal

from fastapi import APIRouter, Depends, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from app.config import get_settings
from app.core.errors import AppError
from app.database import get_database
from app.services import staging_login

router = APIRouter(prefix="/api/auth/test-login", tags=["auth"])

settings = get_settings()

# Slows down password guessing on a public staging URL.
FAILED_ATTEMPT_DELAY_SECONDS = 1.0


class StagingLoginIn(BaseModel):
    account: str
    password: str


class StagingResetIn(BaseModel):
    password: str
    # "empty": brand-new users. "couples": Tester 1+2 and 3+4 linked, set up,
    # with default accounts (staging_login.seed_couples).
    preset: Literal["empty", "couples"] = "empty"


def _require_enabled() -> None:
    if not staging_login.is_enabled(settings):
        raise AppError(status.HTTP_404_NOT_FOUND, "notFound")


async def _require_password(password: str) -> None:
    if not staging_login.password_matches(settings, password):
        await asyncio.sleep(FAILED_ATTEMPT_DELAY_SECONDS)
        raise AppError(status.HTTP_401_UNAUTHORIZED, "testLoginFailed")


@router.get("")
async def list_test_accounts() -> dict:
    _require_enabled()
    return {"accounts": list(staging_login.TEST_ACCOUNTS)}


@router.post("")
async def sign_in_test_account(
    body: StagingLoginIn, db: AsyncIOMotorDatabase = Depends(get_database)
) -> dict:
    _require_enabled()
    await _require_password(body.password)
    if not staging_login.is_test_account(body.account):
        raise AppError(status.HTTP_422_UNPROCESSABLE_ENTITY, "testLoginFailed")
    return {"code": await staging_login.sign_in(db, body.account)}


@router.post("/reset")
async def reset_test_accounts(
    body: StagingResetIn, db: AsyncIOMotorDatabase = Depends(get_database)
) -> dict:
    _require_enabled()
    await _require_password(body.password)
    deleted = await staging_login.reset(db)
    if body.preset == "couples":
        await staging_login.seed_couples(db)
    return {"deleted": deleted, "preset": body.preset}
