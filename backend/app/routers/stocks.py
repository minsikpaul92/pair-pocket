from datetime import datetime
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.security import get_current_user
from app.database import get_database
from app.models.holding import (
    StockHoldingCreate,
    StockHoldingUpdate,
)
from app.models.transaction import AccountType, Currency
from app.models.user import UserOut
from app.services.access import resolve_owner_ids, assert_can_access_doc
from app.services.accounts import compute_account_balance
from app.services.stocks import (
    get_or_update_stock_price,
    search_tickers_yfinance,
    sync_holding_from_transactions,
)
from app.services.exchange import get_cad_krw_rate

router = APIRouter(prefix="/api/stocks", tags=["stocks"])


@router.get("/search")
async def search_stocks(
    q: str = Query(..., min_length=1),
    _: UserOut = Depends(get_current_user),
) -> list[dict]:
    """Search stock tickers via Yahoo Finance (supports Korean and English)."""
    return await search_tickers_yfinance(q)


@router.get("/holdings")
async def get_holdings(
    account_type: AccountType = AccountType.PERSONAL,
    db: AsyncIOMotorDatabase = Depends(get_database),
    current_user: UserOut = Depends(get_current_user),
) -> list[dict]:
    """Get all stock holdings with current valuation and yield."""
    owner_ids = await resolve_owner_ids(db, current_user, account_type)
    
    cursor = db.holdings.find({
        "owner_id": {"$in": owner_ids},
        "account_type": account_type
    })
    holdings_docs = await cursor.to_list(length=None)
    
    holdings = []
    for h in holdings_docs:
        ticker = h["ticker"]
        price_info = await get_or_update_stock_price(db, ticker)
        
        price = price_info.get("price", h["avg_price"]) if price_info else h["avg_price"]
        prev_close = price_info.get("prev_close", price) if price_info else price
        currency = price_info.get("currency", h["currency"]) if price_info else h["currency"]
        
        shares = h["shares"]
        avg_price = h["avg_price"]
        
        invested = shares * avg_price
        valuation = shares * price
        profit = valuation - invested
        yield_percent = (profit / invested * 100) if invested > 0 else 0.0
        
        daily_change = price - prev_close
        daily_change_percent = (daily_change / prev_close * 100) if prev_close > 0 else 0.0
        
        # Look up account details (for institution name)
        account = await db.accounts.find_one({"_id": ObjectId(h["account_id"])})
        institution = account.get("institution") if account else "기타"
        account_name = account.get("name") if account else "기타 계좌"

        holdings.append({
            "id": str(h["_id"]),
            "account_id": h["account_id"],
            "account_name": account_name,
            "institution": institution,
            "ticker": ticker,
            "name": h["name"],
            "shares": shares,
            "avg_price": avg_price,
            "price": price,
            "prev_close": prev_close,
            "currency": currency,
            "invested": invested,
            "valuation": valuation,
            "profit": profit,
            "yield": yield_percent,
            "daily_change": daily_change,
            "daily_change_percent": daily_change_percent,
            "updated_at": h.get("updated_at", datetime.utcnow())
        })
        
    return holdings


@router.post("/holdings", status_code=status.HTTP_201_CREATED)
async def create_holding(
    payload: StockHoldingCreate,
    db: AsyncIOMotorDatabase = Depends(get_database),
    current_user: UserOut = Depends(get_current_user),
) -> dict:
    """Manually add a stock holding (initial setup)."""
    # Verify account exists and is investment kind
    account = await db.accounts.find_one({"_id": ObjectId(payload.account_id)})
    if not account:
        raise HTTPException(status_code=404, detail="Brokerage account not found")
    if account.get("kind") != "investment":
        raise HTTPException(status_code=400, detail="Account is not an investment account")
        
    # Check authorization
    await assert_can_access_doc(db, current_user, account)
    
    # Try fetching details from Yahoo Finance to normalize name & currency
    price_info = await get_or_update_stock_price(db, payload.ticker)
    name = price_info.get("name", payload.name) if price_info else payload.name
    currency = price_info.get("currency", payload.currency) if price_info else payload.currency

    holding_doc = {
        "owner_id": current_user.id,
        "account_id": payload.account_id,
        "account_type": account["account_type"],
        "ticker": payload.ticker.upper(),
        "name": name,
        "avg_price": payload.avg_price,
        "shares": payload.shares,
        "currency": currency,
        "updated_at": datetime.utcnow()
    }
    
    # Check if holding already exists for this account & ticker
    existing = await db.holdings.find_one({
        "owner_id": current_user.id,
        "account_id": payload.account_id,
        "ticker": payload.ticker.upper()
    })
    
    if existing:
        # Merge holdings
        new_shares = existing["shares"] + payload.shares
        new_avg_price = ((existing["shares"] * existing["avg_price"]) + (payload.shares * payload.avg_price)) / new_shares
        await db.holdings.update_one(
            {"_id": existing["_id"]},
            {"$set": {
                "shares": new_shares,
                "avg_price": new_avg_price,
                "updated_at": datetime.utcnow()
            }}
        )
        return {"status": "merged", "id": str(existing["_id"])}
        
    res = await db.holdings.insert_one(holding_doc)
    return {"status": "created", "id": str(res.inserted_id)}


@router.put("/holdings/{holding_id}")
async def update_holding(
    holding_id: str,
    payload: StockHoldingUpdate,
    db: AsyncIOMotorDatabase = Depends(get_database),
    current_user: UserOut = Depends(get_current_user),
) -> dict:
    """Manually update average price and/or shares of a holding."""
    holding = await db.holdings.find_one({"_id": ObjectId(holding_id)})
    if not holding:
        raise HTTPException(status_code=404, detail="Holding not found")
        
    # Verify ownership
    if holding["owner_id"] != current_user.id:
        # Check shared access
        owner_ids = await resolve_owner_ids(db, current_user, holding["account_type"])
        if holding["owner_id"] not in owner_ids:
            raise HTTPException(status_code=403, detail="Forbidden")

    update_fields = {}
    if payload.avg_price is not None:
        update_fields["avg_price"] = payload.avg_price
    if payload.shares is not None:
        update_fields["shares"] = payload.shares
        
    if not update_fields:
        return {"status": "noop"}
        
    update_fields["updated_at"] = datetime.utcnow()
    
    if payload.shares == 0:
        await db.holdings.delete_one({"_id": ObjectId(holding_id)})
        return {"status": "deleted"}

    await db.holdings.update_one(
        {"_id": ObjectId(holding_id)},
        {"$set": update_fields}
    )
    return {"status": "updated"}


@router.delete("/holdings/{holding_id}")
async def delete_holding(
    holding_id: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    current_user: UserOut = Depends(get_current_user),
) -> dict:
    """Manually delete a holding."""
    holding = await db.holdings.find_one({"_id": ObjectId(holding_id)})
    if not holding:
        raise HTTPException(status_code=404, detail="Holding not found")
        
    # Verify ownership
    if holding["owner_id"] != current_user.id:
        owner_ids = await resolve_owner_ids(db, current_user, holding["account_type"])
        if holding["owner_id"] not in owner_ids:
            raise HTTPException(status_code=403, detail="Forbidden")

    await db.holdings.delete_one({"_id": ObjectId(holding_id)})
    return {"status": "deleted"}


@router.get("/summary")
async def get_portfolio_summary(
    account_type: AccountType = AccountType.PERSONAL,
    display_currency: Currency = Currency.CAD,
    account_id: str | None = None,
    db: AsyncIOMotorDatabase = Depends(get_database),
    current_user: UserOut = Depends(get_current_user),
) -> dict:
    """Get portfolio aggregates and investment account cash balances."""
    owner_ids = await resolve_owner_ids(db, current_user, account_type)
    
    # 1. Calculate stock totals
    query = {
        "owner_id": {"$in": owner_ids},
        "account_type": account_type
    }
    if account_id:
        query["account_id"] = account_id

    cursor = db.holdings.find(query)
    holdings_docs = await cursor.to_list(length=None)
    
    rates_info = await get_cad_krw_rate()
    cad_krw = rates_info["cad_krw"]
    krw_cad = rates_info["krw_cad"]
    usd_krw = rates_info["usd_krw"]
    usd_cad = rates_info["usd_cad"]

    def convert_to_display(amount: float, from_curr: str) -> float:
        if from_curr == display_currency.value:
            return amount
        if display_currency == Currency.KRW:
            # Target KRW
            if from_curr == "CAD":
                return amount * cad_krw
            if from_curr == "USD":
                return amount * usd_krw
        elif display_currency == Currency.CAD:
            # Target CAD
            if from_curr == "KRW":
                return amount * krw_cad
            if from_curr == "USD":
                return amount * usd_cad
        # Fallback
        return amount

    total_invested = 0.0
    total_valuation = 0.0
    
    for h in holdings_docs:
        ticker = h["ticker"]
        price_info = await get_or_update_stock_price(db, ticker)
        
        price = price_info.get("price", h["avg_price"]) if price_info else h["avg_price"]
        currency = price_info.get("currency", h["currency"]) if price_info else h["currency"]
        
        shares = h["shares"]
        avg_price = h["avg_price"]
        
        invested_native = shares * avg_price
        valuation_native = shares * price
        
        total_invested += convert_to_display(invested_native, currency)
        total_valuation += convert_to_display(valuation_native, currency)

    total_profit = total_valuation - total_invested
    total_yield = (total_profit / total_invested * 100) if total_invested > 0 else 0.0

    # 2. Get Investment Cash Balances
    accounts_cursor = db.accounts.find({
        "owner_id": {"$in": owner_ids},
        "account_type": account_type,
        "kind": "investment",
        "is_active": True
    })
    investment_accounts = await accounts_cursor.to_list(length=None)
    
    cash_balances = []
    for acc in investment_accounts:
        bal = await compute_account_balance(db, account_doc=acc, owner_ids=owner_ids)
        cash_balances.append({
            "account_id": str(acc["_id"]),
            "name": acc["name"],
            "institution": acc.get("institution") or "기타",
            "balance": bal,
            "currency": acc["currency"]
        })

    return {
        "display_currency": display_currency,
        "total_invested": total_invested,
        "total_valuation": total_valuation,
        "total_profit": total_profit,
        "total_yield": total_yield,
        "cash_balances": cash_balances
    }


@router.post("/update-prices")
async def trigger_price_update(
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: UserOut = Depends(get_current_user), # Wait, should we secure this?
) -> dict:
    """Scheduler endpoint to trigger updates on all active tickers in DB."""
    # Find all unique tickers in holdings
    tickers = await db.holdings.distinct("ticker")
    updated = []
    for ticker in tickers:
        price = await get_or_update_stock_price(db, ticker, force_refresh=True)
        if price:
            updated.append(ticker)
            
    return {"status": "success", "count": len(updated), "updated": updated}
