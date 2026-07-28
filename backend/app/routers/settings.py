from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from app.core.security import get_current_user
from app.database import get_database
from app.models.user import UserOut
from app.models.user_settings import (
    AddInstitutionBody,
    CustomCategoryMap,
    SetCategoryColorBody,
    UserSettingsOut,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SaveAiKeyBody(BaseModel):
    api_key: str

COLLECTION = "user_settings"


def _parse_custom(doc: dict) -> CustomCategoryMap:
    raw = doc.get("custom_categories", {})
    if isinstance(raw, dict):
        return CustomCategoryMap(
            expense=raw.get("expense", {}),
            income=raw.get("income", {}),
        )
    return CustomCategoryMap()


async def _get_or_create(db: AsyncIOMotorDatabase, owner_id: str) -> dict:
    doc = await db[COLLECTION].find_one({"owner_id": owner_id})
    if doc is None:
        doc = {
            "owner_id": owner_id,
            "merchants": [],
            "institutions": [],
            "custom_categories": {"expense": {}, "income": {}},
            "category_colors": {},
        }
        await db[COLLECTION].insert_one(doc)
    return doc


def _settings_out(doc: dict) -> dict:
    colors = doc.get("category_colors") or {}
    if not isinstance(colors, dict):
        colors = {}
    api_key = doc.get("gemini_api_key")
    has_gemini_key = bool(api_key and api_key.strip())
    return {
        "merchants": doc.get("merchants", []),
        "institutions": doc.get("institutions", []),
        "custom_categories": _parse_custom(doc).model_dump(),
        "category_colors": {
            str(k): str(v) for k, v in colors.items() if isinstance(v, str)
        },
        "default_expense_account_id": doc.get("default_expense_account_id"),
        "default_income_account_id": doc.get("default_income_account_id"),
        "has_gemini_key": has_gemini_key,
    }


@router.get("", response_model=UserSettingsOut)
async def get_settings(
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    doc = await _get_or_create(db, current_user.id)
    return _settings_out(doc)


@router.post("/institutions", response_model=UserSettingsOut)
async def add_institution(
    payload: AddInstitutionBody,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    name = payload.name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="금융기관 이름이 비어 있습니다.",
        )

    await _get_or_create(db, current_user.id)
    await db[COLLECTION].update_one(
        {"owner_id": current_user.id},
        {"$addToSet": {"institutions": name}},
    )
    doc = await db[COLLECTION].find_one({"owner_id": current_user.id})
    return _settings_out(doc)


@router.put("/category-colors", response_model=UserSettingsOut)
async def set_category_color(
    payload: SetCategoryColorBody,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    category = payload.category.strip()
    color = payload.color.strip()
    if not category:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="카테고리 이름이 비어 있습니다.",
        )
    if not color.startswith("#") or len(color) not in (4, 7):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="색상은 #RGB 또는 #RRGGBB 형식이어야 합니다.",
        )

    await _get_or_create(db, current_user.id)
    await db[COLLECTION].update_one(
        {"owner_id": current_user.id},
        {"$set": {f"category_colors.{category}": color}},
    )
    doc = await db[COLLECTION].find_one({"owner_id": current_user.id})
    return _settings_out(doc)


@router.post("/ai", response_model=UserSettingsOut)
async def save_ai_key(
    payload: SaveAiKeyBody,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    key = payload.api_key.strip()
    await _get_or_create(db, current_user.id)
    await db[COLLECTION].update_one(
        {"owner_id": current_user.id},
        {"$set": {"gemini_api_key": key}},
    )
    doc = await db[COLLECTION].find_one({"owner_id": current_user.id})
    return _settings_out(doc)


@router.post("/reset", status_code=status.HTTP_200_OK)
async def reset_user_data(
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    owner_id = current_user.id
    # Delete transactions, holdings, subscriptions, subscription_occurrences, accounts
    await db.transactions.delete_many({"owner_id": owner_id})
    await db.holdings.delete_many({"owner_id": owner_id})
    await db.subscriptions.delete_many({"owner_id": owner_id})
    await db.subscription_occurrences.delete_many({"owner_id": owner_id})
    await db.accounts.delete_many({"owner_id": owner_id})
    return {"status": "success", "detail": "모든 테스트 데이터가 성공적으로 초기화되었습니다."}
