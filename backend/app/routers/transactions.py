from fastapi import APIRouter, Depends, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.security import get_current_user
from app.database import get_database
from app.models.transaction import (
    AccountType,
    TransactionCreate,
    TransactionOut,
)
from app.models.user import UserOut

router = APIRouter(prefix="/api/transactions", tags=["transactions"])

COLLECTION = "transactions"


def _serialize(document: dict) -> dict:
    """Shape a raw MongoDB document into the TransactionOut schema."""
    return {
        "id": str(document["_id"]),
        "date": document["date"],
        "amount": document["amount"],
        "currency": document["currency"],
        "type": document["type"],
        "account_type": document["account_type"],
        "category": document["category"],
        "merchant": document["merchant"],
        "owner_id": document["owner_id"],
    }


@router.get("", response_model=list[TransactionOut])
async def list_transactions(
    account_type: AccountType = AccountType.PERSONAL,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[dict]:
    """Return the current user's transactions for the given ledger."""
    query = {"owner_id": current_user.id, "account_type": account_type.value}
    documents = await db[COLLECTION].find(query).sort("date", -1).to_list(length=200)
    return [_serialize(doc) for doc in documents]


@router.post("", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    payload: TransactionCreate,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    document = payload.model_dump()
    # Store enums as their plain string values; keep `date` as a BSON datetime.
    document["currency"] = payload.currency.value
    document["type"] = payload.type.value
    document["account_type"] = payload.account_type.value
    document["owner_id"] = current_user.id
    result = await db[COLLECTION].insert_one(document)
    created = await db[COLLECTION].find_one({"_id": result.inserted_id})
    return _serialize(created)
