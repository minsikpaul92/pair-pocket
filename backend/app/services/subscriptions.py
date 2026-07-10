"""Subscription occurrence generation and lazy materialization."""

from datetime import datetime, timedelta

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument

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


def _owner_clause(
    owner_id: str | None = None,
    owner_ids: list[str] | None = None,
) -> dict:
    ids = owner_ids if owner_ids is not None else ([owner_id] if owner_id else [])
    if not ids:
        return {"owner_id": {"$in": []}}
    if len(ids) == 1:
        return {"owner_id": ids[0]}
    return {"owner_id": {"$in": ids}}


def _resolve_ids(
    owner_id: str | None = None,
    owner_ids: list[str] | None = None,
) -> list[str]:
    if owner_ids is not None:
        return owner_ids
    return [owner_id] if owner_id else []


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
    # monthly + installment both advance one month per charge
    return _add_months(current, 1)


def _as_object_id(value) -> ObjectId | None:
    if isinstance(value, ObjectId):
        return value
    if isinstance(value, str) and ObjectId.is_valid(value):
        return ObjectId(value)
    return None


def _calendar_day(dt: datetime) -> datetime:
    """Normalize to midnight for calendar-day comparisons."""
    return datetime(dt.year, dt.month, dt.day)


def _parse_as_of(as_of: str | None) -> datetime:
    """Parse client local YYYY-MM-DD; fall back to UTC today."""
    if as_of:
        try:
            year, month, day = (int(p) for p in as_of.split("-"))
            return datetime(year, month, day)
        except (ValueError, TypeError):
            pass
    return _calendar_day(datetime.utcnow())


async def _subscription_cycle_for_occurrence(
    db: AsyncIOMotorDatabase, occ: dict
) -> BillingCycle:
    sub_oid = occ.get("subscription_id")
    sub = None
    if isinstance(sub_oid, ObjectId):
        sub = await db[SUBS_COL].find_one({"_id": sub_oid})
    elif isinstance(sub_oid, str) and ObjectId.is_valid(sub_oid):
        sub = await db[SUBS_COL].find_one({"_id": ObjectId(sub_oid)})
    if sub:
        return BillingCycle(sub["cycle"])
    return BillingCycle.MONTHLY


async def _subscription_cycle_for_transaction(
    db: AsyncIOMotorDatabase, tx: dict
) -> BillingCycle:
    cycle_val = tx.get("subscription_billing_cycle")
    if cycle_val:
        return BillingCycle(cycle_val)
    sub_id = tx.get("subscription_id")
    if isinstance(sub_id, str) and ObjectId.is_valid(sub_id):
        sub = await db[SUBS_COL].find_one({"_id": ObjectId(sub_id)})
        if sub:
            return BillingCycle(sub["cycle"])
    occ_id = tx.get("subscription_occurrence_id")
    if isinstance(occ_id, str) and ObjectId.is_valid(occ_id):
        occ = await db[OCC_COL].find_one({"_id": ObjectId(occ_id)})
        if occ:
            return await _subscription_cycle_for_occurrence(db, occ)
    return BillingCycle.MONTHLY


def _months_between(start: datetime, end: datetime) -> int:
    return max(0, (end.year - start.year) * 12 + (end.month - start.month))


def installment_end_date(
    start: datetime, *, total_installments: int
) -> datetime:
    return _add_months(start, max(total_installments - 1, 0))


def _schedule_start(subscription: dict) -> datetime:
    """Earliest date this subscription should appear on the calendar."""
    return subscription.get("installment_start_date") or subscription["start_date"]


async def prune_occurrences_before_start(
    db: AsyncIOMotorDatabase,
    *,
    subscription: dict,
) -> int:
    """Drop pending rows scheduled before the subscription's real start."""
    start = _calendar_day(_schedule_start(subscription))
    result = await db[OCC_COL].delete_many(
        {
            "subscription_id": str(subscription["_id"]),
            "status": OccurrenceStatus.PENDING.value,
            "due_date": {"$lt": start},
        }
    )
    return result.deleted_count


def amount_for_due_date(subscription: dict, due: datetime) -> float:
    """Return promo or regular amount for a scheduled charge date."""
    promo_amount = subscription.get("promo_amount")
    promo_end = subscription.get("promo_end_date")
    regular = float(subscription["amount"])
    if promo_amount is None or promo_end is None:
        return regular
    if _calendar_day(due) <= _calendar_day(promo_end):
        return float(promo_amount)
    return regular


def _month_bounds(month: str) -> tuple[datetime, datetime]:
    year, mon = (int(p) for p in month.split("-"))
    start = datetime(year, mon, 1)
    end = datetime(year + 1, 1, 1) if mon == 12 else datetime(year, mon + 1, 1)
    return start, end


def subscription_visible_now(sub: dict, today: datetime | None = None) -> bool:
    today = _calendar_day(today or datetime.utcnow())
    status = sub.get("status", SubscriptionStatus.ACTIVE.value)
    if status in (
        SubscriptionStatus.CANCELLED.value,
        SubscriptionStatus.COMPLETED.value,
    ):
        return False
    cancel_eff = sub.get("cancel_effective_date")
    if cancel_eff and today >= _calendar_day(cancel_eff):
        return False
    return True


def subscription_visible_in_month(
    sub: dict, month: str, today: datetime | None = None
) -> bool:
    start, end = _month_bounds(month)
    sub_start = _calendar_day(sub["start_date"])
    if sub_start >= end:
        return False

    cancel_eff = sub.get("cancel_effective_date")
    if cancel_eff:
        ce = _calendar_day(cancel_eff)
        if ce <= start:
            return False
        today_day = _calendar_day(today or datetime.utcnow())
        last_day = end - timedelta(days=1)
        if today_day >= ce and ce <= last_day:
            return False

    status = sub.get("status", SubscriptionStatus.ACTIVE.value)
    if status == SubscriptionStatus.CANCELLED.value:
        ended = cancel_eff or sub.get("end_date")
        if ended and _calendar_day(ended) < start:
            return False

    return True


async def finalize_expired_cancellations(
    db: AsyncIOMotorDatabase,
    *,
    owner_id: str | None = None,
    owner_ids: list[str] | None = None,
    account_type: str,
) -> int:
    today = _calendar_day(datetime.utcnow())
    result = await db[SUBS_COL].update_many(
        {
            **_owner_clause(owner_id, owner_ids),
            "account_type": account_type,
            "status": SubscriptionStatus.CANCEL_SCHEDULED.value,
            "cancel_effective_date": {"$lte": today},
        },
        {
            "$set": {
                "status": SubscriptionStatus.CANCELLED.value,
                "updated_at": datetime.utcnow(),
            }
        },
    )
    return result.modified_count


async def schedule_subscription_cancel(
    db: AsyncIOMotorDatabase,
    *,
    subscription: dict,
) -> dict:
    """Mark 해지예정 — visible until day before next billing cycle after upcoming due."""
    cycle = BillingCycle(subscription["cycle"])
    next_due = subscription.get("next_due_date") or subscription["start_date"]
    cancel_effective = _next_due(next_due, cycle)
    end_date = cancel_effective - timedelta(days=1)
    sub_id = str(subscription["_id"])

    await db[SUBS_COL].update_one(
        {"_id": subscription["_id"]},
        {
            "$set": {
                "status": SubscriptionStatus.CANCEL_SCHEDULED.value,
                "cancel_effective_date": cancel_effective,
                "end_date": end_date,
                "updated_at": datetime.utcnow(),
            }
        },
    )
    await db[OCC_COL].delete_many(
        {
            "subscription_id": sub_id,
            "status": OccurrenceStatus.PENDING.value,
            "due_date": {"$gt": end_date},
        }
    )
    updated = await db[SUBS_COL].find_one({"_id": subscription["_id"]})
    return updated


async def purge_subscription_on_reschedule(
    db: AsyncIOMotorDatabase,
    *,
    subscription_id: str,
    old_next_due: datetime,
) -> int:
    """Remove pending rows and auto-materialized rows at the old next-due anchor."""
    old_day = _calendar_day(old_next_due)
    removed = 0
    occs = await db[OCC_COL].find({"subscription_id": subscription_id}).to_list(
        length=200
    )
    for occ in occs:
        due = occ.get("due_date")
        if not isinstance(due, datetime):
            continue
        due_day = _calendar_day(due)
        status = occ.get("status")
        should_remove = (
            status == OccurrenceStatus.PENDING.value or due_day == old_day
        )
        if not should_remove:
            continue
        occ_id = str(occ["_id"])
        tx = await db[TX_COL].find_one({"subscription_occurrence_id": occ_id})
        if tx:
            await db[TX_COL].delete_one({"_id": tx["_id"]})
        await db[OCC_COL].delete_one({"_id": occ["_id"]})
        removed += 1
    return removed


def _reminder_email_body(
    *,
    settings,
    sub: dict,
    title: str,
    detail_lines: list[str],
) -> str:
    sub_id = str(sub["_id"])
    view_url = f"{settings.frontend_url}/?view=subscriptions&subscription={sub_id}"
    cancel_url = (
        f"{settings.frontend_url}/?view=subscriptions&subscription={sub_id}&action=cancel"
    )
    details = "\n".join(detail_lines)
    return (
        f"안녕하세요,\n\n"
        f"{title}\n"
        f"{details}\n\n"
        f"구독 확인: {view_url}\n"
        f"해지하기: {cancel_url}\n\n"
        f"PairPocket"
    )


async def send_promo_reminders(
    db: AsyncIOMotorDatabase,
    *,
    owner_id: str,
    account_type: str,
    user_email: str,
    as_of: str | None = None,
) -> int:
    from app.config import get_settings
    from app.services.email import send_email

    settings = get_settings()
    today = _parse_as_of(as_of)
    week_ahead = today + timedelta(days=7)
    sent_count = 0
    subs = await db[SUBS_COL].find(
        {
            "owner_id": owner_id,
            "account_type": account_type,
            "promo_reminder_enabled": True,
            "promo_amount": {"$ne": None},
            "promo_end_date": {"$gte": today, "$lte": week_ahead},
            "promo_reminder_sent_at": None,
        }
    ).to_list(length=50)

    for sub in subs:
        promo_end = sub.get("promo_end_date")
        if not promo_end:
            continue
        end_label = promo_end.strftime("%Y-%m-%d")
        body = _reminder_email_body(
            settings=settings,
            sub=sub,
            title=f"'{sub['name']}' 구독 프로모션이 {end_label}에 종료됩니다.",
            detail_lines=[
                f"프로모션 금액: {sub.get('promo_amount')} {sub['currency']}",
                f"이후 정상 금액: {sub['amount']} {sub['currency']}",
            ],
        )
        if send_email(
            to=user_email,
            subject=f"[PairPocket] {sub['name']} 프로모션 종료 1주일 전 알림",
            body=body,
        ):
            await db[SUBS_COL].update_one(
                {"_id": sub["_id"]},
                {"$set": {"promo_reminder_sent_at": datetime.utcnow()}},
            )
            sent_count += 1
    return sent_count


async def send_end_reminders(
    db: AsyncIOMotorDatabase,
    *,
    owner_id: str,
    account_type: str,
    user_email: str,
    as_of: str | None = None,
) -> int:
    from app.config import get_settings
    from app.services.email import send_email

    settings = get_settings()
    today = _parse_as_of(as_of)
    week_ahead = today + timedelta(days=7)
    sent_count = 0
    subs = await db[SUBS_COL].find(
        {
            "owner_id": owner_id,
            "account_type": account_type,
            "end_reminder_enabled": True,
            "end_date": {"$gte": today, "$lte": week_ahead},
            "end_reminder_sent_at": None,
        }
    ).to_list(length=50)

    for sub in subs:
        end = sub.get("end_date")
        if not end:
            continue
        end_label = end.strftime("%Y-%m-%d")
        body = _reminder_email_body(
            settings=settings,
            sub=sub,
            title=f"'{sub['name']}' 구독이 {end_label}에 종료됩니다.",
            detail_lines=[f"정상 금액: {sub['amount']} {sub['currency']}"],
        )
        if send_email(
            to=user_email,
            subject=f"[PairPocket] {sub['name']} 구독 종료 1주일 전 알림",
            body=body,
        ):
            await db[SUBS_COL].update_one(
                {"_id": sub["_id"]},
                {"$set": {"end_reminder_sent_at": datetime.utcnow()}},
            )
            sent_count += 1
    return sent_count


async def get_subscription_history(
    db: AsyncIOMotorDatabase,
    *,
    subscription_id: str,
    owner_id: str | None = None,
    owner_ids: list[str] | None = None,
) -> dict | None:
    if not ObjectId.is_valid(subscription_id):
        return None
    sub = await db[SUBS_COL].find_one(
        {
            "_id": ObjectId(subscription_id),
            **_owner_clause(owner_id, owner_ids),
        }
    )
    if not sub:
        return None

    occs = await db[OCC_COL].find(
        {
            "subscription_id": subscription_id,
            "status": OccurrenceStatus.COMPLETED.value,
        }
    ).to_list(length=500)
    occ_ids = [str(o["_id"]) for o in occs]
    txs: list[dict] = []
    if occ_ids:
        txs = await db[TX_COL].find(
            {"subscription_occurrence_id": {"$in": occ_ids}}
        ).to_list(length=500)

    regular_price = float(sub["amount"])
    promo_end = sub.get("promo_end_date")
    total_paid = 0.0
    regular_total = 0.0
    promo_payments = 0

    for tx in txs:
        amt = float(tx["amount"])
        total_paid += amt
        due = tx.get("date")
        if (
            promo_end
            and isinstance(due, datetime)
            and _calendar_day(due) <= _calendar_day(promo_end)
        ):
            regular_total += regular_price
            promo_payments += 1
        else:
            regular_total += amt

    total_saved = max(regular_total - total_paid, 0.0)
    start = sub.get("installment_start_date") or sub["start_date"]
    end = (
        sub.get("cancel_effective_date")
        or sub.get("end_date")
        or datetime.utcnow()
    )
    months_active = max(_months_between(start, end), 1)
    if txs:
        months_active = max(
            months_active,
            len({(tx["date"].year, tx["date"].month) for tx in txs if isinstance(tx.get("date"), datetime)}),
        )

    avg_saved = total_saved / promo_payments if promo_payments else 0.0

    return {
        "subscription_id": subscription_id,
        "start_date": start,
        "end_date": sub.get("cancel_effective_date") or sub.get("end_date"),
        "months_active": months_active,
        "payment_count": len(txs),
        "total_paid": total_paid,
        "currency": sub["currency"],
        "regular_total": regular_total,
        "total_saved": total_saved,
        "avg_saved_per_month": avg_saved,
    }


async def monthly_subscription_summary(
    db: AsyncIOMotorDatabase,
    *,
    owner_id: str | None = None,
    owner_ids: list[str] | None = None,
    account_type: str,
    month: str,
    currency: str | None = None,
) -> dict:
    start, end = _month_bounds(month)
    sub_totals: dict[str, float] = {}
    inst_totals: dict[str, float] = {}

    pending_query: dict = {
        **_owner_clause(owner_id, owner_ids),
        "account_type": account_type,
        "status": OccurrenceStatus.PENDING.value,
        "due_date": {"$gte": start, "$lt": end},
    }
    if currency:
        pending_query["currency"] = currency

    pending = await db[OCC_COL].find(pending_query).to_list(length=200)
    for occ in pending:
        cur = occ["currency"]
        cycle = await _subscription_cycle_for_occurrence(db, occ)
        bucket = inst_totals if cycle == BillingCycle.INSTALLMENT else sub_totals
        bucket[cur] = bucket.get(cur, 0.0) + float(occ["amount"])

    tx_query: dict = {
        **_owner_clause(owner_id, owner_ids),
        "account_type": account_type,
        "subscription_occurrence_id": {"$exists": True, "$ne": None},
        "date": {"$gte": start, "$lt": end},
    }
    if currency:
        tx_query["currency"] = currency

    txs = await db[TX_COL].find(tx_query).to_list(length=500)
    for tx in txs:
        cur = tx["currency"]
        cycle = await _subscription_cycle_for_transaction(db, tx)
        bucket = inst_totals if cycle == BillingCycle.INSTALLMENT else sub_totals
        bucket[cur] = bucket.get(cur, 0.0) + float(tx["amount"])

    return {
        "month": month,
        "subscription_total": sub_totals,
        "installment_total": inst_totals,
    }


async def prune_all_invalid_pending(
    db: AsyncIOMotorDatabase,
    *,
    owner_id: str | None = None,
    owner_ids: list[str] | None = None,
    account_type: str,
) -> int:
    removed = 0
    subs = await db[SUBS_COL].find(
        {**_owner_clause(owner_id, owner_ids), "account_type": account_type}
    ).to_list(length=200)
    for sub in subs:
        removed += await prune_occurrences_before_start(db, subscription=sub)
    return removed


async def generate_occurrences(
    db: AsyncIOMotorDatabase,
    *,
    subscription: dict,
    horizon_months: int = 3,
) -> int:
    """Pre-create PENDING occurrences up to horizon. Returns count created."""
    sub_id = str(subscription["_id"])
    cycle = BillingCycle(subscription["cycle"])
    schedule_start = _calendar_day(_schedule_start(subscription))
    due = subscription.get("next_due_date") or subscription["start_date"]
    if _calendar_day(due) < schedule_start:
        due = _schedule_start(subscription)
    end = subscription.get("end_date")
    total_installments = subscription.get("total_installments")
    completed = subscription.get("completed_installments", 0)

    # With an end date or installment count, generate the full remaining schedule.
    # Open-ended monthly/yearly keep a short rolling horizon.
    if end is not None:
        horizon_end = end
    elif total_installments is not None:
        remaining = max(total_installments - completed, 0)
        horizon_end = datetime.utcnow() + timedelta(days=max(remaining, 1) * 31)
    else:
        horizon_end = datetime.utcnow() + timedelta(days=horizon_months * 31)

    created = 0
    pending_count = await db[OCC_COL].count_documents(
        {
            "subscription_id": sub_id,
            "status": OccurrenceStatus.PENDING.value,
        }
    )

    await prune_occurrences_before_start(db, subscription=subscription)

    while due <= horizon_end:
        if _calendar_day(due) < schedule_start:
            due = _next_due(due, cycle)
            continue
        if end and due > end:
            break
        if total_installments is not None:
            if completed + pending_count + created >= total_installments:
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
                    "amount": amount_for_due_date(subscription, due),
                    "currency": subscription["currency"],
                    "status": OccurrenceStatus.PENDING.value,
                    "transaction_id": None,
                    "created_at": datetime.utcnow(),
                }
            )
            created += 1

        due = _next_due(due, cycle)

    return created


async def dedupe_subscription_transactions(db: AsyncIOMotorDatabase) -> int:
    """Remove duplicate auto-generated expenses for the same occurrence."""
    pipeline = [
        {
            "$match": {
                "subscription_occurrence_id": {"$exists": True, "$ne": None},
            }
        },
        {
            "$group": {
                "_id": "$subscription_occurrence_id",
                "ids": {"$push": "$_id"},
                "count": {"$sum": 1},
            }
        },
        {"$match": {"count": {"$gt": 1}}},
    ]
    removed = 0
    async for group in db[TX_COL].aggregate(pipeline):
        ids = group["ids"]
        keep = ids[0]
        for extra_id in ids[1:]:
            await db[TX_COL].delete_one({"_id": extra_id})
            removed += 1
        occ_id = group["_id"]
        if isinstance(occ_id, str) and ObjectId.is_valid(occ_id):
            await db[OCC_COL].update_one(
                {"_id": ObjectId(occ_id)},
                {"$set": {"transaction_id": str(keep)}},
            )
    return removed


async def materialize_due_occurrences(
    db: AsyncIOMotorDatabase,
    *,
    owner_id: str | None = None,
    owner_ids: list[str] | None = None,
    account_type: str,
    as_of: str | None = None,
) -> int:
    """Lazy sync: turn due PENDING occurrences into Transactions.

    Call on app load. Returns materialized count.
    """
    today = _parse_as_of(as_of)
    ids = _resolve_ids(owner_id, owner_ids)
    if not ids:
        return 0

    await prune_all_invalid_pending(
        db, owner_ids=ids, account_type=account_type
    )
    await dedupe_subscription_transactions(db)
    await finalize_expired_cancellations(
        db, owner_ids=ids, account_type=account_type
    )

    pending = await db[OCC_COL].find(
        {
            **_owner_clause(owner_ids=ids),
            "account_type": account_type,
            "status": OccurrenceStatus.PENDING.value,
        }
    ).to_list(length=500)

    materialized = 0
    for occ in pending:
        due = occ.get("due_date")
        if not isinstance(due, datetime):
            continue
        if _calendar_day(due) > today:
            continue

        claimed = await db[OCC_COL].find_one_and_update(
            {
                "_id": occ["_id"],
                "status": OccurrenceStatus.PENDING.value,
            },
            {
                "$set": {
                    "status": OccurrenceStatus.COMPLETED.value,
                }
            },
            return_document=ReturnDocument.BEFORE,
        )
        if not claimed:
            continue

        existing_tx = await db[TX_COL].find_one(
            {"subscription_occurrence_id": str(claimed["_id"])}
        )
        if existing_tx:
            await db[OCC_COL].update_one(
                {"_id": claimed["_id"]},
                {"$set": {"transaction_id": str(existing_tx["_id"])}},
            )
            continue

        sub_oid = _as_object_id(claimed.get("subscription_id"))
        if not sub_oid:
            continue
        sub = await db[SUBS_COL].find_one({"_id": sub_oid})
        allowed_statuses = {
            SubscriptionStatus.ACTIVE.value,
            SubscriptionStatus.CANCEL_SCHEDULED.value,
        }
        if not sub or sub.get("status") not in allowed_statuses:
            continue

        tx_owner = claimed.get("owner_id") or sub.get("owner_id") or ids[0]
        tx_doc = {
            "date": claimed["due_date"],
            "amount": claimed["amount"],
            "currency": claimed["currency"],
            "type": TransactionType.EXPENSE.value,
            "account_type": sub["account_type"],
            "category": sub["category"],
            "sub_category": sub["sub_category"],
            "merchant": sub.get("merchant") or sub["name"],
            "institution": None,
            "settles_expense_id": None,
            "account_id": sub["account_id"],
            "counter_account_id": None,
            "kind": TransactionKind.NORMAL.value,
            "owner_id": tx_owner,
            "subscription_occurrence_id": str(claimed["_id"]),
            "subscription_id": str(sub["_id"]),
            "subscription_billing_cycle": sub["cycle"],
        }
        result = await db[TX_COL].insert_one(tx_doc)
        await db[OCC_COL].update_one(
            {"_id": claimed["_id"]},
            {
                "$set": {
                    "transaction_id": str(result.inserted_id),
                }
            },
        )

        completed = sub.get("completed_installments", 0) + 1
        next_due = _next_due(claimed["due_date"], BillingCycle(sub["cycle"]))
        updates: dict = {
            "completed_installments": completed,
            "next_due_date": next_due,
            "updated_at": datetime.utcnow(),
        }
        if sub.get("total_installments") and completed >= sub["total_installments"]:
            updates["status"] = SubscriptionStatus.COMPLETED.value

        await db[SUBS_COL].update_one({"_id": sub["_id"]}, {"$set": updates})

        # Keep the pending horizon topped up for active subscriptions.
        refreshed = await db[SUBS_COL].find_one({"_id": sub["_id"]})
        if refreshed and refreshed.get("status") in (
            SubscriptionStatus.ACTIVE.value,
            SubscriptionStatus.CANCEL_SCHEDULED.value,
        ):
            await generate_occurrences(db, subscription=refreshed)

        materialized += 1

    return materialized


async def list_pending_occurrences(
    db: AsyncIOMotorDatabase,
    *,
    owner_id: str | None = None,
    owner_ids: list[str] | None = None,
    account_type: str,
    month: str | None = None,
    currency: str | None = None,
    as_of: str | None = None,
) -> list[dict]:
    """Return upcoming PENDING charges — excluded from stats until materialized."""
    today = _parse_as_of(as_of)

    query: dict = {
        **_owner_clause(owner_id, owner_ids),
        "account_type": account_type,
        "status": OccurrenceStatus.PENDING.value,
    }
    if currency:
        query["currency"] = currency

    date_filter: dict[str, datetime] = {"$gte": today}
    if month:
        year, mon = (int(p) for p in month.split("-"))
        start = datetime(year, mon, 1)
        end = datetime(year + 1, 1, 1) if mon == 12 else datetime(year, mon + 1, 1)
        date_filter["$gte"] = max(today, start)
        date_filter["$lt"] = end
    query["due_date"] = date_filter

    docs = await db[OCC_COL].find(query).sort("due_date", 1).to_list(length=100)
    return docs


async def skip_occurrence(
    db: AsyncIOMotorDatabase,
    *,
    occurrence_id: str,
    owner_id: str | None = None,
    owner_ids: list[str] | None = None,
) -> dict | None:
    """Skip a pending charge without creating a transaction."""
    if not ObjectId.is_valid(occurrence_id):
        return None

    claimed = await db[OCC_COL].find_one_and_update(
        {
            "_id": ObjectId(occurrence_id),
            **_owner_clause(owner_id, owner_ids),
            "status": OccurrenceStatus.PENDING.value,
        },
        {"$set": {"status": OccurrenceStatus.SKIPPED.value}},
        return_document=ReturnDocument.BEFORE,
    )
    if not claimed:
        return None

    sub_oid = _as_object_id(claimed.get("subscription_id"))
    if not sub_oid:
        return claimed

    sub = await db[SUBS_COL].find_one(
        {"_id": sub_oid, **_owner_clause(owner_id, owner_ids)}
    )
    if not sub:
        return claimed

    due = claimed.get("due_date")
    if not isinstance(due, datetime):
        return claimed

    cycle = BillingCycle(sub["cycle"])
    next_due = _next_due(due, cycle)
    await db[SUBS_COL].update_one(
        {"_id": sub_oid},
        {
            "$set": {
                "next_due_date": next_due,
                "updated_at": datetime.utcnow(),
            }
        },
    )

    refreshed = await db[SUBS_COL].find_one({"_id": sub_oid})
    if refreshed and refreshed.get("status") in (
        SubscriptionStatus.ACTIVE.value,
        SubscriptionStatus.CANCEL_SCHEDULED.value,
    ):
        await generate_occurrences(db, subscription=refreshed)

    return claimed


async def run_all_reminder_jobs(
    db: AsyncIOMotorDatabase,
    *,
    as_of: str | None = None,
) -> dict:
    """Send promo/end reminders for every user (cron entry point)."""
    users = await db["users"].find({}).to_list(length=500)
    promo_total = 0
    end_total = 0
    for user in users:
        email = user.get("email")
        if not email:
            continue
        owner_id = str(user["_id"])
        for account_type in ("personal", "shared"):
            promo_total += await send_promo_reminders(
                db,
                owner_id=owner_id,
                account_type=account_type,
                user_email=email,
                as_of=as_of,
            )
            end_total += await send_end_reminders(
                db,
                owner_id=owner_id,
                account_type=account_type,
                user_email=email,
                as_of=as_of,
            )
    return {
        "promo_reminders_sent": promo_total,
        "end_reminders_sent": end_total,
    }
