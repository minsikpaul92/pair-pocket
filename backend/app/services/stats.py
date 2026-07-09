"""Dashboard statistics with investment exclusion and N빵 settlement netting."""

from datetime import datetime

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.category_preset import (
    EXPENSE_CATEGORY_INVESTMENT,
    INCOME_CATEGORY_SETTLEMENT,
    SUB_CATEGORY_SETTLEMENT,
    is_investment_expense,
    is_settlement_income,
    is_transfer_expense,
)
from app.models.ledger import TransactionKind
from app.models.transaction import AccountType, Currency, TransactionType
from app.services.settlement import get_settled_amounts

COLLECTION = "transactions"


def _month_range(month: str) -> tuple[datetime, datetime]:
    year, mon = (int(part) for part in month.split("-"))
    start = datetime(year, mon, 1)
    end = datetime(year + 1, 1, 1) if mon == 12 else datetime(year, mon + 1, 1)
    return start, end


def build_transaction_filter(
    *,
    owner_id: str,
    account_type: AccountType,
    currency: Currency | None = None,
    month: str | None = None,
    tx_type: TransactionType | None = None,
    category: str | None = None,
    sub_category: str | None = None,
    merchant: str | None = None,
    institution: str | None = None,
) -> dict:
    """Shared MongoDB match filter for list + stats queries."""
    query: dict = {
        "owner_id": owner_id,
        "account_type": account_type.value,
    }
    if currency is not None:
        query["currency"] = currency.value
    if month is not None:
        start, end = _month_range(month)
        query["date"] = {"$gte": start, "$lt": end}
    if tx_type is not None:
        query["type"] = tx_type.value
    if category is not None:
        query["category"] = category
    if sub_category is not None:
        query["sub_category"] = sub_category
    if merchant is not None:
        query["merchant"] = merchant
    if institution is not None:
        query["institution"] = institution
    return query


async def compute_stats(
    db: AsyncIOMotorDatabase,
    *,
    owner_id: str,
    account_type: AccountType,
    currency: Currency | None = None,
    month: str | None = None,
    category: str | None = None,
    sub_category: str | None = None,
    merchant: str | None = None,
    institution: str | None = None,
) -> dict:
    """Aggregate income/expense totals with adjusted metrics.

    - adjusted_expense: total_expense − N빵 정산/환급 (actual out-of-pocket spend)
    - pure_consumption: total_expense − 투자/저축 (spending charts, excludes transfers)
    """
    base_filter = build_transaction_filter(
        owner_id=owner_id,
        account_type=account_type,
        currency=currency,
        month=month,
        category=category,
        sub_category=sub_category,
        merchant=merchant,
        institution=institution,
    )

    # Exclude internal asset moves from cashflow stats (kind is authoritative).
    stats_filter = {
        **base_filter,
        "kind": {"$ne": TransactionKind.TRANSFER.value},
    }
    pipeline = [
        {"$match": stats_filter},
        {
            "$group": {
                "_id": {
                    "type": "$type",
                    "category": "$category",
                    "sub_category": "$sub_category",
                },
                "total": {"$sum": "$amount"},
                "count": {"$sum": 1},
            }
        },
    ]
    groups = await db[COLLECTION].aggregate(pipeline).to_list(length=500)

    total_income = 0.0
    total_expense = 0.0
    investment_savings_total = 0.0
    settlement_refund_total = 0.0
    by_category: dict[str, float] = {}
    by_sub_category: dict[str, float] = {}

    for g in groups:
        key = g["_id"]
        amount = g["total"]
        tx_type = key.get("type")
        cat = key.get("category", "")
        sub = key.get("sub_category", "")

        if tx_type == TransactionType.INCOME.value:
            # N빵 정산 is an expense offset, not income — exclude from income totals.
            if is_settlement_income(cat, sub):
                settlement_refund_total += amount
                continue
            total_income += amount
            by_category[cat] = by_category.get(cat, 0) + amount
            by_sub_category[f"{cat} › {sub}"] = (
                by_sub_category.get(f"{cat} › {sub}", 0) + amount
            )
        elif tx_type == TransactionType.EXPENSE.value:
            total_expense += amount
            if is_investment_expense(cat):
                investment_savings_total += amount
            by_category[cat] = by_category.get(cat, 0) + amount
            by_sub_category[f"{cat} › {sub}"] = (
                by_sub_category.get(f"{cat} › {sub}", 0) + amount
            )

    adjusted_expense = max(total_expense - settlement_refund_total, 0)
    pure_consumption = max(total_expense - investment_savings_total, 0)

    # Per-expense effective spending after linked N빵 settlements
    settled_map = await get_settled_amounts(db, owner_id)
    expense_docs = await db[COLLECTION].find(
        {
            **base_filter,
            "type": TransactionType.EXPENSE.value,
            "kind": {"$ne": TransactionKind.TRANSFER.value},
        }
    ).to_list(length=1000)

    effective_by_merchant: dict[str, float] = {}
    settlement_details: list[dict] = []
    for doc in expense_docs:
        if is_transfer_expense(doc.get("category", "")):
            continue
        exp_id = str(doc["_id"])
        settled = settled_map.get(exp_id, 0.0)
        effective = max(doc["amount"] - settled, 0.0)
        merchant = doc.get("merchant", "미지정")
        effective_by_merchant[merchant] = (
            effective_by_merchant.get(merchant, 0.0) + effective
        )
        if settled > 0:
            settlement_details.append(
                {
                    "expense_id": exp_id,
                    "merchant": merchant,
                    "original_amount": doc["amount"],
                    "settled_amount": settled,
                    "effective_amount": effective,
                }
            )

    return {
        "total_income": total_income,
        "total_expense": total_expense,
        "investment_savings_total": investment_savings_total,
        "settlement_refund_total": settlement_refund_total,
        "adjusted_expense": adjusted_expense,
        "pure_consumption": pure_consumption,
        # Settlement reduces out-of-pocket spend; do not also count it as income.
        "net_cashflow": total_income - adjusted_expense,
        "breakdown_by_category": [
            {"category": k, "amount": v}
            for k, v in sorted(by_category.items(), key=lambda x: -x[1])
        ],
        "breakdown_by_sub_category": [
            {"label": k, "amount": v}
            for k, v in sorted(by_sub_category.items(), key=lambda x: -x[1])
        ],
        "breakdown_by_merchant_effective": [
            {"merchant": k, "amount": v}
            for k, v in sorted(effective_by_merchant.items(), key=lambda x: -x[1])
        ],
        "settlement_details": settlement_details,
        "filters_applied": {
            "currency": currency.value if currency else None,
            "month": month,
            "category": category,
            "sub_category": sub_category,
            "merchant": merchant,
            "institution": institution,
            "exclude_investment_from": EXPENSE_CATEGORY_INVESTMENT,
            "settlement_sub_category": f"{INCOME_CATEGORY_SETTLEMENT} › {SUB_CATEGORY_SETTLEMENT}",
        },
    }
