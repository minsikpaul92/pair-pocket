import { translateCategory, translateSubCategory } from "@/lib/category-i18n";

/**
 * Stored values, not UI text: the backend fills a blank merchant with "미지정" and older
 * entries carry the English label.
 */
const PLACEHOLDER_MERCHANTS = new Set(["\uBBF8\uC9C0\uC815", "Unspecified"]);

/** The merchant, or "" when it is blank or an old placeholder. */
export function realMerchant(merchant?: string | null): string {
  const m = merchant?.trim() ?? "";
  return PLACEHOLDER_MERCHANTS.has(m) ? "" : m;
}

type T = (key: string) => string;

/** Merchant, else sub-category, else category, else the localized "unspecified". */
export function merchantLabel(
  tx: { merchant?: string | null; category?: string; sub_category?: string },
  tCategories: T,
  tSubCategories: T,
  unspecified: string
): string {
  return (
    realMerchant(tx.merchant) ||
    (tx.sub_category ? translateSubCategory(tx.sub_category, tSubCategories) : "") ||
    (tx.category ? translateCategory(tx.category, tCategories) : "") ||
    unspecified
  );
}
