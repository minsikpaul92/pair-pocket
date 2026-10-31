"""Financial account CRUD. Default selection lives in `account_defaults`."""

from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.security import get_current_user
from app.database import get_database
from app.models.account import (
    AccountCreate,
    AccountOut,
    AccountUpdate,
    DefaultRole,
    FinancialAccountKind,
    NetWorthSummary,
)
from app.models.transaction import AccountType
from app.models.user import UserOut
from app.services.access import (
    assert_can_access_doc,
    owner_match,
    shared_scope,
    require_shared_group_for_write,
    resolve_owner_ids,
)
from app.services.account_defaults import (
    LEGACY_FLAG_ROLES,
    account_scope_key,
    applicable_roles,
    apply_account_roles,
    on_account_removed,
    on_account_saved,
    roles_by_account,
)
from app.services.accounts import _serialize_account, compute_net_worth

router = APIRouter(prefix="/api/accounts", tags=["accounts"])

COLLECTION = "accounts"
SETTINGS_COL = "user_settings"


def _infer_liability(kind: FinancialAccountKind) -> bool:
    return kind == FinancialAccountKind.CREDIT_CARD


async def _with_roles(db: AsyncIOMotorDatabase, docs: list[dict]) -> list[dict]:
    keys = {k for k in (account_scope_key(d) for d in docs) if k}
    roles = await roles_by_account(db, keys)
    return [_serialize_account(d, roles.get(str(d["_id"]), [])) for d in docs]


async def _apply_requested_roles(db, user, payload, account: dict) -> None:
    """Apply `default_roles`, or deprecated is_default_* flags from older clients."""
    if payload.default_roles is not None:
        await apply_account_roles(db, user, account, set(payload.default_roles))
        return
    flags = {
        name: value
        for name in LEGACY_FLAG_ROLES
        if (value := getattr(payload, name)) is not None
    }
    if not flags:
        return
    applicable = set(applicable_roles(account))
    held = (await roles_by_account(db, {account_scope_key(account)})).get(
        str(account["_id"]), []
    )
    target = {DefaultRole(r) for r in held}
    for name, value in flags.items():
        role = LEGACY_FLAG_ROLES[name]
        # Older clients sent is_default_expense on cards to mean "default card".
        if role == DefaultRole.BANK and DefaultRole.CARD in applicable:
            role = DefaultRole.CARD
        if role in applicable:
            (target.add if value else target.discard)(role)
    await apply_account_roles(db, user, account, target)


@router.get("", response_model=list[AccountOut])
async def list_accounts(
    account_type: AccountType = AccountType.PERSONAL,
    currency: str | None = Query(default=None, description="CAD | KRW"),
    active_only: bool = Query(default=True),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[dict]:
    owner_ids = await resolve_owner_ids(db, current_user, account_type)
    query: dict = {
        **owner_match(owner_ids),
        "account_type": account_type.value,
        **shared_scope(account_type.value, current_user.shared_group_id),
    }
    if currency:
        query["currency"] = currency
    if active_only:
        query["is_active"] = True

    docs = await db[COLLECTION].find(query).sort("name", 1).to_list(length=100)
    return await _with_roles(db, docs)


@router.post("", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
async def create_account(
    payload: AccountCreate,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    require_shared_group_for_write(current_user, payload.account_type)
    now = datetime.utcnow()
    is_liability = payload.is_liability or _infer_liability(payload.kind)

    doc = payload.model_dump(
        exclude={"default_roles", *LEGACY_FLAG_ROLES.keys()}
    )
    doc["kind"] = payload.kind.value
    doc["currency"] = payload.currency.value
    doc["account_type"] = payload.account_type.value
    doc["shared_group_id"] = (
        current_user.shared_group_id
        if payload.account_type == AccountType.SHARED
        else None
    )
    if payload.country is not None:
        doc["country"] = payload.country.value
    doc["is_liability"] = is_liability
    doc["owner_id"] = current_user.id
    doc["created_at"] = now
    doc["updated_at"] = now

    result = await db[COLLECTION].insert_one(doc)
    created = await db[COLLECTION].find_one({"_id": result.inserted_id})
    await _apply_requested_roles(db, current_user, payload, created)
    # A new account becomes the default wherever no default exists yet.
    await on_account_saved(db, created, updated_by=current_user.id, claim_empty=True)
    return (await _with_roles(db, [created]))[0]


@router.get("/net-worth", response_model=NetWorthSummary)
async def net_worth(
    account_type: AccountType = Query(default=AccountType.PERSONAL),
    currency: str | None = Query(default=None, description="CAD | KRW | omit for all"),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> NetWorthSummary:
    """Dashboard: per-account balances and total net worth (assets − liabilities)."""
    from app.models.transaction import Currency as Cur

    cur = Cur(currency) if currency else None
    owner_ids = await resolve_owner_ids(db, current_user, account_type)
    return await compute_net_worth(
        db,
        owner_ids=owner_ids,
        account_type=account_type,
        shared_group_id=current_user.shared_group_id,
        currency=cur,
    )


@router.patch("/{account_id}", response_model=AccountOut)
async def update_account(
    account_id: str,
    payload: AccountUpdate,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    if not ObjectId.is_valid(account_id):
        raise HTTPException(status_code=404, detail="Account not found.")

    existing = await db[COLLECTION].find_one({"_id": ObjectId(account_id)})
    await assert_can_access_doc(
        db, current_user, existing, not_found_detail="Account not found."
    )

    updates = payload.model_dump(
        exclude_unset=True, exclude={"default_roles", *LEGACY_FLAG_ROLES.keys()}
    )
    if "country" in updates and updates["country"] is not None:
        updates["country"] = updates["country"].value
    if updates:
        updates["updated_at"] = datetime.utcnow()
        await db[COLLECTION].update_one(
            {"_id": ObjectId(account_id)}, {"$set": updates}
        )
    updated = await db[COLLECTION].find_one({"_id": ObjectId(account_id)})
    if updated.get("is_active", True):
        await _apply_requested_roles(db, current_user, payload, updated)
    # Deactivation / country change hands slots to the most recently used
    # alternative; reactivation claims empty slots like a new account.
    reactivated = not existing.get("is_active", True) and updated.get(
        "is_active", True
    )
    await on_account_saved(
        db, updated, updated_by=current_user.id, claim_empty=reactivated
    )
    return (await _with_roles(db, [updated]))[0]


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    account_id: str,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> None:
    if not ObjectId.is_valid(account_id):
        raise HTTPException(status_code=404, detail="Account not found.")
    existing = await db[COLLECTION].find_one({"_id": ObjectId(account_id)})
    if not existing:
        raise HTTPException(status_code=404, detail="Account not found.")

    require_shared_group_for_write(current_user, AccountType(existing["account_type"]))
    await assert_can_access_doc(
        db, current_user, existing, not_found_detail="Account not found."
    )

    await db[COLLECTION].delete_one({"_id": ObjectId(account_id)})
    await db.holdings.delete_many({"account_id": account_id})
    await on_account_removed(db, existing)
