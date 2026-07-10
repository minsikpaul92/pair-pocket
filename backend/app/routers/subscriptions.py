"""Subscription CRUD and pending occurrence queries."""

from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.security import get_current_user
from app.database import get_database
from app.models.subscription import (
    BillingCycle,
    MonthlySubscriptionSummaryOut,
    OccurrenceStatus,
    SubscriptionCreate,
    SubscriptionHistoryOut,
    SubscriptionOccurrenceOut,
    SubscriptionOut,
    SubscriptionStatus,
    SubscriptionUpdate,
)
from app.models.transaction import AccountType, Currency
from app.models.user import UserOut
from app.services.subscriptions import (
    amount_for_due_date,
    generate_occurrences,
    get_subscription_history,
    installment_end_date,
    list_pending_occurrences,
    materialize_due_occurrences,
    monthly_subscription_summary,
    purge_subscription_on_reschedule,
    run_all_reminder_jobs,
    schedule_subscription_cancel,
    send_end_reminders,
    send_promo_reminders,
    skip_occurrence,
    subscription_visible_in_month,
    subscription_visible_now,
    _calendar_day,
    _months_between,
)

router = APIRouter(prefix="/api/subscriptions", tags=["subscriptions"])

COLLECTION = "subscriptions"
OCC_COL = "subscription_occurrences"
ACCOUNTS_COL = "accounts"


def _serialize_sub(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "owner_id": doc["owner_id"],
        "name": doc["name"],
        "amount": doc["amount"],
        "currency": doc["currency"],
        "account_type": doc["account_type"],
        "cycle": doc["cycle"],
        "start_date": doc["start_date"],
        "end_date": doc.get("end_date"),
        "installment_start_date": doc.get("installment_start_date"),
        "total_installments": doc.get("total_installments"),
        "promo_amount": doc.get("promo_amount"),
        "promo_end_date": doc.get("promo_end_date"),
        "promo_reminder_enabled": doc.get("promo_reminder_enabled", False),
        "end_reminder_enabled": doc.get("end_reminder_enabled", False),
        "account_id": doc["account_id"],
        "category": doc["category"],
        "sub_category": doc["sub_category"],
        "merchant": doc.get("merchant", "미지정"),
        "status": doc.get("status", SubscriptionStatus.ACTIVE.value),
        "next_due_date": doc.get("next_due_date"),
        "completed_installments": doc.get("completed_installments", 0),
        "cancel_effective_date": doc.get("cancel_effective_date"),
        "created_at": doc["created_at"],
        "updated_at": doc["updated_at"],
    }


async def _validate_account(
    db: AsyncIOMotorDatabase,
    *,
    account_id: str,
    owner_id: str,
    currency: str,
    account_type: str,
) -> None:
    if not ObjectId.is_valid(account_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="유효하지 않은 결제 계좌입니다.",
        )
    account = await db[ACCOUNTS_COL].find_one(
        {
            "_id": ObjectId(account_id),
            "owner_id": owner_id,
            "is_active": True,
        }
    )
    if not account:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="선택한 결제 계좌를 찾을 수 없습니다.",
        )
    if account.get("currency") != currency:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="계좌 통화와 구독 통화가 일치하지 않습니다.",
        )
    if account.get("account_type") != account_type:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="계좌의 공용/개인 구분이 구독과 일치하지 않습니다.",
        )


@router.get("", response_model=list[SubscriptionOut])
async def list_subscriptions(
    account_type: AccountType = AccountType.PERSONAL,
    currency: Currency | None = None,
    month: str | None = Query(default=None, description="YYYY-MM"),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[dict]:
    query: dict = {
        "owner_id": current_user.id,
        "account_type": account_type.value,
    }
    if currency is not None:
        query["currency"] = currency.value
    docs = (
        await db[COLLECTION]
        .find(query)
        .sort("name", 1)
        .to_list(length=100)
    )
    today = datetime.utcnow()
    filtered: list[dict] = []
    for doc in docs:
        if month:
            if subscription_visible_in_month(doc, month):
                filtered.append(doc)
        elif subscription_visible_now(doc, today):
            filtered.append(doc)
    return [_serialize_sub(d) for d in filtered]


@router.get("/summary", response_model=MonthlySubscriptionSummaryOut)
async def subscription_monthly_summary(
    account_type: AccountType = AccountType.PERSONAL,
    month: str = Query(..., description="YYYY-MM"),
    currency: Currency | None = None,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    return await monthly_subscription_summary(
        db,
        owner_id=current_user.id,
        account_type=account_type.value,
        month=month,
        currency=currency.value if currency else None,
    )


@router.get("/pending", response_model=list[SubscriptionOccurrenceOut])
async def pending_occurrences(
    account_type: AccountType = AccountType.PERSONAL,
    month: str | None = Query(default=None, description="YYYY-MM"),
    currency: Currency | None = None,
    as_of: str | None = Query(default=None, description="Client local YYYY-MM-DD"),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[dict]:
    docs = await list_pending_occurrences(
        db,
        owner_id=current_user.id,
        account_type=account_type.value,
        month=month,
        currency=currency.value if currency else None,
        as_of=as_of,
    )
    out: list[dict] = []
    for d in docs:
        sub_oid = d.get("subscription_id")
        sub = None
        if isinstance(sub_oid, ObjectId):
            sub = await db[COLLECTION].find_one({"_id": sub_oid})
        elif isinstance(sub_oid, str) and ObjectId.is_valid(sub_oid):
            sub = await db[COLLECTION].find_one({"_id": ObjectId(sub_oid)})
        out.append(
            {
                "id": str(d["_id"]),
                "subscription_id": str(d["subscription_id"]),
                "due_date": d["due_date"],
                "amount": d["amount"],
                "currency": d["currency"],
                "status": OccurrenceStatus(d["status"]),
                "transaction_id": d.get("transaction_id"),
                "subscription_name": sub["name"] if sub else None,
                "subscription_billing_cycle": (
                    BillingCycle(sub["cycle"]) if sub else None
                ),
            }
        )
    return out


@router.post("/occurrences/{occurrence_id}/skip", response_model=SubscriptionOccurrenceOut)
async def skip_pending_occurrence(
    occurrence_id: str,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    skipped = await skip_occurrence(
        db,
        occurrence_id=occurrence_id,
        owner_id=current_user.id,
    )
    if not skipped:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="예정 결제를 찾을 수 없거나 이미 처리되었습니다.",
        )

    sub_oid = skipped.get("subscription_id")
    sub = None
    if isinstance(sub_oid, ObjectId):
        sub = await db[COLLECTION].find_one({"_id": sub_oid})
    elif isinstance(sub_oid, str) and ObjectId.is_valid(sub_oid):
        sub = await db[COLLECTION].find_one({"_id": ObjectId(sub_oid)})

    return {
        "id": str(skipped["_id"]),
        "subscription_id": str(skipped["subscription_id"]),
        "due_date": skipped["due_date"],
        "amount": skipped["amount"],
        "currency": skipped["currency"],
        "status": OccurrenceStatus.SKIPPED,
        "transaction_id": skipped.get("transaction_id"),
        "subscription_name": sub["name"] if sub else None,
        "subscription_billing_cycle": (
            BillingCycle(sub["cycle"]) if sub else None
        ),
    }


@router.post("/sync", status_code=status.HTTP_200_OK)
async def sync_due_subscriptions(
    account_type: AccountType = AccountType.PERSONAL,
    as_of: str | None = Query(default=None, description="Client local YYYY-MM-DD"),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    count = await materialize_due_occurrences(
        db,
        owner_id=current_user.id,
        account_type=account_type.value,
        as_of=as_of,
    )
    reminders = await send_promo_reminders(
        db,
        owner_id=current_user.id,
        account_type=account_type.value,
        user_email=current_user.email,
        as_of=as_of,
    )
    end_reminders = await send_end_reminders(
        db,
        owner_id=current_user.id,
        account_type=account_type.value,
        user_email=current_user.email,
        as_of=as_of,
    )
    return {
        "materialized": count,
        "promo_reminders_sent": reminders,
        "end_reminders_sent": end_reminders,
    }


@router.get("/{subscription_id}/history", response_model=SubscriptionHistoryOut)
async def subscription_history(
    subscription_id: str,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    result = await get_subscription_history(
        db,
        subscription_id=subscription_id,
        owner_id=current_user.id,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Subscription not found.")
    return result


@router.post("", response_model=SubscriptionOut, status_code=status.HTTP_201_CREATED)
async def create_subscription(
    payload: SubscriptionCreate,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    if (
        payload.cycle == BillingCycle.INSTALLMENT
        and not payload.total_installments
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="할부는 총 회차(total_installments)가 필요합니다.",
        )
    if (
        payload.cycle != BillingCycle.INSTALLMENT
        and payload.total_installments is not None
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="total_installments는 할부(cycle=installment)에서만 사용할 수 있습니다.",
        )

    await _validate_account(
        db,
        account_id=payload.account_id,
        owner_id=current_user.id,
        currency=payload.currency.value,
        account_type=payload.account_type.value,
    )

    now = datetime.utcnow()
    doc = payload.model_dump(exclude={"completed_installments"})
    doc["currency"] = payload.currency.value
    doc["account_type"] = payload.account_type.value
    doc["cycle"] = payload.cycle.value
    doc["owner_id"] = current_user.id
    doc["status"] = SubscriptionStatus.ACTIVE.value
    doc["next_due_date"] = payload.start_date
    doc["promo_reminder_sent_at"] = None
    doc["end_reminder_sent_at"] = None
    if not doc.get("merchant"):
        doc["merchant"] = payload.name

    if payload.cycle == BillingCycle.INSTALLMENT and payload.total_installments:
        inst_start = payload.installment_start_date or payload.start_date
        doc["installment_start_date"] = inst_start
        if not doc.get("end_date"):
            doc["end_date"] = installment_end_date(
                inst_start, total_installments=payload.total_installments
            )
        if payload.completed_installments is not None:
            doc["completed_installments"] = payload.completed_installments
        elif inst_start < payload.start_date:
            doc["completed_installments"] = _months_between(
                inst_start, payload.start_date
            )
        else:
            doc["completed_installments"] = 0
    else:
        doc["completed_installments"] = 0

    doc["created_at"] = now
    doc["updated_at"] = now

    result = await db[COLLECTION].insert_one(doc)
    created = await db[COLLECTION].find_one({"_id": result.inserted_id})
    await generate_occurrences(db, subscription=created)
    return _serialize_sub(created)


@router.patch("/{subscription_id}", response_model=SubscriptionOut)
async def update_subscription(
    subscription_id: str,
    payload: SubscriptionUpdate,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    if not ObjectId.is_valid(subscription_id):
        raise HTTPException(status_code=404, detail="Subscription not found.")

    existing = await db[COLLECTION].find_one(
        {"_id": ObjectId(subscription_id), "owner_id": current_user.id}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Subscription not found.")

    old_next_due = existing.get("next_due_date") or existing["start_date"]
    start_rescheduled = False

    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    if "status" in updates and updates["status"] is not None:
        updates["status"] = updates["status"].value
    if "cycle" in updates and updates["cycle"] is not None:
        updates["cycle"] = updates["cycle"].value
    if "start_date" in updates and updates["start_date"]:
        start_rescheduled = _calendar_day(old_next_due) != _calendar_day(
            updates["start_date"]
        )
        updates["next_due_date"] = updates["start_date"]
    if "promo_end_date" in updates or "promo_amount" in updates:
        updates["promo_reminder_sent_at"] = None
    if "end_date" in updates:
        updates["end_reminder_sent_at"] = None
    if updates.get("end_reminder_enabled"):
        updates["end_reminder_sent_at"] = None
    if updates.get("promo_reminder_enabled"):
        updates["promo_reminder_sent_at"] = None
    cycle = updates.get("cycle", existing.get("cycle"))
    if isinstance(cycle, BillingCycle):
        cycle = cycle.value
    total = updates.get("total_installments", existing.get("total_installments"))
    inst_start = updates.get(
        "installment_start_date", existing.get("installment_start_date")
    )
    if cycle == BillingCycle.INSTALLMENT.value and total and inst_start:
        updates["end_date"] = installment_end_date(
            inst_start, total_installments=total
        )
    if "account_id" in updates and updates["account_id"]:
        await _validate_account(
            db,
            account_id=updates["account_id"],
            owner_id=current_user.id,
            currency=existing["currency"],
            account_type=existing["account_type"],
        )
    if updates:
        updates["updated_at"] = datetime.utcnow()
        await db[COLLECTION].update_one(
            {"_id": ObjectId(subscription_id)}, {"$set": updates}
        )

    updated = await db[COLLECTION].find_one({"_id": ObjectId(subscription_id)})
    if start_rescheduled:
        await purge_subscription_on_reschedule(
            db,
            subscription_id=subscription_id,
            old_next_due=old_next_due,
        )
        occ_count = await db[OCC_COL].count_documents(
            {
                "subscription_id": subscription_id,
                "status": OccurrenceStatus.COMPLETED.value,
            }
        )
        if updated.get("completed_installments", 0) > occ_count:
            await db[COLLECTION].update_one(
                {"_id": ObjectId(subscription_id)},
                {
                    "$set": {
                        "completed_installments": occ_count,
                        "updated_at": datetime.utcnow(),
                    }
                },
            )
            updated = await db[COLLECTION].find_one(
                {"_id": ObjectId(subscription_id)}
            )

    if updated and updated.get("status") in (
        SubscriptionStatus.ACTIVE.value,
        SubscriptionStatus.CANCEL_SCHEDULED.value,
    ):
        await db[OCC_COL].delete_many(
            {
                "subscription_id": subscription_id,
                "status": OccurrenceStatus.PENDING.value,
            }
        )
        await generate_occurrences(db, subscription=updated)
        # Refresh pending amounts for promo pricing.
        pending = await db[OCC_COL].find(
            {
                "subscription_id": subscription_id,
                "status": OccurrenceStatus.PENDING.value,
            }
        ).to_list(length=100)
        for occ in pending:
            due = occ.get("due_date")
            if isinstance(due, datetime):
                await db[OCC_COL].update_one(
                    {"_id": occ["_id"]},
                    {
                        "$set": {
                            "amount": amount_for_due_date(updated, due),
                        }
                    },
                )
    return _serialize_sub(updated)


@router.post("/{subscription_id}/schedule-cancel", response_model=SubscriptionOut)
async def schedule_cancel_subscription(
    subscription_id: str,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    if not ObjectId.is_valid(subscription_id):
        raise HTTPException(status_code=404, detail="Subscription not found.")

    existing = await db[COLLECTION].find_one(
        {"_id": ObjectId(subscription_id), "owner_id": current_user.id}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Subscription not found.")

    if existing.get("status") == SubscriptionStatus.CANCEL_SCHEDULED.value:
        await db[COLLECTION].update_one(
            {"_id": existing["_id"]},
            {
                "$set": {
                    "status": SubscriptionStatus.ACTIVE.value,
                    "cancel_effective_date": None,
                    "end_date": None,
                    "updated_at": datetime.utcnow(),
                }
            },
        )
        updated = await db[COLLECTION].find_one({"_id": existing["_id"]})
        await db[OCC_COL].delete_many(
            {
                "subscription_id": subscription_id,
                "status": OccurrenceStatus.PENDING.value,
            }
        )
        await generate_occurrences(db, subscription=updated)
        return _serialize_sub(updated)

    updated = await schedule_subscription_cancel(db, subscription=existing)
    return _serialize_sub(updated)


@router.delete("/{subscription_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_subscription(
    subscription_id: str,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> None:
    if not ObjectId.is_valid(subscription_id):
        raise HTTPException(status_code=404, detail="Subscription not found.")

    existing = await db[COLLECTION].find_one(
        {"_id": ObjectId(subscription_id), "owner_id": current_user.id}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Subscription not found.")

    await db[OCC_COL].delete_many(
        {
            "subscription_id": subscription_id,
            "status": OccurrenceStatus.PENDING.value,
        }
    )
    await db[COLLECTION].delete_one({"_id": ObjectId(subscription_id)})
