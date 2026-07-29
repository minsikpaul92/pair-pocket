from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from app.core.crypto import encrypt_secret, is_encrypted
from app.core.locales import LOCALE_OPTIONS, SUPPORTED_LOCALE_CODES
from app.core.security import get_current_user
from app.data.canada_subscriptions import (
    CANADA_SUBSCRIPTION_MORE,
    CANADA_SUBSCRIPTION_TOP7,
)
from app.database import get_database
from app.models.user import UserOut
from app.models.user_settings import (
    AddInstitutionBody,
    CustomCategoryMap,
    OnboardingBasicsBody,
    OnboardingCompleteBody,
    OnboardingStepBody,
    SetCategoryColorBody,
    UserSettingsOut,
)
from app.services.audit import write_audit_log

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
            "preferred_locale": None,
            "preferred_locales": [],
            "ledger_start_date": None,
            "onboarding_personal_completed": False,
            "onboarding_personal_step": 0,
        }
        await db[COLLECTION].insert_one(doc)
    return doc


def _normalize_locales(raw: object, fallback: str | None = None) -> list[str]:
    locales: list[str] = []
    if isinstance(raw, list):
        for item in raw:
            code = str(item).strip()
            if code and code not in locales:
                locales.append(code)
    if not locales and fallback:
        locales = [fallback]
    return locales[:2]


def _settings_out(doc: dict) -> dict:
    colors = doc.get("category_colors") or {}
    if not isinstance(colors, dict):
        colors = {}
    api_key = doc.get("gemini_api_key")
    # Ciphertext or legacy plaintext both count as "configured".
    has_gemini_key = bool(api_key and str(api_key).strip())
    preferred_locales = _normalize_locales(
        doc.get("preferred_locales"), doc.get("preferred_locale")
    )
    preferred_locale = preferred_locales[0] if preferred_locales else doc.get(
        "preferred_locale"
    )
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
        "preferred_locale": preferred_locale,
        "preferred_locales": preferred_locales,
        "ledger_start_date": doc.get("ledger_start_date"),
        "onboarding_personal_completed": bool(
            # Legacy docs without the field are treated as already onboarded.
            doc["onboarding_personal_completed"]
            if "onboarding_personal_completed" in doc
            else True
        ),
        "onboarding_personal_step": int(doc.get("onboarding_personal_step") or 0),
    }


@router.get("", response_model=UserSettingsOut)
async def get_settings(
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    doc = await _get_or_create(db, current_user.id)
    return _settings_out(doc)


@router.get("/locales")
async def list_locales() -> dict:
    return {"locales": LOCALE_OPTIONS}


@router.get("/canada-subscriptions")
async def list_canada_subscriptions() -> dict:
    return {"top7": CANADA_SUBSCRIPTION_TOP7, "more": CANADA_SUBSCRIPTION_MORE}


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


@router.delete("/institutions", response_model=UserSettingsOut)
async def remove_institution(
    name: str = Query(..., min_length=1),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    trimmed = name.strip()
    if not trimmed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="금융기관 이름이 비어 있습니다.",
        )

    await _get_or_create(db, current_user.id)
    await db[COLLECTION].update_one(
        {"owner_id": current_user.id},
        {"$pull": {"institutions": trimmed}},
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
    if not key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="API 키가 비어 있습니다.",
        )

    await _get_or_create(db, current_user.id)
    try:
        stored = key if is_encrypted(key) else encrypt_secret(key)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc

    await db[COLLECTION].update_one(
        {"owner_id": current_user.id},
        {"$set": {"gemini_api_key": stored}},
    )
    doc = await db[COLLECTION].find_one({"owner_id": current_user.id})
    return _settings_out(doc)


@router.post("/onboarding/basics", response_model=UserSettingsOut)
async def save_onboarding_basics(
    payload: OnboardingBasicsBody,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    locales = _normalize_locales(payload.preferred_locales, payload.preferred_locale)
    if not locales:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Select at least one language",
        )
    if len(locales) > 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Select at most two languages",
        )
    for locale in locales:
        if locale not in SUPPORTED_LOCALE_CODES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported locale: {locale}",
            )
    start = payload.ledger_start_date.strip()
    if len(start) != 10 or start[4] != "-" or start[7] != "-":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ledger_start_date must be YYYY-MM-DD",
        )

    await _get_or_create(db, current_user.id)
    updates: dict = {
        "preferred_locale": locales[0],
        "preferred_locales": locales,
        "ledger_start_date": start,
        "onboarding_personal_step": 1,
    }

    if payload.api_key and payload.api_key.strip():
        key = payload.api_key.strip()
        try:
            stored = key if is_encrypted(key) else encrypt_secret(key)
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(exc),
            ) from exc
        updates["gemini_api_key"] = stored

    await db[COLLECTION].update_one(
        {"owner_id": current_user.id},
        {"$set": updates},
    )
    await write_audit_log(
        db,
        owner_id=current_user.id,
        action="update",
        entity="onboarding_basics",
        detail={"preferred_locales": locales, "ledger_start_date": start},
    )
    doc = await db[COLLECTION].find_one({"owner_id": current_user.id})
    return _settings_out(doc)


@router.post("/onboarding/step", response_model=UserSettingsOut)
async def save_onboarding_step(
    payload: OnboardingStepBody,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    await _get_or_create(db, current_user.id)
    await db[COLLECTION].update_one(
        {"owner_id": current_user.id},
        {"$set": {"onboarding_personal_step": payload.step}},
    )
    doc = await db[COLLECTION].find_one({"owner_id": current_user.id})
    return _settings_out(doc)


@router.post("/onboarding/complete", response_model=UserSettingsOut)
async def complete_onboarding(
    payload: OnboardingCompleteBody,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    await _get_or_create(db, current_user.id)
    await db[COLLECTION].update_one(
        {"owner_id": current_user.id},
        {
            "$set": {
                "onboarding_personal_completed": payload.completed,
                "onboarding_personal_step": 3 if payload.completed else 0,
            }
        },
    )
    await write_audit_log(
        db,
        owner_id=current_user.id,
        action="complete" if payload.completed else "reopen",
        entity="onboarding_personal",
    )
    doc = await db[COLLECTION].find_one({"owner_id": current_user.id})
    return _settings_out(doc)


RESET_SCOPES = ("all", "ledger", "subscriptions", "stocks")


@router.post("/reset", status_code=status.HTTP_200_OK)
async def reset_user_data(
    scope: str = Query(
        "all",
        description="all | ledger | subscriptions | stocks",
    ),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    if scope not in RESET_SCOPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"scope must be one of: {', '.join(RESET_SCOPES)}",
        )

    owner_id = current_user.id
    deleted: dict[str, int] = {}

    if scope in ("all", "ledger"):
        result = await db.transactions.delete_many({"owner_id": owner_id})
        deleted["transactions"] = result.deleted_count

    if scope in ("all", "stocks"):
        holdings = await db.holdings.delete_many({"owner_id": owner_id})
        deleted["holdings"] = holdings.deleted_count
        # Keep ledger consistent: remove stock buy/sell txs with holdings.
        stock_txs = await db.transactions.delete_many(
            {"owner_id": owner_id, "is_stock_trade": True}
        )
        deleted["stock_transactions"] = stock_txs.deleted_count

    if scope in ("all", "subscriptions"):
        subs = await db.subscriptions.delete_many({"owner_id": owner_id})
        occs = await db.subscription_occurrences.delete_many(
            {"owner_id": owner_id}
        )
        deleted["subscriptions"] = subs.deleted_count
        deleted["subscription_occurrences"] = occs.deleted_count

    if scope == "all":
        accounts = await db.accounts.delete_many({"owner_id": owner_id})
        deleted["accounts"] = accounts.deleted_count
        # Re-open personal onboarding for clean re-test while keeping AI key.
        await db[COLLECTION].update_one(
            {"owner_id": owner_id},
            {
                "$set": {
                    "onboarding_personal_completed": False,
                    "onboarding_personal_step": 0,
                    "preferred_locale": None,
                    "preferred_locales": [],
                    "ledger_start_date": None,
                }
            },
            upsert=True,
        )

    await write_audit_log(
        db,
        owner_id=owner_id,
        action=f"reset:{scope}",
        entity="user_data",
        detail={"deleted": deleted},
    )
    details = {
        "all": "모든 테스트 데이터가 성공적으로 초기화되었습니다.",
        "ledger": "가계부 거래 내역이 초기화되었습니다.",
        "subscriptions": "구독·할부 데이터가 초기화되었습니다.",
        "stocks": "주식 보유 데이터가 초기화되었습니다.",
    }
    return {
        "status": "success",
        "scope": scope,
        "deleted": deleted,
        "detail": details[scope],
    }
