"""Ledger-level enums shared across transactions, accounts, and subscriptions."""

from enum import Enum


class TransactionKind(str, Enum):
    """Distinguishes normal cashflow from internal asset moves."""

    NORMAL = "normal"
    TRANSFER = "transfer"  # 자산 이동/카드 — excluded from expense/income stats


# Category constants for transfers (also added to category presets).
TRANSFER_CATEGORY = "자산 이동/카드"
TRANSFER_CATEGORY_LEGACY = "자산 이동"
TRANSFER_SUB_CARD_REPAYMENT = "카드 대금 상환"
TRANSFER_SUB_ACCOUNT_TRANSFER = "계좌 이체"
TRANSFER_SUB_INVESTMENT_FUNDING = "투자 계좌 입금"


def normalize_transfer_category(category: str) -> str:
    """Map legacy transfer category name to the current preset label."""
    if category == TRANSFER_CATEGORY_LEGACY:
        return TRANSFER_CATEGORY
    return category
