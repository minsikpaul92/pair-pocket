from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator


class Currency(str, Enum):
    KRW = "KRW"
    CAD = "CAD"


class TransactionType(str, Enum):
    INCOME = "income"
    EXPENSE = "expense"


class AccountType(str, Enum):
    SHARED = "shared"
    PERSONAL = "personal"


class TransactionBase(BaseModel):
    """3-level hierarchy: category → sub_category → merchant.

    `institution` is required for [투자/저축] expense transfers (bank/brokerage).
    `owner_id` is set by the server from the JWT, never from the client.
    """

    date: datetime
    amount: float = Field(gt=0)
    currency: Currency
    type: TransactionType
    account_type: AccountType = AccountType.PERSONAL

    # Level 1 — 대분류 (chart summary)
    category: str
    # Level 2 — 중분류 (purpose within category)
    sub_category: str
    # Level 3 — 상세 사용처 (free text / autocomplete)
    merchant: str = "미지정"

    # Financial institution for [투자/저축] expense only
    institution: str | None = None

    # Links [정산 › N빵 정산/환급] income to the original expense transaction
    settles_expense_id: str | None = None

    @field_validator(
        "category", "sub_category", "merchant", "institution", mode="before"
    )
    @classmethod
    def strip_strings(cls, v):
        if isinstance(v, str):
            return v.strip()
        return v


class TransactionCreate(TransactionBase):
    pass


class TransactionOut(TransactionBase):
    id: str
    owner_id: str
