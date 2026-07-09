"""Fixed category hierarchy presets for PairPocket.

Level 1: category (대분류)
Level 2: sub_category (중분류)
Level 3: merchant (상세 사용처) — stored on each transaction, not preset.
"""

from pydantic import BaseModel

from app.models.transaction import TransactionType


# --- Special category / sub-category identifiers for stats logic ---

from app.models.ledger import (
    TRANSFER_CATEGORY,
    TRANSFER_CATEGORY_LEGACY,
    TRANSFER_SUB_ACCOUNT_TRANSFER,
    TRANSFER_SUB_CARD_REPAYMENT,
    TRANSFER_SUB_INVESTMENT_FUNDING,
)

EXPENSE_CATEGORY_INVESTMENT = "투자/저축"
INCOME_CATEGORY_SETTLEMENT = "정산"
SUB_CATEGORY_SETTLEMENT = "N빵 정산/환급"


EXPENSE_PRESETS: dict[str, list[str]] = {
    "식비": ["식재료/장보기", "외식/배달", "카페/간식"],
    "주거/통신": ["월세/모기지", "관리비/공과금", "통신비", "가정 정비"],
    "교통/차량": ["대중교통", "택시/우버", "유류비/충전", "차량 유지"],
    "생활/쇼핑": ["생필품", "의류/잡화", "미용/뷰티", "반려동물"],
    "건강/의료": ["병원/약국", "운동/헬스", "영양제"],
    "문화/취미": ["문화 생활", "취미/엔터", "정기 구독", "여행/숙박"],
    "경조사/선물": ["경조사비", "선물/기념일", "모임/회비"],
    "투자/저축": ["주식 매수", "FHSA 납입", "TFSA 납입", "저축성 예금"],
    "세금": ["세금"],
    TRANSFER_CATEGORY: [
        TRANSFER_SUB_CARD_REPAYMENT,
        TRANSFER_SUB_ACCOUNT_TRANSFER,
        TRANSFER_SUB_INVESTMENT_FUNDING,
    ],
}

INCOME_PRESETS: dict[str, list[str]] = {
    "급여": ["급여", "주급(Bi-weekly)"],
    "부수입": ["파트타임", "부업", "중고거래", "팁(Tip)"],
    "정산": ["N빵 정산/환급"],
    "금융/기타": [
        "주식 판매수익",
        "투자 배당금",
        "은행 이자",
        "정부 환급금(HST/Tax Refund)",
    ],
}

PRESETS_BY_TYPE: dict[TransactionType, dict[str, list[str]]] = {
    TransactionType.EXPENSE: EXPENSE_PRESETS,
    TransactionType.INCOME: INCOME_PRESETS,
}


class CategoryGroup(BaseModel):
    """A level-1 category with its level-2 sub-categories."""

    category: str
    sub_categories: list[str]


class CategoryPresetsOut(BaseModel):
    expense: list[CategoryGroup]
    income: list[CategoryGroup]


def build_presets_response() -> CategoryPresetsOut:
    return CategoryPresetsOut(
        expense=[
            CategoryGroup(category=cat, sub_categories=subs)
            for cat, subs in EXPENSE_PRESETS.items()
        ],
        income=[
            CategoryGroup(category=cat, sub_categories=subs)
            for cat, subs in INCOME_PRESETS.items()
        ],
    )


def get_sub_categories(
    tx_type: TransactionType, category: str
) -> list[str] | None:
    """Return sub-categories for a category, or None if category is unknown."""
    presets = PRESETS_BY_TYPE.get(tx_type, {})
    return presets.get(category)


def is_valid_pair(tx_type: TransactionType, category: str, sub_category: str) -> bool:
    subs = get_sub_categories(tx_type, category)
    return subs is not None and sub_category in subs


def requires_institution(category: str) -> bool:
    return category == EXPENSE_CATEGORY_INVESTMENT


def is_settlement_income(category: str, sub_category: str) -> bool:
    return (
        category == INCOME_CATEGORY_SETTLEMENT
        and sub_category == SUB_CATEGORY_SETTLEMENT
    )


def is_investment_expense(category: str) -> bool:
    return category == EXPENSE_CATEGORY_INVESTMENT


def is_transfer_expense(category: str) -> bool:
    return category in (TRANSFER_CATEGORY, TRANSFER_CATEGORY_LEGACY)


def is_card_repayment(category: str, sub_category: str) -> bool:
    return (
        category in (TRANSFER_CATEGORY, TRANSFER_CATEGORY_LEGACY)
        and sub_category == TRANSFER_SUB_CARD_REPAYMENT
    )


def requires_settlement_link(
    tx_type: TransactionType, category: str, sub_category: str
) -> bool:
    return (
        tx_type == TransactionType.INCOME
        and is_settlement_income(category, sub_category)
    )
