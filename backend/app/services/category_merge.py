"""Merge preset categories with per-user custom entries."""

from app.models.category_preset import (
    EXPENSE_PRESETS,
    INCOME_PRESETS,
    PRESETS_BY_TYPE,
    CategoryGroup,
    CategoryPresetsOut,
)
from app.models.transaction import TransactionType
from app.models.user_settings import CustomCategoryMap


def _merge_maps(
    preset: dict[str, list[str]], custom: dict[str, list[str]]
) -> dict[str, list[str]]:
    merged = {cat: list(subs) for cat, subs in preset.items()}
    for cat, subs in custom.items():
        if cat in merged:
            seen = set(merged[cat])
            for sub in subs:
                if sub not in seen:
                    merged[cat].append(sub)
                    seen.add(sub)
        else:
            merged[cat] = list(subs)
    return merged


def merge_custom_categories(custom: CustomCategoryMap) -> CategoryPresetsOut:
    expense_map = _merge_maps(EXPENSE_PRESETS, custom.expense)
    income_map = _merge_maps(INCOME_PRESETS, custom.income)
    return CategoryPresetsOut(
        expense=[
            CategoryGroup(category=cat, sub_categories=subs)
            for cat, subs in expense_map.items()
        ],
        income=[
            CategoryGroup(category=cat, sub_categories=subs)
            for cat, subs in income_map.items()
        ],
    )


def get_merged_sub_categories(
    custom: CustomCategoryMap,
    tx_type: TransactionType,
    category: str,
) -> list[str] | None:
    merged = merge_custom_categories(custom)
    groups = merged.expense if tx_type == TransactionType.EXPENSE else merged.income
    for group in groups:
        if group.category == category:
            return group.sub_categories
    return None


def is_valid_merged_pair(
    custom: CustomCategoryMap,
    tx_type: TransactionType,
    category: str,
    sub_category: str,
) -> bool:
    subs = get_merged_sub_categories(custom, tx_type, category)
    return subs is not None and sub_category in subs
