"""Renewable sign-in sessions with rotating, revocable refresh credentials.

A sign-in starts a session *family*. Every refresh swaps the presented
credential for a new one. Presenting a credential that was already rotated
away revokes the whole family, since only a copy could still hold it, except
within a short grace window where another tab of the same browser refreshed
with the same cookie at the same moment. Only SHA-256 hashes are stored.
"""

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.config import get_settings
from app.services import db_transactions

SESSIONS = "auth_sessions"
LOGIN_CODES = "auth_login_codes"
LEGACY_UPGRADES = "auth_legacy_upgrades"


class SessionError(Exception):
    """The presented credential is unknown, expired, used, or revoked."""


@dataclass
class IssuedSession:
    user_id: str
    family_id: str
    # None when the browser already holds the current credential.
    refresh_token: str | None


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _new_secret() -> str:
    return secrets.token_urlsafe(32)


def _session_doc(
    user_id: str, family_id: str, token: str, user_agent: str | None
) -> dict:
    now = datetime.utcnow()
    return {
        "token_hash": _hash(token),
        "user_id": user_id,
        "family_id": family_id,
        "created_at": now,
        "expires_at": now
        + timedelta(days=get_settings().refresh_token_expire_days),
        "rotated_at": None,
        "revoked_at": None,
        "user_agent": user_agent,
    }


async def create_login_code(db, user_id: str) -> str:
    """One-time code the OAuth callback passes to the frontend."""
    code = _new_secret()
    now = datetime.utcnow()
    await db[LOGIN_CODES].insert_one(
        {
            "code_hash": _hash(code),
            "user_id": user_id,
            "created_at": now,
            "expires_at": now
            + timedelta(seconds=get_settings().login_code_expire_seconds),
        }
    )
    return code


async def redeem_login_code(db, code: str) -> str:
    """Consume a login code and return its user id."""
    doc = await db[LOGIN_CODES].find_one_and_delete({"code_hash": _hash(code)})
    if doc is None or doc["expires_at"] <= datetime.utcnow():
        raise SessionError("Sign-in code is invalid or expired.")
    return doc["user_id"]


async def start_session(
    db, user_id: str, *, user_agent: str | None = None
) -> IssuedSession:
    family_id = str(ObjectId())
    token = _new_secret()
    await db[SESSIONS].insert_one(_session_doc(user_id, family_id, token, user_agent))
    return IssuedSession(user_id, family_id, token)


async def rotate_session(
    db, token: str, *, user_agent: str | None = None
) -> IssuedSession:
    """Exchange a refresh credential for its successor."""
    token_hash = _hash(token)

    async def claim(session):
        doc = await db[SESSIONS].find_one_and_update(
            {
                "token_hash": token_hash,
                "rotated_at": None,
                "revoked_at": None,
                "expires_at": {"$gt": datetime.utcnow()},
            },
            {"$set": {"rotated_at": datetime.utcnow()}},
            session=session,
        )
        if doc is None:
            return None
        successor = _new_secret()
        await db[SESSIONS].insert_one(
            _session_doc(doc["user_id"], doc["family_id"], successor, user_agent),
            session=session,
        )
        return IssuedSession(doc["user_id"], doc["family_id"], successor)

    issued = await db_transactions.run_in_transaction(db, claim)
    if issued is not None:
        return issued

    now = datetime.utcnow()
    doc = await db[SESSIONS].find_one({"token_hash": token_hash})
    if (
        doc is None
        or doc["revoked_at"] is not None
        or doc["expires_at"] <= now
        or doc["rotated_at"] is None
    ):
        raise SessionError("Session expired.")

    grace = timedelta(seconds=get_settings().refresh_reuse_grace_seconds)
    if now - doc["rotated_at"] <= grace:
        return IssuedSession(doc["user_id"], doc["family_id"], None)

    await revoke_family(db, doc["family_id"])
    raise SessionError("Session credential was reused.")


async def claim_legacy_upgrade(db, token: str, token_expires_at: datetime) -> None:
    """Let each pre-session token start a renewable session only once."""
    try:
        await db[LEGACY_UPGRADES].insert_one(
            {"token_hash": _hash(token), "expires_at": token_expires_at}
        )
    except DuplicateKeyError:
        raise SessionError("This sign-in was already upgraded.")


async def revoke_family(db, family_id: str) -> None:
    await db[SESSIONS].update_many(
        {"family_id": family_id, "revoked_at": None},
        {"$set": {"revoked_at": datetime.utcnow()}},
    )


async def revoke_session(db, token: str) -> None:
    """Sign out: revoke the family the credential belongs to, if any."""
    doc = await db[SESSIONS].find_one({"token_hash": _hash(token)})
    if doc is not None:
        await revoke_family(db, doc["family_id"])
