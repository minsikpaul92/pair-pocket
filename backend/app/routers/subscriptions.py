"""Subscription CRUD and pending occurrence queries."""

from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.security import get_current_user
from app.database import get_database
from app.models.subscription import (
    OccurrenceStatus,
    SubscriptionCreate,
    SubscriptionOccurrenceOut,
    SubscriptionOut,
    SubscriptionStatus,
    SubscriptionUpdate,
)
from app.models.transaction import AccountType
from app.models.user import UserOut
from app.services.subscriptions import (
    generate_occurrences,
    list_pending_occurrences,
    materialize_due_occurrences,
)

router = APIRouter(prefix="/api/subscriptions", tags=["subscriptions"])

COLLECTION = "subscriptions"
OCC_COL = "subscription_occurrences"


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
        "total_installments": doc.get("total_installments"),
        "account_id": doc["account_id"],
        "category": doc["category"],
        "sub_category": doc["sub_category"],
        "merchant": doc.get("merchant", "미지정"),
        "status": doc.get("status", SubscriptionStatus.ACTIVE.value),
        "next_due_date": doc.get("next_due_date"),
        "completed_installments": doc.get("completed_installments", 0),
        "created_at": doc["created_at"],
        "updated_at": doc["updated_at"],
    }


@router.get("", response_model=list[SubscriptionOut])
async def list_subscriptions(
    account_type: AccountType = AccountType.PERSONAL,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[dict]:
    docs = (
        await db[COLLECTION]
        .find({"owner_id": current_user.id, "account_type": account_type.value})
        .sort("name", 1)
        .to_list(length=100)
    )
    return [_serialize_sub(d) for d in docs]


@router.post("", response_model=SubscriptionOut, status_code=status.HTTP_201_CREATED)
async def create_subscription(
    payload: SubscriptionCreate,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    now = datetime.utcnow()
    doc = payload.model_dump()
    doc["owner_id"] = current_user.id
    doc["status"] = SubscriptionStatus.ACTIVE.value
    doc["next_due_date"] = payload.start_date
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

    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    if updates:
        updates["updated_at"] = datetime.utcnow()
        await db[COLLECTION].update_one(
            {"_id": ObjectId(subscription_id)}, {"$set": updates}
        )

    updated = await db[COLLECTION].find_one({"_id": ObjectId(subscription_id)})
    return _serialize_sub(updated)


@router.get("/pending", response_model=list[SubscriptionOccurrenceOut])
async def pending_occurrences(
    account_type: AccountType = AccountType.PERSONAL,
    month: str | None = Query(default=None, description="YYYY-MM"),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[dict]:
    """예정 결제 — shown in UI but excluded from stats until materialized."""
    docs = await list_pending_occurrences(
        db,
        owner_id=current_user.id,
        account_type=account_type.value,
        month=month,
    )
    out: list[dict] = []
    for d in docs:
        sub = await db[COLLECTION].find_one({"_id": d["subscription_id"]})
        out.append(
            {
                "id": str(d["_id"]),
                "subscription_id": d["subscription_id"],
                "due_date": d["due_date"],
                "amount": d["amount"],
                "currency": d["currency"],
                "status": OccurrenceStatus(d["status"]),
                "transaction_id": d.get("transaction_id"),
                "subscription_name": sub["name"] if sub else None,
            }
        )
    return out


@router.post("/sync", status_code=status.HTTP_200_OK)
async def sync_due_subscriptions(
    account_type: AccountType = AccountType.PERSONAL,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    """Materialize due PENDING occurrences into Transactions (lazy scheduler)."""
    count = await materialize_due_occurrences(
        db,
        owner_id=current_user.id,
        account_type=account_type.value,
    )
    return {"materialized": count}
