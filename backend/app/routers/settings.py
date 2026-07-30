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
from app.data.korea_subscriptions import (
    KOREA_SUBSCRIPTION_MORE,
    KOREA_SUBSCRIPTION_TOP7,
)
from app.database import get_database
from app.models.transaction import AccountType
from app.models.user import UserOut
from app.models.user_settings import (
    AddInstitutionBody,
    CustomCategoryMap,
    LedgerStartDateBody,
    OnboardingBasicsBody,
    OnboardingCompleteBody,
    OnboardingStepBody,
    SetCategoryColorBody,
    ShareGeminiKeyBody,
    UserSettingsOut,
)
from app.services.access import get_partner_owner_id, resolve_owner_ids
from app.services.ai import get_user_gemini_api_key, has_effective_gemini_key
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


def _valid_ledger_start(value: str) -> bool:
    return len(value) == 10 and value[4] == "-" and value[7] == "-"


async def _settings_out(db: AsyncIOMotorDatabase, doc: dict) -> dict:
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
    owner_id = doc["owner_id"]
    partner_id = await get_partner_owner_id(db, owner_id)
    partner_has_gemini_key = False
    if partner_id:
        partner_has_gemini_key = bool(await get_user_gemini_api_key(db, partner_id))

    onboarded = bool(
        # Legacy docs without the field are treated as already onboarded.
        doc["onboarding_personal_completed"]
        if "onboarding_personal_completed" in doc
        else True
    )
    effective = await has_effective_gemini_key(db, owner_id)
    # Partner has no key but I do → they borrow mine.
    partner_using_my_key = bool(
        partner_id and has_gemini_key and not partner_has_gemini_key
    )
    # I have no key but partner does → I borrow theirs.
    using_partner_key = bool(
        partner_id and (not has_gemini_key) and partner_has_gemini_key
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
        "has_effective_gemini_key": effective,
        "partner_has_gemini_key": partner_has_gemini_key,
        "partner_using_my_key": partner_using_my_key,
        "using_partner_key": using_partner_key,
        "share_gemini_api_key": bool(doc.get("share_gemini_api_key")),
        "preferred_locale": preferred_locale,
        "preferred_locales": preferred_locales,
        "ledger_start_date": doc.get("ledger_start_date"),
        "shared_ledger_start_date": doc.get("shared_ledger_start_date"),
        "ledger_start_date_locked": False,
        "onboarding_personal_completed": onboarded,
        "onboarding_personal_step": int(doc.get("onboarding_personal_step") or 0),
    }


@router.get("", response_model=UserSettingsOut)
async def get_settings(
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    doc = await _get_or_create(db, current_user.id)
    return await _settings_out(db, doc)


@router.get("/locales")
async def list_locales() -> dict:
    return {"locales": LOCALE_OPTIONS}


@router.get("/canada-subscriptions")
async def list_canada_subscriptions() -> dict:
    return {"top7": CANADA_SUBSCRIPTION_TOP7, "more": CANADA_SUBSCRIPTION_MORE}


@router.get("/korea-subscriptions")
async def list_korea_subscriptions() -> dict:
    return {"top7": KOREA_SUBSCRIPTION_TOP7, "more": KOREA_SUBSCRIPTION_MORE}


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
    return await _settings_out(db, doc)


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
    return await _settings_out(db, doc)


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
    return await _settings_out(db, doc)


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
    return await _settings_out(db, doc)


@router.post("/ai/share", response_model=UserSettingsOut)
async def set_share_gemini_key(
    payload: ShareGeminiKeyBody,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    """Opt in to partner-key fallback after own free-tier primary quota is used."""
    await _get_or_create(db, current_user.id)
    await db[COLLECTION].update_one(
        {"owner_id": current_user.id},
        {"$set": {"share_gemini_api_key": bool(payload.share)}},
    )
    doc = await db[COLLECTION].find_one({"owner_id": current_user.id})
    return await _settings_out(db, doc)


@router.put("/ledger-start-date", response_model=UserSettingsOut)
async def update_ledger_start_date(
    payload: LedgerStartDateBody,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    start = payload.ledger_start_date.strip()
    if not _valid_ledger_start(start):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ledger_start_date must be YYYY-MM-DD",
        )
    kind = (payload.kind or "personal").strip().lower()
    if kind not in ("personal", "shared"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="kind must be personal or shared",
        )

    await _get_or_create(db, current_user.id)

    if kind == "personal":
        await db[COLLECTION].update_one(
            {"owner_id": current_user.id},
            {"$set": {"ledger_start_date": start}},
        )
        synced = [current_user.id]
    else:
        if not current_user.shared_group_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="공유 시작일을 설정하려면 파트너 연결이 필요합니다.",
            )
        owner_ids = [current_user.id]
        partner_id = await get_partner_owner_id(db, current_user.id)
        if partner_id:
            owner_ids.append(partner_id)
            await _get_or_create(db, partner_id)
        await db[COLLECTION].update_many(
            {"owner_id": {"$in": owner_ids}},
            {"$set": {"shared_ledger_start_date": start}},
        )
        synced = owner_ids

    await write_audit_log(
        db,
        owner_id=current_user.id,
        action="update",
        entity=f"ledger_start_date:{kind}",
        detail={"ledger_start_date": start, "synced_owners": synced},
    )
    doc = await db[COLLECTION].find_one({"owner_id": current_user.id})
    return await _settings_out(db, doc)


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
    if not _valid_ledger_start(start):
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
    return await _settings_out(db, doc)


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
    return await _settings_out(db, doc)


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
    return await _settings_out(db, doc)


RESET_SCOPES = ("all", "ledger", "subscriptions", "stocks")
RESET_LEDGER_TYPES = ("all", "personal", "shared")


@router.post("/reset", status_code=status.HTTP_200_OK)
async def reset_user_data(
    scope: str = Query(
        "all",
        description="all | ledger | subscriptions | stocks",
    ),
    account_type: str = Query(
        "all",
        description="all | personal | shared — which ledger ownership to clear",
    ),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    if scope not in RESET_SCOPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"scope must be one of: {', '.join(RESET_SCOPES)}",
        )
    if account_type not in RESET_LEDGER_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"account_type must be one of: {', '.join(RESET_LEDGER_TYPES)}",
        )
    if account_type == "shared" and not current_user.shared_group_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="공유 데이터를 초기화하려면 파트너 연결이 필요합니다.",
        )

    owner_id = current_user.id
    deleted: dict[str, int] = {}

    async def _owner_filter_for(ledger: AccountType) -> dict:
        ids = await resolve_owner_ids(db, current_user, ledger)
        if ledger == AccountType.PERSONAL:
            return {"owner_id": owner_id, "account_type": AccountType.PERSONAL.value}
        return {
            "owner_id": {"$in": ids},
            "account_type": AccountType.SHARED.value,
        }

    async def _match_filters() -> list[dict]:
        if account_type == "personal":
            return [await _owner_filter_for(AccountType.PERSONAL)]
        if account_type == "shared":
            return [await _owner_filter_for(AccountType.SHARED)]
        # all: full wipe of everything I own (personal + shared I created).
        if scope == "all":
            return [{"owner_id": owner_id}]
        filters = [await _owner_filter_for(AccountType.PERSONAL)]
        if current_user.shared_group_id:
            filters.append(await _owner_filter_for(AccountType.SHARED))
        return filters

    filters = await _match_filters()

    async def _delete_many(collection: str, extra: dict | None = None) -> int:
        total = 0
        for base in filters:
            query = {**base, **(extra or {})}
            result = await db[collection].delete_many(query)
            total += result.deleted_count
        return total

    if scope in ("all", "ledger"):
        deleted["transactions"] = await _delete_many("transactions")

    if scope in ("all", "stocks"):
        deleted["holdings"] = await _delete_many("holdings")
        deleted["stock_transactions"] = await _delete_many(
            "transactions", {"is_stock_trade": True}
        )

    if scope in ("all", "subscriptions"):
        deleted["subscriptions"] = await _delete_many("subscriptions")
        deleted["subscription_occurrences"] = await _delete_many(
            "subscription_occurrences"
        )

    # Full reset + onboarding reopen only when wiping everything for this user.
    if scope == "all" and account_type == "all":
        accounts = await db.accounts.delete_many({"owner_id": owner_id})
        deleted["accounts"] = accounts.deleted_count
        await db[COLLECTION].update_one(
            {"owner_id": owner_id},
            {
                "$set": {
                    "onboarding_personal_completed": False,
                    "onboarding_personal_step": 0,
                    "preferred_locale": None,
                    "preferred_locales": [],
                    "ledger_start_date": None,
                    "shared_ledger_start_date": None,
                }
            },
            upsert=True,
        )
    elif scope == "all" and account_type in ("personal", "shared"):
        deleted["accounts"] = await _delete_many("accounts")

    await write_audit_log(
        db,
        owner_id=owner_id,
        action=f"reset:{scope}:{account_type}",
        entity="user_data",
        detail={"deleted": deleted, "account_type": account_type},
    )
    details = {
        "all": "모든 데이터가 성공적으로 초기화되었습니다.",
        "ledger": "가계부 거래 내역이 초기화되었습니다.",
        "subscriptions": "구독·할부 데이터가 초기화되었습니다.",
        "stocks": "주식 보유 데이터가 초기화되었습니다.",
    }
    return {
        "status": "success",
        "scope": scope,
        "account_type": account_type,
        "deleted": deleted,
        "detail": details[scope],
    }
