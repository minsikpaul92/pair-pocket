import datetime
from bson import ObjectId
import httpx
from app.models.holding import StockHolding
from app.models.transaction import AccountType, Currency


async def sync_holding_from_transactions(db, owner_id: str, account_id: str, ticker: str):
    """
    Recalculates stock holding (shares, avg_price) from transactions for a given account and ticker,
    and upserts/deletes the StockHolding document.
    """
    # 1. Query all transactions for this owner, account, and ticker that are stock trades
    cursor = db.transactions.find({
        "owner_id": owner_id,
        "account_id": account_id,
        "ticker": ticker,
        "is_stock_trade": True
    })
    transactions = await cursor.to_list(length=None)
    
    if not transactions:
        # If no transactions exist, delete the holding
        await db.holdings.delete_many({
            "owner_id": owner_id,
            "account_id": account_id,
            "ticker": ticker
        })
        return

    # Sort by date to process chronologically
    transactions.sort(key=lambda x: x["date"])

    total_shares = 0.0
    avg_price = 0.0
    
    # Fetch account detail to know the account_type
    account = await db.accounts.find_one({"_id": ObjectId(account_id)})
    if not account:
        return
        
    account_type = account.get("account_type", "personal")
    
    # Resolve native stock details to fill holding
    price_info = await get_or_update_stock_price(db, ticker)
    stock_name = price_info.get("name", ticker) if price_info else ticker
    stock_currency = price_info.get("currency", "USD") if price_info else "USD"

    # Support standard Currency enum validation
    try:
        validated_currency = Currency(stock_currency)
    except ValueError:
        # Fallback if currency is USD but not in enum (KRW/CAD).
        # We represent US stocks as USD, but standard Currency in PairPocket is KRW/CAD.
        # Wait, if native stock currency is USD, we keep it as USD string or map to CAD.
        # Actually, let's allow "USD" in Currency or map it directly.
        # Since we only defined Currency as KRW/CAD in backend, we should map it to "USD" if possible,
        # or we can add USD to Currency enum!
        validated_currency = Currency.CAD # fallback

    for tx in transactions:
        shares = tx.get("shares") or 0.0
        price = tx.get("price") or 0.0
        fee = tx.get("fee") or 0.0
        trade_type = tx.get("trade_type") or "buy"

        if trade_type == "buy":
            new_shares = total_shares + shares
            if new_shares > 0:
                avg_price = ((total_shares * avg_price) + (shares * price) + fee) / new_shares
            total_shares = new_shares
        elif trade_type == "sell":
            total_shares = max(0.0, total_shares - shares)
            if total_shares == 0:
                avg_price = 0.0
    
    if total_shares > 0:
        await db.holdings.update_one(
            {
                "owner_id": owner_id,
                "account_id": account_id,
                "ticker": ticker
            },
            {
                "$set": {
                    "account_type": account_type,
                    "name": stock_name,
                    "avg_price": avg_price,
                    "shares": total_shares,
                    "currency": stock_currency, # Raw string to support USD/KRW/CAD
                    "updated_at": datetime.datetime.utcnow()
                }
            },
            upsert=True
        )
    else:
        await db.holdings.delete_one({
            "owner_id": owner_id,
            "account_id": account_id,
            "ticker": ticker
        })


async def get_or_update_stock_price(db, ticker: str, force_refresh: bool = False) -> dict | None:
    """
    Returns the cached stock price. If cache is expired (> 2 hours) or missing,
    fetches live price from Yahoo Finance and updates cache.
    """
    now = datetime.datetime.utcnow()
    cached = await db.stock_prices.find_one({"_id": ticker})
    
    if cached and not force_refresh:
        updated_at = cached.get("updated_at")
        if updated_at and (now - updated_at).total_seconds() < 7200: # 2 hours
            return cached
            
    # Fetch from Yahoo Finance
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                return cached
            data = resp.json()
            
            result = data.get("chart", {}).get("result", [])
            if not result:
                return cached
                
            meta = result[0].get("meta", {})
            symbol = meta.get("symbol", ticker)
            price = meta.get("regularMarketPrice")
            prev_close = meta.get("previousClose") or price
            currency = meta.get("currency", "USD")
            
            name = meta.get("shortName") or meta.get("longName") or symbol
            
            if price is None:
                return cached
                
            doc = {
                "_id": ticker,
                "ticker": ticker,
                "price": float(price),
                "prev_close": float(prev_close),
                "currency": currency,
                "name": name,
                "updated_at": now
            }
            
            await db.stock_prices.update_one(
                {"_id": ticker},
                {"$set": doc},
                upsert=True
            )
            return doc
    except Exception as e:
        print(f"Error fetching stock price for {ticker}: {e}")
        return cached


KOREAN_STOCK_MAP = {
    "삼성전자": "Samsung Electronics",
    "삼성": "Samsung",
    "애플": "Apple",
    "테슬라": "Tesla",
    "엔비디아": "Nvidia",
    "엔비": "Nvidia",
    "구글": "Alphabet",
    "알파벳": "Alphabet",
    "마이크로소프트": "Microsoft",
    "마소": "Microsoft",
    "아마존": "Amazon",
    "메타": "Meta",
    "페이스북": "Meta",
    "넷플릭스": "Netflix",
    "코카콜라": "Coca-Cola",
    "스타벅스": "Starbucks",
    "디즈니": "Disney",
    "현대차": "Hyundai Motor",
    "현대자동차": "Hyundai Motor",
    "에코프로": "Ecopro",
    "에코프로비엠": "Ecopro BM",
    "카카오": "Kakao",
    "네이버": "NAVER",
}


def contains_hangul(text: str) -> bool:
    for char in text:
        if 0xac00 <= ord(char) <= 0xd7a3 or 0x3130 <= ord(char) <= 0x318f:
            return True
    return False


async def search_tickers_yfinance(query: str) -> list[dict]:
    """
    Queries Yahoo Finance search endpoint to autocomplete stocks.
    Supports Korean & English.
    """
    if not query or len(query.strip()) < 1:
        return []
        
    q = query.strip()
    if contains_hangul(q):
        for ko, en in KOREAN_STOCK_MAP.items():
            if ko in q:
                q = q.replace(ko, en)
        if contains_hangul(q):
            return []

    url = "https://query1.finance.yahoo.com/v1/finance/search"
    params = {
        "q": q,
        "quotesCount": 10,
        "newsCount": 0
    }
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code != 200:
                return []
            data = resp.json()
            quotes = data.get("quotes", [])
            
            results = []
            for q in quotes:
                quote_type = q.get("quoteType")
                if quote_type not in ["EQUITY", "ETF"]:
                    continue
                    
                symbol = q.get("symbol")
                name = q.get("longname") or q.get("shortname") or symbol
                exchange = q.get("exchange")
                
                results.append({
                    "ticker": symbol,
                    "name": name,
                    "exchange": exchange,
                    "quote_type": quote_type
                })
            return results
    except Exception as e:
        print(f"Error searching tickers: {e}")
        return []
