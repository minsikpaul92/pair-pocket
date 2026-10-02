"""Server-backed default accounts: one document per (scope, currency, role) slot.

A slot holds the account a form should pre-select. Personal slots belong to one
user; shared slots belong to the partnership group, so either partner can change
them and both see the same value. Switching a default is a single upsert on a
uniquely indexed document, so a slot never holds two accounts.
"""

from datetime import datetime
from enum import Enum

from bson import ObjectId
from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

from app.models.account import DefaultRole, FinancialAccountKind
from app.models.transaction import AccountType
from app.models.user import UserOut
from app.services.accounts import resolve_account_country

COLLECTION = "account_defaults"
ACCOUNTS_COL = "accounts"
TX_COL = "transactions"

SLOT_CURRENCIES = ("CAD", "KRW")


class DefaultPurpose(str, Enum):
    EXPENSE = "expense"
    TRANSFER = "transfer"
    INCOME = "income"
    SUBSCRIPTION = "subscription"
    STOCK = "stock"


# Which slots a form consults, in order (agreed product rules).
PURPOSE_CHAINS: dict[DefaultPurpose, tuple[DefaultRole, ...]] = {
    DefaultPurpose.EXPENSE: (DefaultRole.CARD, DefaultRole.BANK),
    DefaultPurpose.TRANSFER: (DefaultRole.BANK,),
    DefaultPurpose.INCOME: (DefaultRole.INCOME, DefaultRole.BANK),
    DefaultPurpose.SUBSCRIPTION: (
        DefaultRole.SUBSCRIPTION,
        DefaultRole.CARD,
        DefaultRole.BANK,
    ),
    DefaultPurpose.STOCK: (DefaultRole.BROKERAGE,),
}

_CASH_KINDS = {
    FinancialAccountKind.CHECKING.value,
    FinancialAccountKind.SAVINGS.value,
    FinancialAccountKind.CASH.value,
}
ROLE_KINDS: dict[DefaultRole, set[str]] = {
    DefaultRole.BANK: _CASH_KINDS,
    DefaultRole.INCOME: _CASH_KINDS,
    DefaultRole.CARD: {FinancialAccountKind.CREDIT_CARD.value},
    DefaultRole.SUBSCRIPTION: _CASH_KINDS | {FinancialAccountKind.CREDIT_CARD.value},
    DefaultRole.BROKERAGE: {FinancialAccountKind.INVESTMENT.value},
}

# Roles a newly created (or reactivated) account claims when the slot is empty.
# Subscription stays empty because it already falls back to card → bank.
AUTO_FILL_ROLES = (
    DefaultRole.BANK,
    DefaultRole.CARD,
    DefaultRole.INCOME,
    DefaultRole.BROKERAGE,
)

# Legacy per-account flags (kept readable for clients built before slots).
LEGACY_FLAG_ROLES: dict[str, DefaultRole] = {
    "is_default_expense": DefaultRole.BANK,
    "is_default_credit": DefaultRole.CARD,
    "is_default_income": DefaultRole.INCOME,
    "is_default_investment": DefaultRole.BROKERAGE,
}


def user_scope_key(user: UserOut, account_type: AccountType) -> str | None:
    if account_type == AccountType.PERSONAL:
        return f"personal:{user.id}"
    return f"shared:{user.shared_group_id}" if user.shared_group_id else None


def account_scope_key(account: dict) -> str | None:
    if account.get("account_type") == AccountType.SHARED.value:
        group = account.get("shared_group_id")
        return f"shared:{group}" if group else None
    return f"personal:{account['owner_id']}"


def _accounts_in_scope(scope_key: str) -> dict:
    kind, _, value = scope_key.partition(":")
    if kind == "shared":
        return {"account_type": AccountType.SHARED.value, "shared_group_id": value}
    return {"account_type": AccountType.PERSONAL.value, "owner_id": value}


def slot_currency(account: dict, role: DefaultRole) -> str | None:
    """Ledger tab (CAD/KRW) whose slot this account can fill for a role."""
    if role == DefaultRole.BROKERAGE:
        return "KRW" if resolve_account_country(account) == "KR" else "CAD"
    currency = account.get("currency")
    return currency if currency in SLOT_CURRENCIES else None


def is_eligible(account: dict | None, role: DefaultRole, currency: str) -> bool:
    return bool(
        account
        and account.get("is_active", True)
        and account.get("kind") in ROLE_KINDS[role]
        and slot_currency(account, role) == currency
    )


def applicable_roles(account: dict) -> list[DefaultRole]:
    """Roles this account could hold (ignores whether it is active)."""
    return [
        role
        for role in DefaultRole
        if account.get("kind") in ROLE_KINDS[role] and slot_currency(account, role)
    ]


async def _load_slots(db: AsyncIOMotorDatabase, scope_key: str) -> list[dict]:
    return await db[COLLECTION].find({"scope_key": scope_key}).to_list(length=50)


async def _load_account(db: AsyncIOMotorDatabase, account_id: str) -> dict | None:
    if not ObjectId.is_valid(account_id):
        return None
    return await db[ACCOUNTS_COL].find_one({"_id": ObjectId(account_id)})


async def _eligible_accounts(
    db: AsyncIOMotorDatabase,
    scope_key: str,
    role: DefaultRole,
    currency: str,
    *,
    exclude_id: str | None = None,
) -> list[dict]:
    docs = await (
        db[ACCOUNTS_COL]
        .find(
            {
                **_accounts_in_scope(scope_key),
                "kind": {"$in": sorted(ROLE_KINDS[role])},
                "is_active": True,
            }
        )
        .to_list(length=200)
    )
    return [
        d
        for d in docs
        if str(d["_id"]) != exclude_id and is_eligible(d, role, currency)
    ]


async def _last_used(db: AsyncIOMotorDatabase, account: dict) -> datetime:
    account_id = str(account["_id"])
    latest = await (
        db[TX_COL]
        .find({"$or": [{"account_id": account_id}, {"counter_account_id": account_id}]})
        .sort("date", -1)
        .limit(1)
        .to_list(length=1)
    )
    date = latest[0].get("date") if latest else None
    if isinstance(date, datetime):
        return date
    if isinstance(date, str):
        try:
            return datetime.fromisoformat(date[:19])
        except ValueError:
            pass
    return datetime.min


async def most_recently_used(
    db: AsyncIOMotorDatabase,
    scope_key: str,
    role: DefaultRole,
    currency: str,
    *,
    exclude_id: str | None = None,
) -> dict | None:
    """Replacement default: the eligible account with the latest transaction."""
    candidates = await _eligible_accounts(
        db, scope_key, role, currency, exclude_id=exclude_id
    )
    best: tuple | None = None
    best_doc = None
    for doc in candidates:
        key = (
            await _last_used(db, doc),
            doc.get("updated_at") or doc.get("created_at") or datetime.min,
        )
        if best is None or key > best:
            best, best_doc = key, doc
    return best_doc


async def write_slot(
    db: AsyncIOMotorDatabase,
    scope_key: str,
    role: DefaultRole,
    currency: str,
    account_id: str,
    *,
    updated_by: str,
) -> None:
    kind, _, value = scope_key.partition(":")
    await db[COLLECTION].update_one(
        {"scope_key": scope_key, "currency": currency, "role": role.value},
        {
            "$set": {
                "account_id": account_id,
                "account_type": kind,
                "shared_group_id": value if kind == "shared" else None,
                "owner_id": value if kind == "personal" else None,
                "updated_by": updated_by,
                "updated_at": datetime.utcnow(),
            }
        },
        upsert=True,
    )


async def _claim_empty_slot(
    db: AsyncIOMotorDatabase,
    scope_key: str,
    role: DefaultRole,
    currency: str,
    account_id: str,
    *,
    updated_by: str,
) -> None:
    kind, _, value = scope_key.partition(":")
    try:
        await db[COLLECTION].update_one(
            {"scope_key": scope_key, "currency": currency, "role": role.value},
            {
                "$setOnInsert": {
                    "account_id": account_id,
                    "account_type": kind,
                    "shared_group_id": value if kind == "shared" else None,
                    "owner_id": value if kind == "personal" else None,
                    "updated_by": updated_by,
                    "updated_at": datetime.utcnow(),
                }
            },
            upsert=True,
        )
    except DuplicateKeyError:
        pass  # Another request filled the slot first.


async def set_default(
    db: AsyncIOMotorDatabase,
    user: UserOut,
    account_type: AccountType,
    currency: str,
    role: DefaultRole,
    account_id: str,
) -> None:
    """Validate access and eligibility, then point the slot at the account."""
    scope_key = user_scope_key(user, account_type)
    if scope_key is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A partner link is required for shared defaults.",
        )
    if currency not in SLOT_CURRENCIES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="currency must be CAD or KRW.",
        )
    account = await _load_account(db, account_id)
    if not account or account_scope_key(account) != scope_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Account not found."
        )
    if not is_eligible(account, role, currency):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="account_not_eligible",
        )
    await write_slot(db, scope_key, role, currency, account_id, updated_by=user.id)


async def clear_default(
    db: AsyncIOMotorDatabase,
    user: UserOut,
    account_type: AccountType,
    currency: str,
    role: DefaultRole,
) -> None:
    scope_key = user_scope_key(user, account_type)
    if scope_key is None:
        return
    await db[COLLECTION].delete_one(
        {"scope_key": scope_key, "currency": currency, "role": role.value}
    )


async def apply_account_roles(
    db: AsyncIOMotorDatabase,
    user: UserOut,
    account: dict,
    roles: set[DefaultRole],
) -> None:
    """Make `roles` exactly the defaults this account holds (from account editing)."""
    scope_key = account_scope_key(account)
    if scope_key is None:
        return
    if roles - set(applicable_roles(account)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="account_not_eligible",
        )
    account_id = str(account["_id"])
    for role in applicable_roles(account):
        currency = slot_currency(account, role)
        if role in roles:
            if not is_eligible(account, role, currency):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="account_not_eligible",
                )
            await write_slot(
                db, scope_key, role, currency, account_id, updated_by=user.id
            )
        else:
            await release_slot(db, scope_key, role, currency, account_id)


async def release_slot(
    db: AsyncIOMotorDatabase,
    scope_key: str,
    role: DefaultRole,
    currency: str,
    account_id: str,
) -> None:
    """Hand a slot held by this account to the most recently used alternative."""
    slot = await db[COLLECTION].find_one(
        {"scope_key": scope_key, "currency": currency, "role": role.value}
    )
    if not slot or slot.get("account_id") != account_id:
        return
    replacement = await most_recently_used(
        db, scope_key, role, currency, exclude_id=account_id
    )
    if replacement is None:
        await db[COLLECTION].delete_one({"_id": slot["_id"]})
        return
    await db[COLLECTION].update_one(
        {"_id": slot["_id"], "account_id": account_id},
        {
            "$set": {
                "account_id": str(replacement["_id"]),
                "updated_at": datetime.utcnow(),
            }
        },
    )


async def on_account_saved(
    db: AsyncIOMotorDatabase,
    account: dict,
    *,
    updated_by: str,
    claim_empty: bool = False,
) -> None:
    """Keep slots valid after an account is created or edited.

    - Slots held by this account move to the most recently used alternative
      when it no longer qualifies (deactivated, country changed); with no
      alternative the slot is left empty.
    - With `claim_empty` (new or reactivated account) it fills every empty
      slot it qualifies for.
    """
    scope_key = account_scope_key(account)
    if scope_key is None:
        return
    account_id = str(account["_id"])
    for slot in await db[COLLECTION].find(
        {"scope_key": scope_key, "account_id": account_id}
    ).to_list(length=20):
        role = DefaultRole(slot["role"])
        if not is_eligible(account, role, slot["currency"]):
            await release_slot(db, scope_key, role, slot["currency"], account_id)

    if not claim_empty or not account.get("is_active", True):
        return
    for role in AUTO_FILL_ROLES:
        currency = slot_currency(account, role)
        if currency and is_eligible(account, role, currency):
            await _claim_empty_slot(
                db, scope_key, role, currency, account_id, updated_by=updated_by
            )


async def on_account_removed(db: AsyncIOMotorDatabase, account: dict) -> None:
    scope_key = account_scope_key(account)
    if scope_key is None:
        return
    account_id = str(account["_id"])
    for slot in await db[COLLECTION].find(
        {"scope_key": scope_key, "account_id": account_id}
    ).to_list(length=20):
        await release_slot(
            db, scope_key, DefaultRole(slot["role"]), slot["currency"], account_id
        )


async def roles_by_account(
    db: AsyncIOMotorDatabase, scope_keys: set[str]
) -> dict[str, list[str]]:
    """account_id → roles it currently holds (for badges)."""
    out: dict[str, list[str]] = {}
    if not scope_keys:
        return out
    async for slot in db[COLLECTION].find({"scope_key": {"$in": sorted(scope_keys)}}):
        roles = out.setdefault(slot["account_id"], [])
        if slot["role"] not in roles:
            roles.append(slot["role"])
    return out


async def describe_defaults(
    db: AsyncIOMotorDatabase, user: UserOut, account_type: AccountType
) -> dict:
    """Slots with their validity, plus the account each form purpose should use."""
    scope_key = user_scope_key(user, account_type)
    result: dict = {"account_type": account_type.value, "slots": [], "resolved": {}}
    if scope_key is None:
        return result

    slots = {(s["currency"], s["role"]): s for s in await _load_slots(db, scope_key)}
    accounts = {
        str(d["_id"]): d
        for d in await db[ACCOUNTS_COL]
        .find(_accounts_in_scope(scope_key))
        .to_list(length=200)
    }

    def valid_slot_account(currency: str, role: DefaultRole) -> str | None:
        slot = slots.get((currency, role.value))
        if not slot:
            return None
        account = accounts.get(slot["account_id"])
        return slot["account_id"] if is_eligible(account, role, currency) else None

    def eligible_ids(currency: str, role: DefaultRole) -> list[str]:
        return [aid for aid, a in accounts.items() if is_eligible(a, role, currency)]

    for currency in SLOT_CURRENCIES:
        for role in DefaultRole:
            slot = slots.get((currency, role.value))
            valid = valid_slot_account(currency, role)
            result["slots"].append(
                {
                    "currency": currency,
                    "role": role.value,
                    "account_id": slot["account_id"] if slot else None,
                    "status": "set" if valid else ("invalid" if slot else "missing"),
                    "eligible_account_ids": eligible_ids(currency, role),
                }
            )

        resolved: dict[str, dict] = {}
        for purpose, chain in PURPOSE_CHAINS.items():
            entry = {"account_id": None, "source": None, "reason": None}
            for role in chain:
                account_id = valid_slot_account(currency, role)
                if account_id:
                    entry.update(account_id=account_id, source=role.value)
                    break
            else:
                options: list[str] = []
                for role in chain:
                    for aid in eligible_ids(currency, role):
                        if aid not in options:
                            options.append(aid)
                if len(options) == 1:
                    entry.update(account_id=options[0], source="only_option")
                else:
                    entry["reason"] = "not_set" if options else "no_account"
            resolved[purpose.value] = entry
        result["resolved"][currency] = resolved
    return result
