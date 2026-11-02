"""Suggest a merchant name and category for bank statement rows.

Merchants the user already entered are matched first. Only the rest go to the
AI, in a single request, and anything it is unsure about is left for review.
"""

import json
import logging
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.ledger import TRANSFER_CATEGORY
from app.models.transaction import TransactionType
from app.models.user_settings import CustomCategoryMap
from app.services import ai
from app.services.bank_import import _tokens
from app.services.category_merge import is_valid_merged_pair, merge_custom_categories

logger = logging.getLogger(__name__)

# At or above this the suggestion is pre-accepted; below it goes to review.
AUTO_CONFIDENCE = 0.85
HISTORY_LIMIT = 3000


def history_lookup(description: str, history: list[dict]) -> dict | None:
    """Latest past entry whose merchant words all appear in the description."""
    words = _tokens(description)
    for doc in history:  # newest first
        merchant_words = _tokens(doc.get("merchant", ""))
        if merchant_words and merchant_words <= words:
            return doc
    return None


def _allowed_categories(custom: CustomCategoryMap) -> dict[str, dict[str, list[str]]]:
    merged = merge_custom_categories(custom)
    return {
        "expense": {
            g.category: g.sub_categories
            for g in merged.expense
            if g.category != TRANSFER_CATEGORY
        },
        "income": {
            g.category: g.sub_categories
            for g in merged.income
            if g.category != TRANSFER_CATEGORY
        },
    }


def build_ai_payload(rows: list[dict], allowed: dict) -> dict[str, Any]:
    lines = [
        f'{r["index"]}|{r["direction"]}|{r["amount"]:.2f}|{r["description"]}'
        for r in rows
    ]
    prompt = (
        "You label Canadian bank statement lines for a household budget app.\n"
        "Each line is: index|direction|amount|description. direction 'out' is money "
        "spent, 'in' is money received. Descriptions are raw bank text.\n"
        "For each line return a clean merchant name (e.g. 'Amazon', 'Netflix'), the "
        "type ('expense' for out, 'income' for in), and a category and sub_category "
        "that are EXACTLY one valid pair from the lists below.\n"
        "confidence is 0 to 1: how sure you are of the category. Use a low value when "
        "the description is vague, masked, or could be several things.\n"
        f"Valid expense pairs: {json.dumps(allowed['expense'], ensure_ascii=False)}\n"
        f"Valid income pairs: {json.dumps(allowed['income'], ensure_ascii=False)}\n"
        "Lines:\n" + "\n".join(lines)
    )
    return {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "results": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "index": {"type": "INTEGER"},
                                "merchant": {"type": "STRING"},
                                "type": {"type": "STRING"},
                                "category": {"type": "STRING"},
                                "sub_category": {"type": "STRING"},
                                "confidence": {"type": "NUMBER"},
                            },
                            "required": [
                                "index",
                                "merchant",
                                "type",
                                "category",
                                "sub_category",
                                "confidence",
                            ],
                        },
                    }
                },
                "required": ["results"],
            },
        },
    }


def read_ai_results(
    raw: list[dict], rows: list[dict], custom: CustomCategoryMap
) -> dict[int, dict]:
    """Keep only suggestions that are valid pairs for the row's direction."""
    by_index = {r["index"]: r for r in rows}
    out: dict[int, dict] = {}
    for item in raw:
        row = by_index.get(item.get("index"))
        if row is None:
            continue
        tx_type = TransactionType.EXPENSE if row["direction"] == "out" else TransactionType.INCOME
        category = str(item.get("category", "")).strip()
        sub = str(item.get("sub_category", "")).strip()
        if category == TRANSFER_CATEGORY or not is_valid_merged_pair(
            custom, tx_type, category, sub
        ):
            continue
        try:
            confidence = max(0.0, min(1.0, float(item.get("confidence", 0))))
        except (TypeError, ValueError):
            confidence = 0.0
        out[row["index"]] = {
            "merchant": str(item.get("merchant") or row["description"]).strip(),
            "type": tx_type.value,
            "category": category,
            "sub_category": sub,
            "confidence": confidence,
            "source": "ai",
        }
    return out


async def classify_rows(
    db: AsyncIOMotorDatabase,
    owner_id: str,
    owner_ids: list[str],
    account_type: str,
    shared_scope: dict,
    rows: list[dict],
    custom: CustomCategoryMap,
) -> dict[int, dict]:
    """Suggestions keyed by row index. Rows with no usable suggestion are absent."""
    history = (
        await db["transactions"]
        .find(
            {
                "owner_id": {"$in": owner_ids},
                "account_type": account_type,
                **shared_scope,
                "kind": {"$ne": "transfer"},
                "merchant": {"$nin": [None, "", "미지정"]},
            }
        )
        .sort("date", -1)
        .to_list(length=HISTORY_LIMIT)
    )

    suggestions: dict[int, dict] = {}
    unknown: list[dict] = []
    for row in rows:
        wanted = "expense" if row["direction"] == "out" else "income"
        hit = history_lookup(row["description"], [h for h in history if h.get("type") == wanted])
        if hit:
            suggestions[row["index"]] = {
                "merchant": hit["merchant"],
                "type": wanted,
                "category": hit["category"],
                "sub_category": hit["sub_category"],
                "confidence": 1.0,
                "source": "history",
            }
        else:
            unknown.append(row)

    if not unknown:
        return suggestions

    allowed = _allowed_categories(custom)
    try:
        api_key = await ai.get_user_gemini_api_key(db, owner_id)
        result, _model, _notes = await ai._generate_json_result(
            db, owner_id, api_key, build_ai_payload(unknown, allowed)
        )
    except Exception as exc:  # no key, quota, or a bad reply: leave the rows for review
        logger.warning("bank import classification skipped: %s", exc)
        return suggestions
    suggestions.update(read_ai_results(result.get("results", []), unknown, custom))
    return suggestions
