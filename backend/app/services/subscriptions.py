"""Subscription occurrence generation and lazy materialization."""

from datetime import datetime, timedelta

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.ledger import TransactionKind
from app.models.subscription import (
    BillingCycle,
    OccurrenceStatus,
    SubscriptionStatus,
)
from app.models.transaction import TransactionType

SUBS_COL = "subscriptions"
OCC_COL = "subscription_occurrences"
TX_COL = "transactions"


def _add_months(dt: datetime, months: int) -> datetime:
    month = dt.month - 1 + months
    year = dt.year + month // 12
    month = month % 12 + 1
    day = min(
        dt.day,
        [
            31,
            29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28,
            31,
            30,
            31,
            30,
            31,
            31,
            30,
            31,
            30,
            31,
        ][month - 1],
    )
    return dt.replace(year=year, month=month, day=day)


def _next_due(current: datetime, cycle: BillingCycle) -> datetime:
    if cycle == BillingCycle.YEARLY:
        return current.replace(year=current.year + 1)
    return _add_months(current, 1)


async def generate_occurrences(
    db: AsyncIOMotorDatabase,
    *,
    subscription: dict,
    horizon_months: int = 3,
) -> int:
    """Pre-create PENDING occurrences up to horizon. Returns count created."""
    sub_id = str(subscription["_id"])
    cycle = BillingCycle(subscription["cycle"])
    due = subscription.get("next_due_date") or subscription["start_date"]
    end = subscription.get("end_date")
    horizon_end = datetime.utcnow() + timedelta(days=horizon_months * 31)
    created = 0

    total_installments = subscription.get("total_installments")
    completed = subscription.get("completed_installments", 0)

    while due <= horizon_end:
        if end and due > end:
            break
        if total_installments and completed + created >= total_installments:
            break

        exists = await db[OCC_COL].find_one(
            {"subscription_id": sub_id, "due_date": due}
        )
        if not exists:
            await db[OCC_COL].insert_one(
                {
                    "subscription_id": sub_id,
                    "owner_id": subscription["owner_id"],
                    "account_type": subscription["account_type"],
                    "due_date": due,
                    "amount": subscription["amount"],
                    "currency": subscription["currency"],
                    "status": OccurrenceStatus.PENDING.value,
                    "transaction_id": None,
                    "created_at": datetime.utcnow(),
                }
            )
            created += 1

        due = _next_due(due, cycle)

    return created


async def materialize_due_occurrences(
    db: AsyncIOMotorDatabase,
    *,
    owner_id: str,
    account_type: str,
    as_of: datetime | None = None,
) -> int:
    """Lazy sync: turn due PENDING occurrences into Transactions.

    Call on dashboard load or via background task. Returns materialized count.
    """
    now = as_of or datetime.utcnow()
    pending = await db[OCC_COL].find(
        {
            "owner_id": owner_id,
            "account_type": account_type,
            "status": OccurrenceStatus.PENDING.value,
            "due_date": {"$lte": now},
        }
    ).to_list(length=200)

    materialized = 0
    for occ in pending:
        sub = await db[SUBS_COL].find_one({"_id": occ["subscription_id"]})
        if not sub or sub.get("status") != SubscriptionStatus.ACTIVE.value:
            continue

        tx_doc = {
            "date": occ["due_date"],
            "amount": occ["amount"],
            "currency": occ["currency"],
            "type": TransactionType.EXPENSE.value,
            "account_type": sub["account_type"],
            "category": sub["category"],
            "sub_category": sub["sub_category"],
            "merchant": sub.get("merchant", sub["name"]),
            "account_id": sub["account_id"],
            "kind": TransactionKind.NORMAL.value,
            "owner_id": owner_id,
            "subscription_occurrence_id": str(occ["_id"]),
        }
        result = await db[TX_COL].insert_one(tx_doc)
        await db[OCC_COL].update_one(
            {"_id": occ["_id"]},
            {
                "$set": {
                    "status": OccurrenceStatus.COMPLETED.value,
                    "transaction_id": str(result.inserted_id),
                }
            },
        )

        completed = sub.get("completed_installments", 0) + 1
        updates: dict = {
            "completed_installments": completed,
            "next_due_date": _next_due(occ["due_date"], BillingCycle(sub["cycle"])),
            "updated_at": datetime.utcnow(),
        }
        if sub.get("total_installments") and completed >= sub["total_installments"]:
            updates["status"] = SubscriptionStatus.COMPLETED.value

        await db[SUBS_COL].update_one({"_id": sub["_id"]}, {"$set": updates})
        materialized += 1

    return materialized


async def list_pending_occurrences(
    db: AsyncIOMotorDatabase,
    *,
    owner_id: str,
    account_type: str,
    month: str | None = None,
) -> list[dict]:
    """Return PENDING charges for UI '(예정)' badges — excluded from stats."""
    query: dict = {
        "owner_id": owner_id,
        "account_type": account_type,
        "status": OccurrenceStatus.PENDING.value,
    }
    if month:
        year, mon = (int(p) for p in month.split("-"))
        start = datetime(year, mon, 1)
        end = datetime(year + 1, 1, 1) if mon == 12 else datetime(year, mon + 1, 1)
        query["due_date"] = {"$gte": start, "$lt": end}

    docs = await db[OCC_COL].find(query).sort("due_date", 1).to_list(length=100)
    return docs
