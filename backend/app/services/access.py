"""Ledger access helpers for personal vs shared (group) scoping."""

from bson import ObjectId
from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.transaction import AccountType
from app.models.user import UserOut

USERS_COL = "users"


async def resolve_owner_ids(
    db: AsyncIOMotorDatabase,
    user: UserOut,
    account_type: AccountType,
) -> list[str]:
    """Return owner_id values that the current user may see for this ledger.

    - personal: only the current user
    - shared: all members of the user's shared_group_id (empty if not linked)
    """
    if account_type == AccountType.PERSONAL:
        return [user.id]

    if not user.shared_group_id:
        return []

    cursor = db[USERS_COL].find(
        {"shared_group_id": user.shared_group_id},
        {"_id": 1},
    )
    docs = await cursor.to_list(length=10)
    return [str(doc["_id"]) for doc in docs]


def owner_match(owner_ids: list[str]) -> dict:
    """Mongo filter fragment for owner_id given a resolved id list."""
    if not owner_ids:
        return {"owner_id": {"$in": []}}
    if len(owner_ids) == 1:
        return {"owner_id": owner_ids[0]}
    return {"owner_id": {"$in": owner_ids}}


def require_shared_group_for_write(user: UserOut, account_type: AccountType) -> None:
    """Block creating shared ledger data before a partner link exists."""
    if account_type == AccountType.SHARED and not user.shared_group_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="공유 가계부를 쓰려면 먼저 파트너를 초대해야 합니다.",
        )


def _as_object_id(value: str) -> ObjectId | None:
    if ObjectId.is_valid(value):
        return ObjectId(value)
    return None


async def user_can_access_owner(
    db: AsyncIOMotorDatabase,
    user: UserOut,
    *,
    doc_owner_id: str,
    account_type: str,
) -> bool:
    """Whether the current user may read/mutate a document with this ownership."""
    if account_type == AccountType.PERSONAL.value:
        return doc_owner_id == user.id

    if account_type != AccountType.SHARED.value:
        return False
    if not user.shared_group_id:
        return False
    if doc_owner_id == user.id:
        return True

    oid = _as_object_id(doc_owner_id)
    if not oid:
        return False
    owner = await db[USERS_COL].find_one(
        {"_id": oid},
        {"shared_group_id": 1},
    )
    if not owner:
        return False
    return owner.get("shared_group_id") == user.shared_group_id


async def assert_can_access_doc(
    db: AsyncIOMotorDatabase,
    user: UserOut,
    doc: dict | None,
    *,
    not_found_detail: str = "Not found.",
) -> dict:
    """Raise 404 if missing or not accessible; return the document otherwise."""
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail)

    ok = await user_can_access_owner(
        db,
        user,
        doc_owner_id=doc["owner_id"],
        account_type=doc.get("account_type", AccountType.PERSONAL.value),
    )
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail)
    return doc
