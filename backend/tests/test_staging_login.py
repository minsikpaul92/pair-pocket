"""Staging test accounts: off outside test databases, sign-in, and reset."""

import asyncio
from types import SimpleNamespace

import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

from app.database import get_database
from app.routers import auth
from app.routers import staging_login as staging_router
from app.services import partnerships

PASSWORD = "staging-password"


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setattr(auth.settings, "session_cookie_secure", False)
    staging = staging_router.settings
    monkeypatch.setattr(staging, "test_login_password", PASSWORD)
    monkeypatch.setattr(staging, "mongodb_db_name", "pairpocket_staging")
    monkeypatch.setattr(staging_router, "FAILED_ATTEMPT_DELAY_SECONDS", 0)

    async def execute(_db, callback):
        return await callback(None)

    monkeypatch.setattr(partnerships, "_transaction", execute)

    db = AsyncMongoMockClient().staging_login_tests
    app = FastAPI()
    app.include_router(auth.router)
    app.include_router(staging_router.router)
    app.dependency_overrides[get_database] = lambda: db
    with TestClient(app) as client:
        yield SimpleNamespace(db=db, client=client)


def sign_in(env, account: str) -> str:
    res = env.client.post(
        "/api/auth/test-login", json={"account": account, "password": PASSWORD}
    )
    assert res.status_code == 200
    session = env.client.post("/api/auth/session", json={"code": res.json()["code"]})
    assert session.status_code == 200
    user = run(env.db.users.find_one({"google_id": f"test-login:{account}"}))
    return str(user["_id"])


@pytest.mark.parametrize(
    ("password", "database"),
    [("", "pairpocket_staging"), (PASSWORD, "pairpocket"), (PASSWORD, "staging_db")],
)
def test_off_unless_password_and_test_database(env, monkeypatch, password, database):
    monkeypatch.setattr(staging_router.settings, "test_login_password", password)
    monkeypatch.setattr(staging_router.settings, "mongodb_db_name", database)
    assert env.client.get("/api/auth/test-login").status_code == 404
    res = env.client.post(
        "/api/auth/test-login", json={"account": "tester1", "password": password}
    )
    assert res.status_code == 404
    assert run(env.db.users.count_documents({})) == 0


def test_lists_the_test_accounts(env):
    res = env.client.get("/api/auth/test-login")
    assert res.status_code == 200
    accounts = res.json()["accounts"]
    assert [a["id"] for a in accounts] == ["tester1", "tester2", "tester3", "tester4"]
    assert [a["locale"] for a in accounts] == ["ko", "ko", "en", "en"]


def test_rejects_wrong_password_and_unknown_account(env):
    wrong = env.client.post(
        "/api/auth/test-login", json={"account": "tester1", "password": "nope"}
    )
    assert wrong.status_code == 401
    assert wrong.json()["detail"] == "testLoginFailed"
    unknown = env.client.post(
        "/api/auth/test-login", json={"account": "admin", "password": PASSWORD}
    )
    assert unknown.status_code == 422
    assert run(env.db.users.count_documents({})) == 0


def test_sign_in_starts_like_a_new_user_in_the_account_language(env):
    user_id = sign_in(env, "tester3")
    assert sign_in(env, "tester3") == user_id  # signing in again reuses the user

    settings = run(env.db.user_settings.find_one({"owner_id": user_id}))
    assert settings["preferred_locales"] == ["en"]
    assert settings["onboarding_personal_completed"] is False
    assert run(env.db.users.count_documents({})) == 1


def test_reset_deletes_only_test_accounts(env):
    tester1, tester2, tester3 = (sign_in(env, f"tester{n}") for n in (1, 2, 3))
    real_id = ObjectId()
    real = str(real_id)
    run(
        env.db.users.insert_one(
            {
                "_id": real_id,
                "google_id": "google-real",
                "email": "real@example.org",
                "name": "Real",
                "shared_group_id": "mixed",
            }
        )
    )
    # Tester 1 and 2 are a couple; Tester 3 is linked with a real user.
    for uid, group in ((tester1, "testers"), (tester2, "testers"), (tester3, "mixed")):
        run(
            env.db.users.update_one(
                {"_id": ObjectId(uid)}, {"$set": {"shared_group_id": group}}
            )
        )
    run(
        env.db.shared_groups.insert_many(
            [
                {"_id": "testers", "members": [tester1, tester2], "status": "active"},
                {"_id": "mixed", "members": [tester3, real], "status": "active"},
            ]
        )
    )
    tester_account = run(env.db.accounts.insert_one({"owner_id": tester1})).inserted_id
    real_account = run(env.db.accounts.insert_one({"owner_id": real})).inserted_id
    run(
        env.db.account_defaults.insert_many(
            [
                {"scope_key": "shared:testers", "account_id": str(tester_account)},
                {"scope_key": f"personal:{real}", "account_id": str(real_account)},
            ]
        )
    )
    run(
        env.db.transactions.insert_many(
            [{"owner_id": tester2, "amount": 1}, {"owner_id": real, "amount": 2}]
        )
    )
    run(
        env.db.invitations.insert_one(
            {"inviter_id": tester1, "invitee_email": "x@example.org"}
        )
    )

    wrong = env.client.post("/api/auth/test-login/reset", json={"password": "nope"})
    assert wrong.status_code == 401
    assert run(env.db.users.count_documents({})) == 4

    res = env.client.post("/api/auth/test-login/reset", json={"password": PASSWORD})
    assert res.status_code == 200

    users = run(env.db.users.find({}).to_list(None))
    assert [u["google_id"] for u in users] == ["google-real"]
    assert users[0]["shared_group_id"] is None  # unlinked, not left in a dead group
    assert run(env.db.transactions.count_documents({})) == 1
    assert run(env.db.accounts.count_documents({})) == 1
    assert run(env.db.account_defaults.count_documents({})) == 1
    assert run(env.db.invitations.count_documents({})) == 0
    assert run(env.db.user_settings.count_documents({})) == 0
    assert run(env.db.auth_sessions.count_documents({})) == 0
    groups = run(env.db.shared_groups.find({}).to_list(None))
    assert [(g["_id"], g["status"]) for g in groups] == [("mixed", "archived")]


def test_couples_preset_links_testers_with_default_accounts(env):
    sign_in(env, "tester1")  # existing data is replaced, not merged
    res = env.client.post(
        "/api/auth/test-login/reset", json={"password": PASSWORD, "preset": "couples"}
    )
    assert res.status_code == 200

    users = {
        u["google_id"].split(":")[1]: u for u in run(env.db.users.find({}).to_list(None))
    }
    assert sorted(users) == ["tester1", "tester2", "tester3", "tester4"]
    assert users["tester1"]["shared_group_id"] == users["tester2"]["shared_group_id"]
    assert users["tester3"]["shared_group_id"] == users["tester4"]["shared_group_id"]
    assert users["tester1"]["shared_group_id"] != users["tester3"]["shared_group_id"]
    assert run(env.db.shared_groups.count_documents({"status": "active"})) == 2

    for user in users.values():
        uid = str(user["_id"])
        settings = run(env.db.user_settings.find_one({"owner_id": uid}))
        assert settings["onboarding_personal_completed"] is True
        assert settings["ledger_start_date"]
        personal = run(
            env.db.accounts.count_documents({"owner_id": uid, "account_type": "personal"})
        )
        assert personal == 2
        defaults = run(
            env.db.account_defaults.count_documents({"scope_key": f"personal:{uid}"})
        )
        assert defaults >= 1
    shared = run(env.db.accounts.find({"account_type": "shared"}).to_list(None))
    assert len(shared) == 2
    assert {a["shared_group_id"] for a in shared} == {
        users["tester1"]["shared_group_id"],
        users["tester3"]["shared_group_id"],
    }

    # Signing in keeps the prepared state; an empty reset clears it again.
    assert sign_in(env, "tester1") == str(users["tester1"]["_id"])
    env.client.post("/api/auth/test-login/reset", json={"password": PASSWORD})
    assert run(env.db.users.count_documents({})) == 0
    assert run(env.db.accounts.count_documents({})) == 0
