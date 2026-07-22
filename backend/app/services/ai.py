import base64
import json
from datetime import datetime
import httpx
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

async def get_user_gemini_api_key(db: AsyncIOMotorDatabase, owner_id: str) -> str | None:
    doc = await db["user_settings"].find_one({"owner_id": owner_id})
    if doc:
        key = doc.get("gemini_api_key")
        if key and key.strip():
            return key.strip()
    return None

async def parse_receipt_or_statement_stream(
    db: AsyncIOMotorDatabase,
    owner_id: str,
    file_bytes: bytes,
    mime_type: str,
    file_name: str
):
    """
    Stream parsing status and results using SSE format.
    Yields dictionary status updates:
    - {"event": "trying", "model": str}
    - {"event": "failed", "model": str, "error": str}
    - {"event": "success", "model": str, "result": dict, "log_id": str}
    - {"event": "error", "error": str, "log_id": str}
    """
    api_key = await get_user_gemini_api_key(db, owner_id)
    log_id = ObjectId()
    
    if not api_key:
        err_msg = "Gemini API Key가 등록되어 있지 않습니다. 설정에서 키를 먼저 등록해 주세요."
        # Write failed log
        await db["ocr_logs"].insert_one({
            "_id": log_id,
            "timestamp": datetime.utcnow(),
            "owner_id": owner_id,
            "file_name": file_name,
            "status": "failed",
            "error_message": err_msg,
            "feedback": None
        })
        yield {
            "event": "error",
            "error": err_msg,
            "log_id": str(log_id)
        }
        return

    base64_data = base64.b64encode(file_bytes).decode("utf-8")

    prompt = (
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

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {
                        "inlineData": {
                            "mimeType": mime_type,
                            "data": base64_data
                        }
                    }
                ]
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "is_statement": {
                        "type": "BOOLEAN",
                        "description": "True if the document is a statement containing multiple separate transactions, False if it is a single receipt."
                    },
                    "transactions": {
                        "type": "ARRAY",
                        "description": "If is_statement is True, list all parsed transactions from the statement. If is_statement is False, this array should contain exactly one object representing the receipt's total.",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "date": {"type": "STRING", "description": "Transaction date in YYYY-MM-DD format. Infer correctly using 2026 reference year."},
                                "amount": {"type": "NUMBER", "description": "Total purchase or transaction amount."},
                                "currency": {"type": "STRING", "description": "CAD, KRW, or USD."},
                                "merchant": {"type": "STRING", "description": "Name of the merchant / business."},
                                "category": {"type": "STRING", "description": "Mapped category name."},
                                "sub_category": {"type": "STRING", "description": "Suggested subcategory name."},
                                "items": {
                                    "type": "ARRAY",
                                    "description": "List of individual purchased items on the receipt (only for single receipts; leave empty for statements).",
                                    "items": {
                                        "type": "OBJECT",
                                        "properties": {
                                            "name": {"type": "STRING", "description": "Original item name."},
                                            "standardized_name": {"type": "STRING", "description": "Standardized simple Korean item name (e.g. 수박, 소고기, 우유, 화장지) for price tracking."},
                                            "quantity": {"type": "NUMBER", "description": "Quantity purchased. Can be fractional for weighted items (e.g., 2.5)."},
                                            "unit": {"type": "STRING", "description": "Unit of measurement (e.g. 개, lb, kg, bag) or null."},
                                            "unit_price": {"type": "NUMBER", "description": "Unit price."},
                                            "total_price": {"type": "NUMBER", "description": "Total price for this line item."}
                                        },
                                        "required": ["name", "quantity", "unit_price", "total_price"]
                                    }
                                }
                            },
                            "required": ["date", "amount", "currency", "merchant", "category", "sub_category"]
                        }
                    }
                },
                "required": ["is_statement", "transactions"]
            }
        }
    }

    # API fallback chain
    models = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemma-4-31b-it"]
    last_error = None

    async with httpx.AsyncClient(timeout=45.0) as client:
        for model in models:
            yield {
                "event": "trying",
                "model": model
            }
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            try:
                resp = await client.post(url, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    text = data["candidates"][0]["content"]["parts"][0]["text"]
                    parsed_json = json.loads(text)
                    
                    # Log success
                    await db["ocr_logs"].insert_one({
                        "_id": log_id,
                        "timestamp": datetime.utcnow(),
                        "owner_id": owner_id,
                        "file_name": file_name,
                        "status": "success",
                        "model_used": model,
                        "parsed_data": parsed_json,
                        "feedback": None
                    })
                    
                    yield {
                        "event": "success",
                        "model": model,
                        "result": parsed_json,
                        "log_id": str(log_id)
                    }
                    return
                else:
                    error_text = resp.text
                    try:
                        err_json = resp.json()
                        if "error" in err_json:
                            error_text = err_json["error"].get("message", error_text)
                    except Exception:
                        pass
                    last_error = error_text
                    yield {
                        "event": "failed",
                        "model": model,
                        "error": error_text
                    }
            except Exception as e:
                last_error = str(e)
                yield {
                    "event": "failed",
                    "model": model,
                    "error": str(e)
                }

        # If all models failed
        await db["ocr_logs"].insert_one({
            "_id": log_id,
            "timestamp": datetime.utcnow(),
            "owner_id": owner_id,
            "file_name": file_name,
            "status": "failed",
            "error_message": f"All models failed. Last error: {last_error}",
            "feedback": None
        })
        yield {
            "event": "error",
            "error": f"All models failed. Last error: {last_error}",
            "log_id": str(log_id)
        }

async def parse_receipt_or_statement(
    db: AsyncIOMotorDatabase, owner_id: str, file_bytes: bytes, mime_type: str, file_name: str = "file"
) -> dict:
    """Consume the SSE stream to return the final successful result or raise an error (backwards compatibility)."""
    last_error = "Unknown error"
    async for event in parse_receipt_or_statement_stream(db, owner_id, file_bytes, mime_type, file_name):
        if event["event"] == "success":
            return event["result"]
        elif event["event"] == "error":
            last_error = event.get("error", last_error)
        elif event["event"] == "failed":
            last_error = event.get("error", last_error)
    raise Exception(last_error)
