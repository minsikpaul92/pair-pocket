"""Renewable sign-in sessions through the real auth routes.

Uses an isolated Mongo mock; no network, Google OAuth, or production data.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

from app.config import get_settings
from app.database import get_database
from app.routers import auth
from app.services import sessions
from app.services.sessions import LEGACY_UPGRADES, LOGIN_CODES, SESSIONS

COOKIE = auth.REFRESH_COOKIE


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def env(monkeypatch):
    # TestClient talks plain http, which never carries Secure cookies.
    monkeypatch.setattr(auth.settings, "session_cookie_secure", False)
    monkeypatch.setattr(auth.settings, "cors_origins", "https://app.example")

    db = AsyncMongoMockClient().session_tests
    for collection, key in (
        (SESSIONS, "token_hash"),
        (LOGIN_CODES, "code_hash"),
        (LEGACY_UPGRADES, "token_hash"),
    ):
        run(db[collection].create_index(key, unique=True))
    user_id = ObjectId()
    run(
        db.users.insert_one(
            {
                "_id": user_id,
                "google_id": "g-1",
                "email": "owner@example.com",
                "name": "Owner",
                "shared_group_id": None,
            }
        )
    )

    app = FastAPI()
    app.include_router(auth.router)
    app.dependency_overrides[get_database] = lambda: db
    with TestClient(app) as client:

        def sign_in():
            code = run(sessions.create_login_code(db, str(user_id)))
            res = client.post("/api/auth/session", json={"code": code})
            assert res.status_code == 200, res.text
            return res.json()["access_token"]

        def refresh(cookie=None):
            if cookie is not None:
                client.cookies.clear()
                client.cookies.set(COOKIE, cookie)
            return client.post("/api/auth/refresh")

        def me(token):
            return client.get(
                "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
            )

        yield SimpleNamespace(
            db=db,
            client=client,
            user_id=str(user_id),
            sign_in=sign_in,
            refresh=refresh,
            me=me,
        )


def claims(token):
    settings = get_settings()
    return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])


def legacy_token(user_id, days=7):
    """A pre-session token: no `sid`, seven-day lifetime."""
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(days=days)
    return jwt.encode(
        {"sub": user_id, "exp": expire},
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )


def test_login_code_starts_a_session_once(env):
    code = run(sessions.create_login_code(env.db, env.user_id))

    res = env.client.post("/api/auth/session", json={"code": code})
    assert res.status_code == 200, res.text
    assert env.client.cookies.get(COOKIE)
    token = res.json()["access_token"]
    assert claims(token)["sid"]
    assert env.me(token).json()["email"] == "owner@example.com"

    replay = env.client.post("/api/auth/session", json={"code": code})
    assert replay.status_code == 401


def test_expired_login_code_is_rejected(env):
    code = run(sessions.create_login_code(env.db, env.user_id))
    run(
        env.db[LOGIN_CODES].update_many(
            {}, {"$set": {"expires_at": datetime.utcnow() - timedelta(seconds=1)}}
        )
    )
    res = env.client.post("/api/auth/session", json={"code": code})
    assert res.status_code == 401


def test_login_redirect_carries_a_code_not_a_token(env, monkeypatch):
    monkeypatch.setattr(auth.settings, "google_client_id", "")
    monkeypatch.setattr(auth.settings, "allow_dev_login", True)

    res = env.client.get("/api/auth/login", follow_redirects=False)
    query = parse_qs(urlparse(res.headers["location"]).query)
    assert "token" not in query
    code = query["code"][0]
    assert env.client.post("/api/auth/session", json={"code": code}).status_code == 200


def test_refresh_rotates_the_cookie(env):
    first_token = env.sign_in()
    first_cookie = env.client.cookies.get(COOKIE)

    res = env.refresh()
    assert res.status_code == 200, res.text
    second_cookie = env.client.cookies.get(COOKIE)
    assert second_cookie and second_cookie != first_cookie

    token = res.json()["access_token"]
    assert claims(token)["sid"] == claims(first_token)["sid"]
    assert env.me(token).status_code == 200
    assert env.refresh().status_code == 200


def test_concurrent_refresh_within_grace_keeps_the_session(env):
    env.sign_in()
    first_cookie = env.client.cookies.get(COOKIE)
    assert env.refresh().status_code == 200
    current_cookie = env.client.cookies.get(COOKIE)

    # A second tab presents the cookie the first tab just rotated away.
    res = env.refresh(first_cookie)
    assert res.status_code == 200
    assert "set-cookie" not in res.headers
    assert env.me(res.json()["access_token"]).status_code == 200

    # The rotated-in credential still works.
    assert env.refresh(current_cookie).status_code == 200


def test_reused_credential_after_grace_revokes_the_family(env):
    env.sign_in()
    first_cookie = env.client.cookies.get(COOKIE)
    assert env.refresh().status_code == 200
    current_cookie = env.client.cookies.get(COOKIE)
    run(
        env.db[SESSIONS].update_many(
            {"rotated_at": {"$ne": None}},
            {"$set": {"rotated_at": datetime.utcnow() - timedelta(minutes=5)}},
        )
    )

    assert env.refresh(first_cookie).status_code == 401
    assert env.refresh(current_cookie).status_code == 401


def test_expired_session_cannot_refresh(env):
    env.sign_in()
    run(
        env.db[SESSIONS].update_many(
            {}, {"$set": {"expires_at": datetime.utcnow() - timedelta(seconds=1)}}
        )
    )
    res = env.refresh()
    assert res.status_code == 401
    assert not env.client.cookies.get(COOKIE)


def test_refresh_without_cookie_is_unauthorized(env):
    assert env.refresh().status_code == 401


def test_logout_revokes_the_session(env):
    env.sign_in()
    cookie = env.client.cookies.get(COOKIE)

    res = env.client.post("/api/auth/logout")
    assert res.status_code == 204
    assert not env.client.cookies.get(COOKIE)
    assert env.refresh(cookie).status_code == 401


def test_logout_only_ends_its_own_session(env):
    env.sign_in()
    other_device = env.client.cookies.get(COOKIE)
    env.client.cookies.clear()
    env.sign_in()

    assert env.client.post("/api/auth/logout").status_code == 204
    assert env.refresh(other_device).status_code == 200


def test_cookie_routes_reject_other_sites(env):
    env.sign_in()
    res = env.client.post(
        "/api/auth/refresh", headers={"Origin": "https://evil.example"}
    )
    assert res.status_code == 403
    trusted = env.client.post(
        "/api/auth/refresh", headers={"Origin": "https://app.example"}
    )
    assert trusted.status_code == 200


def test_legacy_token_upgrades_once(env):
    token = legacy_token(env.user_id)
    headers = {"Authorization": f"Bearer {token}"}

    res = env.client.post("/api/auth/session/upgrade", headers=headers)
    assert res.status_code == 200, res.text
    assert claims(res.json()["access_token"])["sid"]
    assert env.refresh().status_code == 200

    again = env.client.post("/api/auth/session/upgrade", headers=headers)
    assert again.status_code == 409


def test_session_token_cannot_be_upgraded(env):
    token = env.sign_in()
    res = env.client.post(
        "/api/auth/session/upgrade", headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 409
