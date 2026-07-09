"""Financial Account model for asset/liability tracking.

Balance is derived from opening_balance + ledger movements (transactions & transfers).
Credit cards are liabilities: positive balance = amount owed.
"""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator

from app.models.transaction import AccountType, Currency


class FinancialAccountKind(str, Enum):
    """Account instrument type."""

    CHECKING = "checking"  # 입출금
    SAVINGS = "savings"
    CREDIT_CARD = "credit_card"  # liability
    INVESTMENT = "investment"
    CASH = "cash"


class AccountBase(BaseModel):
    """A trackable wallet: bank account, credit card, brokerage, etc."""

    name: str = Field(min_length=1, max_length=80)
    nickname: str | None = Field(default=None, max_length=40)
    kind: FinancialAccountKind
    currency: Currency
    account_type: AccountType = AccountType.PERSONAL

    # Starting point when the account is registered (can be 0).
    # For credit cards this is existing debt; for banks it is current cash.
    opening_balance: float = 0.0

    # True for credit cards — balance contributes negatively to net worth.
    is_liability: bool = False

    is_default_expense: bool = False
    is_default_income: bool = False
    is_active: bool = True

    # Optional display metadata (issuer icon, last four digits, etc.)
    institution: str | None = None
    last_four: str | None = None
    # Optional full/partial account number for non-credit-card accounts
    account_number: str | None = None

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, v):
        if isinstance(v, str):
            return v.strip()
        return v

    @field_validator(
        "nickname", "institution", "last_four", "account_number", mode="before"
    )
    @classmethod
    def strip_optional(cls, v):
        if isinstance(v, str):
            return v.strip() or None
        return v


class AccountCreate(AccountBase):
    pass


class AccountUpdate(BaseModel):
    name: str | None = None
    nickname: str | None = None
    opening_balance: float | None = None
    is_default_expense: bool | None = None
    is_default_income: bool | None = None
    is_active: bool | None = None
    institution: str | None = None
    last_four: str | None = None
    account_number: str | None = None


class AccountOut(AccountBase):
    id: str
    owner_id: str
    created_at: datetime
    updated_at: datetime


class AccountBalanceOut(BaseModel):
    """Computed balance for dashboard."""

    account_id: str
    name: str
    nickname: str | None = None
    kind: FinancialAccountKind
    currency: Currency
    account_type: AccountType
    is_liability: bool
    balance: float = Field(
        description="Signed balance. Liabilities are positive = debt owed."
    )
    net_worth_contribution: float = Field(
        description="balance for assets, -balance for liabilities."
    )


class NetWorthSummary(BaseModel):
    """Dashboard total assets snapshot."""

    account_type: AccountType
    currency: Currency | None = None
    total_assets: float
    total_liabilities: float
    net_worth: float
    accounts: list[AccountBalanceOut]
