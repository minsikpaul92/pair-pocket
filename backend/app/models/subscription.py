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
    PAUSED = "paused"  # legacy
    CANCEL_SCHEDULED = "cancel_scheduled"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class OccurrenceStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    SKIPPED = "skipped"


class SubscriptionBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    amount: float = Field(ge=0)
    currency: Currency
    account_type: AccountType = AccountType.PERSONAL

    cycle: BillingCycle = BillingCycle.MONTHLY
    start_date: datetime
    end_date: datetime | None = None

    installment_start_date: datetime | None = None
    total_installments: int | None = Field(default=None, gt=0)

    # Optional promotional pricing (amount = regular price after promo ends).
    promo_amount: float | None = Field(default=None, ge=0)
    promo_end_date: datetime | None = None
    promo_reminder_enabled: bool = False
    end_reminder_enabled: bool = False

    account_id: str
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
    completed_installments: int | None = Field(default=None, ge=0)


class SubscriptionUpdate(BaseModel):
    name: str | None = None
    amount: float | None = Field(default=None, ge=0)
    status: SubscriptionStatus | None = None
    end_date: datetime | None = None
    account_id: str | None = None
    category: str | None = None
    sub_category: str | None = None
    start_date: datetime | None = None
    installment_start_date: datetime | None = None
    total_installments: int | None = Field(default=None, gt=0)
    completed_installments: int | None = Field(default=None, ge=0)
    cycle: BillingCycle | None = None
    promo_amount: float | None = Field(default=None, ge=0)
    promo_end_date: datetime | None = None
    promo_reminder_enabled: bool | None = None
    end_reminder_enabled: bool | None = None


class SubscriptionOut(SubscriptionBase):
    id: str
    owner_id: str
    status: SubscriptionStatus
    next_due_date: datetime | None = None
    completed_installments: int = 0
    cancel_effective_date: datetime | None = None
    created_at: datetime
    updated_at: datetime


class SubscriptionOccurrenceOut(BaseModel):
    id: str
    subscription_id: str
    due_date: datetime
    amount: float
    currency: Currency
    status: OccurrenceStatus
    transaction_id: str | None = None
    subscription_name: str | None = None
    subscription_billing_cycle: BillingCycle | None = None


class SubscriptionHistoryOut(BaseModel):
    subscription_id: str
    start_date: datetime
    end_date: datetime | None
    months_active: int
    payment_count: int
    total_paid: float
    currency: Currency
    regular_total: float
    total_saved: float
    avg_saved_per_month: float


class MonthlySubscriptionSummaryOut(BaseModel):
    month: str
    subscription_total: dict[str, float]
    installment_total: dict[str, float]
