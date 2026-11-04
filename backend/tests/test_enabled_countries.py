"""Which countries' ledgers are shown is its own setting, apart from languages."""

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
    db = AsyncMongoMockClient().enabled_countries_tests
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


def save_locales(env, locales):
    res = env.client.put(
        "/api/settings/locales",
        json={"preferred_locales": locales, "preferred_locale": locales[0]},
    )
    assert res.status_code == 200, res.text


def set_countries(env, countries):
    return env.client.put("/api/settings/countries", json={"countries": countries})


def countries(env):
    return env.client.get("/api/settings").json()["enabled_countries"]


def test_new_user_has_canada_only(env):
    assert countries(env) == ["CA"]


@pytest.mark.parametrize(
    "locales, expected",
    [(["en"], ["CA"]), (["ko"], ["CA", "KR"]), (["en", "ko"], ["CA", "KR"])],
)
def test_older_documents_fall_back_to_the_languages(env, locales, expected):
    save_locales(env, locales)
    assert countries(env) == expected


def test_english_user_turns_korea_on_and_off_without_changing_languages(env):
    save_locales(env, ["en"])

    res = set_countries(env, ["CA", "KR"])
    assert res.status_code == 200, res.text
    assert res.json()["enabled_countries"] == ["CA", "KR"]
    assert res.json()["preferred_locales"] == ["en"]

    res = set_countries(env, ["CA"])
    assert res.json()["enabled_countries"] == ["CA"]
    assert countries(env) == ["CA"]


def test_korean_user_can_turn_korea_off(env):
    save_locales(env, ["ko", "en"])

    res = set_countries(env, ["CA"])

    assert res.json()["enabled_countries"] == ["CA"]
    assert res.json()["preferred_locales"] == ["ko", "en"]


def test_order_is_fixed(env):
    res = set_countries(env, ["KR", "CA"])
    assert res.json()["enabled_countries"] == ["CA", "KR"]


@pytest.mark.parametrize("body", [["KR"], [], ["CA", "US"]])
def test_canada_is_required_and_unknown_codes_are_rejected(env, body):
    set_countries(env, ["CA", "KR"])

    assert set_countries(env, body).status_code in (400, 422)
    assert countries(env) == ["CA", "KR"]


def test_turning_korea_off_keeps_korean_data(env):
    run(
        env.db.accounts.insert_one(
            {"owner_id": env.user.id, "currency": "KRW", "country": "KR"}
        )
    )
    set_countries(env, ["CA", "KR"])
    set_countries(env, ["CA"])

    assert run(env.db.accounts.count_documents({"owner_id": env.user.id})) == 1


def test_switching_language_never_changes_countries(env):
    save_locales(env, ["en"])
    env.client.put("/api/settings/active-locale", json={"preferred_locale": "ko"})
    assert countries(env) == ["CA"]

    set_countries(env, ["CA", "KR"])
    env.client.put("/api/settings/active-locale", json={"preferred_locale": "en"})
    assert countries(env) == ["CA", "KR"]


def test_switching_language_keeps_korea_for_older_korean_documents(env):
    save_locales(env, ["ko"])
    env.client.put("/api/settings/active-locale", json={"preferred_locale": "en"})
    assert countries(env) == ["CA", "KR"]


@pytest.mark.parametrize(
    "locales, expected", [(["en"], ["CA"]), (["en", "ko"], ["CA", "KR"])]
)
def test_onboarding_sets_the_starting_countries_from_languages(env, locales, expected):
    set_countries(env, ["CA", "KR"] if expected == ["CA"] else ["CA"])
    res = env.client.post(
        "/api/settings/onboarding/basics",
        json={"preferred_locales": locales, "ledger_start_date": "2026-11-01"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["enabled_countries"] == expected
    stored = run(env.db.user_settings.find_one({"owner_id": env.user.id}))
    assert stored["enabled_countries"] == expected
