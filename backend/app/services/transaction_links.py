"""Server-managed personal ↔ shared transfer pairs.

A transfer between ledgers is stored as two linked entries: an expense in the
outflow ledger and an income in the inflow ledger. Either side can be entered;
the server creates, updates, and deletes the other side with it.
"""

from bson import ObjectId
from fastapi import status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.errors import AppError
from app.models.ledger import (
    TRANSFER_CATEGORY,
    TransactionKind,
    normalize_transfer_category,
    paired_transfer_ledgers,
)
from app.models.transaction import AccountType, TransactionType
from app.models.user import UserOut
from app.services.access import assert_can_access_doc


def pair_ledgers(doc: dict) -> tuple[str, str] | None:
    """(outflow, inflow) ledgers when the doc is a personal↔shared transfer."""
    if normalize_transfer_category(doc.get("category", "")) != TRANSFER_CATEGORY:
        return None
    return paired_transfer_ledgers(doc.get("sub_category", ""))


def is_paired_transfer(doc: dict) -> bool:
    return pair_ledgers(doc) is not None


def expected_roles(doc: dict) -> set[tuple[str, str]]:
    outflow, inflow = pair_ledgers(doc)  # type: ignore[misc]
    return {
        (outflow, TransactionType.EXPENSE.value),
        (inflow, TransactionType.INCOME.value),
    }


def has_valid_role(doc: dict) -> bool:
    """Entry sits on one side of its pair (outflow expense or inflow income)."""
    return (doc.get("account_type"), doc.get("type")) in expected_roles(doc)


def twin_document(doc: dict, *, shared_group_id: str | None) -> dict:
    """The other side of a pair: swapped ledger, direction, and accounts."""
    outflow, inflow = pair_ledgers(doc)  # type: ignore[misc]
    is_outflow = doc["type"] == TransactionType.EXPENSE.value
    ledger = inflow if is_outflow else outflow
    return {
        "date": doc["date"],
        "amount": doc["amount"],
        "currency": doc["currency"],
        "type": (
            TransactionType.INCOME.value if is_outflow else TransactionType.EXPENSE.value
        ),
        "account_type": ledger,
        "shared_group_id": (
            shared_group_id if ledger == AccountType.SHARED.value else None
        ),
        "category": doc["category"],
        "sub_category": doc["sub_category"],
        "merchant": doc.get("merchant") or "미지정",
        "note": doc.get("note"),
        "institution": None,
        "settles_expense_id": None,
        "account_id": doc.get("counter_account_id"),
        "counter_account_id": doc.get("account_id"),
        "kind": TransactionKind.NORMAL.value,
        "owner_id": doc["owner_id"],
        "subscription_billing_cycle": None,
        "subscription_id": None,
        "is_stock_trade": False,
        "trade_type": None,
        "ticker": None,
        "shares": None,
        "price": None,
        "fee": None,
        "items": None,
    }


async def authorized_funding_twin(
    db: AsyncIOMotorDatabase, user: UserOut, doc: dict
) -> dict | None:
    """Authorize both entries before any mutation, including category changes.

    A shared ledger grants no write access to a partner's personal entry.
    Invalid legacy links fail closed instead of deleting unrelated records.
    """
    linked_id = doc.get("linked_transaction_id")
    if linked_id is None:
        return None
    if not isinstance(linked_id, str) or not ObjectId.is_valid(linked_id):
        raise AppError(status.HTTP_409_CONFLICT, "invalidTransactionLink")

    twin = await db["transactions"].find_one({"_id": ObjectId(linked_id)})
    await assert_can_access_doc(
        db, user, twin, not_found_code="linkedTransactionNotFound"
    )
    if (
        str(doc["_id"]) == linked_id
        or twin.get("linked_transaction_id") != str(doc["_id"])
        or twin.get("owner_id") != doc.get("owner_id")
        or not is_paired_transfer(doc)
        or pair_ledgers(twin) != pair_ledgers(doc)
        or {
            (doc.get("account_type"), doc.get("type")),
            (twin.get("account_type"), twin.get("type")),
        }
        != expected_roles(doc)
        or not doc.get("account_id")
        or not doc.get("counter_account_id")
        or doc["account_id"] == doc["counter_account_id"]
        or doc["account_id"] != twin.get("counter_account_id")
        or doc["counter_account_id"] != twin.get("account_id")
        or doc.get("currency") != twin.get("currency")
    ):
        raise AppError(status.HTTP_409_CONFLICT, "invalidTransactionLink")
    return twin
