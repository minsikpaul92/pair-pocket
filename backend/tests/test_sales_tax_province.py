"""The province that sets the expense form's sales tax rate."""

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
def client():
    db = AsyncMongoMockClient().sales_tax_province_tests
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
    with TestClient(app) as test_client:
        yield test_client


def test_defaults_to_ontario(client):
    res = client.get("/api/settings")
    assert res.status_code == 200, res.text
    assert res.json()["sales_tax_province"] == "ON"


def test_choice_is_saved_and_returned(client):
    res = client.put("/api/settings/sales-tax-province", json={"province": "QC"})
    assert res.status_code == 200, res.text
    assert res.json()["sales_tax_province"] == "QC"
    assert client.get("/api/settings").json()["sales_tax_province"] == "QC"


def test_every_province_and_territory_is_accepted(client):
    for code in "AB BC MB NB NL NS NT NU ON PE QC SK YT".split():
        res = client.put("/api/settings/sales-tax-province", json={"province": code})
        assert res.status_code == 200, f"{code}: {res.text}"


def test_unknown_code_is_rejected_and_keeps_the_old_choice(client):
    client.put("/api/settings/sales-tax-province", json={"province": "BC"})
    res = client.put("/api/settings/sales-tax-province", json={"province": "XX"})
    assert res.status_code == 422
    assert client.get("/api/settings").json()["sales_tax_province"] == "BC"
