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
    TRANSFER_SUB_ETRANSFER,
    TRANSFER_SUB_INVESTMENT_FUNDING,
    TRANSFER_SUB_SHARED_FUNDING,
    is_cashflow_transfer_sub,
    is_internal_transfer_sub,
    is_shared_funding_sub,
    normalize_transfer_category,
    normalize_transfer_sub_category,
)

EXPENSE_CATEGORY_INVESTMENT = "투자/저축"
INCOME_CATEGORY_SETTLEMENT = "정산"
SUB_CATEGORY_SETTLEMENT = "N빵 정산/환급"


EXPENSE_PRESETS: dict[str, list[str]] = {
    "식비": ["식재료/장보기", "외식/배달", "카페/간식"],
    "주거/통신": [
        "월세/모기지",
        "관리비/공과금",
        "통신비",
        "인터넷",
        "휴대폰",
        "가정 정비",
    ],
    "교통/차량": ["대중교통", "택시/우버", "유류비/충전", "차량 유지"],
    "생활/쇼핑": ["생필품", "의류/잡화", "미용/뷰티", "반려동물"],
    "건강/의료": ["병원/약국", "운동/헬스", "영양제"],
    "문화/취미": ["문화 생활", "취미/엔터", "정기 구독", "학원/교육", "여행/숙박"],
    "경조사/선물": ["경조사비", "선물/기념일", "모임/회비"],
    "투자/저축": ["주식 매수", "FHSA 납입", "TFSA 납입", "저축성 예금"],
    "세금": ["세금"],
    TRANSFER_CATEGORY: [
        TRANSFER_SUB_CARD_REPAYMENT,
        TRANSFER_SUB_ACCOUNT_TRANSFER,
        TRANSFER_SUB_INVESTMENT_FUNDING,
        TRANSFER_SUB_SHARED_FUNDING,
        TRANSFER_SUB_ETRANSFER,
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
    # Mirror of personal→shared funding (server-created income twin).
    TRANSFER_CATEGORY: [TRANSFER_SUB_SHARED_FUNDING],
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
    cat = normalize_transfer_category(category)
    return presets.get(cat)


def is_valid_pair(tx_type: TransactionType, category: str, sub_category: str) -> bool:
    cat = normalize_transfer_category(category)
    sub = normalize_transfer_sub_category(sub_category)
    # Accept legacy internal-transfer sub name as valid for expense presets.
    if (
        tx_type == TransactionType.EXPENSE
        and cat == TRANSFER_CATEGORY
        and sub == TRANSFER_SUB_ACCOUNT_TRANSFER
    ):
        return True
    subs = get_sub_categories(tx_type, cat)
    return subs is not None and sub in subs


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
    return normalize_transfer_category(category) in (
        TRANSFER_CATEGORY,
        TRANSFER_CATEGORY_LEGACY,
    )


def is_internal_asset_move(category: str, sub_category: str) -> bool:
    """Balance-only moves under 자산 이동/카드 (excluded from cashflow stats)."""
    return is_transfer_expense(category) and is_internal_transfer_sub(sub_category)


def is_non_cashflow_transfer(category: str, sub_category: str = "") -> bool:
    """True for internal asset moves; false for e-Transfer / shared funding."""
    if not is_transfer_expense(category):
        return False
    if not sub_category:
        # Legacy rows without a known cashflow sub — treat as non-cashflow.
        return True
    return not is_cashflow_transfer_sub(sub_category)


def is_card_repayment(category: str, sub_category: str) -> bool:
    return (
        is_transfer_expense(category)
        and normalize_transfer_sub_category(sub_category)
        == TRANSFER_SUB_CARD_REPAYMENT
    )


def requires_settlement_link(
    tx_type: TransactionType, category: str, sub_category: str
) -> bool:
    return (
        tx_type == TransactionType.INCOME
        and is_settlement_income(category, sub_category)
    )


# Re-export helpers used by routers/services.
__all__ = [
    "EXPENSE_CATEGORY_INVESTMENT",
    "INCOME_CATEGORY_SETTLEMENT",
    "SUB_CATEGORY_SETTLEMENT",
    "EXPENSE_PRESETS",
    "INCOME_PRESETS",
    "CategoryGroup",
    "CategoryPresetsOut",
    "build_presets_response",
    "get_sub_categories",
    "is_valid_pair",
    "requires_institution",
    "is_settlement_income",
    "is_investment_expense",
    "is_transfer_expense",
    "is_internal_asset_move",
    "is_non_cashflow_transfer",
    "is_card_repayment",
    "requires_settlement_link",
    "is_cashflow_transfer_sub",
    "is_shared_funding_sub",
    "normalize_transfer_category",
    "normalize_transfer_sub_category",
]
