"""Built-in test accounts for staging, so testers can sign in without Google.

Test login is on only when TEST_LOGIN_PASSWORD is set and the database name
ends in one of TEST_DATABASE_SUFFIXES, so a misconfigured production app
(database `pairpocket`) can never expose it. Every account shares the password,
and a reset deletes everything the test accounts own. Real users are never
touched: test users are found by their fixed `google_id` values.
"""

from __future__ import annotations

import hmac

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import Settings
from app.models.user import UserOut
from app.services.partnerships import archive_partnership
from app.services.sessions import create_login_code

TEST_DATABASE_SUFFIXES = ("_staging", "_test", "_dev")

# Two couples: Tester 1 and 2 use Korean, Tester 3 and 4 use English.
TEST_ACCOUNTS: tuple[dict[str, str], ...] = (
    {"id": "tester1", "name": "Tester 1", "locale": "ko"},
    {"id": "tester2", "name": "Tester 2", "locale": "ko"},
    {"id": "tester3", "name": "Tester 3", "locale": "en"},
    {"id": "tester4", "name": "Tester 4", "locale": "en"},
)
_ACCOUNTS_BY_ID = {account["id"]: account for account in TEST_ACCOUNTS}

# Ledger data owned by a user through `owner_id`.
OWNED_COLLECTIONS = (
    "transactions",
    "accounts",
    "subscriptions",
    "subscription_occurrences",
    "holdings",
    "user_settings",
    "ocr_logs",
    "audit_logs",
)


def is_enabled(settings: Settings) -> bool:
    return bool(settings.test_login_password) and settings.mongodb_db_name.endswith(
        TEST_DATABASE_SUFFIXES
    )


def password_matches(settings: Settings, password: str) -> bool:
    return hmac.compare_digest(
        password.encode("utf-8"), settings.test_login_password.encode("utf-8")
    )


def _google_id(account_id: str) -> str:
    return f"test-login:{account_id}"


def _email(account_id: str) -> str:
    # example.com never receives mail; invitations fall back to the shareable link.
    return f"{account_id}@example.com"


def is_test_account(account_id: str) -> bool:
    return account_id in _ACCOUNTS_BY_ID


async def sign_in(db: AsyncIOMotorDatabase, account_id: str) -> str:
    """Create the test user on first use and return a one-time login code."""
    account = _ACCOUNTS_BY_ID[account_id]
    google_id = _google_id(account_id)
    await db["users"].update_one(
        {"google_id": google_id},
        {
            "$set": {
                "email": _email(account_id),
                "name": account["name"],
                "picture": None,
            },
            "$setOnInsert": {"google_id": google_id, "shared_group_id": None},
        },
        upsert=True,
    )
    user = await db["users"].find_one({"google_id": google_id})
    user_id = str(user["_id"])
    # Same starting point as a new Google user, with the account's language.
    await db["user_settings"].update_one(
        {"owner_id": user_id},
        {
            "$setOnInsert": {
                "owner_id": user_id,
                "merchants": [],
                "institutions": [],
                "custom_categories": {"expense": {}, "income": {}},
                "category_colors": {},
                "preferred_locale": account["locale"],
                "preferred_locales": [account["locale"]],
                "onboarding_personal_completed": False,
                "onboarding_personal_step": 0,
            }
        },
        upsert=True,
    )
    return await create_login_code(db, user_id)


async def reset(db: AsyncIOMotorDatabase) -> dict[str, int]:
    """Delete the test users and everything they own; return deleted counts."""
    google_ids = [_google_id(account["id"]) for account in TEST_ACCOUNTS]
    users = await db["users"].find({"google_id": {"$in": google_ids}}).to_list(None)
    user_ids = [str(user["_id"]) for user in users]
    deleted: dict[str, int] = {}
    if not user_ids:
        return deleted

    # Unlink first so a partner outside the test accounts keeps a valid state.
    for user in users:
        current = await db["users"].find_one({"_id": user["_id"]})
        if current and current.get("shared_group_id"):
            await archive_partnership(db, _user_out(current))

    owned = {"owner_id": {"$in": user_ids}}
    accounts = await db["accounts"].find(owned, {"_id": 1}).to_list(None)
    account_ids = [str(doc["_id"]) for doc in accounts]
    personal_scopes = [f"personal:{user_id}" for user_id in user_ids]
    # Groups made only of test users go; a group with a real member stays archived.
    in_groups = {"members": {"$in": user_ids}}
    groups = await db["shared_groups"].find(in_groups).to_list(None)
    test_only_groups = [
        group["_id"]
        for group in groups
        if set(group.get("members", [])) <= set(user_ids)
    ]
    shared_scopes = [f"shared:{group_id}" for group_id in test_only_groups]

    async def delete(collection: str, query: dict) -> None:
        result = await db[collection].delete_many(query)
        deleted[collection] = deleted.get(collection, 0) + result.deleted_count

    for collection in OWNED_COLLECTIONS:
        await delete(collection, owned)
    await delete(
        "account_defaults",
        {
            "$or": [
                {"account_id": {"$in": account_ids}},
                {"scope_key": {"$in": personal_scopes + shared_scopes}},
            ]
        },
    )
    await delete(
        "invitations",
        {
            "$or": [
                {"inviter_id": {"$in": user_ids}},
                {"accepted_by": {"$in": user_ids}},
                {"invitee_email": {"$in": [_email(a["id"]) for a in TEST_ACCOUNTS]}},
            ]
        },
    )
    await delete("shared_groups", {"_id": {"$in": test_only_groups}})
    await delete("auth_sessions", {"user_id": {"$in": user_ids}})
    await delete("auth_login_codes", {"user_id": {"$in": user_ids}})
    await delete("users", {"_id": {"$in": [ObjectId(uid) for uid in user_ids]}})
    return deleted


def _user_out(doc: dict) -> UserOut:
    return UserOut(
        id=str(doc["_id"]),
        google_id=doc["google_id"],
        email=doc["email"],
        name=doc["name"],
        picture=doc.get("picture"),
        shared_group_id=doc.get("shared_group_id"),
    )
