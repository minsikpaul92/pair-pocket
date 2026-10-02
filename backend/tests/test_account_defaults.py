"""Default account slots through the real routes with an isolated Mongo mock.

No network, credentials, production database, or AI calls are used.
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
from app.models.user import UserOut
from app.routers.account_defaults import router as defaults_router
from app.routers.accounts import router as accounts_router
from app.services import account_defaults_migration as migration


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def env():
    db = AsyncMongoMockClient().account_defaults_tests
    run(
        db.account_defaults.create_index(
            [("scope_key", 1), ("currency", 1), ("role", 1)], unique=True
        )
    )
    users = {}
    for name, group in [("owner", "home"), ("partner", "home"), ("outsider", "other")]:
        user = UserOut(
            id=str(ObjectId()),
            google_id=name,
            email=f"{name}@example.com",
            name=name,
            shared_group_id=group,
        )
        run(db.users.insert_one({"_id": ObjectId(user.id), "shared_group_id": group}))
        users[name] = user
    current = {"user": users["owner"]}

    app = FastAPI()
    app.include_router(accounts_router)
    app.include_router(defaults_router)
    app.dependency_overrides[get_database] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: current["user"]
    with TestClient(app) as client:

        def act_as(name):
            current["user"] = users[name]

        def create(name="Account", kind="checking", currency="CAD", **extra):
            res = client.post(
                "/api/accounts",
                json={"name": name, "kind": kind, "currency": currency, **extra},
            )
            assert res.status_code == 201, res.text
            return res.json()

        def defaults(account_type="personal"):
            res = client.get(
                "/api/account-defaults", params={"account_type": account_type}
            )
            assert res.status_code == 200, res.text
            return res.json()

        yield SimpleNamespace(
            db=db,
            client=client,
            users=users,
            act_as=act_as,
            create=create,
            defaults=defaults,
        )
        act_as("owner")


def slot(body, currency, role):
    return next(
        s for s in body["slots"] if s["currency"] == currency and s["role"] == role
    )


def resolved(body, currency, purpose):
    return body["resolved"][currency][purpose]["account_id"]


def add_tx(env, account_id, day):
    run(
        env.db.transactions.insert_one(
            {
                "owner_id": env.users["owner"].id,
                "account_type": "personal",
                "account_id": account_id,
                "date": day,
                "amount": 1,
                "type": "expense",
            }
        )
    )


def test_first_accounts_claim_empty_slots_and_later_ones_do_not(env):
    bank = env.create("TD", "checking")
    card = env.create("Visa", "credit_card")
    second_bank = env.create("RBC", "checking")

    assert bank["default_roles"] == ["bank", "income"]
    assert card["default_roles"] == ["card"]
    assert second_bank["default_roles"] == []
    body = env.defaults()
    assert slot(body, "CAD", "bank")["account_id"] == bank["id"]
    assert slot(body, "KRW", "bank")["status"] == "missing"
    # Subscriptions are never auto-claimed; they fall back to card → bank.
    assert slot(body, "CAD", "subscription")["status"] == "missing"


def test_purpose_chains_follow_card_first_and_bank_first_rules(env):
    bank = env.create("TD", "checking")
    card = env.create("Visa", "credit_card")
    body = env.defaults()
    assert resolved(body, "CAD", "expense") == card["id"]
    assert resolved(body, "CAD", "subscription") == card["id"]
    assert resolved(body, "CAD", "transfer") == bank["id"]
    assert resolved(body, "CAD", "income") == bank["id"]
    assert body["resolved"]["KRW"]["expense"]["reason"] == "no_account"


def test_expense_falls_back_to_bank_without_card(env):
    bank = env.create("TD", "checking")
    body = env.defaults()
    assert resolved(body, "CAD", "expense") == bank["id"]
    assert body["resolved"]["CAD"]["expense"]["source"] == "bank"


def test_switching_default_replaces_the_single_slot_document(env):
    first = env.create("TD", "checking")
    second = env.create("RBC", "checking")
    res = env.client.put(
        "/api/account-defaults/personal/CAD/bank", json={"account_id": second["id"]}
    )
    assert res.status_code == 200
    assert slot(res.json(), "CAD", "bank")["account_id"] == second["id"]
    count = run(
        env.db.account_defaults.count_documents({"currency": "CAD", "role": "bank"})
    )
    assert count == 1
    accounts = {a["id"]: a for a in env.client.get("/api/accounts").json()}
    assert "bank" not in accounts[first["id"]]["default_roles"]
    assert accounts[second["id"]]["is_default_expense"] is True


@pytest.mark.parametrize(
    "kind,currency,path",
    [
        ("credit_card", "CAD", "personal/CAD/bank"),
        ("checking", "KRW", "personal/CAD/bank"),
        ("checking", "CAD", "personal/CAD/brokerage"),
    ],
)
def test_ineligible_accounts_are_rejected(env, kind, currency, path):
    account = env.create("X", kind, currency)
    res = env.client.put(f"/api/account-defaults/{path}", json={"account_id": account["id"]})
    assert res.status_code == 422


def test_other_users_accounts_cannot_fill_my_slots(env):
    env.act_as("partner")
    partner_personal = env.create("Partner bank", "checking")
    env.act_as("owner")
    res = env.client.put(
        "/api/account-defaults/personal/CAD/bank",
        json={"account_id": partner_personal["id"]},
    )
    assert res.status_code == 404


def test_shared_defaults_are_common_to_both_partners(env):
    first = env.create("Joint A", "checking", account_type="shared")
    env.act_as("partner")
    second = env.create("Joint B", "checking", account_type="shared")
    res = env.client.put(
        "/api/account-defaults/shared/CAD/bank", json={"account_id": second["id"]}
    )
    assert res.status_code == 200
    env.act_as("owner")
    assert slot(env.defaults("shared"), "CAD", "bank")["account_id"] == second["id"]
    assert first["default_roles"] == ["bank", "income"]

    env.act_as("outsider")
    assert slot(env.defaults("shared"), "CAD", "bank")["status"] == "missing"
    res = env.client.put(
        "/api/account-defaults/shared/CAD/bank", json={"account_id": first["id"]}
    )
    assert res.status_code == 404


def test_deactivating_default_moves_it_to_most_recently_used(env):
    default = env.create("TD", "checking")
    stale = env.create("Old", "checking")
    recent = env.create("RBC", "checking")
    add_tx(env, stale["id"], datetime(2026, 1, 1))
    add_tx(env, recent["id"], datetime(2026, 9, 1))

    res = env.client.patch(f"/api/accounts/{default['id']}", json={"is_active": False})
    assert res.status_code == 200
    assert res.json()["default_roles"] == []
    body = env.defaults()
    assert slot(body, "CAD", "bank")["account_id"] == recent["id"]
    assert slot(body, "CAD", "income")["account_id"] == recent["id"]


def test_last_account_deactivated_leaves_slot_empty_until_new_account(env):
    only = env.create("TD", "checking")
    env.client.patch(f"/api/accounts/{only['id']}", json={"is_active": False})
    assert slot(env.defaults(), "CAD", "bank")["status"] == "missing"

    new = env.create("RBC", "checking")
    assert new["default_roles"] == ["bank", "income"]


def test_reactivated_account_claims_empty_slots(env):
    only = env.create("TD", "checking")
    env.client.patch(f"/api/accounts/{only['id']}", json={"is_active": False})
    res = env.client.patch(f"/api/accounts/{only['id']}", json={"is_active": True})
    assert res.json()["default_roles"] == ["bank", "income"]


def test_renaming_does_not_reclaim_a_slot_the_user_cleared(env):
    account = env.create("TD", "checking")
    env.client.delete("/api/account-defaults/personal/CAD/bank")
    env.client.patch(f"/api/accounts/{account['id']}", json={"name": "TD Main"})
    assert slot(env.defaults(), "CAD", "bank")["status"] == "missing"


def test_deleting_default_hands_slot_to_remaining_account(env):
    default = env.create("TD", "checking")
    other = env.create("RBC", "checking")
    res = env.client.delete(f"/api/accounts/{default['id']}")
    assert res.status_code == 204
    assert slot(env.defaults(), "CAD", "bank")["account_id"] == other["id"]


def test_account_editing_sets_independent_roles(env):
    env.create("TD", "checking")
    other = env.create("RBC", "checking")
    res = env.client.patch(
        f"/api/accounts/{other['id']}",
        json={"default_roles": ["income", "subscription"]},
    )
    assert res.status_code == 200
    assert sorted(res.json()["default_roles"]) == ["income", "subscription"]
    body = env.defaults()
    assert slot(body, "CAD", "income")["account_id"] == other["id"]
    assert slot(body, "CAD", "bank")["account_id"] != other["id"]

    bad = env.client.patch(
        f"/api/accounts/{other['id']}", json={"default_roles": ["card"]}
    )
    assert bad.status_code == 422


def test_legacy_flags_from_old_clients_still_work(env):
    env.create("Visa", "credit_card")
    card = env.create("Amex", "credit_card")
    # Old clients flagged cards with is_default_expense.
    res = env.client.patch(
        f"/api/accounts/{card['id']}", json={"is_default_expense": True}
    )
    assert res.json()["default_roles"] == ["card"]
    assert res.json()["is_default_credit"] is True


def test_brokerage_slot_follows_country_tab(env):
    broker = env.create("Wealthsimple", "investment", "USD", country="CA")
    assert broker["default_roles"] == ["brokerage"]
    body = env.defaults()
    assert slot(body, "CAD", "brokerage")["account_id"] == broker["id"]
    assert resolved(body, "CAD", "stock") == broker["id"]


def legacy_account(env, name, kind="checking", currency="CAD", **flags):
    doc = {
        "_id": ObjectId(),
        "name": name,
        "kind": kind,
        "currency": currency,
        "account_type": "personal",
        "shared_group_id": None,
        "owner_id": env.users["owner"].id,
        "is_active": True,
        "created_at": datetime(2026, 1, 1),
        "updated_at": datetime(2026, 1, 1),
        **flags,
    }
    run(env.db.accounts.insert_one(doc))
    return str(doc["_id"])


def test_migration_resolves_ambiguous_flags(env, tmp_path):
    older = legacy_account(env, "Old", is_default_expense=True)
    newer = legacy_account(
        env, "New", is_default_expense=True, updated_at=datetime(2026, 5, 1)
    )
    card = legacy_account(env, "Visa", "credit_card", is_default_income=True)
    inactive = legacy_account(
        env, "Closed", currency="KRW", is_default_expense=True, is_active=False
    )
    used = legacy_account(env, "Toss", currency="KRW")
    add_tx(env, used, datetime(2026, 8, 1))

    result = run(migration.plan(env.db))
    report = result["report"]
    assert report["duplicates"][0]["chosen"] == newer
    assert report["duplicates"][0]["ignored"] == [older]
    assert {"account_id": card, "flag": "is_default_income"} in report[
        "dropped_ineligible"
    ]
    assert report["replaced_inactive"][0]["account_id"] == used
    assert run(env.db.account_defaults.count_documents({})) == 0  # dry run

    assert run(migration.apply(env.db, result)) == 2
    body = env.defaults()
    assert slot(body, "CAD", "bank")["account_id"] == newer
    assert slot(body, "KRW", "bank")["account_id"] == used
    assert inactive not in {s["account_id"] for s in body["slots"]}
    # Rerun keeps existing slots.
    assert run(migration.apply(env.db, run(migration.plan(env.db)))) == 0

    counts = run(migration.cleanup_legacy(env.db, tmp_path / "backup.json"))
    assert counts["accounts"] == 4
    assert "is_default_expense" in (tmp_path / "backup.json").read_text()
    assert run(env.db.accounts.count_documents({"is_default_expense": {"$exists": True}})) == 0
