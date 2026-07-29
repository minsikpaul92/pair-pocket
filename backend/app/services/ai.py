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
        "quantity, unit (e.g. 개, lb, kg, bag) or null, unit_price, and total_price.\n"
        "For Canadian receipts: extract subtotal (pre-tax), tax_amount (HST/GST/PST), tip_amount if shown, "
        "and amount as the final total paid. Line item unit_price should be pre-tax when the receipt shows it; "
        "otherwise use the printed line total divided by quantity.\n"
        "Line item parsing rules: each row must align to columns name | standardized_name | quantity | unit | unit_price | total_price. "
        "standardized_name is a normalized product label for cross-store price comparison (same meat cut at different stores)."
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
                            "description": "Final total paid (after tax and tip).",
                        },
                        "subtotal": {
                            "type": "NUMBER",
                            "description": "Pre-tax subtotal when shown on receipt.",
                        },
                        "tax_amount": {
                            "type": "NUMBER",
                            "description": "Total tax (HST/GST/PST) when shown.",
                        },
                        "tip_amount": {
                            "type": "NUMBER",
                            "description": "Tip/gratuity when shown.",
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


ONBOARDING_MAX_IMAGES = 15
ONBOARDING_STEPS = ("assets", "subscriptions", "brokerage")


def _onboarding_prompt(step: str) -> str:
    if step == "assets":
        return (
            "You are helping PairPocket onboarding. Analyze bank/card/brokerage app screenshots.\n"
            "Extract every distinct account or credit card visible across the images.\n"
            "kind must be one of: checking, savings, credit_card, investment, cash.\n"
            "currency must be CAD, KRW, or USD (default CAD if unsure).\n"
            "\n"
            "BALANCES (critical — avoid double-counting stocks):\n"
            "- credit_card: opening_balance = amount currently owed (debt / unpaid).\n"
            "- checking / savings / cash: opening_balance = available / ledger balance.\n"
            "- investment / brokerage: opening_balance = CASH ONLY "
            "(labels like 현금, 예수금, Available to trade, buying power, cash). "
            "NEVER use total account value, 평가금액, portfolio total, or 총자산 "
            "(those include stock holdings).\n"
            "- If a brokerage screen shows multiple cash currencies "
            "(e.g. Toss Securities 토스증권 with 원화 and 달러), emit SEPARATE "
            "investment accounts — one per currency — with clear names like "
            "'토스증권 한화' / '토스증권 달러' (or 'Toss Securities KRW' / "
            "'Toss Securities USD'). Do not merge KRW+USD cash into one balance.\n"
            "\n"
            "PRIVACY (critical):\n"
            "- For credit_card: set last_four to ONLY the last 4 digits of the card. "
            "Never return the full card number. Leave account_number empty.\n"
            "- For checking/savings/investment: set account_number to a MASKED value "
            "showing only the last 4 digits, e.g. '••••1234' or '****1234'. "
            "Do NOT return the full account number. Leave last_four empty.\n"
            "- If the number is not visible, omit last_four / account_number.\n"
            "Return JSON matching the schema. Deduplicate obvious duplicates."
        )
    if step == "subscriptions":
        return (
            "You are helping PairPocket onboarding. Analyze subscription, membership, "
            "installment, and fixed-bill screenshots (Netflix, Apple, Costco membership, "
            "Affirm, phone/internet bills, etc.).\n"
            "For EACH distinct recurring charge extract:\n"
            "- name (service / merchant)\n"
            "- amount: the amount currently charged. If a promotion/intro price is active, "
            "put that in promo_amount and put the regular/full price in amount "
            "(or regular_amount). Set promo_end_date if shown.\n"
            "- currency: CAD, KRW, or USD (default CAD)\n"
            "- kind: subscription | installment | fixed "
            "(memberships/streaming = subscription; Affirm/BNPL/할부 = installment; "
            "rent/utilities/phone/internet = fixed)\n"
            "- cycle: monthly or yearly (installments use monthly). Default monthly.\n"
            "- billing_day: day of month (1-28) of renewal / next charge / 결제일. "
            "Infer from 'renews on', 'next billing', '결제 예정', anniversary dates.\n"
            "- start_date / end_date: ISO YYYY-MM-DD only (e.g. 2025-03-15). "
            "Never use dots/slashes like 2025.03.15.\n"
            "- Installments (Affirm/BNPL/할부): always set total_installments when "
            "the plan shows N payments / N회 / 'of N'. Also set end_date when the "
            "last payment / payoff / maturity date is shown. If only start + N "
            "payments are visible, still return total_installments (client computes end).\n"
            "Costco membership is a yearly subscription named Costco when visible.\n"
            "Deduplicate by service name. Return JSON matching the schema."
        )
    return (
        "You are helping PairPocket onboarding. Analyze brokerage / investment screenshots.\n"
        "Extract brokerage name, CASH/buying-power only, currency, and holdings.\n"
        "cash_balance must be CASH ONLY (현금, 예수금, Available to trade, buying power). "
        "Never use total portfolio value / 총자산 / 평가금액.\n"
        "If multiple cash currencies appear (e.g. KRW + USD on Toss Securities), "
        "prefer the primary visible cash currency for cash_balance and note others "
        "in holdings only if they are stocks; for multi-currency cash, the assets "
        "step handles split accounts — here set cash_balance to the main cash line.\n"
        "For each holding include ticker, name, shares, avg_price (cost basis / average "
        "price if shown), currency.\n"
        "CANADIAN LISTINGS (critical — Wealthsimple FHSA / TSX / CDR):\n"
        "- If price shows CAD, or name contains CDR / CAD Hedged / TSX / NEO, "
        "currency MUST be CAD.\n"
        "- Prefer Yahoo-style Canadian tickers: TSX → .TO (e.g. VFV.TO, QQC.TO), "
        "NEO CDRs → .NE (e.g. NVDA.NE, XOM.NE, LLY.NE, PLTR.NE), "
        "TSXV → .V. Keep suffixes like ZXLE.F as shown.\n"
        "- NEVER map a CAD-priced CDR (e.g. NVDA ~$44 CAD, XOM ~$28 CAD) to the "
        "US-listed ticker without a Canadian suffix — that inflates valuation badly.\n"
        "- Put the full visible name (including 'CDR (CAD Hedged)') in name.\n"
        "currency must be CAD, KRW, or USD (default CAD if Wealthsimple / CAD labels).\n"
        "If multiple screenshots belong to one account, merge into one brokerage object.\n"
        "Return JSON matching the schema."
    )


def _onboarding_schema(step: str) -> dict[str, Any]:
    if step == "assets":
        return {
            "type": "OBJECT",
            "properties": {
                "accounts": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "name": {"type": "STRING"},
                            "institution": {"type": "STRING"},
                            "kind": {"type": "STRING"},
                            "currency": {"type": "STRING"},
                            "opening_balance": {"type": "NUMBER"},
                            "last_four": {
                                "type": "STRING",
                                "description": "Credit cards only: last 4 digits.",
                            },
                            "account_number": {
                                "type": "STRING",
                                "description": (
                                    "Bank/broker only: masked account number "
                                    "ending with last 4 digits (e.g. ••••1234)."
                                ),
                            },
                        },
                        "required": ["name", "kind", "currency", "opening_balance"],
                    },
                }
            },
            "required": ["accounts"],
        }
    if step == "subscriptions":
        return {
            "type": "OBJECT",
            "properties": {
                "subscriptions": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "name": {"type": "STRING"},
                            "amount": {"type": "NUMBER"},
                            "regular_amount": {"type": "NUMBER"},
                            "currency": {"type": "STRING"},
                            "kind": {"type": "STRING"},
                            "cycle": {"type": "STRING"},
                            "billing_day": {"type": "NUMBER"},
                            "start_date": {"type": "STRING"},
                            "end_date": {"type": "STRING"},
                            "total_installments": {"type": "NUMBER"},
                            "promo_amount": {"type": "NUMBER"},
                            "promo_end_date": {"type": "STRING"},
                            "category": {"type": "STRING"},
                            "sub_category": {"type": "STRING"},
                        },
                        "required": ["name", "amount", "currency"],
                    },
                }
            },
            "required": ["subscriptions"],
        }
    return {
        "type": "OBJECT",
        "properties": {
            "brokerage": {
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING"},
                    "currency": {"type": "STRING"},
                    "cash_balance": {"type": "NUMBER"},
                    "holdings": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "ticker": {"type": "STRING"},
                                "name": {"type": "STRING"},
                                "shares": {"type": "NUMBER"},
                                "avg_price": {"type": "NUMBER"},
                                "currency": {"type": "STRING"},
                            },
                            "required": ["ticker", "shares", "avg_price"],
                        },
                    },
                },
                "required": ["name", "currency", "cash_balance", "holdings"],
            }
        },
        "required": ["brokerage"],
    }


def _build_onboarding_batch_payload(
    step: str, images: Sequence[tuple[bytes, str]]
) -> dict[str, Any]:
    parts: list[dict[str, Any]] = [{"text": _onboarding_prompt(step)}]
    for file_bytes, mime_type in images:
        parts.append(
            {
                "inlineData": {
                    "mimeType": mime_type,
                    "data": base64.b64encode(file_bytes).decode("utf-8"),
                }
            }
        )
    return {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": _onboarding_schema(step),
        },
    }


async def _generate_json_result(
    db: AsyncIOMotorDatabase,
    owner_id: str,
    api_key: str,
    payload: dict[str, Any],
) -> tuple[dict[str, Any], str, list[str]]:
    notes: list[str] = []
    last_error = "Unknown error"
    async for event in generate_content_with_routing(db, owner_id, api_key, payload):
        if event["event"] == "quota_fallback":
            msg = event.get("message")
            if msg:
                notes.append(str(msg))
        elif event["event"] == "success":
            return event["result"], str(event["model"]), notes
        elif event["event"] == "error":
            last_error = event.get("error", last_error)
        elif event["event"] == "failed":
            last_error = event.get("error", last_error)
    raise Exception(last_error)


def _empty_onboarding_data(step: str) -> dict[str, Any]:
    if step == "assets":
        return {"accounts": []}
    if step == "subscriptions":
        return {"subscriptions": []}
    return {
        "brokerage": {
            "name": "",
            "currency": "CAD",
            "cash_balance": 0,
            "holdings": [],
        }
    }


def _merge_onboarding_batch(step: str, merged: dict[str, Any], batch: dict[str, Any]) -> None:
    if step == "assets":
        items = batch.get("accounts") or []
        if isinstance(items, list):
            merged["accounts"].extend(items)
        return
    if step == "subscriptions":
        items = batch.get("subscriptions") or []
        if isinstance(items, list):
            merged["subscriptions"].extend(items)
        return
    brokerage = batch.get("brokerage") or {}
    if not isinstance(brokerage, dict):
        return
    current = merged["brokerage"]
    if brokerage.get("name") and not current.get("name"):
        current["name"] = brokerage.get("name")
    if brokerage.get("currency"):
        current["currency"] = brokerage.get("currency")
    if brokerage.get("cash_balance") is not None:
        try:
            current["cash_balance"] = float(brokerage.get("cash_balance") or 0)
        except (TypeError, ValueError):
            pass
    holdings = brokerage.get("holdings") or []
    if isinstance(holdings, list):
        current["holdings"].extend(holdings)


async def parse_onboarding_screenshots_stream(
    db: AsyncIOMotorDatabase,
    owner_id: str,
    step: str,
    files: Sequence[tuple[bytes, str, str]],
    *,
    batch_size: int = IMAGE_BATCH_SIZE,
    delay_seconds: float = BATCH_DELAY_SECONDS,
):
    """
    Yield progress events while parsing onboarding screenshots.
    Final success payload matches parse_onboarding_screenshots().
    Events: scanning | trying | quota_fallback | batch_done | success | error
    """
    if step not in ONBOARDING_STEPS:
        yield {"event": "error", "error": f"Unsupported onboarding step: {step}"}
        return
    if not files:
        yield {"event": "error", "error": "No images provided"}
        return
    if len(files) > ONBOARDING_MAX_IMAGES:
        yield {
            "event": "error",
            "error": f"Maximum {ONBOARDING_MAX_IMAGES} images allowed",
        }
        return

    try:
        api_key = await get_user_gemini_api_key(db, owner_id)
    except Exception as e:
        yield {"event": "error", "error": str(e)}
        return
    if not api_key:
        yield {
            "event": "error",
            "error": (
                "Gemini API Key가 등록되어 있지 않습니다. "
                "설정에서 키를 먼저 등록해 주세요."
            ),
        }
        return

    merged = _empty_onboarding_data(step)
    models_used: list[str] = []
    notes: list[str] = []
    errors: list[str] = []
    batches = list(iter_batches(list(files), batch_size))

    yield {
        "event": "scanning",
        "count": len(files),
        "batch_count": len(batches),
    }

    for batch_index, batch in enumerate(batches):
        payload = _build_onboarding_batch_payload(
            step, [(file_bytes, mime) for file_bytes, mime, _ in batch]
        )
        names = ", ".join(name for _, _, name in batch)
        last_error = "Unknown error"
        try:
            async for event in generate_content_with_routing(
                db, owner_id, api_key, payload
            ):
                if event["event"] == "trying":
                    yield {
                        "event": "trying",
                        "model": event.get("model"),
                        "count": len(files),
                        "batch": batch_index + 1,
                        "batch_count": len(batches),
                    }
                elif event["event"] == "quota_fallback":
                    msg = event.get("message")
                    if msg:
                        notes.append(str(msg))
                    yield {
                        "event": "quota_fallback",
                        "model": event.get("model"),
                        "fallback_model": event.get("fallback_model"),
                        "message": msg,
                        "count": len(files),
                    }
                elif event["event"] == "success":
                    model = str(event["model"])
                    models_used.append(model)
                    result = event["result"]
                    if isinstance(result, dict):
                        _merge_onboarding_batch(step, merged, result)
                    yield {
                        "event": "batch_done",
                        "model": model,
                        "batch": batch_index + 1,
                        "batch_count": len(batches),
                    }
                    logger.info(
                        "onboarding_parse_ok owner=%s step=%s batch=%s model=%s files=%s",
                        owner_id,
                        step,
                        batch_index + 1,
                        model,
                        names,
                    )
                    last_error = ""
                    break
                elif event["event"] in ("failed", "error"):
                    last_error = str(event.get("error") or last_error)
            if last_error:
                raise Exception(last_error)
        except Exception as e:
            errors.append(f"Batch {batch_index + 1} ({names}): {e}")
            logger.warning(
                "onboarding_parse_fail owner=%s step=%s batch=%s err=%s",
                owner_id,
                step,
                batch_index + 1,
                e,
            )
        if batch_index < len(batches) - 1 and delay_seconds > 0:
            await asyncio.sleep(delay_seconds)

    if errors and (
        (step == "assets" and not merged["accounts"])
        or (step == "subscriptions" and not merged["subscriptions"])
        or (
            step == "brokerage"
            and not merged["brokerage"].get("name")
            and not merged["brokerage"].get("holdings")
        )
    ):
        yield {"event": "error", "error": "; ".join(errors)}
        return

    yield {
        "event": "success",
        "step": step,
        "data": merged,
        "models_used": models_used,
        "notes": notes,
        "errors": errors or None,
        "batch_count": len(batches),
        "image_count": len(files),
    }


async def parse_onboarding_screenshots(
    db: AsyncIOMotorDatabase,
    owner_id: str,
    step: str,
    files: Sequence[tuple[bytes, str, str]],
    *,
    batch_size: int = IMAGE_BATCH_SIZE,
    delay_seconds: float = BATCH_DELAY_SECONDS,
) -> dict[str, Any]:
    """Non-streaming wrapper around parse_onboarding_screenshots_stream."""
    final: dict[str, Any] | None = None
    async for event in parse_onboarding_screenshots_stream(
        db,
        owner_id,
        step,
        files,
        batch_size=batch_size,
        delay_seconds=delay_seconds,
    ):
        if event.get("event") == "error":
            raise Exception(event.get("error") or "Onboarding parse failed")
        if event.get("event") == "success":
            final = {
                "step": event["step"],
                "data": event["data"],
                "models_used": event.get("models_used") or [],
                "notes": event.get("notes") or [],
                "errors": event.get("errors"),
                "batch_count": event.get("batch_count"),
                "image_count": event.get("image_count"),
            }
    if not final:
        raise Exception("Onboarding parse failed")
    return final
