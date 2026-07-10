from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field

from app.core.security import get_current_user
from app.database import get_database
from app.models.transaction import AccountType, Currency
from app.models.user import UserOut
from app.services.access import resolve_owner_ids
from app.services.stats import compute_stats

router = APIRouter(prefix="/api/stats", tags=["stats"])


class CategoryBreakdown(BaseModel):
    category: str
    amount: float


class SubCategoryBreakdown(BaseModel):
    label: str
    amount: float


class FiltersApplied(BaseModel):
    currency: str | None = None
    month: str | None = None
    category: str | None = None
    sub_category: str | None = None
    merchant: str | None = None
    institution: str | None = None
    exclude_investment_from: str
    settlement_sub_category: str


class StatsSummary(BaseModel):
    """Dashboard summary with N빵 netting and investment exclusion."""

    total_income: float
    total_expense: float
    investment_savings_total: float = Field(
        description="Sum of [투자/저축] expenses (excluded from pure_consumption)."
    )
    settlement_refund_total: float = Field(
        description="Sum of [정산 › N빵 정산/환급] income (subtracted from adjusted_expense)."
    )
    adjusted_expense: float = Field(
        description="total_expense − settlement_refund_total (actual out-of-pocket)."
    )
    pure_consumption: float = Field(
        description="total_expense − investment_savings_total (spending charts)."
    )
    net_cashflow: float
    breakdown_by_category: list[CategoryBreakdown]
    breakdown_by_sub_category: list[SubCategoryBreakdown]
    filters_applied: FiltersApplied


@router.get("/summary", response_model=StatsSummary)
async def stats_summary(
    account_type: AccountType = AccountType.PERSONAL,
    currency: Currency | None = None,
    month: str | None = Query(default=None, description="Filter by 'YYYY-MM'."),
    category: str | None = None,
    sub_category: str | None = None,
    merchant: str | None = None,
    institution: str | None = None,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    """Dashboard stats with investment exclusion and N빵 settlement netting."""
    owner_ids = await resolve_owner_ids(db, current_user, account_type)
    return await compute_stats(
        db,
        owner_ids=owner_ids,
        account_type=account_type,
        currency=currency,
        month=month,
        category=category,
        sub_category=sub_category,
        merchant=merchant,
        institution=institution,
    )
