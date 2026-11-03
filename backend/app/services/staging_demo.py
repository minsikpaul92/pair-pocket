"""Demo data for the test accounts: the "demo" reset preset.

Both couples get the same believable month: named accounts, two brokerages
with holdings, income, spending across categories, fixed bills and a dinner
paid from a personal card that is waiting to be settled. Tester 1+2 get Korean
names and Tester 3+4 English ones. Entries go through the same router code as
the app, so they pass the same validation and update defaults and balances.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime
from math import ceil

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.account import AccountCountry, FinancialAccountKind
from app.models.ledger import (
    TRANSFER_CATEGORY,
    TRANSFER_SUB_ACCOUNT_TRANSFER,
    TRANSFER_SUB_SHARED_FUNDING,
)
from app.models.transaction import AccountType, Currency, TransactionType
from app.models.user import UserOut

CHECKING = FinancialAccountKind.CHECKING
CARD = FinancialAccountKind.CREDIT_CARD
SAVINGS = FinancialAccountKind.SAVINGS
INVESTMENT = FinancialAccountKind.INVESTMENT
EXPENSE = TransactionType.EXPENSE
INCOME = TransactionType.INCOME

# Accounts: (key, owner, kind, currency, country, institution, opening balance,
# name in English, name in Korean). Owner "a" and "b" are the two partners;
# "shared" is the couple's shared ledger. Credit cards start with nothing owed.
DEMO_ACCOUNTS = (
    ("a_chequing", "a", CHECKING, "CAD", "CA", "TD", 4250.0, "TD Chequing", "TD 입출금"),
    ("a_visa", "a", CARD, "CAD", "CA", "TD", 0.0, "TD Visa", "TD 비자카드"),
    ("a_savings", "a", SAVINGS, "CAD", "CA", "TD", 12000.0, "TD Savings", "TD 저축"),
    ("b_chequing", "b", CHECKING, "CAD", "CA", "RBC", 2980.0, "RBC Chequing", "RBC 입출금"),
    ("b_visa", "b", CARD, "CAD", "CA", "RBC", 0.0, "RBC Visa", "RBC 비자카드"),
    ("b_savings", "b", SAVINGS, "CAD", "CA", "RBC", 8500.0, "RBC Savings", "RBC 저축"),
    (
        "shared_chequing",
        "shared",
        CHECKING,
        "CAD",
        "CA",
        "Tangerine",
        1200.0,
        "Tangerine Joint Chequing",
        "Tangerine 공동 통장",
    ),
    (
        "a_wealthsimple",
        "a",
        INVESTMENT,
        "CAD",
        "CA",
        "Wealthsimple",
        850.0,
        "Wealthsimple TFSA",
        "Wealthsimple TFSA",
    ),
    ("a_kiwoom", "a", INVESTMENT, "KRW", "KR", "Kiwoom", 320000.0, "Kiwoom Securities", "키움증권"),
)

# Holdings: (account key, ticker, shares, average price, name in English,
# name in Korean). Prices are in the brokerage's currency. Average costs sit
# about 15% under November 2026 prices (NAVER a little above), so returns look
# like a real portfolio's; revisit them if prices move far.
DEMO_HOLDINGS = (
    ("a_wealthsimple", "SHOP.TO", 15, 172.0, "Shopify", "쇼피파이"),
    ("a_wealthsimple", "RY.TO", 20, 248.0, "Royal Bank of Canada", "캐나다 왕립은행"),
    (
        "a_wealthsimple",
        "XEQT.TO",
        100,
        39.8,
        "iShares Core Equity ETF Portfolio",
        "iShares 코어 주식 ETF",
    ),
    ("a_kiwoom", "005930.KS", 20, 182000.0, "Samsung Electronics", "삼성전자"),
    ("a_kiwoom", "000660.KS", 5, 1180000.0, "SK hynix", "SK하이닉스"),
    ("a_kiwoom", "035420.KS", 4, 185000.0, "NAVER", "네이버"),
)

# The expense the settlement demo settles: paid in full from a personal card.
DINNER_MERCHANT = {"en": "Dinner with friends", "ko": "친구들과 저녁 식사"}

# Entries: (entered by, account key, day, type, category, sub-category,
# amount in CAD, merchant in English, merchant in Korean). Days are laid out
# over a 28-day month and squeezed into the days passed so far (_passed).
# Entries on the shared account are in the shared ledger.
DEMO_ENTRIES = (
    ("a", "a_chequing", 1, INCOME, "급여", "급여", 3400.0, "Northwind Payroll", "노스윈드 급여"),
    ("b", "b_chequing", 1, INCOME, "급여", "급여", 2900.0, "Lakeside Clinic Payroll", "레이크사이드 클리닉 급여"),
    ("b", "b_chequing", 9, INCOME, "부수입", "부업", 350.0, "Freelance design", "프리랜서 디자인"),
    ("a", "a_savings", 2, INCOME, "금융/기타", "은행 이자", 18.42, "Savings interest", "예금 이자"),
    ("a", "a_visa", 2, EXPENSE, "식비", "카페/간식", 6.45, "Tim Hortons", "팀홀튼"),
    ("a", "a_visa", 4, EXPENSE, "교통/차량", "대중교통", 50.0, "PRESTO", "프레스토 충전"),
    ("a", "a_visa", 11, EXPENSE, "생활/쇼핑", "의류/잡화", 59.9, "Uniqlo", "유니클로"),
    ("a", "a_chequing", 13, EXPENSE, "건강/의료", "운동/헬스", 45.0, "GoodLife Fitness", "굿라이프 피트니스"),
    ("a", "a_visa", 16, EXPENSE, "식비", "카페/간식", 7.85, "Starbucks", "스타벅스"),
    ("a", "a_visa", 19, EXPENSE, "식비", "외식/배달", 100.0, *DINNER_MERCHANT.values()),
    ("b", "b_visa", 5, EXPENSE, "식비", "외식/배달", 32.4, "Uber Eats", "우버이츠"),
    ("b", "b_visa", 7, EXPENSE, "생활/쇼핑", "미용/뷰티", 48.0, "Sephora", "세포라"),
    ("b", "b_visa", 12, EXPENSE, "교통/차량", "택시/우버", 18.75, "Uber", "우버"),
    ("b", "b_visa", 15, EXPENSE, "문화/취미", "문화 생활", 28.0, "Cineplex", "시네플렉스"),
    ("b", "b_visa", 22, EXPENSE, "건강/의료", "병원/약국", 23.6, "Shoppers Drug Mart", "쇼퍼스 드러그마트"),
    ("a", "shared_chequing", 3, EXPENSE, "식비", "식재료/장보기", 186.42, "Costco", "코스트코"),
    ("b", "shared_chequing", 6, EXPENSE, "주거/통신", "관리비/공과금", 96.3, "Toronto Hydro", "토론토 하이드로"),
    ("a", "shared_chequing", 8, EXPENSE, "주거/통신", "인터넷", 85.0, "Rogers Internet", "로저스 인터넷"),
    ("b", "shared_chequing", 10, EXPENSE, "식비", "식재료/장보기", 74.18, "No Frills", "H마트"),
    ("a", "shared_chequing", 17, EXPENSE, "식비", "식재료/장보기", 92.65, "T&T Supermarket", "T&T 슈퍼마켓"),
    ("b", "shared_chequing", 21, EXPENSE, "생활/쇼핑", "생필품", 43.5, "Canadian Tire", "캐네디언 타이어"),
    ("a", "shared_chequing", 24, EXPENSE, "식비", "외식/배달", 64.2, "The Keg", "북창동 순두부"),
)

# Moves between accounts: (entered by, from, to, day, sub-category, amount,
# merchant in English, merchant in Korean). Shared funding also adds the
# matching income to the shared ledger.
DEMO_TRANSFERS = (
    ("a", "a_chequing", "shared_chequing", 1, TRANSFER_SUB_SHARED_FUNDING, 1500.0, "Joint account deposit", "공동 통장 입금"),
    ("b", "b_chequing", "shared_chequing", 1, TRANSFER_SUB_SHARED_FUNDING, 1500.0, "Joint account deposit", "공동 통장 입금"),
    ("a", "a_chequing", "a_savings", 2, TRANSFER_SUB_ACCOUNT_TRANSFER, 500.0, "Monthly savings", "월 저축"),
)

# Monthly bills: (entered by, account key, day, category, sub-category, amount,
# fixed bill, name in English, name in Korean). Bills due by today are
# recorded right away; the rest show as upcoming.
DEMO_SUBSCRIPTIONS = (
    ("a", "shared_chequing", 1, "주거/통신", "월세/모기지", 2100.0, True, "Rent", "월세"),
    ("a", "a_visa", 12, "주거/통신", "휴대폰", 55.0, True, "Fido phone plan", "Fido 휴대폰 요금"),
    ("a", "a_visa", 18, "문화/취미", "정기 구독", 20.99, False, "Netflix", "넷플릭스"),
)


def _on(day: int) -> datetime:
    today = date.today()
    last = monthrange(today.year, today.month)[1]
    return datetime(today.year, today.month, min(day, last), 12)


def _passed(day: int) -> datetime:
    """A day from the 28-day layout, moved so it is never later than today:
    early in the month the entries share the days from the 1st to today."""
    today = date.today().day
    return _on(day if today >= 28 else max(1, ceil(day * today / 28)))


async def seed_couple(db: AsyncIOMotorDatabase, users: list[UserOut], locale: str) -> None:
    """Fill one linked couple's ledgers with the demo month in `locale`."""
    from app.models.account import AccountCreate
    from app.models.subscription import SubscriptionCreate
    from app.models.transaction import TransactionCreate
    from app.routers.accounts import create_account
    from app.routers.subscriptions import create_subscription
    from app.routers.transactions import create_transaction

    korean = locale == "ko"
    people = {"a": users[0], "b": users[1], "shared": users[0]}
    accounts: dict[str, dict] = {}
    for key, owner, kind, currency, country, institution, opening, en, ko in DEMO_ACCOUNTS:
        accounts[key] = await create_account(
            AccountCreate(
                name=ko if korean else en,
                kind=kind,
                currency=Currency(currency),
                country=AccountCountry(country),
                institution=institution,
                opening_balance=opening,
                account_type=(
                    AccountType.SHARED if owner == "shared" else AccountType.PERSONAL
                ),
            ),
            people[owner],
            db,
        )

    for key, ticker, shares, avg_price, en, ko in DEMO_HOLDINGS:
        account = accounts[key]
        # Inserted directly: adding through the router looks the ticker up online.
        await db["holdings"].insert_one(
            {
                "owner_id": account["owner_id"],
                "account_id": account["id"],
                "account_type": account["account_type"],
                "shared_group_id": account.get("shared_group_id"),
                "ticker": ticker,
                "name": ko if korean else en,
                "avg_price": avg_price,
                "shares": float(shares),
                "currency": account["currency"],
                "updated_at": datetime.utcnow(),
            }
        )

    def ledger(key: str) -> AccountType:
        return AccountType(accounts[key]["account_type"])

    for who, key, day, tx_type, category, sub, amount, en, ko in DEMO_ENTRIES:
        await create_transaction(
            TransactionCreate(
                date=_passed(day),
                amount=amount,
                currency=Currency.CAD,
                type=tx_type,
                account_type=ledger(key),
                category=category,
                sub_category=sub,
                merchant=ko if korean else en,
                account_id=accounts[key]["id"],
            ),
            people[who],
            db,
        )

    for who, source, target, day, sub, amount, en, ko in DEMO_TRANSFERS:
        await create_transaction(
            TransactionCreate(
                date=_passed(day),
                amount=amount,
                currency=Currency.CAD,
                type=EXPENSE,
                account_type=ledger(source),
                category=TRANSFER_CATEGORY,
                sub_category=sub,
                merchant=ko if korean else en,
                account_id=accounts[source]["id"],
                counter_account_id=accounts[target]["id"],
            ),
            people[who],
            db,
        )

    for who, key, day, category, sub, amount, fixed, en, ko in DEMO_SUBSCRIPTIONS:
        name = ko if korean else en
        await create_subscription(
            SubscriptionCreate(
                name=name,
                amount=amount,
                currency=Currency.CAD,
                account_type=ledger(key),
                start_date=_on(day),
                is_fixed_bill=fixed,
                account_id=accounts[key]["id"],
                category=category,
                sub_category=sub,
                merchant=name,
            ),
            people[who],
            db,
        )

    # Start with a quiet bell: the seeding itself is not partner activity.
    await db["notifications"].delete_many(
        {"recipient_id": {"$in": [user.id for user in users]}}
    )
