"""Exercise ledger privacy through the real routes with an isolated Mongo mock.

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
from app.models.ledger import TRANSFER_CATEGORY, TRANSFER_SUB_SHARED_FUNDING
from app.models.user import UserOut
from app.routers.transactions import router


def run(coro):
    return asyncio.run(coro)


def payload(**changes):
    return {
        "date": "2026-09-01T00:00:00", "amount": 30, "currency": "CAD",
        "type": "expense", "account_type": "personal",
        "category": "식비", "sub_category": "식재료/장보기", "merchant": "Groceries",
        **changes,
    }


def stored(owner, **changes):
    return {
        **payload(), "date": datetime(2026, 9, 1),
        "_id": ObjectId(), "owner_id": owner.id, **changes,
    }


@pytest.fixture
def ledger():
    db = AsyncMongoMockClient().ledger_access_tests
    users = []
    for name, group in [("owner", "household"), ("partner", "household"), ("outsider", "other")]:
        user = UserOut(
            id=str(ObjectId()), google_id=name, email=f"{name}@example.com",
            name=name, shared_group_id=group,
        )
        run(db.users.insert_one({"_id": ObjectId(user.id), "shared_group_id": group}))
        users.append(user)
    owner, partner, outsider = users
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_database] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: owner
    with TestClient(app) as client:
        yield SimpleNamespace(db=db, client=client, owner=owner, partner=partner, outsider=outsider)


def insert(ledger, *docs):
    run(ledger.db.transactions.insert_many(list(docs)))


def snapshot(ledger):
    return run(ledger.db.transactions.find({}).sort("_id", 1).to_list(length=None))


def pair(ledger, owner=None):
    owner = owner or ledger.owner
    personal_account, shared_account = ObjectId(), ObjectId()
    run(ledger.db.accounts.insert_many([
        {"_id": personal_account, "owner_id": owner.id, "is_active": True,
         "account_type": "personal", "currency": "CAD", "is_liability": False},
        {"_id": shared_account, "owner_id": owner.id, "is_active": True,
         "account_type": "shared", "currency": "CAD", "is_liability": False},
    ]))
    expense = stored(
        owner, category=TRANSFER_CATEGORY, sub_category=TRANSFER_SUB_SHARED_FUNDING,
        account_id=str(personal_account), counter_account_id=str(shared_account),
    )
    income = stored(
        owner, category=TRANSFER_CATEGORY, sub_category=TRANSFER_SUB_SHARED_FUNDING,
        account_type="shared", type="income", account_id=str(shared_account),
        counter_account_id=str(personal_account), linked_transaction_id=str(expense["_id"]),
    )
    expense["linked_transaction_id"] = str(income["_id"])
    insert(ledger, expense, income)
    return expense, income


def request_for(doc, **changes):
    data = {
        key: value for key, value in doc.items()
        if key not in {"_id", "owner_id", "date", "linked_transaction_id"}
    }
    data.update(changes)
    return payload(**data)


@pytest.mark.parametrize("method", ["post", "put"])
def test_clients_cannot_supply_link_ids(ledger, method):
    own, target = stored(ledger.owner), stored(ledger.outsider)
    insert(ledger, own, target)
    before = snapshot(ledger)
    url = "/api/transactions" + (f"/{own['_id']}" if method == "put" else "")
    response = getattr(ledger.client, method)(url, json=payload(linked_transaction_id=str(target["_id"])))
    assert response.status_code == 422
    assert snapshot(ledger) == before


@pytest.mark.parametrize("method", ["put", "delete"])
@pytest.mark.parametrize("target_owner", ["partner", "outsider"])
def test_private_transaction_cannot_be_mutated(ledger, method, target_owner):
    target = stored(getattr(ledger, target_owner))
    insert(ledger, target)
    before = snapshot(ledger)
    kwargs = {"json": payload()} if method == "put" else {}
    response = getattr(ledger.client, method)(f"/api/transactions/{target['_id']}", **kwargs)
    assert response.status_code == 404
    assert snapshot(ledger) == before


@pytest.mark.parametrize("method", ["put", "delete"])
def test_legacy_foreign_link_is_blocked_before_any_write(ledger, method):
    target = stored(ledger.outsider)
    own = stored(ledger.owner, linked_transaction_id=str(target["_id"]))
    insert(ledger, own, target)
    before = snapshot(ledger)
    kwargs = {"json": payload(amount=99)} if method == "put" else {}
    response = getattr(ledger.client, method)(f"/api/transactions/{own['_id']}", **kwargs)
    assert response.status_code == 404
    assert snapshot(ledger) == before


@pytest.mark.parametrize("method", ["put", "delete"])
@pytest.mark.parametrize("broken", ["reciprocal", "owner", "role", "category", "account", "currency", "self", "invalid"])
def test_invalid_existing_links_fail_without_partial_writes(ledger, method, broken):
    expense, income = pair(ledger)
    patch = {
        "reciprocal": {"linked_transaction_id": str(ObjectId())},
        "owner": {"owner_id": ledger.partner.id},
        "role": {"type": "expense"},
        "category": {"category": "급여"},
        "account": {"account_id": str(ObjectId())},
        "currency": {"currency": "KRW"},
    }.get(broken)
    if patch:
        run(ledger.db.transactions.update_one({"_id": income["_id"]}, {"$set": patch}))
    else:
        link = str(expense["_id"]) if broken == "self" else "invalid"
        run(ledger.db.transactions.update_one({"_id": expense["_id"]}, {"$set": {"linked_transaction_id": link}}))
    before = snapshot(ledger)
    kwargs = {"json": payload()} if method == "put" else {}
    response = getattr(ledger.client, method)(f"/api/transactions/{expense['_id']}", **kwargs)
    assert response.status_code == 409
    assert snapshot(ledger) == before


@pytest.mark.parametrize("method", ["put", "delete"])
def test_partner_cannot_mutate_personal_entry_through_shared_twin(ledger, method):
    _, income = pair(ledger, ledger.partner)
    before = snapshot(ledger)
    kwargs = {"json": payload(account_type="shared", type="income", category="급여", sub_category="급여")} if method == "put" else {}
    response = getattr(ledger.client, method)(f"/api/transactions/{income['_id']}", **kwargs)
    assert response.status_code == 404
    assert snapshot(ledger) == before


@pytest.mark.parametrize("side", [0, 1])
def test_owner_can_delete_valid_funding_pair_from_either_side(ledger, side):
    docs = pair(ledger)
    response = ledger.client.delete(f"/api/transactions/{docs[side]['_id']}")
    assert response.status_code == 204
    assert snapshot(ledger) == []


@pytest.mark.parametrize("side", [0, 1])
def test_owner_can_update_valid_funding_pair_from_either_side(ledger, side):
    docs = pair(ledger)
    data = request_for(docs[side])
    data["amount"] = 75
    response = ledger.client.put(f"/api/transactions/{docs[side]['_id']}", json=data)
    assert response.status_code == 200, response.text
    saved = snapshot(ledger)
    assert len(saved) == 2
    assert all(doc["amount"] == 75 for doc in saved)
    assert {doc["linked_transaction_id"] for doc in saved} == {str(doc["_id"]) for doc in saved}


def test_create_shared_funding_generates_server_links(ledger):
    expense, _ = pair(ledger)
    run(ledger.db.transactions.delete_many({}))
    response = ledger.client.post("/api/transactions", json=request_for(expense))
    assert response.status_code == 201, response.text
    saved = snapshot(ledger)
    assert len(saved) == 2
    assert {doc["linked_transaction_id"] for doc in saved} == {str(doc["_id"]) for doc in saved}


def test_owner_can_change_funding_category_and_remove_own_twin(ledger):
    expense, _ = pair(ledger)
    response = ledger.client.put(f"/api/transactions/{expense['_id']}", json=payload())
    assert response.status_code == 200, response.text
    saved = snapshot(ledger)
    assert len(saved) == 1
    assert saved[0]["linked_transaction_id"] is None


def test_partner_can_edit_shared_entry_but_cannot_move_it_to_personal(ledger):
    doc = stored(ledger.partner, account_type="shared")
    insert(ledger, doc)
    response = ledger.client.put(f"/api/transactions/{doc['_id']}", json=payload(account_type="shared", amount=80))
    assert response.status_code == 200, response.text
    assert response.json()["owner_id"] == ledger.partner.id
    before = snapshot(ledger)
    response = ledger.client.put(f"/api/transactions/{doc['_id']}", json=payload())
    assert response.status_code == 403
    assert snapshot(ledger) == before
    assert ledger.client.delete(f"/api/transactions/{doc['_id']}").status_code == 204


@pytest.mark.parametrize("scope", ["personal", "shared"])
@pytest.mark.parametrize("endpoint", ["merchants", "merchants/all", "institutions"])
def test_suggestions_only_include_the_requested_ledger(ledger, scope, endpoint):
    docs = []
    for user in [ledger.owner, ledger.partner, ledger.outsider]:
        for account_type in ["personal", "shared"]:
            label = f"{user.name}-{account_type}"
            docs.append(stored(user, account_type=account_type, merchant=label,
                               institution=label, category="투자/저축", sub_category="저축성 예금"))
    insert(ledger, *docs)
    response = ledger.client.get(f"/api/transactions/{endpoint}", params={"account_type": scope, "category": "투자/저축"})
    assert response.status_code == 200, response.text
    expected = {"owner-personal"} if scope == "personal" else {"owner-shared", "partner-shared"}
    assert set(response.json()) == expected


@pytest.mark.parametrize("scope", ["personal", "shared"])
def test_merchant_lookup_ignores_private_and_foreign_categories(ledger, scope):
    wanted = stored(ledger.owner, account_type=scope, merchant="Same Shop")
    insert(ledger, wanted,
           stored(ledger.partner, merchant="Same Shop", category="Private category", date=datetime(2026, 9, 2)),
           stored(ledger.outsider, account_type=scope, merchant="Same Shop", category="Foreign category", date=datetime(2026, 9, 3)))
    response = ledger.client.get("/api/transactions/merchants/lookup", params={"account_type": scope, "name": "same shop"})
    assert response.json() == {"found": True, "category": wanted["category"], "sub_category": wanted["sub_category"]}


def test_private_only_merchant_is_not_discoverable_in_shared_lookup(ledger):
    insert(ledger, stored(ledger.partner, merchant="Private clinic"))
    response = ledger.client.get("/api/transactions/merchants/lookup", params={"account_type": "shared", "name": "Private clinic"})
    assert response.json() == {"found": False}


def test_unlinked_user_has_no_shared_history_suggestions(ledger):
    ledger.owner.shared_group_id = None
    insert(ledger, stored(ledger.owner, account_type="shared"))
    response = ledger.client.get("/api/transactions/merchants/all", params={"account_type": "shared"})
    assert response.json() == []


@pytest.mark.parametrize("method", ["put", "delete"])
def test_missing_twin_does_not_allow_partial_mutation(ledger, method):
    expense, income = pair(ledger)
    run(ledger.db.transactions.delete_one({"_id": income["_id"]}))
    before = snapshot(ledger)
    kwargs = {"json": payload()} if method == "put" else {}
    response = getattr(ledger.client, method)(f"/api/transactions/{expense['_id']}", **kwargs)
    assert response.status_code == 404
    assert snapshot(ledger) == before


@pytest.mark.parametrize("method", ["put", "delete"])
def test_unlinked_owner_cannot_cascade_into_inaccessible_shared_ledger(ledger, method):
    expense, _ = pair(ledger)
    ledger.owner.shared_group_id = None
    before = snapshot(ledger)
    kwargs = {"json": payload()} if method == "put" else {}
    response = getattr(ledger.client, method)(f"/api/transactions/{expense['_id']}", **kwargs)
    assert response.status_code == 404
    assert snapshot(ledger) == before


def test_regular_personal_transaction_still_supports_create_update_delete(ledger):
    created = ledger.client.post("/api/transactions", json=payload())
    assert created.status_code == 201, created.text
    assert created.json()["linked_transaction_id"] is None
    url = f"/api/transactions/{created.json()['id']}"
    updated = ledger.client.put(url, json=payload(amount=45))
    assert updated.status_code == 200, updated.text
    assert updated.json()["amount"] == 45
    assert ledger.client.delete(url).status_code == 204
    assert snapshot(ledger) == []


def test_custom_category_named_like_funding_does_not_create_links(ledger):
    run(ledger.db.user_settings.insert_one({
        "owner_id": ledger.owner.id,
        "custom_categories": {"expense": {"Custom": [TRANSFER_SUB_SHARED_FUNDING]}},
    }))
    response = ledger.client.post("/api/transactions", json=payload(
        category="Custom", sub_category=TRANSFER_SUB_SHARED_FUNDING,
    ))
    assert response.status_code == 201, response.text
    assert len(snapshot(ledger)) == 1
    assert response.json()["linked_transaction_id"] is None
