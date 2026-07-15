from datetime import datetime
from pydantic import BaseModel, Field
from app.models.transaction import AccountType, Currency


class StockHolding(BaseModel):
    owner_id: str
    account_id: str           # Linked FinancialAccount ID
    account_type: AccountType # "personal" | "shared"
    ticker: str               # e.g., "AAPL", "005930.KS", "VSP.TO"
    name: str                 # e.g., "알파벳 A", "삼성전자"
    avg_price: float          # Average purchase price in native currency
    shares: float             # Total shares held
    currency: Currency        # Native currency of the stock (e.g., "USD", "KRW", "CAD")
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class StockHoldingOut(StockHolding):
    id: str


class StockHoldingCreate(BaseModel):
    account_id: str
    ticker: str
    name: str
    avg_price: float = Field(ge=0)
    shares: float = Field(gt=0)
    currency: Currency


class StockHoldingUpdate(BaseModel):
    avg_price: float | None = None
    shares: float | None = None


class StockPriceCache(BaseModel):
    ticker: str
    price: float              # Latest market price in native currency
    prev_close: float         # Previous day's close price in native currency
    currency: str             # Asset currency (e.g., "USD", "KRW", "CAD")
    name: str                 # Stock display name
    updated_at: datetime = Field(default_factory=datetime.utcnow)
