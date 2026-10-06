"""Switching a subscription / installment / fixed bill between personal and shared."""

import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

from app.core.security import get_current_user
from app.database import get_database
from app.models.user import UserOut
from app.routers import subscriptions as subscriptions_router


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def env():
    db = AsyncMongoMockClient().subscription_scope_tests
    users = {}
    for name, group in [("owner", "home"), ("partner", "home"), ("solo", None)]:
        user = UserOut(
            id=str(ObjectId()),
            google_id=name,
            email=f"{name}@example.com",
            name=name,
            shared_group_id=group,
        )
        run(db.users.insert_one({"_id": ObjectId(user.id), "shared_group_id": group}))
        users[name] = user

    def account(owner, account_type, currency="CAD"):
        doc = {
            "_id": ObjectId(),
            "name": f"{owner.google_id}-{account_type}-{currency}",
            "kind": "checking",
            "owner_id": owner.id,
            "account_type": account_type,
            "shared_group_id": owner.shared_group_id if account_type == "shared" else None,
            "currency": currency,
            "is_active": True,
            "is_liability": False,
            "opening_balance": 0.0,
        }
        run(db.accounts.insert_one(doc))
        return doc

    accounts = SimpleNamespace(
        personal=account(users["owner"], "personal"),
        shared=account(users["owner"], "shared"),
        shared_krw=account(users["owner"], "shared", "KRW"),
        partner_personal=account(users["partner"], "personal"),
        solo_personal=account(users["solo"], "personal"),
    )
    current = {"user": users["owner"]}
    app = FastAPI()
    app.include_router(subscriptions_router.router)
    app.dependency_overrides[get_database] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: current["user"]
    with TestClient(app) as client:

        def act_as(name):
            current["user"] = users[name]

        yield SimpleNamespace(
            db=db, client=client, users=users, accounts=accounts, act_as=act_as
        )


SOON = (datetime.utcnow() + timedelta(days=10)).strftime("%Y-%m-%dT00:00:00")


def sub_body(account, account_type, **changes):
    return {
        "name": "Netflix",
        "amount": 20,
        "currency": "CAD",
        "account_type": account_type,
        "cycle": "monthly",
        "start_date": SOON,
        "account_id": str(account["_id"]),
        "category": "문화/취미",
        "sub_category": "정기 구독",
        **changes,
    }


def create(env, account, account_type, **changes):
    res = env.client.post(
        "/api/subscriptions", json=sub_body(account, account_type, **changes)
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def pending(env, sub_id):
    return run(
        env.db.subscription_occurrences.find({"subscription_id": sub_id}).to_list(None)
    )


def test_personal_to_shared_moves_sub_and_pending(env):
    sub_id = create(env, env.accounts.personal, "personal")
    res = env.client.patch(
        f"/api/subscriptions/{sub_id}",
        json={"account_type": "shared", "account_id": str(env.accounts.shared["_id"])},
    )
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["account_type"] == "shared"
    assert out["account_id"] == str(env.accounts.shared["_id"])
    doc = run(env.db.subscriptions.find_one({"_id": ObjectId(sub_id)}))
    assert doc["shared_group_id"] == "home"
    occs = pending(env, sub_id)
    assert occs and all(
        o["account_type"] == "shared" and o["shared_group_id"] == "home" for o in occs
    )
    # The partner can now see it; it left the personal list.
    env.act_as("partner")
    shared = env.client.get("/api/subscriptions", params={"account_type": "shared"})
    assert [s["id"] for s in shared.json()] == [sub_id]


def test_shared_to_personal_clears_group(env):
    sub_id = create(env, env.accounts.shared, "shared")
    res = env.client.patch(
        f"/api/subscriptions/{sub_id}",
        json={"account_type": "personal", "account_id": str(env.accounts.personal["_id"])},
    )
    assert res.status_code == 200, res.text
    doc = run(env.db.subscriptions.find_one({"_id": ObjectId(sub_id)}))
    assert doc["account_type"] == "personal"
    assert doc["shared_group_id"] is None
    assert doc["owner_id"] == env.users["owner"].id
    assert all(o["account_type"] == "personal" for o in pending(env, sub_id))
    env.act_as("partner")
    shared = env.client.get("/api/subscriptions", params={"account_type": "shared"})
    assert shared.json() == []


def test_scope_change_requires_account_in_target_ledger(env):
    sub_id = create(env, env.accounts.personal, "personal")
    url = f"/api/subscriptions/{sub_id}"
    # No new account.
    assert env.client.patch(url, json={"account_type": "shared"}).status_code == 422
    # Still the personal account.
    res = env.client.patch(
        url,
        json={"account_type": "shared", "account_id": str(env.accounts.personal["_id"])},
    )
    assert res.status_code == 422
    # Wrong currency.
    res = env.client.patch(
        url,
        json={"account_type": "shared", "account_id": str(env.accounts.shared_krw["_id"])},
    )
    assert res.status_code == 422
    doc = run(env.db.subscriptions.find_one({"_id": ObjectId(sub_id)}))
    assert doc["account_type"] == "personal"


def test_shared_to_personal_rejects_shared_account(env):
    sub_id = create(env, env.accounts.shared, "shared")
    res = env.client.patch(
        f"/api/subscriptions/{sub_id}",
        json={"account_type": "personal", "account_id": str(env.accounts.shared["_id"])},
    )
    assert res.status_code == 422


def test_unlinked_user_cannot_move_to_shared(env):
    env.act_as("solo")
    sub_id = create(env, env.accounts.solo_personal, "personal")
    res = env.client.patch(
        f"/api/subscriptions/{sub_id}",
        json={"account_type": "shared", "account_id": str(env.accounts.solo_personal["_id"])},
    )
    assert res.status_code == 400


def test_same_scope_patch_is_unchanged(env):
    sub_id = create(env, env.accounts.personal, "personal")
    res = env.client.patch(
        f"/api/subscriptions/{sub_id}",
        json={"account_type": "personal", "name": "Netflix 4K"},
    )
    assert res.status_code == 200
    assert res.json()["name"] == "Netflix 4K"
    assert res.json()["account_type"] == "personal"


def test_installment_can_switch_scope(env):
    sub_id = create(
        env,
        env.accounts.personal,
        "personal",
        cycle="installment",
        total_installments=6,
        installment_start_date=SOON,
    )
    res = env.client.patch(
        f"/api/subscriptions/{sub_id}",
        json={"account_type": "shared", "account_id": str(env.accounts.shared["_id"])},
    )
    assert res.status_code == 200, res.text
    assert res.json()["account_type"] == "shared"


def test_past_charges_stay_in_original_ledger_after_switch(env):
    yesterday = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%dT00:00:00")
    sub_id = create(env, env.accounts.personal, "personal", start_date=yesterday)
    charged = run(env.db.transactions.find({"subscription_id": sub_id}).to_list(None))
    assert len(charged) == 1 and charged[0]["account_type"] == "personal"

    res = env.client.patch(
        f"/api/subscriptions/{sub_id}",
        json={"account_type": "shared", "account_id": str(env.accounts.shared["_id"])},
    )
    assert res.status_code == 200, res.text

    txs = run(env.db.transactions.find({"subscription_id": sub_id}).to_list(None))
    personal = [t for t in txs if t["account_type"] == "personal"]
    assert [t["_id"] for t in personal] == [charged[0]["_id"]]
    assert personal[0]["account_id"] == str(env.accounts.personal["_id"])
    # Nothing new is charged to the shared ledger until the next due date.
    assert all(t["account_type"] == "personal" for t in txs)
    upcoming = run(
        env.db.subscription_occurrences.find(
            {"subscription_id": sub_id, "status": "pending"}
        ).to_list(None)
    )
    assert upcoming and all(o["account_type"] == "shared" for o in upcoming)
