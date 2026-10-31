"""Expense-ratio stats: weekly ranges, transfer exclusion, hidden categories.

Uses an isolated Mongo mock; no network or production data.
"""

import asyncio
from datetime import datetime
from types import SimpleNamespace

import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

from app.core.security import get_current_user
from app.database import get_database
from app.models.ledger import (
    TRANSFER_CATEGORY,
    TRANSFER_SUB_ETRANSFER,
    TRANSFER_SUB_SHARED_FUNDING,
)
from app.models.user import UserOut
from app.routers.settings import router as settings_router
from app.routers.stats import router as stats_router
from app.routers.transactions import router as transactions_router


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def env():
    db = AsyncMongoMockClient().expense_ratio_tests
    user = UserOut(
        id=str(ObjectId()),
        google_id="owner",
        email="owner@example.com",
        name="owner",
        shared_group_id=None,
    )
    run(db.users.insert_one({"_id": ObjectId(user.id), "shared_group_id": None}))

    def add(day, amount, category, sub_category, **extra):
        doc = {
            "date": day,
            "amount": amount,
            "currency": "CAD",
            "type": "expense",
            "account_type": "personal",
            "shared_group_id": None,
            "category": category,
            "sub_category": sub_category,
            "merchant": "Shop",
            "kind": "normal",
            "owner_id": user.id,
            **extra,
        }
        run(db.transactions.insert_one(doc))

    # Week of Sun 2026-09-27 .. Sat 2026-10-03 spans a month boundary.
    add(datetime(2026, 9, 26, 23, 0), 999, "식비", "외식")  # Saturday before
    add(datetime(2026, 9, 27), 40, "식비", "외식")
    add(datetime(2026, 9, 30, 18, 30), 60, "생활/쇼핑", "생필품")
    add(datetime(2026, 10, 3, 23, 59), 25, "식비", "카페")
    add(datetime(2026, 10, 4), 500, "식비", "외식")  # next Sunday
    add(datetime(2026, 10, 1), 300, TRANSFER_CATEGORY, TRANSFER_SUB_SHARED_FUNDING)
    add(datetime(2026, 10, 2), 70, TRANSFER_CATEGORY, TRANSFER_SUB_ETRANSFER)

    app = FastAPI()
    for router in (stats_router, transactions_router, settings_router):
        app.include_router(router)
    app.dependency_overrides[get_database] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as client:
        yield SimpleNamespace(db=db, client=client, user=user)


def breakdown(body):
    return {r["category"]: r["amount"] for r in body["expense_breakdown_by_category"]}


def test_week_range_crosses_month_and_includes_both_ends(env):
    res = env.client.get(
        "/api/stats/summary",
        params={"currency": "CAD", "start": "2026-09-27", "end": "2026-10-03"},
    )
    assert res.status_code == 200
    body = res.json()
    assert breakdown(body) == {"식비": 65, "생활/쇼핑": 60}
    assert body["filters_applied"]["start"] == "2026-09-27"
    assert body["filters_applied"]["end"] == "2026-10-03"


def test_transfers_leave_ratio_but_stay_in_expense_totals(env):
    body = env.client.get(
        "/api/stats/summary",
        params={"currency": "CAD", "start": "2026-09-27", "end": "2026-10-03"},
    ).json()
    assert TRANSFER_CATEGORY not in breakdown(body)
    # Shared funding and e-Transfer are real cash leaving the personal book.
    assert body["total_expense"] == 40 + 60 + 25 + 300 + 70


def test_month_filter_still_works(env):
    body = env.client.get(
        "/api/stats/summary", params={"currency": "CAD", "month": "2026-10"}
    ).json()
    assert breakdown(body) == {"식비": 525}


@pytest.mark.parametrize(
    "params",
    [
        {"start": "2026-09-27"},
        {"end": "2026-10-03"},
        {"start": "2026-10-03", "end": "2026-09-27"},
        {"start": "2026-09-27", "end": "2026-10-03", "month": "2026-10"},
        {"start": "2025-01-01", "end": "2026-01-05"},
    ],
)
def test_invalid_ranges_are_rejected(env, params):
    res = env.client.get("/api/stats/summary", params=params)
    assert res.status_code == 422


def test_transaction_list_accepts_week_range(env):
    res = env.client.get(
        "/api/transactions", params={"start": "2026-09-27", "end": "2026-10-03"}
    )
    assert res.status_code == 200
    assert sorted(t["amount"] for t in res.json()) == [25, 40, 60, 70, 300]


def test_hidden_categories_are_saved_deduplicated(env):
    res = env.client.put(
        "/api/settings/expense-ratio-hidden-categories",
        json={"categories": [" 주거/통신 ", "주거/통신", "식비"]},
    )
    assert res.status_code == 200
    assert res.json()["expense_ratio_hidden_categories"] == ["주거/통신", "식비"]
    assert env.client.get("/api/settings").json()[
        "expense_ratio_hidden_categories"
    ] == ["주거/통신", "식비"]

    cleared = env.client.put(
        "/api/settings/expense-ratio-hidden-categories", json={"categories": []}
    )
    assert cleared.json()["expense_ratio_hidden_categories"] == []


def test_hidden_categories_reject_blank_names(env):
    res = env.client.put(
        "/api/settings/expense-ratio-hidden-categories", json={"categories": ["  "]}
    )
    assert res.status_code == 422


def test_sub_category_breakdown_matches_category_totals(env):
    body = env.client.get(
        "/api/stats/summary",
        params={"currency": "CAD", "start": "2026-09-27", "end": "2026-10-03"},
    ).json()
    rows = {
        (r["category"], r["sub_category"]): r["amount"]
        for r in body["expense_breakdown_by_sub_category"]
    }
    assert rows == {("식비", "외식"): 40, ("식비", "카페"): 25, ("생활/쇼핑", "생필품"): 60}


def test_hidden_entries_accept_sub_categories(env):
    res = env.client.put(
        "/api/settings/expense-ratio-hidden-categories",
        json={"categories": ["주거/통신 › 월세/모기지"]},
    )
    assert res.status_code == 200
    assert res.json()["expense_ratio_hidden_categories"] == ["주거/통신 › 월세/모기지"]
