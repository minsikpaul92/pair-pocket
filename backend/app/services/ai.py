import base64
import json
import httpx
from motor.motor_asyncio import AsyncIOMotorDatabase

async def get_user_gemini_api_key(db: AsyncIOMotorDatabase, owner_id: str) -> str | None:
    doc = await db["user_settings"].find_one({"owner_id": owner_id})
    if doc:
        key = doc.get("gemini_api_key")
        if key and key.strip():
            return key.strip()
    return None

async def parse_receipt_or_statement(db: AsyncIOMotorDatabase, owner_id: str, file_bytes: bytes, mime_type: str) -> dict:
    api_key = await get_user_gemini_api_key(db, owner_id)
    if not api_key:
        raise ValueError("Gemini API Key가 등록되어 있지 않습니다. 설정에서 키를 먼저 등록해 주세요.")

    base64_data = base64.b64encode(file_bytes).decode("utf-8")

    prompt = (
        "You are an expert expense parser for PairPocket. Analyze the provided receipt image or financial statement PDF. "
        "Extract the transaction details and return them in JSON format. "
        "For currency, determine if it is Canadian Dollars (CAD) or South Korean Won (KRW). Default to CAD if unsure. "
        "For category, map it to one of the following: '식비', '생활/쇼핑', '문화/취미', '교통/차량', '주거/통신', '투자/저축', '의료/건강', '교육/육아', '금융/기타'. "
        "Suggest a logical sub_category based on the merchant."
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
                    "date": {"type": "STRING", "description": "Transaction date in YYYY-MM-DD format."},
                    "amount": {"type": "NUMBER", "description": "Total purchase or transaction amount."},
                    "currency": {"type": "STRING", "description": "CAD or KRW."},
                    "merchant": {"type": "STRING", "description": "Name of the merchant / business."},
                    "category": {"type": "STRING", "description": "Mapped category name."},
                    "sub_category": {"type": "STRING", "description": "Suggested subcategory name."}
                },
                "required": ["date", "amount", "currency", "merchant", "category", "sub_category"]
            }
        }
    }

    # Define fallback models in case gemini-3.5-flash has high demand/quota limits
    models = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-1.5-flash"]
    last_error = None

    async with httpx.AsyncClient(timeout=45.0) as client:
        for model in models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            try:
                resp = await client.post(url, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    text = data["candidates"][0]["content"]["parts"][0]["text"]
                    return json.loads(text)
                else:
                    error_text = resp.text
                    try:
                        err_json = resp.json()
                        if "error" in err_json:
                            error_text = err_json["error"].get("message", error_text)
                    except Exception:
                        pass
                    last_error = error_text
            except Exception as e:
                last_error = str(e)

        raise Exception(f"Gemini API Error: {last_error}")
