"""Default account slots per ledger (personal / shared) and currency tab."""

from fastapi import APIRouter, Depends, Path, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from app.core.security import get_current_user
from app.database import get_database
from app.models.account import DefaultRole
from app.models.transaction import AccountType
from app.models.user import UserOut
from app.services.access import require_shared_group_for_write
from app.services.account_defaults import clear_default, describe_defaults, set_default

router = APIRouter(prefix="/api/account-defaults", tags=["account-defaults"])

CurrencyPath = Path(pattern="^(CAD|KRW)$")


class DefaultSlotOut(BaseModel):
    currency: str
    role: DefaultRole
    account_id: str | None = None
    # set: valid default · missing: none chosen · invalid: account no longer qualifies
    status: str
    eligible_account_ids: list[str]


class ResolvedDefault(BaseModel):
    account_id: str | None = None
    # Slot role that supplied the account, or "only_option" when exactly one fits.
    source: str | None = None
    # When account_id is null: "not_set" (several options) or "no_account".
    reason: str | None = None


class AccountDefaultsOut(BaseModel):
    account_type: AccountType
    slots: list[DefaultSlotOut]
    # currency → purpose (expense | transfer | income | subscription | stock)
    resolved: dict[str, dict[str, ResolvedDefault]]


class SetDefaultBody(BaseModel):
    account_id: str


@router.get("", response_model=AccountDefaultsOut)
async def get_account_defaults(
    account_type: AccountType = AccountType.PERSONAL,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    return await describe_defaults(db, current_user, account_type)


@router.put("/{account_type}/{currency}/{role}", response_model=AccountDefaultsOut)
async def put_account_default(
    account_type: AccountType,
    role: DefaultRole,
    payload: SetDefaultBody,
    currency: str = CurrencyPath,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    require_shared_group_for_write(current_user, account_type)
    await set_default(db, current_user, account_type, currency, role, payload.account_id)
    return await describe_defaults(db, current_user, account_type)


@router.delete(
    "/{account_type}/{currency}/{role}",
    response_model=AccountDefaultsOut,
    status_code=status.HTTP_200_OK,
)
async def delete_account_default(
    account_type: AccountType,
    role: DefaultRole,
    currency: str = CurrencyPath,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    require_shared_group_for_write(current_user, account_type)
    await clear_default(db, current_user, account_type, currency, role)
    return await describe_defaults(db, current_user, account_type)
