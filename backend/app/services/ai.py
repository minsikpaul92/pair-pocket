import asyncio
import base64
import json
import logging
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any, AsyncIterator, Iterable, Sequence, TypeVar
from zoneinfo import ZoneInfo

import httpx
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.crypto import decrypt_secret, encrypt_secret, is_encrypted

logger = logging.getLogger(__name__)

PRIMARY_MODEL = "gemini-3.6-flash"
FALLBACK_MODELS = (
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
)
MODEL_CHAIN = (PRIMARY_MODEL, *FALLBACK_MODELS)

# Shared by Smart Import multi-file and onboarding screenshot batches.
IMAGE_BATCH_SIZE = 3
BATCH_DELAY_SECONDS = 1.0

# Short cooldown when Retry-After is missing but the error looks like a minute window.
DEFAULT_MINUTE_BACKOFF_SECONDS = 60

PACIFIC = ZoneInfo("America/Los_Angeles")

T = TypeVar("T")


async def get_user_gemini_api_key(db: AsyncIOMotorDatabase, owner_id: str) -> str | None:
    """Return the user's Gemini API key, decrypting at rest ciphertext when needed."""
    doc = await db["user_settings"].find_one({"owner_id": owner_id})
    if not doc:
        return None

    stored = doc.get("gemini_api_key")
    if not stored or not str(stored).strip():
        return None

    stored = str(stored).strip()
    try:
        plaintext = decrypt_secret(stored).strip()
    except ValueError:
        return None

    if not plaintext:
        return None

    # Lazy-migrate legacy plaintext keys to encrypted storage.
    if not is_encrypted(stored):
        try:
            await db["user_settings"].update_one(
                {"owner_id": owner_id},
                {"$set": {"gemini_api_key": encrypt_secret(plaintext)}},
            )
        except RuntimeError:
            # Missing encryption key in misconfigured env; still return plaintext.
            pass

    return plaintext


def iter_batches(items: Sequence[T], size: int = IMAGE_BATCH_SIZE) -> Iterable[list[T]]:
    """Yield consecutive batches of `size` (default 3) for import/onboarding uploads."""
    if size < 1:
        raise ValueError("batch size must be >= 1")
    for i in range(0, len(items), size):
        yield list(items[i : i + size])


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _next_midnight_pacific() -> datetime:
    now_pt = datetime.now(PACIFIC)
    tomorrow = (now_pt + timedelta(days=1)).date()
    return datetime(
        tomorrow.year, tomorrow.month, tomorrow.day, tzinfo=PACIFIC
    ).astimezone(timezone.utc)


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_retry_after(resp: httpx.Response) -> datetime | None:
    raw = resp.headers.get("retry-after")
    if not raw:
        return None
    raw = raw.strip()
    if raw.isdigit():
        return _utc_now() + timedelta(seconds=int(raw))
    try:
        return parsedate_to_datetime(raw).astimezone(timezone.utc)
    except (TypeError, ValueError, IndexError):
        return None


def _looks_like_daily_quota(message: str) -> bool:
    m = message.lower()
    needles = (
        "per day",
        "daily",
        "rpd",
        "quota exceeded",
        "generate_requests_per_model_per_day",
        "exceeded your current quota",
    )
    return any(n in m for n in needles)


def _looks_like_minute_quota(message: str) -> bool:
    m = message.lower()
    needles = (
        "per minute",
        "rpm",
        "rate limit",
        "resource_exhausted",
        "generate_requests_per_model_per_minute",
    )
    return any(n in m for n in needles)


def _is_quota_status(status_code: int, message: str) -> bool:
    if status_code == 429:
        return True
    m = message.lower()
    return "resource_exhausted" in m or "quota" in m


def compute_resume_at(resp: httpx.Response | None, error_message: str) -> datetime:
    """
    Prefer Retry-After. Otherwise infer daily vs minute window from the error text.
    Does not hard-code RPM/RPD integers.
    """
    if resp is not None:
        header_resume = _parse_retry_after(resp)
        if header_resume is not None:
            return header_resume

    if _looks_like_daily_quota(error_message) and not _looks_like_minute_quota(error_message):
        return _next_midnight_pacific()

    if _looks_like_minute_quota(error_message):
        return _utc_now() + timedelta(seconds=DEFAULT_MINUTE_BACKOFF_SECONDS)

    # Ambiguous 429: short backoff is safer than probing every request until PT midnight.
    return _utc_now() + timedelta(seconds=DEFAULT_MINUTE_BACKOFF_SECONDS)


async def _load_model_state(db: AsyncIOMotorDatabase, owner_id: str) -> dict[str, Any]:
    doc = await db["user_settings"].find_one(
        {"owner_id": owner_id}, {"gemini_model_state": 1}
    )
    state = (doc or {}).get("gemini_model_state") or {}
    return state if isinstance(state, dict) else {}


async def _save_model_state(
    db: AsyncIOMotorDatabase, owner_id: str, state: dict[str, Any] | None
) -> None:
    if state is None:
        await db["user_settings"].update_one(
            {"owner_id": owner_id},
            {"$unset": {"gemini_model_state": ""}},
            upsert=True,
        )
        return
    await db["user_settings"].update_one(
        {"owner_id": owner_id},
        {"$set": {"gemini_model_state": state}},
        upsert=True,
    )


def build_model_chain(state: dict[str, Any]) -> tuple[list[str], dict[str, Any] | None]:
    """
    Return ordered models to try, plus optional skip_info when primary is cooled down.
    Clears expired cooldown conceptually by returning the full chain (caller may clear DB).
    """
    now = _utc_now()
    resume_at = _parse_iso(state.get("resume_at"))
    cooldown_model = state.get("cooldown_model")

    if (
        resume_at
        and cooldown_model == PRIMARY_MODEL
        and now < resume_at
    ):
        skip_info = {
            "skipped_model": PRIMARY_MODEL,
            "fallback_model": FALLBACK_MODELS[0],
            "resume_at": resume_at.isoformat(),
            "reason": "free_tier_quota_cache",
        }
        return list(FALLBACK_MODELS), skip_info

    return list(MODEL_CHAIN), None


async def _mark_model_cooldown(
    db: AsyncIOMotorDatabase,
    owner_id: str,
    model: str,
    resume_at: datetime,
) -> dict[str, Any]:
    preferred = (
        FALLBACK_MODELS[0] if model == PRIMARY_MODEL else model
    )
    state = {
        "cooldown_model": model,
        "preferred_model": preferred,
        "resume_at": resume_at.astimezone(timezone.utc).isoformat(),
        "updated_at": _utc_now().isoformat(),
    }
    await _save_model_state(db, owner_id, state)
    return state


async def _clear_cooldown_if_primary_ok(
    db: AsyncIOMotorDatabase, owner_id: str, model: str, state: dict[str, Any]
) -> None:
    if model == PRIMARY_MODEL and state.get("cooldown_model") == PRIMARY_MODEL:
        await _save_model_state(db, owner_id, None)


def _extract_error_message(resp: httpx.Response) -> str:
    error_text = resp.text
    try:
        err_json = resp.json()
        if isinstance(err_json, dict) and "error" in err_json:
            error_text = err_json["error"].get("message", error_text)
    except Exception:
        pass
    return error_text


def _receipt_prompt() -> str:
    return (
        "You are an expert expense parser for PairPocket. Analyze the provided receipt image or financial statement PDF.\n"
        "Determine if the document is a single receipt or a statement containing multiple transactions.\n"
        "For dates, look for candidate patterns. Note that North American, European, and Asian formats vary (e.g. MM/DD/YY, DD/MM/YY, DD-MM-YYYY).\n"
        "Compare with current reference year 2026 and surrounding timestamps/contexts to resolve date ambiguities (like MM vs DD).\n"
        "Extract the transaction details and return them in JSON format matching the response schema.\n"
        "For currency, determine if it is Canadian Dollars (CAD), South Korean Won (KRW) or US Dollars (USD). Default to CAD if unsure.\n"
        "If the merchant/business name cannot be identified from the document, set the merchant field to a logical category-based fallback name like '외식' (for restaurants), '장보기' (for groceries), or '쇼핑' (for retail/shopping).\n"
        "For category and sub_category, map them STRICTLY to one of the following valid pairs:\n"
        "- Category: '식비' -> sub_category must be exactly one of: '식재료/장보기', '외식/배달', '카페/간식'\n"
        "- Category: '주거/통신' -> sub_category must be exactly one of: '월세/모기지', '관리비/공과금', '통신비', '가정 정비'\n"
        "- Category: '교통/차량' -> sub_category must be exactly one of: '대중교통', '택시/우버', '유류비/충전', '차량 유지'\n"
        "- Category: '생활/쇼핑' -> sub_category must be exactly one of: '생필품', '의류/잡화', '미용/뷰티', '반려동물'\n"
        "- Category: '건강/의료' -> sub_category must be exactly one of: '병원/약국', '운동/헬스', '영양제'\n"
        "- Category: '문화/취미' -> sub_category must be exactly one of: '문화 생활', '취미/엔터', '정기 구독', '여행/숙박'\n"
        "- Category: '경조사/선물' -> sub_category must be exactly one of: '경조사비', '선물/기념일', '모임/회비'\n"
        "- Category: '투자/저축' -> sub_category must be exactly one of: '주식 매수', 'FHSA 납입', 'TFSA 납입', '저축성 예금'\n"
        "- Category: '세금' -> sub_category must be exactly: '세금'\n"
        "- Category: '금융/기타' -> sub_category must be exactly: '기타'\n"
        "Do NOT use any other categories or sub_categories.\n"
        "If it is a single receipt, extract all individual items (sub-items/line items) from the receipt, "
        "including original item name, standardized Korean item name (e.g. 수박, 소고기, 우유, 화장지) for price tracking, "
        "quantity, unit (e.g. 개, lb, kg, bag) or null, unit_price, and total_price."
    )


def _receipt_response_schema() -> dict[str, Any]:
    return {
        "type": "OBJECT",
        "properties": {
            "is_statement": {
                "type": "BOOLEAN",
                "description": "True if the document is a statement containing multiple separate transactions, False if it is a single receipt.",
            },
            "transactions": {
                "type": "ARRAY",
                "description": "If is_statement is True, list all parsed transactions from the statement. If is_statement is False, this array should contain exactly one object representing the receipt's total.",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "date": {
                            "type": "STRING",
                            "description": "Transaction date in YYYY-MM-DD format. Infer correctly using 2026 reference year.",
                        },
                        "amount": {
                            "type": "NUMBER",
                            "description": "Total purchase or transaction amount.",
                        },
                        "currency": {
                            "type": "STRING",
                            "description": "CAD, KRW, or USD.",
                        },
                        "merchant": {
                            "type": "STRING",
                            "description": "Name of the merchant / business.",
                        },
                        "category": {
                            "type": "STRING",
                            "description": "Mapped category name.",
                        },
                        "sub_category": {
                            "type": "STRING",
                            "description": "Suggested subcategory name.",
                        },
                        "items": {
                            "type": "ARRAY",
                            "description": "List of individual purchased items on the receipt (only for single receipts; leave empty for statements).",
                            "items": {
                                "type": "OBJECT",
                                "properties": {
                                    "name": {
                                        "type": "STRING",
                                        "description": "Original item name.",
                                    },
                                    "standardized_name": {
                                        "type": "STRING",
                                        "description": "Standardized simple Korean item name (e.g. 수박, 소고기, 우유, 화장지) for price tracking.",
                                    },
                                    "quantity": {
                                        "type": "NUMBER",
                                        "description": "Quantity purchased. Can be fractional for weighted items (e.g., 2.5).",
                                    },
                                    "unit": {
                                        "type": "STRING",
                                        "description": "Unit of measurement (e.g. 개, lb, kg, bag) or null.",
                                    },
                                    "unit_price": {
                                        "type": "NUMBER",
                                        "description": "Unit price.",
                                    },
                                    "total_price": {
                                        "type": "NUMBER",
                                        "description": "Total price for this line item.",
                                    },
                                },
                                "required": [
                                    "name",
                                    "quantity",
                                    "unit_price",
                                    "total_price",
                                ],
                            },
                        },
                    },
                    "required": [
                        "date",
                        "amount",
                        "currency",
                        "merchant",
                        "category",
                        "sub_category",
                    ],
                },
            },
        },
        "required": ["is_statement", "transactions"],
    }


def _build_single_file_payload(file_bytes: bytes, mime_type: str) -> dict[str, Any]:
    base64_data = base64.b64encode(file_bytes).decode("utf-8")
    return {
        "contents": [
            {
                "parts": [
                    {"text": _receipt_prompt()},
                    {
                        "inlineData": {
                            "mimeType": mime_type,
                            "data": base64_data,
                        }
                    },
                ]
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": _receipt_response_schema(),
        },
    }


async def generate_content_with_routing(
    db: AsyncIOMotorDatabase,
    owner_id: str,
    api_key: str,
    payload: dict[str, Any],
) -> AsyncIterator[dict[str, Any]]:
    """
    Quota-aware Gemini router.
    Yields trying / failed / quota_fallback / success / error style events (no OCR log writes).
    """
    state = await _load_model_state(db, owner_id)
    models, skip_info = build_model_chain(state)

    # Expired cooldown: clear so next call starts clean.
    resume_at = _parse_iso(state.get("resume_at"))
    if resume_at and _utc_now() >= resume_at and state.get("cooldown_model"):
        await _save_model_state(db, owner_id, None)
        state = {}
        models, skip_info = build_model_chain(state)

    if skip_info:
        yield {
            "event": "quota_fallback",
            "model": skip_info["skipped_model"],
            "fallback_model": skip_info["fallback_model"],
            "resume_at": skip_info["resume_at"],
            "message": (
                f"Free-tier limit for {skip_info['skipped_model']}; "
                f"using {skip_info['fallback_model']} until {skip_info['resume_at']}."
            ),
        }

    last_error: str | None = None

    async with httpx.AsyncClient(timeout=45.0) as client:
        for model in models:
            yield {"event": "trying", "model": model}
            url = (
                "https://generativelanguage.googleapis.com/v1beta/models/"
                f"{model}:generateContent?key={api_key}"
            )
            try:
                resp = await client.post(url, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    text = data["candidates"][0]["content"]["parts"][0]["text"]
                    parsed_json = json.loads(text)
                    await _clear_cooldown_if_primary_ok(db, owner_id, model, state)
                    logger.info(
                        "gemini_success owner=%s model=%s", owner_id, model
                    )
                    yield {
                        "event": "success",
                        "model": model,
                        "result": parsed_json,
                    }
                    return

                error_text = _extract_error_message(resp)
                last_error = error_text
                yield {
                    "event": "failed",
                    "model": model,
                    "error": error_text,
                    "status_code": resp.status_code,
                }

                if _is_quota_status(resp.status_code, error_text):
                    resume = compute_resume_at(resp, error_text)
                    new_state = await _mark_model_cooldown(
                        db, owner_id, model, resume
                    )
                    state = new_state
                    idx = models.index(model)
                    next_models = models[idx + 1 :]
                    if next_models:
                        yield {
                            "event": "quota_fallback",
                            "model": model,
                            "fallback_model": next_models[0],
                            "resume_at": new_state["resume_at"],
                            "message": (
                                f"Quota/rate limit on {model}; "
                                f"retrying with {next_models[0]}."
                            ),
                        }
            except Exception as e:
                last_error = str(e)
                yield {
                    "event": "failed",
                    "model": model,
                    "error": str(e),
                }

    yield {
        "event": "error",
        "error": f"All models failed. Last error: {last_error}",
    }


async def parse_receipt_or_statement_stream(
    db: AsyncIOMotorDatabase,
    owner_id: str,
    file_bytes: bytes,
    mime_type: str,
    file_name: str,
):
    """
    Stream parsing status and results using SSE format.
    Yields dictionary status updates:
    - {"event": "trying", "model": str}
    - {"event": "failed", "model": str, "error": str}
    - {"event": "quota_fallback", "model": str, "fallback_model": str, "message": str, ...}
    - {"event": "success", "model": str, "result": dict, "log_id": str}
    - {"event": "error", "error": str, "log_id": str}
    """
    api_key = await get_user_gemini_api_key(db, owner_id)
    log_id = ObjectId()

    if not api_key:
        err_msg = "Gemini API Key가 등록되어 있지 않습니다. 설정에서 키를 먼저 등록해 주세요."
        await db["ocr_logs"].insert_one(
            {
                "_id": log_id,
                "timestamp": datetime.utcnow(),
                "owner_id": owner_id,
                "file_name": file_name,
                "status": "failed",
                "error_message": err_msg,
                "feedback": None,
            }
        )
        yield {
            "event": "error",
            "error": err_msg,
            "log_id": str(log_id),
        }
        return

    payload = _build_single_file_payload(file_bytes, mime_type)
    last_error: str | None = None

    async for event in generate_content_with_routing(db, owner_id, api_key, payload):
        if event["event"] == "success":
            model = event["model"]
            parsed_json = event["result"]
            await db["ocr_logs"].insert_one(
                {
                    "_id": log_id,
                    "timestamp": datetime.utcnow(),
                    "owner_id": owner_id,
                    "file_name": file_name,
                    "status": "success",
                    "model_used": model,
                    "parsed_data": parsed_json,
                    "feedback": None,
                }
            )
            yield {
                "event": "success",
                "model": model,
                "result": parsed_json,
                "log_id": str(log_id),
            }
            return

        if event["event"] == "error":
            last_error = event.get("error", last_error)
            await db["ocr_logs"].insert_one(
                {
                    "_id": log_id,
                    "timestamp": datetime.utcnow(),
                    "owner_id": owner_id,
                    "file_name": file_name,
                    "status": "failed",
                    "error_message": last_error,
                    "feedback": None,
                }
            )
            yield {
                "event": "error",
                "error": last_error,
                "log_id": str(log_id),
            }
            return

        if event["event"] == "failed":
            last_error = event.get("error", last_error)

        yield event


async def parse_receipt_or_statement(
    db: AsyncIOMotorDatabase,
    owner_id: str,
    file_bytes: bytes,
    mime_type: str,
    file_name: str = "file",
) -> dict:
    """Consume the SSE stream to return the final successful result or raise an error."""
    last_error = "Unknown error"
    async for event in parse_receipt_or_statement_stream(
        db, owner_id, file_bytes, mime_type, file_name
    ):
        if event["event"] == "success":
            return event["result"]
        if event["event"] == "error":
            last_error = event.get("error", last_error)
        elif event["event"] == "failed":
            last_error = event.get("error", last_error)
    raise Exception(last_error)


async def parse_files_in_batches(
    db: AsyncIOMotorDatabase,
    owner_id: str,
    files: Sequence[tuple[bytes, str, str]],
    *,
    batch_size: int = IMAGE_BATCH_SIZE,
    delay_seconds: float = BATCH_DELAY_SECONDS,
) -> list[dict[str, Any]]:
    """
    Parse multiple files in batches of `batch_size` (default 3).
    Each file is still one Gemini request (current schema is single-doc);
    batching adds a short delay between groups to reduce RPM bursts.
    Returns a list of {file_name, result?} / {file_name, error?} dicts.
    """
    outcomes: list[dict[str, Any]] = []
    batches = list(iter_batches(list(files), batch_size))
    for batch_index, batch in enumerate(batches):
        for file_bytes, mime_type, file_name in batch:
            try:
                result = await parse_receipt_or_statement(
                    db, owner_id, file_bytes, mime_type, file_name
                )
                outcomes.append({"file_name": file_name, "result": result})
            except Exception as e:
                outcomes.append({"file_name": file_name, "error": str(e)})
        if batch_index < len(batches) - 1 and delay_seconds > 0:
            await asyncio.sleep(delay_seconds)
    return outcomes
