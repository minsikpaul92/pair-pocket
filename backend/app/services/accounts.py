"""Account balance derivation from opening_balance + ledger movements."""

import asyncio

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
        "country": doc.get("country"),
        "opening_balance": doc.get("opening_balance", 0.0),
        "is_liability": doc.get("is_liability", False),
        "is_default_expense": doc.get("is_default_expense", False),
        "is_default_income": doc.get("is_default_income", False),
        "is_default_credit": doc.get("is_default_credit", False),
        "is_default_investment": doc.get("is_default_investment", False),
        "is_active": doc.get("is_active", True),
        "institution": doc.get("institution"),
        "last_four": doc.get("last_four"),
        "account_number": doc.get("account_number"),
        "created_at": doc["created_at"],
        "updated_at": doc["updated_at"],
    }


async def _ledger_start_date_for_owners(
    db: AsyncIOMotorDatabase, owner_ids: list[str]
) -> str | None:
    """Use the earliest personal ledger_start_date among owners when present."""
    if not owner_ids:
        return None
    cursor = db["user_settings"].find(
        {"owner_id": {"$in": owner_ids}, "ledger_start_date": {"$type": "string"}},
        {"ledger_start_date": 1},
    )
    dates: list[str] = []
    async for doc in cursor:
        value = doc.get("ledger_start_date")
        if isinstance(value, str) and len(value) >= 10:
            dates.append(value[:10])
    return min(dates) if dates else None


async def compute_account_balance(
    db: AsyncIOMotorDatabase,
    *,
    account_doc: dict,
    owner_id: str | None = None,
    owner_ids: list[str] | None = None,
    ledger_start_date: str | None = None,
) -> float:
    """Derive running balance for one financial account.

    Live balance = opening_balance + transactions on/after ledger_start_date
    (when configured). Pre-start transactions remain in history but do not
    affect the live balance.

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
    ids = owner_ids if owner_ids is not None else ([owner_id] if owner_id else [])
    if not ids:
        return balance
    owner_clause: dict = (
        {"owner_id": ids[0]} if len(ids) == 1 else {"owner_id": {"$in": ids}}
    )

    start = ledger_start_date
    if start is None:
        start = await _ledger_start_date_for_owners(db, ids)

    query: dict = {
        **owner_clause,
        "$or": [
            {"account_id": account_id},
            {"counter_account_id": account_id},
        ],
    }
    if start:
        query["date"] = {"$gte": start}

    cursor = db[TX_COL].find(query)

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
    owner_id: str | None = None,
    owner_ids: list[str] | None = None,
    account_type: AccountType,
    currency: Currency | None = None,
) -> NetWorthSummary:
    """Aggregate per-account balances into net worth."""
    ids = owner_ids if owner_ids is not None else ([owner_id] if owner_id else [])
    if not ids:
        return NetWorthSummary(
            account_type=account_type,
            currency=currency,
            total_assets=0.0,
            total_liabilities=0.0,
            net_worth=0.0,
            accounts=[],
        )
    owner_clause: dict = (
        {"owner_id": ids[0]} if len(ids) == 1 else {"owner_id": {"$in": ids}}
    )
    query: dict = {
        **owner_clause,
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
            db, account_doc=doc, owner_ids=ids
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

    # Calculate stock holdings valuation (once per account currency bucket).
    # When currency is filtered, only include holdings on accounts in that currency
    # so CAD + KRW dashboard totals do not double-count the same portfolio.
    holdings_query: dict = {
        "owner_id": {"$in": ids},
        "account_type": account_type.value,
    }
    account_ids = {str(d["_id"]) for d in docs}
    if currency is not None:
        holdings_query["account_id"] = {"$in": list(account_ids)}

    holdings_cursor = db.holdings.find(holdings_query)
    holdings_docs = await holdings_cursor.to_list(length=None)

    if holdings_docs:
        from app.services.exchange import get_cad_krw_rate
        from app.services.stocks import get_or_update_stock_price
        
        rates_info = await get_cad_krw_rate()
        cad_krw = rates_info["cad_krw"]
        krw_cad = rates_info["krw_cad"]
        usd_krw = rates_info["usd_krw"]
        usd_cad = rates_info["usd_cad"]

        target_currency = currency if currency else Currency.CAD
        stocks_valuation_total = 0.0

        price_infos = await asyncio.gather(
            *[get_or_update_stock_price(db, h["ticker"]) for h in holdings_docs]
        )

        for h, price_info in zip(holdings_docs, price_infos):
            # Prefer holding's stored currency (CAD CDR / KR listing) over Yahoo.
            price = (
                price_info.get("price", h["avg_price"]) if price_info else h["avg_price"]
            )
            stock_curr = h.get("currency") or (
                price_info.get("currency") if price_info else "USD"
            )
            shares = h["shares"]
            valuation_native = shares * price

            val_converted = valuation_native
            if stock_curr != target_currency.value:
                if target_currency == Currency.KRW:
                    if stock_curr == "CAD":
                        val_converted = valuation_native * cad_krw
                    elif stock_curr == "USD":
                        val_converted = valuation_native * usd_krw
                elif target_currency == Currency.CAD:
                    if stock_curr == "KRW":
                        val_converted = valuation_native * krw_cad
                    elif stock_curr == "USD":
                        val_converted = valuation_native * usd_cad
                elif target_currency == Currency.USD:
                    if stock_curr == "KRW":
                        val_converted = valuation_native * (rates_info.get("krw_usd") or (1 / usd_krw))
                    elif stock_curr == "CAD":
                        val_converted = valuation_native * (rates_info.get("cad_usd") or (1 / usd_cad))

            stocks_valuation_total += val_converted

        if stocks_valuation_total > 0:
            total_assets += stocks_valuation_total
            accounts.append(
                AccountBalanceOut(
                    account_id=f"virtual_stocks_{target_currency.value.lower()}",
                    name="주식 자산",
                    nickname="보유 주식 평가금",
                    kind=FinancialAccountKind.INVESTMENT,
                    currency=target_currency,
                    account_type=account_type,
                    is_liability=False,
                    balance=stocks_valuation_total,
                    net_worth_contribution=stocks_valuation_total,
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
