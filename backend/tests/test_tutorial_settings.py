"""Tutorial progress is stored per user, apart from onboarding."""

import asyncio

import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

from app.core.security import get_current_user
from app.database import get_database
from app.models.user import UserOut
from app.routers.settings import router as settings_router

DEFAULTS = {
    "completed": [],
    "dismissed": False,
    "offer_shown": False,
    "whats_new_done": [],
}


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def env():
    db = AsyncMongoMockClient().tutorial_tests
    user = UserOut(
        id=str(ObjectId()),
        google_id="owner",
        email="owner@example.com",
        name="owner",
        shared_group_id=None,
    )
    run(db.users.insert_one({"_id": ObjectId(user.id), "shared_group_id": None}))

    app = FastAPI()
    app.include_router(settings_router)
    app.dependency_overrides[get_database] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as client:
        yield type("Env", (), {"client": client, "db": db, "user": user})


def save(env, body):
    return env.client.put("/api/settings/tutorial", json=body)


def tutorial(env):
    return env.client.get("/api/settings").json()["tutorial"]


def test_new_user_has_defaults(env):
    assert tutorial(env) == DEFAULTS


def test_document_without_the_key_gets_defaults(env):
    env.client.get("/api/settings")
    run(env.db.user_settings.update_one({}, {"$unset": {"tutorial": ""}}))
    assert tutorial(env) == DEFAULTS


def test_save_returns_and_keeps_the_object(env):
    body = {
        "completed": ["basics", "subs"],
        "dismissed": True,
        "offer_shown": True,
        "whats_new_done": ["countrySetting"],
    }
    res = save(env, body)
    assert res.status_code == 200, res.text
    assert res.json()["tutorial"] == body
    assert tutorial(env) == body


def test_same_body_twice_gives_the_same_result(env):
    body = {"completed": ["basics"], "whats_new_done": ["a"]}
    first = save(env, body).json()["tutorial"]
    second = save(env, body).json()["tutorial"]
    assert first == second
    assert tutorial(env) == first


def test_unknown_module_is_rejected(env):
    res = save(env, {"completed": ["basics", "nope"]})
    assert res.status_code == 422
    assert tutorial(env) == DEFAULTS


def test_lengths_are_capped(env):
    assert save(env, {"whats_new_done": ["x" * 65]}).status_code == 422
    assert save(env, {"whats_new_done": [f"e{i}" for i in range(101)]}).status_code == 422
    assert save(env, {"completed": ["x" * 65]}).status_code == 422


def test_duplicates_are_dropped(env):
    res = save(env, {"completed": ["basics", "basics"], "whats_new_done": ["a", "a"]})
    assert res.json()["tutorial"]["completed"] == ["basics"]
    assert res.json()["tutorial"]["whats_new_done"] == ["a"]


def test_reset_all_clears_it(env):
    save(env, {"completed": ["basics"], "dismissed": True, "offer_shown": True})
    res = env.client.post("/api/settings/reset", params={"scope": "all"})
    assert res.status_code == 200, res.text
    assert tutorial(env) == DEFAULTS
