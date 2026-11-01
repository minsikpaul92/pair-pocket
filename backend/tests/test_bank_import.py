from datetime import datetime

from app.services.bank_import import (
    HINT_ACCOUNT_TRANSFER,
    HINT_CARD_REPAYMENT,
    HINT_E_TRANSFER,
    HINT_NORMAL,
    STATUS_DUPLICATE,
    STATUS_NEW,
    STATUS_REVIEW,
    classify_hint,
    match_existing,
    parse_bank_csv,
    transfer_counterpart,
)

# Synthetic data shaped like real bank exports; no real accounts or amounts.
CARD_CSV = """10/29/2026,STORE ONE,4.51,,243.13
10/29/2026,REFUND SHOP,,52.83,238.62
10/14/2026,PAYMENT - THANK YOU,,507.96,0.00
"""

DEPOSIT_CSV = '''"2026-10-07","SEND E-TFR ***ABC","250",,"1204.19"
"2026-10-14","XX520 TFR-TO C/C","507.96",,"696.23"
"2026-10-20","YY203 TFR-TO 1234567","140",,"34375.94"
"2026-10-05","E-TRANSFER ***XYZ",,"2,700","34515.94"
'''


def _doc(id_, day, amount, merchant, type_="expense", kind="normal"):
    return {
        "_id": id_,
        "date": datetime(2026, 10, day),
        "amount": amount,
        "merchant": merchant,
        "type": type_,
        "kind": kind,
    }


def test_parses_card_rows_with_slash_dates():
    rows = parse_bank_csv(CARD_CSV)
    assert [(r.amount, r.direction) for r in rows] == [
        (4.51, "out"),
        (52.83, "in"),
        (507.96, "in"),
    ]
    assert rows[0].date.isoformat() == "2026-10-29"
    assert rows[0].balance == 243.13


def test_parses_quoted_deposit_rows_and_thousands_separator():
    rows = parse_bank_csv(DEPOSIT_CSV)
    assert len(rows) == 4
    assert rows[3].amount == 2700.0 and rows[3].direction == "in"


def test_skips_header_and_blank_lines():
    rows = parse_bank_csv("Date,Description,Debit,Credit,Balance\n\n2026-10-01,SHOP,5.00,,10.00\n")
    assert len(rows) == 1 and rows[0].description == "SHOP"


def test_hints():
    card = parse_bank_csv(CARD_CSV)
    assert classify_hint(card[0], is_card=True) == HINT_NORMAL
    assert classify_hint(card[2], is_card=True) == HINT_CARD_REPAYMENT
    dep = parse_bank_csv(DEPOSIT_CSV)
    assert classify_hint(dep[0], is_card=False) == HINT_E_TRANSFER
    assert classify_hint(dep[1], is_card=False) == HINT_CARD_REPAYMENT
    assert classify_hint(dep[2], is_card=False) == HINT_ACCOUNT_TRANSFER
    assert transfer_counterpart(dep[2]) == "1234567"


def test_same_day_same_merchant_is_duplicate():
    rows = parse_bank_csv(CARD_CSV)
    existing = [_doc("a", 29, 4.51, "Store One")]
    result = match_existing(rows, existing, is_card=True)
    assert result[0]["status"] == STATUS_DUPLICATE and result[0]["match_id"] == "a"
    assert result[1]["status"] == STATUS_NEW


def test_same_amount_nearby_day_needs_review():
    rows = parse_bank_csv(CARD_CSV)
    existing = [_doc("a", 27, 4.51, "Store One")]
    result = match_existing(rows, existing, is_card=True)
    assert result[0]["status"] == STATUS_REVIEW and result[0]["match_id"] == "a"


def test_same_amount_far_away_is_new():
    rows = parse_bank_csv(CARD_CSV)
    existing = [_doc("a", 10, 4.51, "Store One")]
    assert match_existing(rows, existing, is_card=True)[0]["status"] == STATUS_NEW


def test_one_existing_entry_is_claimed_once():
    rows = parse_bank_csv("2026-10-05,STORE ONE,4.51,,10\n2026-10-05,STORE ONE,4.51,,5\n")
    existing = [_doc("a", 5, 4.51, "Store One")]
    result = match_existing(rows, existing, is_card=False)
    assert [r["status"] for r in result] == [STATUS_DUPLICATE, STATUS_NEW]


def test_card_repayment_matches_transfer_entry_without_merchant():
    rows = parse_bank_csv(CARD_CSV)
    existing = [_doc("t", 14, 507.96, "카드 대금", kind="transfer")]
    result = match_existing(rows, existing, is_card=True)
    assert result[2]["status"] == STATUS_DUPLICATE


def test_direction_must_match_type():
    rows = parse_bank_csv(CARD_CSV)
    existing = [_doc("a", 29, 52.83, "Refund Shop", type_="expense")]
    assert match_existing(rows, existing, is_card=True)[1]["status"] == STATUS_NEW


# Endpoint

import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.security import get_current_user
from app.database import get_database
from app.routers import bank_import as bank_import_router
from tests.test_ledger_integrity import env, run  # noqa: F401


@pytest.fixture
def client(env):
    app = FastAPI()
    app.include_router(bank_import_router.router)
    app.dependency_overrides[get_database] = lambda: env.db
    app.dependency_overrides[get_current_user] = lambda: env.users["owner"]
    with TestClient(app) as c:
        yield c


def _post(client, account, csv_text):
    return client.post(
        "/api/import/bank/preview",
        data={"account_id": str(account["_id"])},
        files={"file": ("a.csv", csv_text.encode(), "text/csv")},
    )


def test_preview_groups_rows(env, client):
    account = env.accounts.personal
    owner = env.users["owner"].id
    base = {"owner_id": owner, "account_type": "personal", "currency": "CAD", "type": "expense", "category": "식비", "sub_category": "카페/간식"}
    run(
        env.db.transactions.insert_many(
            [
                {**base, "date": datetime(2026, 10, 5), "amount": 4.51, "merchant": "Store One"},
                {**base, "date": datetime(2026, 10, 8), "amount": 9.99, "merchant": "Cafe"},
            ]
        )
    )
    csv_text = (
        "2026-10-05,STORE ONE,4.51,,100\n"
        "2026-10-06,CAFE 12,9.99,,90\n"
        "2026-10-07,NEW PLACE,20.00,,70\n"
    )
    res = _post(client, account, csv_text)
    assert res.status_code == 200, res.text
    data = res.json()
    assert [r["status"] for r in data["rows"]] == ["duplicate", "review", "new"]
    assert data["summary"] == {"auto": 0, "review": 2, "duplicate": 1}
    assert data["rows"][1]["match"]["merchant"] == "Cafe"


def test_preview_ignores_other_users_entries(env, client):
    run(
        env.db.transactions.insert_one(
            {
                "owner_id": env.users["partner"].id,
                "account_type": "personal",
                "currency": "CAD",
                "type": "expense",
                "date": datetime(2026, 10, 5),
                "amount": 4.51,
                "merchant": "Store One",
            }
        )
    )
    res = _post(client, env.accounts.personal, "2026-10-05,STORE ONE,4.51,,100\n")
    assert res.json()["rows"][0]["status"] == "new"


def test_preview_rejects_foreign_account_and_empty_file(env, client):
    assert _post(client, env.accounts.partner_personal, "2026-10-05,X,1,,1\n").status_code in (403, 404)
    assert _post(client, env.accounts.personal, "nothing here\n").status_code == 422


def test_confident_ai_suggestion_is_auto_and_unsure_goes_to_review(env, client, monkeypatch):
    from app.services import ai

    async def fake_json(db, owner_id, api_key, payload):
        return (
            {
                "results": [
                    {"index": 0, "merchant": "Netflix", "type": "expense", "category": "문화/취미",
                     "sub_category": "정기 구독", "confidence": 0.95},
                    {"index": 1, "merchant": "Unknown", "type": "expense", "category": "식비",
                     "sub_category": "외식/배달", "confidence": 0.4},
                    {"index": 2, "merchant": "Bad", "type": "expense", "category": "없는분류",
                     "sub_category": "x", "confidence": 0.99},
                ]
            },
            "model",
            [],
        )

    monkeypatch.setattr(ai, "_generate_json_result", fake_json)
    csv_text = (
        "2026-10-01,NETFLIX.COM,9.03,,100\n"
        "2026-10-02,POS 4412 XYZ,20.00,,80\n"
        "2026-10-03,WEIRD,5.00,,75\n"
    )
    rows = _post(client, env.accounts.personal, csv_text).json()["rows"]
    assert [r["bucket"] for r in rows] == ["auto", "review", "review"]
    assert rows[0]["suggestion"]["sub_category"] == "정기 구독"
    assert rows[2]["suggestion"] is None  # invalid category pair is dropped


def test_known_merchant_uses_history_without_ai(env, client, monkeypatch):
    from app.services import ai

    async def boom(*a, **k):
        raise AssertionError("AI should not be called")

    monkeypatch.setattr(ai, "_generate_json_result", boom)
    run(
        env.db.transactions.insert_one(
            {
                "owner_id": env.users["owner"].id, "account_type": "personal",
                "currency": "CAD", "type": "expense", "date": datetime(2026, 9, 1),
                "amount": 9.03, "merchant": "Netflix", "category": "문화/취미",
                "sub_category": "정기 구독",
            }
        )
    )
    rows = _post(client, env.accounts.personal, "2026-10-01,NETFLIX.COM,9.03,,100\n").json()["rows"]
    assert rows[0]["bucket"] == "auto" and rows[0]["suggestion"]["source"] == "history"


def _commit(client, account, items):
    return client.post(
        "/api/import/bank/commit", json={"account_id": str(account["_id"]), "items": items}
    )


def _item(**changes):
    return {
        "date": "2026-10-05", "amount": 9.03, "direction": "out", "merchant": "Netflix",
        "category": "문화/취미", "sub_category": "정기 구독", **changes,
    }


def test_commit_saves_entries_without_notifying(env, client):
    res = _commit(client, env.accounts.personal, [_item(), _item(direction="in", amount=5,
        merchant="Refund", category="금융/기타", sub_category="은행 이자")])
    assert res.status_code == 201 and res.json() == {"created": 2}
    saved = run(env.db.transactions.find({}).to_list(length=None))
    assert {d["type"] for d in saved} == {"expense", "income"}
    assert all(d["account_id"] == str(env.accounts.personal["_id"]) for d in saved)
    assert run(env.db.notifications.count_documents({})) == 0


def test_commit_is_all_or_nothing(env, client):
    res = _commit(client, env.accounts.personal, [_item(), _item(category="없는분류", sub_category="x")])
    assert res.status_code == 422
    assert run(env.db.transactions.count_documents({})) == 0


def test_commit_card_repayment_is_a_transfer_to_the_card(env, client):
    card = {**env.accounts.personal, "_id": ObjectId(), "kind": "credit_card", "is_liability": True,
            "name": "card"}
    run(env.db.accounts.insert_one(card))
    res = _commit(client, env.accounts.personal, [
        {"date": "2026-10-14", "amount": 507.96, "direction": "out", "merchant": "Card payment",
         "kind": "card_repayment", "counter_account_id": str(card["_id"])}])
    assert res.status_code == 201, res.text
    saved = run(env.db.transactions.find_one({}))
    assert saved["kind"] == "transfer" and saved["counter_account_id"] == str(card["_id"])


def test_commit_rejects_raw_transfer_category(env, client):
    res = _commit(client, env.accounts.personal, [_item(category="자산 이동/카드", sub_category="내 계좌 이동")])
    assert res.status_code == 422
