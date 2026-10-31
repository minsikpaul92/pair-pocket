"""Personal ↔ shared transfer pairs and settlement integrity through real routes.

Uses an isolated Mongo mock; the autouse conftest fixture stands in for
MongoDB transactions and rolls back every collection when a write fails.
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
    TRANSFER_SUB_SHARED_FUNDING,
    TRANSFER_SUB_SHARED_WITHDRAWAL,
)
from app.models.user import UserOut
from app.routers import transactions as transactions_router
from app.services.accounts import compute_account_balance

SETTLEMENT = {"category": "정산", "sub_category": "N빵 정산/환급"}


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def env():
    db = AsyncMongoMockClient().ledger_integrity_tests
    users = {}
    for name, group in [("owner", "home"), ("partner", "home")]:
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

    def account(owner, account_type, currency="CAD", **extra):
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
            **extra,
        }
        run(db.accounts.insert_one(doc))
        return doc

    accounts = SimpleNamespace(
        personal=account(users["owner"], "personal"),
        shared=account(users["owner"], "shared"),
        partner_personal=account(users["partner"], "personal"),
        personal_krw=account(users["owner"], "personal", "KRW"),
    )

    app = FastAPI()
    app.include_router(transactions_router.router)
    app.dependency_overrides[get_database] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: current["user"]
    with TestClient(app) as client:

        def act_as(name):
            current["user"] = users[name]

        yield SimpleNamespace(
            db=db, client=client, users=users, accounts=accounts, act_as=act_as
        )


def body(**changes):
    return {
        "date": "2026-09-15T00:00:00",
        "amount": 100,
        "currency": "CAD",
        "type": "expense",
        "account_type": "personal",
        "category": "식비",
        "sub_category": "외식/배달",
        "merchant": "Shop",
        **changes,
    }


def transfer(env, sub, entry_type, ledger, amount=100):
    """Entry for a ledger transfer; account_id is in the entry's ledger."""
    entry_account = env.accounts.shared if ledger == "shared" else env.accounts.personal
    other = env.accounts.personal if ledger == "shared" else env.accounts.shared
    return body(
        type=entry_type,
        account_type=ledger,
        category=TRANSFER_CATEGORY,
        sub_category=sub,
        amount=amount,
        account_id=str(entry_account["_id"]),
        counter_account_id=str(other["_id"]),
    )


def docs(env):
    return run(env.db.transactions.find({}).sort("_id", 1).to_list(length=None))


def balance(env, account):
    owners = [env.users["owner"].id, env.users["partner"].id]
    return run(compute_account_balance(env.db, account_doc=account, owner_ids=owners))


def roles(saved):
    return {(d["account_type"], d["type"]) for d in saved}


@pytest.mark.parametrize(
    "sub,entry_type,ledger",
    [
        (TRANSFER_SUB_SHARED_FUNDING, "expense", "personal"),
        (TRANSFER_SUB_SHARED_FUNDING, "income", "shared"),
        (TRANSFER_SUB_SHARED_WITHDRAWAL, "expense", "shared"),
        (TRANSFER_SUB_SHARED_WITHDRAWAL, "income", "personal"),
    ],
)
def test_transfer_can_be_entered_from_either_side(env, sub, entry_type, ledger):
    res = env.client.post("/api/transactions", json=transfer(env, sub, entry_type, ledger))
    assert res.status_code == 201, res.text
    saved = docs(env)
    assert len(saved) == 2
    outflow = "personal" if sub == TRANSFER_SUB_SHARED_FUNDING else "shared"
    inflow = "shared" if outflow == "personal" else "personal"
    assert roles(saved) == {(outflow, "expense"), (inflow, "income")}
    assert {d["linked_transaction_id"] for d in saved} == {str(d["_id"]) for d in saved}
    shared = next(d for d in saved if d["account_type"] == "shared")
    assert shared["shared_group_id"] == "home"

    sign = -1 if outflow == "personal" else 1
    assert balance(env, env.accounts.personal) == sign * 100
    assert balance(env, env.accounts.shared) == -sign * 100


@pytest.mark.parametrize(
    "sub,entry_type,ledger",
    [
        (TRANSFER_SUB_SHARED_FUNDING, "expense", "shared"),
        (TRANSFER_SUB_SHARED_FUNDING, "income", "personal"),
        (TRANSFER_SUB_SHARED_WITHDRAWAL, "expense", "personal"),
        (TRANSFER_SUB_SHARED_WITHDRAWAL, "income", "shared"),
    ],
)
def test_wrong_side_for_direction_is_rejected(env, sub, entry_type, ledger):
    res = env.client.post("/api/transactions", json=transfer(env, sub, entry_type, ledger))
    assert res.status_code == 422
    assert docs(env) == []


def test_withdrawal_cannot_target_partners_personal_account(env):
    data = transfer(env, TRANSFER_SUB_SHARED_WITHDRAWAL, "expense", "shared")
    data["counter_account_id"] = str(env.accounts.partner_personal["_id"])
    res = env.client.post("/api/transactions", json=data)
    assert res.status_code == 422
    assert docs(env) == []


def test_editing_either_side_keeps_both_in_sync(env):
    env.client.post(
        "/api/transactions",
        json=transfer(env, TRANSFER_SUB_SHARED_WITHDRAWAL, "income", "personal"),
    )
    shared_side = next(d for d in docs(env) if d["account_type"] == "shared")
    data = transfer(env, TRANSFER_SUB_SHARED_WITHDRAWAL, "expense", "shared", amount=40)
    res = env.client.put(f"/api/transactions/{shared_side['_id']}", json=data)
    assert res.status_code == 200, res.text
    assert [d["amount"] for d in docs(env)] == [40, 40]
    assert balance(env, env.accounts.personal) == 40


@pytest.mark.parametrize("side", ["personal", "shared"])
def test_deleting_either_side_removes_the_pair(env, side):
    env.client.post(
        "/api/transactions",
        json=transfer(env, TRANSFER_SUB_SHARED_WITHDRAWAL, "expense", "shared"),
    )
    target = next(d for d in docs(env) if d["account_type"] == side)
    assert env.client.delete(f"/api/transactions/{target['_id']}").status_code == 204
    assert docs(env) == []


def test_ordinary_entry_converts_into_a_transfer_and_back(env):
    created = env.client.post(
        "/api/transactions",
        json=body(account_type="shared", account_id=str(env.accounts.shared["_id"])),
    ).json()
    data = transfer(env, TRANSFER_SUB_SHARED_WITHDRAWAL, "expense", "shared")
    res = env.client.put(f"/api/transactions/{created['id']}", json=data)
    assert res.status_code == 200, res.text
    assert roles(docs(env)) == {("shared", "expense"), ("personal", "income")}

    plain = body(account_type="shared", account_id=str(env.accounts.shared["_id"]))
    res = env.client.put(f"/api/transactions/{created['id']}", json=plain)
    assert res.status_code == 200, res.text
    saved = docs(env)
    assert len(saved) == 1 and saved[0]["linked_transaction_id"] is None


def test_partner_cannot_link_owners_entry_into_their_books(env):
    created = env.client.post(
        "/api/transactions",
        json=body(account_type="shared", account_id=str(env.accounts.shared["_id"])),
    ).json()
    env.act_as("partner")
    data = transfer(env, TRANSFER_SUB_SHARED_WITHDRAWAL, "expense", "shared")
    data["counter_account_id"] = str(env.accounts.partner_personal["_id"])
    res = env.client.put(f"/api/transactions/{created['id']}", json=data)
    assert res.status_code == 403
    assert len(docs(env)) == 1


def test_failed_twin_write_rolls_back_the_whole_pair(env, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("simulated failure after the first insert")

    monkeypatch.setattr(transactions_router, "twin_document", boom)
    with pytest.raises(RuntimeError):
        env.client.post(
            "/api/transactions",
            json=transfer(env, TRANSFER_SUB_SHARED_FUNDING, "expense", "personal"),
        )
    assert docs(env) == []


def test_failed_conversion_leaves_original_entry_untouched(env, monkeypatch):
    created = env.client.post(
        "/api/transactions",
        json=body(account_type="shared", account_id=str(env.accounts.shared["_id"])),
    ).json()
    before = docs(env)
    monkeypatch.setattr(
        transactions_router,
        "twin_document",
        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("fail")),
    )
    with pytest.raises(RuntimeError):
        env.client.put(
            f"/api/transactions/{created['id']}",
            json=transfer(env, TRANSFER_SUB_SHARED_WITHDRAWAL, "expense", "shared"),
        )
    assert docs(env) == before


def expense(env, amount=100, **changes):
    res = env.client.post(
        "/api/transactions",
        json=body(amount=amount, account_id=str(env.accounts.personal["_id"]), **changes),
    )
    assert res.status_code == 201, res.text
    return res.json()


def settle(env, expense_id, amount, **changes):
    return env.client.post(
        "/api/transactions",
        json=body(
            type="income",
            amount=amount,
            settles_expense_id=expense_id,
            **SETTLEMENT,
            **changes,
        ),
    )


def test_settlements_track_remaining_and_block_over_settlement(env):
    exp = expense(env, 100)
    assert settle(env, exp["id"], 60).status_code == 201
    over = settle(env, exp["id"], 41)
    assert over.status_code == 422
    assert settle(env, exp["id"], 40).status_code == 201
    assert settle(env, exp["id"], 0.01).status_code == 422
    settled = [d for d in docs(env) if d.get("settles_expense_id") == exp["id"]]
    assert sum(d["amount"] for d in settled) == 100
    # Each accepted settlement locked the expense inside its transaction (so
    # concurrent ones conflict); rejected attempts rolled back their lock.
    stored = run(env.db.transactions.find_one({"_id": ObjectId(exp["id"])}))
    assert stored["settlement_lock_rev"] == 2


def test_settlement_currency_must_match_expense(env):
    exp = expense(env, 100)
    res = settle(env, exp["id"], 10, currency="KRW")
    assert res.status_code == 422
    assert "통화" in res.json()["detail"]


def test_settlement_must_be_in_the_same_ledger(env):
    exp = expense(env, 100)
    res = settle(env, exp["id"], 10, account_type="shared")
    assert res.status_code == 422


def test_editing_settlement_counts_its_own_amount_once(env):
    exp = expense(env, 100)
    first = settle(env, exp["id"], 70).json()
    res = env.client.put(
        f"/api/transactions/{first['id']}",
        json=body(type="income", amount=100, settles_expense_id=exp["id"], **SETTLEMENT),
    )
    assert res.status_code == 200, res.text
    res = env.client.put(
        f"/api/transactions/{first['id']}",
        json=body(type="income", amount=101, settles_expense_id=exp["id"], **SETTLEMENT),
    )
    assert res.status_code == 422


@pytest.mark.parametrize(
    "changes,account",
    [
        ({"amount": 59}, "personal"),
        ({"currency": "KRW"}, "personal_krw"),
        ({"type": "income", "category": "부수입", "sub_category": "부업"}, "personal"),
    ],
)
def test_expense_edits_cannot_invalidate_settlements(env, changes, account):
    exp = expense(env, 100)
    settle(env, exp["id"], 60)
    before = docs(env)
    data = body(account_id=str(getattr(env.accounts, account)["_id"]), **changes)
    res = env.client.put(f"/api/transactions/{exp['id']}", json=data)
    assert res.status_code == 422
    assert docs(env) == before


def test_expense_can_still_grow_or_shrink_down_to_settled_total(env):
    exp = expense(env, 100)
    settle(env, exp["id"], 60)
    for amount in (120, 60):
        res = env.client.put(
            f"/api/transactions/{exp['id']}",
            json=body(amount=amount, account_id=str(env.accounts.personal["_id"])),
        )
        assert res.status_code == 200, res.text


def test_expense_with_settlement_cannot_be_deleted(env):
    exp = expense(env, 100)
    settle(env, exp["id"], 10)
    assert env.client.delete(f"/api/transactions/{exp['id']}").status_code == 422
