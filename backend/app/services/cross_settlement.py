"""Settlements paid with money from the other ledger (personal ↔ shared).

A shared expense paid with the shared card can be settled from a personal
account, and a personal expense from the shared account. The settlement is
stored as two linked entries that the server creates, changes and deletes
together:

- in the expense's ledger, a [정산 › N빵 정산/환급] income that settles the
  expense, so its spending shrinks (to zero when fully settled);
- in the other ledger, an expense for the money that left the paying account,
  keeping the original category and merchant.
"""

from bson import ObjectId
from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.category_preset import (
    INCOME_CATEGORY_SETTLEMENT,
    SUB_CATEGORY_SETTLEMENT,
)
from app.models.ledger import TransactionKind
from app.models.transaction import (
    AccountType,
    CrossSettlementCreate,
    TransactionCreate,
    TransactionType,
)
from app.models.user import UserOut
from app.services import db_transactions
from app.services.access import assert_can_access_doc, resolve_owner_ids
from app.services.settlement import check_settlement
from app.services.validation import _assert_account_type, _load_owned_account

COLLECTION = "transactions"
PAIR_KIND = "settlement"


def is_settlement_pair(doc: dict | None) -> bool:
    return bool(doc) and doc.get("pair_kind") == PAIR_KIND


def _other_ledger(ledger: str) -> str:
    return (
        AccountType.SHARED.value
        if ledger == AccountType.PERSONAL.value
        else AccountType.PERSONAL.value
    )


async def _ledger_owners(
    db: AsyncIOMotorDatabase, user: UserOut, ledger: str
) -> list[str]:
    """Owners whose accounts the user may touch: own personal, whole shared."""
    if ledger == AccountType.PERSONAL.value:
        return [user.id]
    return await resolve_owner_ids(db, user, AccountType.SHARED)


def _entry(
    *,
    user: UserOut,
    ledger: str,
    entry_type: TransactionType,
    source: dict,
    amount: float,
    date,
    note: str | None,
    account_id: str,
    counter_account_id: str,
    category: str,
    sub_category: str,
    settles_expense_id: str | None,
) -> dict:
    return {
        "date": date,
        "amount": float(amount),
        "currency": source["currency"],
        "type": entry_type.value,
        "account_type": ledger,
        "shared_group_id": (
            user.shared_group_id if ledger == AccountType.SHARED.value else None
        ),
        "category": category,
        "sub_category": sub_category,
        "merchant": source.get("merchant") or "미지정",
        "note": note,
        "institution": source.get("institution")
        if entry_type == TransactionType.EXPENSE
        else None,
        "settles_expense_id": settles_expense_id,
        "account_id": account_id,
        "counter_account_id": counter_account_id,
        "kind": TransactionKind.NORMAL.value,
        "owner_id": user.id,
        "subscription_billing_cycle": None,
        "subscription_id": None,
        "is_stock_trade": False,
        "trade_type": None,
        "ticker": None,
        "shares": None,
        "price": None,
        "fee": None,
        "items": None,
        "pair_kind": PAIR_KIND,
    }


def _reject(detail: str, code: int = status.HTTP_422_UNPROCESSABLE_ENTITY):
    raise HTTPException(status_code=code, detail=detail)


async def _own_account(
    db: AsyncIOMotorDatabase,
    user: UserOut,
    *,
    account_id: str,
    ledger: str,
    currency: str,
    label: str,
) -> dict:
    account = await _load_owned_account(
        db,
        account_id=account_id,
        owner_ids=await _ledger_owners(db, user, ledger),
        shared_group_id=user.shared_group_id,
        label=label,
    )
    _assert_account_type(account, AccountType(ledger), label)
    if account.get("currency") != currency:
        _reject(f"{label} 통화와 정산 통화가 일치하지 않습니다.")
    if account.get("is_liability"):
        _reject(f"{label}는 자산 계좌여야 합니다.")
    return account


async def create(
    db: AsyncIOMotorDatabase, user: UserOut, payload: CrossSettlementCreate
) -> dict:
    """Create both entries and return the one in the expense's ledger."""
    if not user.shared_group_id:
        _reject(
            "개인↔공용 정산을 쓰려면 먼저 파트너를 초대해야 합니다.",
            status.HTTP_400_BAD_REQUEST,
        )
    expense = None
    if ObjectId.is_valid(payload.expense_id):
        expense = await db[COLLECTION].find_one({"_id": ObjectId(payload.expense_id)})
    await assert_can_access_doc(
        db, user, expense, not_found_detail="정산 대상 지출을 찾을 수 없습니다."
    )
    if (
        expense.get("type") != TransactionType.EXPENSE.value
        or expense.get("kind") == TransactionKind.TRANSFER.value
        or is_settlement_pair(expense)
        or (
            expense["account_type"] == AccountType.PERSONAL.value
            and expense["owner_id"] != user.id
        )
    ):
        _reject("정산할 수 없는 지출입니다.")

    inflow = expense["account_type"]
    outflow = _other_ledger(inflow)
    currency = expense["currency"]
    receive = await _own_account(
        db,
        user,
        account_id=payload.receive_account_id,
        ledger=inflow,
        currency=currency,
        label="받는 계좌",
    )
    pay = await _own_account(
        db,
        user,
        account_id=payload.pay_account_id,
        ledger=outflow,
        currency=currency,
        label="지급 계좌",
    )
    receive_id, pay_id = str(receive["_id"]), str(pay["_id"])

    income = _entry(
        user=user,
        ledger=inflow,
        entry_type=TransactionType.INCOME,
        source=expense,
        amount=payload.amount,
        date=payload.date,
        note=payload.note,
        account_id=receive_id,
        counter_account_id=pay_id,
        category=INCOME_CATEGORY_SETTLEMENT,
        sub_category=SUB_CATEGORY_SETTLEMENT,
        settles_expense_id=payload.expense_id,
    )
    payment = _entry(
        user=user,
        ledger=outflow,
        entry_type=TransactionType.EXPENSE,
        source=expense,
        amount=payload.amount,
        date=payload.date,
        note=payload.note,
        account_id=pay_id,
        counter_account_id=receive_id,
        category=expense.get("category", ""),
        sub_category=expense.get("sub_category", ""),
        settles_expense_id=None,
    )

    async def write(session):
        await check_settlement(
            db,
            expense_id=payload.expense_id,
            amount=payload.amount,
            currency=currency,
            owner_ids=await _ledger_owners(db, user, inflow),
            account_type=AccountType(inflow),
            shared_group_id=user.shared_group_id,
            lock=True,
            session=session,
        )
        income_id = (await db[COLLECTION].insert_one(income, session=session)).inserted_id
        payment_id = (
            await db[COLLECTION].insert_one(payment, session=session)
        ).inserted_id
        await db[COLLECTION].update_one(
            {"_id": income_id},
            {"$set": {"linked_transaction_id": str(payment_id)}},
            session=session,
        )
        await db[COLLECTION].update_one(
            {"_id": payment_id},
            {"$set": {"linked_transaction_id": str(income_id)}},
            session=session,
        )
        return income_id

    created_id = await db_transactions.run_in_transaction(db, write)
    return await db[COLLECTION].find_one({"_id": created_id})


async def _load_pair(
    db: AsyncIOMotorDatabase, user: UserOut, doc: dict
) -> tuple[dict, dict]:
    """(income, expense) of a settlement pair, checked before any change."""
    if doc.get("owner_id") != user.id:
        _reject(
            "정산을 입력한 사람만 수정하거나 삭제할 수 있습니다.",
            status.HTTP_403_FORBIDDEN,
        )
    linked_id = doc.get("linked_transaction_id")
    twin = None
    if isinstance(linked_id, str) and ObjectId.is_valid(linked_id):
        twin = await db[COLLECTION].find_one({"_id": ObjectId(linked_id)})
    if (
        twin is None
        or twin.get("linked_transaction_id") != str(doc["_id"])
        or not is_settlement_pair(twin)
        or twin.get("owner_id") != doc["owner_id"]
        or {doc.get("type"), twin.get("type")}
        != {TransactionType.INCOME.value, TransactionType.EXPENSE.value}
    ):
        _reject("Invalid transaction link.", status.HTTP_409_CONFLICT)
    if doc["type"] == TransactionType.INCOME.value:
        return doc, twin
    return twin, doc


async def update(
    db: AsyncIOMotorDatabase,
    user: UserOut,
    existing: dict,
    payload: TransactionCreate,
) -> dict:
    """Change amount, date and note on both entries; the rest stays linked."""
    income, expense = await _load_pair(db, user, existing)
    if payload.amount <= 0:
        _reject("정산 금액은 0보다 커야 합니다.")
    inflow = income["account_type"]

    async def write(session):
        await check_settlement(
            db,
            expense_id=income["settles_expense_id"],
            amount=payload.amount,
            currency=income["currency"],
            owner_ids=await _ledger_owners(db, user, inflow),
            account_type=AccountType(inflow),
            shared_group_id=user.shared_group_id,
            exclude_settlement_id=str(income["_id"]),
            lock=True,
            session=session,
        )
        await db[COLLECTION].update_many(
            {"_id": {"$in": [income["_id"], expense["_id"]]}},
            {
                "$set": {
                    "amount": float(payload.amount),
                    "date": payload.date,
                    "note": payload.note,
                }
            },
            session=session,
        )

    await db_transactions.run_in_transaction(db, write)
    return await db[COLLECTION].find_one({"_id": existing["_id"]})


async def delete(db: AsyncIOMotorDatabase, user: UserOut, existing: dict) -> None:
    """Delete both entries; the settled expense grows back its remaining amount."""
    income, expense = await _load_pair(db, user, existing)

    async def write(session):
        await db[COLLECTION].delete_many(
            {"_id": {"$in": [income["_id"], expense["_id"]]}}, session=session
        )

    await db_transactions.run_in_transaction(db, write)
