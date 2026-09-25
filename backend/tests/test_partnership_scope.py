"""Regression coverage for historical shared-ledger boundaries."""

import asyncio
from datetime import datetime, timedelta

import pytest
from bson import ObjectId, json_util
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

from app.models.user import UserOut
from app.models.account import AccountCreate, FinancialAccountKind
from app.models.subscription import BillingCycle, SubscriptionCreate
from app.models.transaction import AccountType, Currency
from app.routers.accounts import create_account
from app.routers.subscriptions import create_subscription
from app.services import partnerships
from app.services.access import assert_can_access_doc, shared_scope
from app.services.shared_scope_migration import (
    GROUP_SCOPED_COLLECTIONS,
    inspect_legacy_shared_records,
    migrate_legacy_shared_records,
)


def run(coro):
    return asyncio.run(coro)


def user(name: str, group_id: str | None = None) -> UserOut:
    return UserOut(
        id=str(ObjectId()),
        google_id=name,
        email=f"{name}@example.com",
        name=name,
        shared_group_id=group_id,
    )


@pytest.fixture
def database():
    return AsyncMongoMockClient().partnership_scope_tests


@pytest.fixture
def direct_transactions(monkeypatch):
    async def execute(_db, callback):
        return await callback(None)

    monkeypatch.setattr(partnerships, "_transaction", execute)


def add_user(db, value: UserOut):
    run(
        db.users.insert_one(
            {
                "_id": ObjectId(value.id),
                "google_id": value.google_id,
                "email": value.email,
                "name": value.name,
                "shared_group_id": value.shared_group_id,
            }
        )
    )


def add_invite(db, inviter: UserOut, invitee: UserOut, token: str):
    run(
        db.invitations.insert_one(
            {
                "inviter_id": inviter.id,
                "invitee_email": invitee.email,
                "token": token,
                "status": "pending",
                "expires_at": datetime.utcnow() + timedelta(days=1),
                "shared_ledger_start_date": "2026-01-01",
            }
        )
    )


def test_old_group_is_hidden_after_unlink_and_relink(database, direct_transactions):
    alice, bob, carol = user("alice"), user("bob"), user("carol")
    for value in (alice, bob, carol):
        add_user(database, value)

    add_invite(database, alice, bob, "alice-bob")
    old_group, _ = run(
        partnerships.accept_partner_invitation(database, bob, "alice-bob")
    )
    alice.shared_group_id = old_group
    bob.shared_group_id = old_group

    for collection in GROUP_SCOPED_COLLECTIONS:
        run(
            database[collection].insert_one(
                {
                    "owner_id": alice.id,
                    "account_type": "shared",
                    "shared_group_id": old_group,
                    "label": f"old-{collection}",
                }
            )
        )

    run(partnerships.archive_partnership(database, alice))
    alice.shared_group_id = None
    bob.shared_group_id = None
    add_invite(database, carol, alice, "carol-alice")
    new_group, _ = run(
        partnerships.accept_partner_invitation(database, alice, "carol-alice")
    )
    alice.shared_group_id = new_group

    assert new_group != old_group
    archived = run(database.shared_groups.find_one({"_id": old_group}))
    assert archived["status"] == "archived"

    new_owner_ids = [alice.id, carol.id]
    for collection in GROUP_SCOPED_COLLECTIONS:
        visible = run(
            database[collection]
            .find(
                {
                    "owner_id": {"$in": new_owner_ids},
                    "account_type": "shared",
                    **shared_scope("shared", new_group),
                }
            )
            .to_list(length=None)
        )
        assert visible == []

    old_transaction = run(database.transactions.find_one({"label": "old-transactions"}))
    with pytest.raises(HTTPException) as error:
        run(assert_can_access_doc(database, alice, old_transaction))
    assert error.value.status_code == 404


def test_invitation_acceptance_is_single_use(database, direct_transactions):
    inviter, invitee = user("inviter"), user("invitee")
    add_user(database, inviter)
    add_user(database, invitee)
    add_invite(database, inviter, invitee, "single-use")

    run(partnerships.accept_partner_invitation(database, invitee, "single-use"))
    with pytest.raises(HTTPException) as error:
        run(partnerships.accept_partner_invitation(database, invitee, "single-use"))
    assert error.value.status_code == 404


def test_legacy_records_fail_closed_until_explicit_migration(database, tmp_path):
    first, second = user("first", "verified-group"), user("second", "verified-group")
    add_user(database, first)
    add_user(database, second)

    for collection in GROUP_SCOPED_COLLECTIONS:
        run(
            database[collection].insert_many(
                [
                    {"owner_id": first.id, "account_type": "shared", "legacy": True},
                    {
                        "owner_id": first.id,
                        "account_type": "shared",
                        "shared_group_id": "another-group",
                        "legacy": False,
                    },
                ]
            )
        )

    for collection in GROUP_SCOPED_COLLECTIONS:
        assert (
            run(
                database[collection].count_documents(
                    {
                        "owner_id": {"$in": [first.id, second.id]},
                        "account_type": "shared",
                        **shared_scope("shared", "verified-group"),
                    }
                )
            )
            == 0
        )

    counts = run(inspect_legacy_shared_records(database, [first.id, second.id]))
    assert counts == {collection: 1 for collection in GROUP_SCOPED_COLLECTIONS}

    backup = tmp_path / "legacy-shared.json"
    migrated = run(
        migrate_legacy_shared_records(
            database,
            group_id="verified-group",
            member_ids=[first.id, second.id],
            backup_path=backup,
        )
    )
    assert migrated == counts
    saved_backup = json_util.loads(backup.read_text(encoding="utf-8"))
    assert saved_backup["group_id"] == "verified-group"
    assert all(
        len(saved_backup["collections"][collection]) == 1
        for collection in GROUP_SCOPED_COLLECTIONS
    )

    for collection in GROUP_SCOPED_COLLECTIONS:
        assert (
            run(
                database[collection].count_documents(
                    {"shared_group_id": "verified-group"}
                )
            )
            == 1
        )
        assert (
            run(
                database[collection].count_documents(
                    {"shared_group_id": "another-group"}
                )
            )
            == 1
        )


def test_migration_rejects_members_outside_the_group(database, tmp_path):
    first, second = user("first", "one-group"), user("second", "other-group")
    add_user(database, first)
    add_user(database, second)

    with pytest.raises(ValueError, match="Both members"):
        run(
            migrate_legacy_shared_records(
                database,
                group_id="one-group",
                member_ids=[first.id, second.id],
                backup_path=tmp_path / "should-not-exist.json",
            )
        )
    assert not (tmp_path / "should-not-exist.json").exists()


def test_new_shared_accounts_subscriptions_and_occurrences_keep_group(database):
    owner = user("owner", "active-group")
    partner = user("partner", "active-group")
    add_user(database, owner)
    add_user(database, partner)

    account = run(
        create_account(
            AccountCreate(
                name="Shared card",
                kind=FinancialAccountKind.CREDIT_CARD,
                currency=Currency.CAD,
                account_type=AccountType.SHARED,
            ),
            owner,
            database,
        )
    )
    saved_account = run(database.accounts.find_one({"_id": ObjectId(account["id"])}))
    assert saved_account["shared_group_id"] == "active-group"

    subscription = run(
        create_subscription(
            SubscriptionCreate(
                name="Shared subscription",
                amount=12,
                currency=Currency.CAD,
                account_type=AccountType.SHARED,
                cycle=BillingCycle.MONTHLY,
                start_date=datetime.utcnow() + timedelta(days=20),
                account_id=account["id"],
                category="문화/취미",
                sub_category="정기 구독",
            ),
            owner,
            database,
        )
    )
    saved_subscription = run(
        database.subscriptions.find_one({"_id": ObjectId(subscription["id"])})
    )
    occurrence = run(
        database.subscription_occurrences.find_one(
            {"subscription_id": subscription["id"]}
        )
    )
    assert saved_subscription["shared_group_id"] == "active-group"
    assert occurrence["shared_group_id"] == "active-group"
