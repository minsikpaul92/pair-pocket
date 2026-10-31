"""Move legacy is_default_* account flags into `account_defaults` slots.

Two steps so the running release keeps working throughout:
1. `plan` / `apply`: copy flags into slots (accounts are not modified).
2. `cleanup_legacy`: after the slot release is verified, unset the old fields.

Rules agreed for ambiguous data:
- several accounts flagged for one slot → the most recently updated wins;
- flag on an account that cannot hold the role (wrong kind/currency) → dropped;
- flag only on inactive accounts → the most recently used eligible active
  account takes the slot, or it stays empty if there is none.
Existing slots are never overwritten, so reruns are safe.
"""

from datetime import datetime
from pathlib import Path

from bson import json_util
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.account import DefaultRole, FinancialAccountKind
from app.services.account_defaults import (
    COLLECTION,
    LEGACY_FLAG_ROLES,
    ROLE_KINDS,
    account_scope_key,
    is_eligible,
    most_recently_used,
    slot_currency,
)

LEGACY_SETTINGS_FIELDS = ("default_expense_account_id", "default_income_account_id")
MIGRATION_ACTOR = "migration:account-defaults"


def _flag_role(flag: str, account: dict) -> DefaultRole:
    role = LEGACY_FLAG_ROLES[flag]
    # Cards flagged as the expense default meant "default card".
    if role == DefaultRole.BANK and account.get("kind") == (
        FinancialAccountKind.CREDIT_CARD.value
    ):
        return DefaultRole.CARD
    return role


def _recency(account: dict) -> datetime:
    return account.get("updated_at") or account.get("created_at") or datetime.min


async def plan(db: AsyncIOMotorDatabase) -> dict:
    """Compute slot assignments without writing anything."""
    flagged = await db["accounts"].find(
        {"$or": [{flag: True} for flag in LEGACY_FLAG_ROLES]}
    ).to_list(length=None)

    candidates: dict[tuple[str, str, str], list[dict]] = {}
    report: dict[str, list] = {
        "assigned": [],
        "duplicates": [],
        "dropped_ineligible": [],
        "replaced_inactive": [],
        "emptied_inactive": [],
        "skipped_unscoped": [],
        "kept_existing": [],
    }
    for account in flagged:
        account_id = str(account["_id"])
        scope_key = account_scope_key(account)
        if scope_key is None:
            report["skipped_unscoped"].append(account_id)
            continue
        for flag in LEGACY_FLAG_ROLES:
            if not account.get(flag):
                continue
            role = _flag_role(flag, account)
            currency = slot_currency(account, role)
            if currency is None or account.get("kind") not in ROLE_KINDS[role]:
                report["dropped_ineligible"].append(
                    {"account_id": account_id, "flag": flag}
                )
                continue
            candidates.setdefault((scope_key, currency, role.value), []).append(
                account
            )

    assignments: list[dict] = []
    for (scope_key, currency, role_value), accounts in sorted(candidates.items()):
        role = DefaultRole(role_value)
        slot = {"scope_key": scope_key, "currency": currency, "role": role_value}
        if await db[COLLECTION].find_one(slot):
            report["kept_existing"].append(slot)
            continue
        active = [a for a in accounts if is_eligible(a, role, currency)]
        if active:
            active.sort(key=_recency, reverse=True)
            winner = active[0]
            if len(active) > 1:
                report["duplicates"].append(
                    {
                        **slot,
                        "chosen": str(winner["_id"]),
                        "ignored": [str(a["_id"]) for a in active[1:]],
                    }
                )
            report["assigned"].append({**slot, "account_id": str(winner["_id"])})
            assignments.append({**slot, "account_id": str(winner["_id"])})
            continue
        replacement = await most_recently_used(db, scope_key, role, currency)
        if replacement is None:
            report["emptied_inactive"].append(slot)
            continue
        entry = {**slot, "account_id": str(replacement["_id"])}
        report["replaced_inactive"].append(entry)
        assignments.append(entry)

    return {"assignments": assignments, "report": report}


async def apply(db: AsyncIOMotorDatabase, result: dict) -> int:
    """Insert planned slots; never overwrites a slot created in the meantime."""
    written = 0
    for entry in result["assignments"]:
        kind, _, value = entry["scope_key"].partition(":")
        outcome = await db[COLLECTION].update_one(
            {
                "scope_key": entry["scope_key"],
                "currency": entry["currency"],
                "role": entry["role"],
            },
            {
                "$setOnInsert": {
                    "account_id": entry["account_id"],
                    "account_type": kind,
                    "shared_group_id": value if kind == "shared" else None,
                    "owner_id": value if kind == "personal" else None,
                    "updated_by": MIGRATION_ACTOR,
                    "updated_at": datetime.utcnow(),
                }
            },
            upsert=True,
        )
        written += 1 if outcome.upserted_id is not None else 0
    return written


async def cleanup_legacy(db: AsyncIOMotorDatabase, backup_path: Path) -> dict:
    """Back up, then unset legacy flags on accounts and unused settings fields."""
    flags = list(LEGACY_FLAG_ROLES)
    account_filter = {"$or": [{f: {"$exists": True}} for f in flags]}
    settings_filter = {"$or": [{f: {"$exists": True}} for f in LEGACY_SETTINGS_FIELDS]}
    backup = {
        "accounts": await db["accounts"]
        .find(account_filter, {f: 1 for f in flags})
        .to_list(length=None),
        "user_settings": await db["user_settings"]
        .find(settings_filter, {f: 1 for f in LEGACY_SETTINGS_FIELDS})
        .to_list(length=None),
    }
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    backup_path.write_text(json_util.dumps(backup, indent=2), encoding="utf-8")

    accounts = await db["accounts"].update_many(
        account_filter, {"$unset": {f: "" for f in flags}}
    )
    settings = await db["user_settings"].update_many(
        settings_filter, {"$unset": {f: "" for f in LEGACY_SETTINGS_FIELDS}}
    )
    return {
        "accounts": accounts.modified_count,
        "user_settings": settings.modified_count,
    }
