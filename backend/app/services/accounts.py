"""Account balance derivation from opening_balance + ledger movements."""

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.account import AccountBalanceOut, FinancialAccountKind, NetWorthSummary
from app.models.category_preset import is_card_repayment, is_transfer_expense
from app.models.ledger import TransactionKind
from app.models.transaction import AccountType, Currency, TransactionType

ACCOUNTS_COL = "accounts"
TX_COL = "transactions"


def _serialize_account(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "owner_id": doc["owner_id"],
        "name": doc["name"],
        "nickname": doc.get("nickname"),
        "kind": doc["kind"],
        "currency": doc["currency"],
        "account_type": doc["account_type"],
        "opening_balance": doc.get("opening_balance", 0.0),
        "is_liability": doc.get("is_liability", False),
        "is_default_expense": doc.get("is_default_expense", False),
        "is_default_income": doc.get("is_default_income", False),
        "is_active": doc.get("is_active", True),
        "institution": doc.get("institution"),
        "last_four": doc.get("last_four"),
        "account_number": doc.get("account_number"),
        "created_at": doc["created_at"],
        "updated_at": doc["updated_at"],
    }


async def compute_account_balance(
    db: AsyncIOMotorDatabase,
    *,
    account_doc: dict,
    owner_id: str,
) -> float:
    """Derive running balance for one financial account.

    Asset accounts (checking, savings):
      + income credited here
      - expenses debited here
      - transfer out (account_id)
      + transfer in (counter_account_id)

    Liability accounts (credit card):
      + card purchases (expense on this card)
      - card repayments (TRANSFER › 카드 대금 상환 with counter_account_id)
    """
    account_id = str(account_doc["_id"])
    is_liability = account_doc.get("is_liability", False)
    balance = float(account_doc.get("opening_balance", 0.0))

    cursor = db[TX_COL].find(
        {
            "owner_id": owner_id,
            "$or": [
                {"account_id": account_id},
                {"counter_account_id": account_id},
            ],
        }
    )

    async for tx in cursor:
        amount = float(tx["amount"])
        tx_type = tx.get("type")
        kind = tx.get("kind", TransactionKind.NORMAL.value)
        category = tx.get("category", "")
        sub_category = tx.get("sub_category", "")
        primary = tx.get("account_id") == account_id
        counter = tx.get("counter_account_id") == account_id

        if is_liability:
            # Credit card: purchases increase debt; repayments decrease debt.
            if (
                kind == TransactionKind.TRANSFER.value
                and is_card_repayment(category, sub_category)
                and counter
            ):
                balance -= amount
            elif tx_type == TransactionType.EXPENSE.value and primary:
                balance += amount
            continue

        # Asset account
        if kind == TransactionKind.TRANSFER.value or is_transfer_expense(category):
            if primary:
                balance -= amount
            elif counter:
                balance += amount
            continue

        if tx_type == TransactionType.INCOME.value and primary:
            balance += amount
        elif tx_type == TransactionType.EXPENSE.value and primary:
            balance -= amount

    return balance


async def compute_net_worth(
    db: AsyncIOMotorDatabase,
    *,
    owner_id: str,
    account_type: AccountType,
    currency: Currency | None = None,
) -> NetWorthSummary:
    """Aggregate per-account balances into net worth."""
    query: dict = {
        "owner_id": owner_id,
        "account_type": account_type.value,
        "is_active": True,
    }
    if currency is not None:
        query["currency"] = currency.value

    docs = await db[ACCOUNTS_COL].find(query).sort("name", 1).to_list(length=100)

    accounts: list[AccountBalanceOut] = []
    total_assets = 0.0
    total_liabilities = 0.0

    for doc in docs:
        balance = await compute_account_balance(
            db, account_doc=doc, owner_id=owner_id
        )
        is_liability = doc.get("is_liability", False)
        contribution = -balance if is_liability else balance

        if is_liability:
            total_liabilities += balance
        else:
            total_assets += balance

        accounts.append(
            AccountBalanceOut(
                account_id=str(doc["_id"]),
                name=doc["name"],
                nickname=doc.get("nickname"),
                kind=FinancialAccountKind(doc["kind"]),
                currency=Currency(doc["currency"]),
                account_type=AccountType(doc["account_type"]),
                is_liability=is_liability,
                balance=balance,
                net_worth_contribution=contribution,
            )
        )

    return NetWorthSummary(
        account_type=account_type,
        currency=currency,
        total_assets=total_assets,
        total_liabilities=total_liabilities,
        net_worth=total_assets - total_liabilities,
        accounts=accounts,
    )
