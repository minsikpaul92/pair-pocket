"""Cancel dates for fixed expenses, and $0 (promo) charges kept off the calendar."""

import asyncio
from datetime import datetime

import pytest
from bson import ObjectId
from mongomock_motor import AsyncMongoMockClient

from app.services import subscriptions as svc


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def db(monkeypatch):
    async def _no_notify(*_args, **_kwargs):
        return None

    monkeypatch.setattr(svc, "notify_transaction", _no_notify)
    return AsyncMongoMockClient().subscription_cancel_tests


OWNER = "owner-1"


def make_sub(db, *, cycle="monthly", next_due, interval_days=None, **extra):
    doc = {
        "_id": ObjectId(),
        "owner_id": OWNER,
        "name": "Anthropic",
        "amount": 20.0,
        "currency": "CAD",
        "account_type": "personal",
        "shared_group_id": None,
        "cycle": cycle,
        "interval_days": interval_days,
        "start_date": datetime(2026, 1, 4),
        "next_due_date": next_due,
        "status": "active",
        "account_id": "acc-1",
        "category": "구독",
        "sub_category": "AI",
        "completed_installments": 0,
        "created_at": datetime(2026, 1, 1),
        "updated_at": datetime(2026, 1, 1),
        **extra,
    }
    run(db.subscriptions.insert_one(doc))
    run(svc.generate_occurrences(db, subscription=doc))
    return doc


def pending_dates(db, sub):
    occs = run(
        db.subscription_occurrences.find(
            {"subscription_id": str(sub["_id"]), "status": "pending"}
        ).to_list(length=None)
    )
    return sorted(o["due_date"] for o in occs)


def test_cancel_before_due_stops_the_upcoming_charge(db):
    sub = make_sub(db, next_due=datetime(2026, 12, 4))
    updated = run(svc.schedule_subscription_cancel(db, subscription=sub, as_of="2026-11-22"))
    assert updated["status"] == "cancel_scheduled"
    assert updated["cancel_effective_date"] == datetime(2026, 12, 4)
    assert updated["end_date"] == datetime(2026, 12, 3)
    assert pending_dates(db, sub) == []


def test_cancel_on_due_day_after_payment_keeps_paid_cycle(db):
    sub = make_sub(db, next_due=datetime(2026, 12, 4))
    n = run(
        svc.materialize_due_occurrences(
            db, owner_id=OWNER, account_type="personal", as_of="2026-12-04"
        )
    )
    assert n == 1
    sub = run(db.subscriptions.find_one({"_id": sub["_id"]}))
    assert sub["next_due_date"] == datetime(2027, 1, 4)

    updated = run(svc.schedule_subscription_cancel(db, subscription=sub, as_of="2026-12-04"))
    assert updated["cancel_effective_date"] == datetime(2027, 1, 4)
    assert updated["end_date"] == datetime(2027, 1, 3)
    assert pending_dates(db, sub) == []
    assert run(db.transactions.count_documents({"subscription_id": str(sub["_id"])})) == 1


def test_cancel_on_due_day_before_sync_does_not_drop_todays_charge(db):
    sub = make_sub(db, next_due=datetime(2026, 12, 4))
    updated = run(svc.schedule_subscription_cancel(db, subscription=sub, as_of="2026-12-04"))
    assert updated["cancel_effective_date"] == datetime(2027, 1, 4)
    assert pending_dates(db, sub) == [datetime(2026, 12, 4)]


def test_cancel_yearly(db):
    sub = make_sub(db, cycle="yearly", next_due=datetime(2027, 3, 1))
    updated = run(svc.schedule_subscription_cancel(db, subscription=sub, as_of="2026-11-22"))
    assert updated["cancel_effective_date"] == datetime(2027, 3, 1)
    assert updated["end_date"] == datetime(2027, 2, 28)
    assert pending_dates(db, sub) == []


def test_cancel_every_x_days(db):
    sub = make_sub(db, cycle="every_x_days", interval_days=10, next_due=datetime(2026, 11, 22))
    updated = run(svc.schedule_subscription_cancel(db, subscription=sub, as_of="2026-11-22"))
    assert updated["cancel_effective_date"] == datetime(2026, 12, 2)
    assert pending_dates(db, sub) == [datetime(2026, 11, 22)]


def test_cancel_effective_date_hides_and_finalizes(db):
    sub = make_sub(db, next_due=datetime(2026, 12, 4))
    updated = run(svc.schedule_subscription_cancel(db, subscription=sub, as_of="2026-11-22"))
    assert svc.subscription_visible_now(updated, datetime(2026, 12, 3))
    assert not svc.subscription_visible_now(updated, datetime(2026, 12, 4))
    assert svc.subscription_visible_in_month(updated, "2026-12", datetime(2026, 11, 22))
    assert not svc.subscription_visible_in_month(updated, "2027-01", datetime(2026, 11, 22))


def test_undo_cancel_restores_upcoming_charge(db):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.core.security import get_current_user
    from app.database import get_database
    from app.models.user import UserOut
    from app.routers import subscriptions as router

    user = UserOut(
        id=str(ObjectId()), google_id="g", email="o@example.com", name="o",
        shared_group_id=None,
    )
    sub = make_sub(db, next_due=datetime(2026, 12, 4), owner_id=user.id)
    app = FastAPI()
    app.include_router(router.router)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_database] = lambda: db
    client = TestClient(app)
    url = f"/api/subscriptions/{sub['_id']}/schedule-cancel?as_of=2026-11-22"

    res = client.post(url)
    assert res.status_code == 200, res.text
    assert res.json()["cancel_effective_date"].startswith("2026-12-04")
    assert pending_dates(db, sub) == []

    res = client.post(url)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "active"
    assert res.json()["cancel_effective_date"] is None
    assert datetime(2026, 12, 4) in pending_dates(db, sub)


def test_zero_charges_hidden_from_pending_until_promo_ends(db):
    sub = make_sub(
        db,
        next_due=datetime(2026, 12, 4),
        promo_amount=0.0,
        promo_end_date=datetime(2027, 1, 4),
    )
    dates = pending_dates(db, sub)
    assert datetime(2026, 12, 4) in dates and datetime(2027, 2, 4) in dates

    listed = run(
        svc.list_pending_occurrences(
            db, owner_id=OWNER, account_type="personal", as_of="2026-11-22"
        )
    )
    listed_dates = [o["due_date"] for o in listed]
    assert datetime(2026, 12, 4) not in listed_dates
    assert datetime(2027, 1, 4) not in listed_dates
    assert datetime(2027, 2, 4) in listed_dates


def test_zero_charge_creates_no_transaction_but_advances(db):
    sub = make_sub(db, next_due=datetime(2026, 12, 4), amount=0.0)
    run(
        svc.materialize_due_occurrences(
            db, owner_id=OWNER, account_type="personal", as_of="2026-12-04"
        )
    )
    assert run(db.transactions.count_documents({})) == 0
    refreshed = run(db.subscriptions.find_one({"_id": sub["_id"]}))
    assert refreshed["next_due_date"] == datetime(2027, 1, 4)


def test_dashboard_list_hides_zero_but_tab_keeps_it(db):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.core.security import get_current_user
    from app.database import get_database
    from app.models.user import UserOut
    from app.routers import subscriptions as router

    user = UserOut(
        id=str(ObjectId()), google_id="g", email="o@example.com", name="o",
        shared_group_id=None,
    )
    make_sub(db, next_due=datetime(2026, 12, 4), owner_id=user.id, promo_amount=0.0)
    make_sub(db, next_due=datetime(2026, 12, 4), owner_id=user.id, name="Paid")
    app = FastAPI()
    app.include_router(router.router)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_database] = lambda: db
    client = TestClient(app)

    tab = client.get("/api/subscriptions").json()
    dash = client.get("/api/subscriptions", params={"hide_zero": "true"}).json()
    assert len(tab) == 2
    assert [s["name"] for s in dash] == ["Paid"]


def test_legacy_cancel_scheduled_without_effective_date_is_hidden():
    sub = {
        "start_date": datetime(2025, 1, 2),
        "status": "cancel_scheduled",
        "end_date": datetime(2026, 10, 31),
    }
    today = datetime(2026, 11, 22)
    assert svc.subscription_visible_in_month(sub, "2026-10", today)
    assert not svc.subscription_visible_in_month(sub, "2026-11", today)
    assert not svc.subscription_visible_now(sub, today)


def test_edited_end_date_wins_over_cancel_effective_date():
    sub = {
        "start_date": datetime(2026, 9, 2),
        "status": "cancel_scheduled",
        "end_date": datetime(2026, 10, 31),
        "cancel_effective_date": datetime(2026, 12, 2),
    }
    assert not svc.subscription_visible_in_month(sub, "2026-11", datetime(2026, 11, 22))
