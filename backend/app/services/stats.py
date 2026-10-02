"""Dashboard statistics with investment exclusion and N빵 settlement netting."""

from datetime import date, datetime, timedelta

from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.category_preset import (
    EXPENSE_CATEGORY_INVESTMENT,
    INCOME_CATEGORY_SETTLEMENT,
    SUB_CATEGORY_SETTLEMENT,
    is_investment_expense,
    is_non_cashflow_transfer,
    is_settlement_income,
)
from app.models.ledger import (
    TRANSFER_CATEGORY,
    TransactionKind,
    normalize_transfer_category,
)
from app.models.transaction import AccountType, Currency, TransactionType
from app.services.access import shared_scope
from app.services.settlement import get_settled_amounts

COLLECTION = "transactions"


def _month_range(month: str) -> tuple[datetime, datetime]:
    year, mon = (int(part) for part in month.split("-"))
    start = datetime(year, mon, 1)
    end = datetime(year + 1, 1, 1) if mon == 12 else datetime(year, mon + 1, 1)
    return start, end


MAX_RANGE_DAYS = 366


def resolve_date_range(
    start: date | None, end: date | None, *, month: str | None = None
) -> tuple[datetime, datetime] | None:
    """Validate an inclusive [start, end] day range and return [start, end) datetimes."""
    if start is None and end is None:
        return None
    if start is None or end is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="start and end must be provided together.",
        )
    if month is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Use either month or start/end, not both.",
        )
    if end < start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="end must be on or after start.",
        )
    if (end - start).days >= MAX_RANGE_DAYS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Date range cannot exceed {MAX_RANGE_DAYS} days.",
        )
    return (
        datetime(start.year, start.month, start.day),
        datetime(end.year, end.month, end.day) + timedelta(days=1),
    )


def build_transaction_filter(
    *,
    owner_id: str | None = None,
    owner_ids: list[str] | None = None,
    account_type: AccountType,
    shared_group_id: str | None = None,
    currency: Currency | None = None,
    month: str | None = None,
    date_range: tuple[datetime, datetime] | None = None,
    tx_type: TransactionType | None = None,
    category: str | None = None,
    sub_category: str | None = None,
    merchant: str | None = None,
    institution: str | None = None,
) -> dict:
    """Shared MongoDB match filter for list + stats queries."""
    ids = owner_ids if owner_ids is not None else ([owner_id] if owner_id else [])
    if not ids:
        owner_clause: dict = {"owner_id": {"$in": []}}
    elif len(ids) == 1:
        owner_clause = {"owner_id": ids[0]}
    else:
        owner_clause = {"owner_id": {"$in": ids}}
    query: dict = {
        **owner_clause,
        "account_type": account_type.value,
        **shared_scope(account_type, shared_group_id),
    }
    if currency is not None:
        query["currency"] = currency.value
    if month is not None:
        start, end = _month_range(month)
        query["date"] = {"$gte": start, "$lt": end}
    elif date_range is not None:
        query["date"] = {"$gte": date_range[0], "$lt": date_range[1]}
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


def _is_transfer_category(category: str) -> bool:
    return normalize_transfer_category(category) == TRANSFER_CATEGORY


async def compute_stats(
    db: AsyncIOMotorDatabase,
    *,
    owner_id: str | None = None,
    owner_ids: list[str] | None = None,
    account_type: AccountType,
    shared_group_id: str | None = None,
    currency: Currency | None = None,
    month: str | None = None,
    date_range: tuple[datetime, datetime] | None = None,
    category: str | None = None,
    sub_category: str | None = None,
    merchant: str | None = None,
    institution: str | None = None,
) -> dict:
    """Aggregate income/expense totals with adjusted metrics.

    - adjusted_expense: total_expense − N빵 정산/환급 (actual out-of-pocket spend)
    - pure_consumption: total_expense − 투자/저축 (spending charts, excludes transfers)
    """
    ids = owner_ids if owner_ids is not None else ([owner_id] if owner_id else [])
    base_filter = build_transaction_filter(
        owner_ids=ids,
        account_type=account_type,
        shared_group_id=shared_group_id,
        currency=currency,
        month=month,
        date_range=date_range,
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
    expense_by_category: dict[str, float] = {}
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
            else:
                # Pure consumption categories for pie / expense ratio charts.
                expense_by_category[cat] = expense_by_category.get(cat, 0) + amount
            by_category[cat] = by_category.get(cat, 0) + amount
            by_sub_category[f"{cat} › {sub}"] = (
                by_sub_category.get(f"{cat} › {sub}", 0) + amount
            )

    adjusted_expense = max(total_expense - settlement_refund_total, 0)
    pure_consumption = max(total_expense - investment_savings_total, 0)

    # Per-expense effective spending after linked N빵 settlements
    settled_map = await get_settled_amounts(
        db,
        owner_ids=ids,
        account_type=account_type,
        shared_group_id=shared_group_id,
    )
    expense_docs = (
        await db[COLLECTION]
        .find(
            {
                **base_filter,
                "type": TransactionType.EXPENSE.value,
                "kind": {"$ne": TransactionKind.TRANSFER.value},
            }
        )
        .to_list(length=1000)
    )

    effective_by_category: dict[str, float] = {}
    effective_by_sub_category: dict[tuple[str, str], float] = {}
    effective_by_merchant: dict[str, float] = {}
    settlement_details: list[dict] = []
    for doc in expense_docs:
        cat = doc.get("category", "")
        sub = doc.get("sub_category", "")
        if is_non_cashflow_transfer(cat, sub):
            continue
        exp_id = str(doc["_id"])
        settled = settled_map.get(exp_id, 0.0)
        effective = max(doc["amount"] - settled, 0.0)

        # Expense-ratio slices: consumption only — no 투자/저축 or 자산 이동/카드
        # (shared funding, e-Transfer still count toward expense totals).
        if not is_investment_expense(cat) and not _is_transfer_category(cat):
            effective_by_category[cat] = effective_by_category.get(cat, 0.0) + effective
            effective_by_sub_category[(cat, sub)] = (
                effective_by_sub_category.get((cat, sub), 0.0) + effective
            )

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
        "expense_breakdown_by_category": [
            {"category": k, "amount": v}
            for k, v in sorted(effective_by_category.items(), key=lambda x: -x[1])
        ],
        "expense_breakdown_by_sub_category": [
            {"category": cat, "sub_category": sub, "amount": v}
            for (cat, sub), v in sorted(
                effective_by_sub_category.items(), key=lambda x: -x[1]
            )
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
            "start": date_range[0].date().isoformat() if date_range else None,
            "end": (date_range[1] - timedelta(days=1)).date().isoformat()
            if date_range
            else None,
            "category": category,
            "sub_category": sub_category,
            "merchant": merchant,
            "institution": institution,
            "exclude_investment_from": EXPENSE_CATEGORY_INVESTMENT,
            "settlement_sub_category": f"{INCOME_CATEGORY_SETTLEMENT} › {SUB_CATEGORY_SETTLEMENT}",
        },
    }
