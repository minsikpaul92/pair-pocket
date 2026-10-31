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


class AccountCountry(str, Enum):
    """Brokerage / bank country tab (independent of currency)."""

    CA = "CA"
    KR = "KR"


class DefaultRole(str, Enum):
    """Default-account slot. Stored in `account_defaults`, not on the account."""

    BANK = "bank"  # spending fallback and transfers
    CARD = "card"
    INCOME = "income"
    SUBSCRIPTION = "subscription"  # optional override; falls back to card → bank
    BROKERAGE = "brokerage"


class AccountBase(BaseModel):
    """A trackable wallet: bank account, credit card, brokerage, etc."""

    name: str = Field(min_length=1, max_length=80)
    nickname: str | None = Field(default=None, max_length=40)
    kind: FinancialAccountKind
    currency: Currency
    account_type: AccountType = AccountType.PERSONAL
    # Where the account was registered (Canada vs Korea tab). Optional for legacy rows.
    country: AccountCountry | None = None

    # Starting point when the account is registered (can be 0).
    # For credit cards this is existing debt; for banks it is current cash.
    opening_balance: float = 0.0

    # True for credit cards — balance contributes negatively to net worth.
    is_liability: bool = False

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


class LegacyDefaultFlags(BaseModel):
    """Deprecated per-account flags, accepted from clients built before slots."""

    is_default_expense: bool | None = None
    is_default_income: bool | None = None
    is_default_credit: bool | None = None
    is_default_investment: bool | None = None


class AccountCreate(AccountBase, LegacyDefaultFlags):
    # Slots this account should hold, e.g. ["bank", "income"].
    default_roles: list[DefaultRole] | None = None


class AccountUpdate(LegacyDefaultFlags):
    name: str | None = None
    nickname: str | None = None
    opening_balance: float | None = None
    # Full set of slots this account should hold; omit to leave defaults alone.
    default_roles: list[DefaultRole] | None = None
    is_active: bool | None = None
    institution: str | None = None
    last_four: str | None = None
    account_number: str | None = None
    country: AccountCountry | None = None


class AccountOut(AccountBase):
    id: str
    owner_id: str
    default_roles: list[DefaultRole] = Field(default_factory=list)
    # Deprecated mirrors of default_roles for older clients.
    is_default_expense: bool = False
    is_default_income: bool = False
    is_default_credit: bool = False
    is_default_investment: bool = False
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
