"""Ledger-level enums shared across transactions, accounts, and subscriptions."""

from enum import Enum


class TransactionKind(str, Enum):
    """Distinguishes normal cashflow from internal asset moves."""

    NORMAL = "normal"
    TRANSFER = "transfer"  # Internal asset moves — excluded from expense/income stats


# Category constants for transfers (also added to category presets).
TRANSFER_CATEGORY = "자산 이동/카드"
TRANSFER_CATEGORY_LEGACY = "자산 이동"
TRANSFER_SUB_CARD_REPAYMENT = "카드 대금 상환"
TRANSFER_SUB_ACCOUNT_TRANSFER = "내 계좌 이동"
TRANSFER_SUB_ACCOUNT_TRANSFER_LEGACY = "계좌 이체"
TRANSFER_SUB_INVESTMENT_FUNDING = "투자 계좌 입금"
TRANSFER_SUB_SHARED_FUNDING = "공용 계좌 입금"
TRANSFER_SUB_ETRANSFER = "e-Transfer/계좌이체"

# Subs that stay under 자산 이동/카드 but count as real cashflow (kind=normal).
CASHFLOW_TRANSFER_SUBS = frozenset(
    {
        TRANSFER_SUB_SHARED_FUNDING,
        TRANSFER_SUB_ETRANSFER,
    }
)

# Internal balance-only moves (kind=transfer).
INTERNAL_TRANSFER_SUBS = frozenset(
    {
        TRANSFER_SUB_CARD_REPAYMENT,
        TRANSFER_SUB_ACCOUNT_TRANSFER,
        TRANSFER_SUB_ACCOUNT_TRANSFER_LEGACY,
        TRANSFER_SUB_INVESTMENT_FUNDING,
    }
)


def normalize_transfer_category(category: str) -> str:
    """Map legacy transfer category name to the current preset label."""
    if category == TRANSFER_CATEGORY_LEGACY:
        return TRANSFER_CATEGORY
    return category


def normalize_transfer_sub_category(sub_category: str) -> str:
    """Map legacy internal-transfer sub name to the current preset label."""
    if sub_category == TRANSFER_SUB_ACCOUNT_TRANSFER_LEGACY:
        return TRANSFER_SUB_ACCOUNT_TRANSFER
    return sub_category


def is_cashflow_transfer_sub(sub_category: str) -> bool:
    return normalize_transfer_sub_category(sub_category) in CASHFLOW_TRANSFER_SUBS


def is_internal_transfer_sub(sub_category: str) -> bool:
    return normalize_transfer_sub_category(sub_category) in {
        TRANSFER_SUB_CARD_REPAYMENT,
        TRANSFER_SUB_ACCOUNT_TRANSFER,
        TRANSFER_SUB_INVESTMENT_FUNDING,
    }


def is_shared_funding_sub(sub_category: str) -> bool:
    return (
        normalize_transfer_sub_category(sub_category) == TRANSFER_SUB_SHARED_FUNDING
    )


def is_etransfer_sub(sub_category: str) -> bool:
    return normalize_transfer_sub_category(sub_category) == TRANSFER_SUB_ETRANSFER
