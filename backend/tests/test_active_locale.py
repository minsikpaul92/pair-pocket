"""Switching the UI language must not change which countries are enabled."""

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


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def env():
    db = AsyncMongoMockClient().active_locale_tests
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

        def save(locales):
            res = client.put(
                "/api/settings/locales",
                json={"preferred_locales": locales, "preferred_locale": locales[0]},
            )
            assert res.status_code == 200, res.text

        def switch(locale):
            return client.put(
                "/api/settings/active-locale", json={"preferred_locale": locale}
            )

        yield type("Env", (), {"client": client, "save": staticmethod(save), "switch": staticmethod(switch)})


def test_switching_keeps_both_chosen_languages(env):
    env.save(["ko", "en"])

    res = env.switch("en")

    assert res.status_code == 200
    assert res.json()["preferred_locale"] == "en"
    assert res.json()["preferred_locales"] == ["en", "ko"]

    res = env.switch("ko")
    assert res.json()["preferred_locale"] == "ko"
    assert res.json()["preferred_locales"] == ["ko", "en"]


def test_switching_to_a_new_language_adds_it_without_dropping_the_other(env):
    env.save(["en"])

    res = env.switch("ko")

    assert res.json()["preferred_locales"] == ["ko", "en"]


def test_never_keeps_more_than_two_languages(env):
    env.save(["ko", "en"])

    # A third supported language replaces the older secondary one.
    res = env.switch("ja")

    assert res.status_code == 200
    assert res.json()["preferred_locales"] == ["ja", "ko"]


def test_unsupported_language_is_rejected_and_nothing_changes(env):
    env.save(["ko", "en"])

    assert env.switch("xx").status_code == 400
    settings = env.client.get("/api/settings").json()
    assert settings["preferred_locales"] == ["ko", "en"]


def test_first_switch_without_saved_languages_stores_it(env):
    res = env.switch("en")

    assert res.json()["preferred_locale"] == "en"
    assert res.json()["preferred_locales"] == ["en"]
