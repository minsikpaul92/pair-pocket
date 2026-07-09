"""Financial account CRUD and default selection."""

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
    FinancialAccountKind,
    NetWorthSummary,
)
from app.models.transaction import AccountType
from app.models.user import UserOut
from app.services.accounts import _serialize_account, compute_net_worth

router = APIRouter(prefix="/api/accounts", tags=["accounts"])

COLLECTION = "accounts"
SETTINGS_COL = "user_settings"


def _infer_liability(kind: FinancialAccountKind) -> bool:
    return kind == FinancialAccountKind.CREDIT_CARD


@router.get("", response_model=list[AccountOut])
async def list_accounts(
    account_type: AccountType = AccountType.PERSONAL,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[dict]:
    docs = (
        await db[COLLECTION]
        .find({"owner_id": current_user.id, "account_type": account_type.value})
        .sort("name", 1)
        .to_list(length=100)
    )
    return [_serialize_account(d) for d in docs]


@router.post("", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
async def create_account(
    payload: AccountCreate,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    now = datetime.utcnow()
    is_liability = payload.is_liability or _infer_liability(payload.kind)

    if payload.is_default_expense:
        await db[COLLECTION].update_many(
            {
                "owner_id": current_user.id,
                "account_type": payload.account_type.value,
                "currency": payload.currency.value,
            },
            {"$set": {"is_default_expense": False}},
        )
    if payload.is_default_income:
        await db[COLLECTION].update_many(
            {
                "owner_id": current_user.id,
                "account_type": payload.account_type.value,
                "currency": payload.currency.value,
            },
            {"$set": {"is_default_income": False}},
        )

    doc = payload.model_dump()
    doc["is_liability"] = is_liability
    doc["owner_id"] = current_user.id
    doc["created_at"] = now
    doc["updated_at"] = now

    result = await db[COLLECTION].insert_one(doc)
    created = await db[COLLECTION].find_one({"_id": result.inserted_id})
    return _serialize_account(created)


@router.patch("/{account_id}", response_model=AccountOut)
async def update_account(
    account_id: str,
    payload: AccountUpdate,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    if not ObjectId.is_valid(account_id):
        raise HTTPException(status_code=404, detail="Account not found.")

    existing = await db[COLLECTION].find_one(
        {"_id": ObjectId(account_id), "owner_id": current_user.id}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Account not found.")

    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    if not updates:
        return _serialize_account(existing)

    if updates.get("is_default_expense"):
        await db[COLLECTION].update_many(
            {
                "owner_id": current_user.id,
                "account_type": existing["account_type"],
                "currency": existing["currency"],
            },
            {"$set": {"is_default_expense": False}},
        )
    if updates.get("is_default_income"):
        await db[COLLECTION].update_many(
            {
                "owner_id": current_user.id,
                "account_type": existing["account_type"],
                "currency": existing["currency"],
            },
            {"$set": {"is_default_income": False}},
        )

    updates["updated_at"] = datetime.utcnow()
    await db[COLLECTION].update_one(
        {"_id": ObjectId(account_id)}, {"$set": updates}
    )
    updated = await db[COLLECTION].find_one({"_id": ObjectId(account_id)})
    return _serialize_account(updated)


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
    return await compute_net_worth(
        db,
        owner_id=current_user.id,
        account_type=account_type,
        currency=cur,
    )
