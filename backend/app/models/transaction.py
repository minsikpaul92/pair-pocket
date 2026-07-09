from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


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
    """Core transaction fields as defined in PRD.md §4.

    `owner_id` is intentionally excluded here: the server derives it from the
    authenticated user rather than trusting the client.
    """

    date: datetime
    amount: float = Field(gt=0)
    currency: Currency
    type: TransactionType
    account_type: AccountType = AccountType.PERSONAL
    category: str
    merchant: str


class TransactionCreate(TransactionBase):
    pass


class TransactionOut(TransactionBase):
    id: str
    owner_id: str
