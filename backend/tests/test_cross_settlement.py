"""Settlements paid from the other ledger (personal ↔ shared) through real routes."""

import pytest
from bson import ObjectId

from app.models.transaction import AccountType, Currency
from app.services.settlement import settled_total
from app.services.stats import compute_stats
from tests.test_ledger_integrity import balance, body, docs, env, run  # noqa: F401

DATE = "2026-09-20T00:00:00"


def add_expense(env, ledger, account, amount=100):
    res = env.client.post(
        "/api/transactions",
        json=body(account_type=ledger, account_id=str(account["_id"]), amount=amount),
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def settle(env, expense_id, receive, pay, amount=100, **extra):
    return env.client.post(
        "/api/transactions/cross-settlement",
        json={
            "expense_id": expense_id,
            "amount": amount,
            "date": DATE,
            "receive_account_id": str(receive["_id"]),
            "pay_account_id": str(pay["_id"]),
            **extra,
        },
    )


def stats(env, ledger):
    owners = [env.users["owner"].id, env.users["partner"].id]
    return run(
        compute_stats(
            env.db,
            owner_ids=owners if ledger == "shared" else [env.users["owner"].id],
            account_type=AccountType(ledger),
            shared_group_id="home",
            currency=Currency.CAD,
            month="2026-09",
        )
    )


def pair(env):
    saved = docs(env)
    income = next(d for d in saved if d["type"] == "income")
    expense = next(
        d for d in saved if d["type"] == "expense" and d.get("pair_kind") == "settlement"
    )
    return income, expense


def test_shared_expense_settled_from_a_personal_account(env):
    shared, personal = env.accounts.shared, env.accounts.personal
    expense_id = add_expense(env, "shared", shared)

    res = settle(env, expense_id, receive=shared, pay=personal)
    assert res.status_code == 201, res.text
    income, payment = pair(env)

    assert (income["account_type"], income["type"]) == ("shared", "income")
    assert (income["category"], income["sub_category"]) == ("정산", "N빵 정산/환급")
    assert income["settles_expense_id"] == expense_id
    assert income["account_id"] == str(shared["_id"])
    assert income["shared_group_id"] == "home"
    assert (payment["account_type"], payment["type"]) == ("personal", "expense")
    assert (payment["category"], payment["sub_category"]) == ("식비", "외식/배달")
    assert payment["merchant"] == "Shop"
    assert payment["account_id"] == str(personal["_id"])
    assert payment["settles_expense_id"] is None
    assert income["linked_transaction_id"] == str(payment["_id"])
    assert payment["linked_transaction_id"] == str(income["_id"])
    assert income["pair_kind"] == payment["pair_kind"] == "settlement"

    # The shared expense is fully settled; the personal ledger carries the cost.
    assert stats(env, "shared")["adjusted_expense"] == 0
    assert stats(env, "personal")["total_expense"] == 100
    # Money left the personal account and refilled the shared one.
    assert balance(env, personal) == -100
    assert balance(env, shared) == 0


def test_personal_expense_settled_from_the_shared_account(env):
    shared, personal = env.accounts.shared, env.accounts.personal
    expense_id = add_expense(env, "personal", personal)

    res = settle(env, expense_id, receive=personal, pay=shared)
    assert res.status_code == 201, res.text
    income, payment = pair(env)

    assert (income["account_type"], income["type"]) == ("personal", "income")
    assert income["settles_expense_id"] == expense_id
    assert (payment["account_type"], payment["type"]) == ("shared", "expense")
    assert payment["shared_group_id"] == "home"
    assert stats(env, "personal")["adjusted_expense"] == 0
    assert stats(env, "shared")["total_expense"] == 100
    assert balance(env, personal) == 0
    assert balance(env, shared) == -100


def test_partial_settlements_are_capped_by_the_remaining_amount(env):
    shared, personal = env.accounts.shared, env.accounts.personal
    expense_id = add_expense(env, "shared", shared)

    assert settle(env, expense_id, shared, personal, amount=60).status_code == 201
    over = settle(env, expense_id, shared, personal, amount=50)
    assert over.status_code == 422
    assert settle(env, expense_id, shared, personal, amount=40).status_code == 201
    assert len(docs(env)) == 5  # expense + two pairs
    assert stats(env, "shared")["adjusted_expense"] == 0


def test_cross_settlement_can_follow_an_ordinary_settlement(env):
    shared, personal = env.accounts.shared, env.accounts.personal
    expense_id = add_expense(env, "shared", shared)
    ordinary = env.client.post(
        "/api/transactions",
        json=body(
            type="income",
            account_type="shared",
            category="정산",
            sub_category="N빵 정산/환급",
            settles_expense_id=expense_id,
            account_id=str(shared["_id"]),
            amount=70,
        ),
    )
    assert ordinary.status_code == 201, ordinary.text

    assert settle(env, expense_id, shared, personal, amount=40).status_code == 422
    assert settle(env, expense_id, shared, personal, amount=30).status_code == 201


@pytest.mark.parametrize("side", ["income", "expense"])
def test_editing_either_entry_updates_both(env, side):
    shared, personal = env.accounts.shared, env.accounts.personal
    expense_id = add_expense(env, "shared", shared)
    settle(env, expense_id, shared, personal, amount=40)
    income, payment = pair(env)
    edited = income if side == "income" else payment

    res = env.client.put(
        f"/api/transactions/{edited['_id']}",
        json=body(
            amount=90,
            date="2026-09-25T00:00:00",
            note="catch-up",
            type=edited["type"],
            account_type=edited["account_type"],
        ),
    )
    assert res.status_code == 200, res.text
    income, payment = pair(env)
    assert income["amount"] == payment["amount"] == 90
    assert income["date"] == payment["date"]
    assert income["note"] == payment["note"] == "catch-up"
    # Ledger, accounts and category stay as the server set them.
    assert (income["account_type"], payment["account_type"]) == ("shared", "personal")
    assert income["category"] == "정산"
    assert payment["category"] == "식비"
    assert stats(env, "shared")["adjusted_expense"] == 10


def test_editing_past_the_remaining_amount_is_rejected(env):
    shared, personal = env.accounts.shared, env.accounts.personal
    expense_id = add_expense(env, "shared", shared)
    settle(env, expense_id, shared, personal, amount=40)
    income, _ = pair(env)

    res = env.client.put(
        f"/api/transactions/{income['_id']}",
        json=body(amount=101, type="income", account_type="shared"),
    )
    assert res.status_code == 422
    assert pair(env)[0]["amount"] == 40


@pytest.mark.parametrize("side", ["income", "expense"])
def test_deleting_either_entry_removes_both_and_frees_the_expense(env, side):
    shared, personal = env.accounts.shared, env.accounts.personal
    expense_id = add_expense(env, "shared", shared)
    settle(env, expense_id, shared, personal)
    income, payment = pair(env)

    target = income if side == "income" else payment
    assert env.client.delete(f"/api/transactions/{target['_id']}").status_code == 204
    assert len(docs(env)) == 1
    assert run(settled_total(env.db, expense_id)) == 0
    assert stats(env, "shared")["adjusted_expense"] == 100


def test_settled_expense_cannot_be_deleted_until_the_settlement_goes(env):
    shared, personal = env.accounts.shared, env.accounts.personal
    expense_id = add_expense(env, "shared", shared)
    settle(env, expense_id, shared, personal)

    assert env.client.delete(f"/api/transactions/{expense_id}").status_code == 422


def test_only_the_owner_can_change_or_delete_the_pair(env):
    shared, personal = env.accounts.shared, env.accounts.personal
    expense_id = add_expense(env, "shared", shared)
    settle(env, expense_id, shared, personal)
    income, _ = pair(env)

    env.act_as("partner")
    edit = env.client.put(
        f"/api/transactions/{income['_id']}",
        json=body(amount=10, type="income", account_type="shared"),
    )
    assert edit.status_code == 403
    assert env.client.delete(f"/api/transactions/{income['_id']}").status_code == 403
    assert len(docs(env)) == 3


def test_cannot_pay_from_a_partners_personal_account(env):
    shared = env.accounts.shared
    expense_id = add_expense(env, "shared", shared)

    res = settle(env, expense_id, shared, env.accounts.partner_personal)
    assert res.status_code == 422
    assert len(docs(env)) == 1


def test_accounts_must_sit_in_the_right_ledger_and_currency(env):
    shared, personal = env.accounts.shared, env.accounts.personal
    expense_id = add_expense(env, "shared", shared)

    # Paying account in the same ledger as the expense.
    assert settle(env, expense_id, shared, shared).status_code == 422
    # Receiving account in the other ledger.
    assert settle(env, expense_id, personal, personal).status_code == 422
    # Currency differs from the expense.
    assert settle(env, expense_id, shared, env.accounts.personal_krw).status_code == 422
    assert len(docs(env)) == 1


def test_payment_entry_cannot_be_settled_again(env):
    shared, personal = env.accounts.shared, env.accounts.personal
    expense_id = add_expense(env, "shared", shared)
    settle(env, expense_id, shared, personal, amount=40)
    _, payment = pair(env)

    res = settle(env, str(payment["_id"]), personal, shared, amount=10)
    assert res.status_code == 422
    listed = env.client.get(
        "/api/transactions/settleable?currency=CAD&account_type=personal"
    )
    assert str(payment["_id"]) not in {row["id"] for row in listed.json()}


def test_unknown_expense_is_rejected(env):
    res = settle(
        env, str(ObjectId()), env.accounts.shared, env.accounts.personal
    )
    assert res.status_code == 404


def test_failed_second_write_rolls_back_the_pair(env, monkeypatch):
    shared, personal = env.accounts.shared, env.accounts.personal
    expense_id = add_expense(env, "shared", shared)
    collection = env.db.transactions
    original = type(collection).update_one
    calls = {"n": 0}

    async def flaky(self, *args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("boom")
        return await original(self, *args, **kwargs)

    monkeypatch.setattr(type(collection), "update_one", flaky)
    with pytest.raises(RuntimeError):
        settle(env, expense_id, shared, personal)
    monkeypatch.undo()
    assert len(docs(env)) == 1
