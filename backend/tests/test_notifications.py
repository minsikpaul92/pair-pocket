"""Shared-ledger entries notify the partner; personal entries and twins do not."""

from bson import ObjectId
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.security import get_current_user
from app.database import get_database
from app.models.ledger import TRANSFER_SUB_SHARED_FUNDING
from app.routers import notifications as notifications_router
from tests.test_cross_settlement import add_expense, settle  # noqa: F401
from tests.test_ledger_integrity import body, env, run, transfer  # noqa: F401


def add(env, ledger, account, **extra):
    res = env.client.post(
        "/api/transactions",
        json=body(account_type=ledger, account_id=str(account["_id"]), **extra),
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def rows(env, user):
    return run(env.db.notifications.find({"recipient_id": user.id}).to_list(length=None))


def test_poster_reads_it_and_partner_does_not(env):
    owner_id = ObjectId(env.users["owner"].id)
    run(env.db.users.update_one({"_id": owner_id}, {"$set": {"name": "Owner"}}))
    tx_id = add(env, "shared", env.accounts.shared, merchant="Costco", amount=42.5)

    mine = rows(env, env.users["owner"])
    theirs = rows(env, env.users["partner"])
    assert [(r["is_read"], r["transaction_id"]) for r in mine] == [(True, tx_id)]
    assert [(r["is_read"], r["transaction_id"]) for r in theirs] == [(False, tx_id)]
    assert theirs[0]["actor_name"] == "Owner"
    assert (theirs[0]["merchant"], theirs[0]["amount"], theirs[0]["currency"]) == (
        "Costco",
        42.5,
        "CAD",
    )


def test_personal_entries_notify_nobody(env):
    add(env, "personal", env.accounts.personal)
    assert run(env.db.notifications.count_documents({})) == 0


def test_a_transfer_pair_notifies_once_for_the_shared_side(env):
    env.client.post(
        "/api/transactions",
        json=transfer(env, TRANSFER_SUB_SHARED_FUNDING, "expense", "personal"),
    ).raise_for_status()
    shared = [d for d in run(env.db.transactions.find({}).to_list(length=None))
              if d["account_type"] == "shared"]
    assert len(shared) == 1
    notes = rows(env, env.users["partner"])
    assert [r["transaction_id"] for r in notes] == [str(shared[0]["_id"])]


def test_a_cross_ledger_settlement_notifies_once(env):
    expense = add_expense(env, "shared", env.accounts.shared)
    run(env.db.notifications.delete_many({}))
    assert settle(env, expense, env.accounts.shared, env.accounts.personal).status_code == 201
    assert len(rows(env, env.users["partner"])) == 1


def test_notifying_twice_for_one_entry_does_not_duplicate(env):
    from app.services.notifications import notify_transaction

    add(env, "shared", env.accounts.shared)
    doc = run(env.db.transactions.find_one({}))
    run(notify_transaction(env.db, doc, actor_id=env.users["owner"].id))
    assert run(env.db.notifications.count_documents({})) == 2


def test_read_endpoints(env):
    app = FastAPI()
    app.include_router(notifications_router.router)
    app.dependency_overrides[get_database] = lambda: env.db
    app.dependency_overrides[get_current_user] = lambda: env.users["partner"]
    add(env, "shared", env.accounts.shared, merchant="A")
    add(env, "shared", env.accounts.shared, merchant="B")
    with TestClient(app) as client:
        assert client.get("/api/notifications/unread-count").json() == {"count": 2}
        listing = client.get("/api/notifications").json()
        assert [n["merchant"] for n in listing] == ["B", "A"]
        one = client.post(f"/api/notifications/{listing[0]['id']}/read")
        assert one.json() == {"count": 1}
        assert client.post("/api/notifications/read-all").json() == {"count": 0}
        assert client.get("/api/notifications/unread-count").json() == {"count": 0}
        assert client.post("/api/notifications/bad/read").status_code == 404

    # The poster's own rows were already read, and the partner's calls left them alone.
    assert all(r["is_read"] for r in rows(env, env.users["owner"]))
