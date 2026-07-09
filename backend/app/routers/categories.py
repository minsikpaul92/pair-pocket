from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from app.core.security import get_current_user
from app.database import get_database
from app.models.category_preset import CategoryPresetsOut, build_presets_response
from app.models.transaction import TransactionType
from app.models.user import UserOut
from app.models.user_settings import CustomCategoryMap
from app.routers.settings import _get_or_create
from app.services.category_merge import get_merged_sub_categories, merge_custom_categories

router = APIRouter(prefix="/api/categories", tags=["categories"])


class AddCategoryBody(BaseModel):
    type: TransactionType
    category: str


class AddSubCategoryBody(BaseModel):
    type: TransactionType
    category: str
    sub_category: str


def _parse_custom(doc: dict) -> CustomCategoryMap:
    raw = doc.get("custom_categories", {})
    if isinstance(raw, dict):
        return CustomCategoryMap(
            expense=raw.get("expense", {}),
            income=raw.get("income", {}),
        )
    return CustomCategoryMap()


def _type_key(tx_type: TransactionType) -> str:
    return "expense" if tx_type == TransactionType.EXPENSE else "income"


@router.get("/presets", response_model=CategoryPresetsOut)
async def list_presets() -> CategoryPresetsOut:
    """Return the built-in seed presets only (no user custom entries)."""
    return build_presets_response()


@router.get("", response_model=CategoryPresetsOut)
async def list_merged_categories(
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> CategoryPresetsOut:
    """Return presets merged with the current user's custom categories."""
    doc = await _get_or_create(db, current_user.id)
    return merge_custom_categories(_parse_custom(doc))


@router.get("/sub-categories", response_model=list[str])
async def list_sub_categories(
    type: TransactionType = Query(..., description="income or expense"),
    category: str = Query(..., description="Level-1 category name"),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[str]:
    doc = await _get_or_create(db, current_user.id)
    custom = _parse_custom(doc)
    subs = get_merged_sub_categories(custom, type, category)
    if subs is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown category '{category}' for type '{type.value}'.",
        )
    return subs


@router.post("/category", response_model=CategoryPresetsOut)
async def add_custom_category(
    payload: AddCategoryBody,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> CategoryPresetsOut:
    name = payload.category.strip()
    if not name:
        raise HTTPException(status_code=400, detail="대분류 이름이 비어 있습니다.")

    await _get_or_create(db, current_user.id)
    type_key = _type_key(payload.type)
    await db["user_settings"].update_one(
        {"owner_id": current_user.id},
        {"$set": {f"custom_categories.{type_key}.{name}": []}},
    )
    doc = await db["user_settings"].find_one({"owner_id": current_user.id})
    return merge_custom_categories(_parse_custom(doc))


@router.post("/sub-category", response_model=CategoryPresetsOut)
async def add_custom_sub_category(
    payload: AddSubCategoryBody,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> CategoryPresetsOut:
    category = payload.category.strip()
    sub = payload.sub_category.strip()
    if not category or not sub:
        raise HTTPException(status_code=400, detail="대분류와 중분류 이름이 필요합니다.")

    doc = await _get_or_create(db, current_user.id)
    custom = _parse_custom(doc)
    subs = get_merged_sub_categories(custom, payload.type, category)
    if subs is None:
        raise HTTPException(
            status_code=404,
            detail=f"대분류 '{category}'를 찾을 수 없습니다.",
        )
    if sub in subs:
        return merge_custom_categories(custom)

    type_key = _type_key(payload.type)
    await db["user_settings"].update_one(
        {"owner_id": current_user.id},
        {"$addToSet": {f"custom_categories.{type_key}.{category}": sub}},
    )
    doc = await db["user_settings"].find_one({"owner_id": current_user.id})
    return merge_custom_categories(_parse_custom(doc))
