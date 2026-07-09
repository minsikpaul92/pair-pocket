"""Subscription & installment scheduling.

Pending occurrences are NOT materialized as Transactions until due (or on lazy sync).
This keeps '예정' spend out of monthly stats while still surfacing in the UI.
"""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator

from app.models.transaction import AccountType, Currency


class BillingCycle(str, Enum):
    MONTHLY = "monthly"
    YEARLY = "yearly"
    INSTALLMENT = "installment"


class SubscriptionStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class OccurrenceStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    SKIPPED = "skipped"


class SubscriptionBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    amount: float = Field(gt=0)
    currency: Currency
    account_type: AccountType = AccountType.PERSONAL

    cycle: BillingCycle = BillingCycle.MONTHLY
    start_date: datetime
    end_date: datetime | None = None

    # Installment-only: total number of payments (e.g. 24-month phone plan).
    total_installments: int | None = Field(default=None, gt=0)

    # Charged from this financial account (card or bank).
    account_id: str

    # Fields copied into auto-generated expense transactions.
    category: str
    sub_category: str
    merchant: str = "미지정"

    @field_validator("name", "category", "sub_category", "merchant", mode="before")
    @classmethod
    def strip_strings(cls, v):
        if isinstance(v, str):
            return v.strip()
        return v


class SubscriptionCreate(SubscriptionBase):
    pass


class SubscriptionUpdate(BaseModel):
    name: str | None = None
    amount: float | None = Field(default=None, gt=0)
    status: SubscriptionStatus | None = None
    end_date: datetime | None = None
    account_id: str | None = None


class SubscriptionOut(SubscriptionBase):
    id: str
    owner_id: str
    status: SubscriptionStatus
    next_due_date: datetime | None = None
    completed_installments: int = 0
    created_at: datetime
    updated_at: datetime


class SubscriptionOccurrenceOut(BaseModel):
    """A single scheduled charge — pending until materialized."""

    id: str
    subscription_id: str
    due_date: datetime
    amount: float
    currency: Currency
    status: OccurrenceStatus
    transaction_id: str | None = None
    subscription_name: str | None = None
