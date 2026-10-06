/**
 * Display text for canonical category values (lib/category-values.ts).
 * Labels live in the message packs under `categories.<key>` and
 * `subCategories.<key>`. User-created custom values have no key and are shown
 * as typed.
 */

import { CATEGORY, MERCHANT_PLACEHOLDER, SUB_CATEGORY } from "@/lib/category-values";

const hasOwn = (obj: object, key: string) =>
  Object.prototype.hasOwnProperty.call(obj, key);

function invert(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!hasOwn(out, value)) out[value] = key;
  }
  return out;
}

export const CATEGORY_KEY_BY_VALUE: Record<string, string> = invert(CATEGORY);
export const SUB_CATEGORY_KEY_BY_VALUE: Record<string, string> = invert(SUB_CATEGORY);

export function categoryI18nKey(value: string): string | null {
  return hasOwn(CATEGORY_KEY_BY_VALUE, value) ? CATEGORY_KEY_BY_VALUE[value] : null;
}

export function subCategoryI18nKey(value: string): string | null {
  return hasOwn(SUB_CATEGORY_KEY_BY_VALUE, value)
    ? SUB_CATEGORY_KEY_BY_VALUE[value]
    : null;
}

export function translateCategory(
  value: string,
  t: (key: string) => string
): string {
  const key = categoryI18nKey(value);
  return key ? t(key) : value;
}

export function translateSubCategory(
  value: string,
  t: (key: string) => string
): string {
  const key = subCategoryI18nKey(value);
  return key ? t(key) : value;
}

/** A message pack (or the merged messages from `useMessages()`). */
type LabelSource = { [key: string]: unknown };

function labelsOf(source: LabelSource, namespace: string): Record<string, string> {
  const node = source[namespace];
  if (!node || typeof node !== "object") return {};
  const labels: Record<string, string> = {};
  for (const [key, label] of Object.entries(node as Record<string, unknown>)) {
    if (typeof label === "string") labels[key] = label;
  }
  return labels;
}

function canonicalize(
  text: string,
  values: Record<string, string>,
  namespace: string,
  sources: LabelSource[]
): string {
  const v = text.trim();
  if (!v) return v;
  if (Object.values(values).includes(v)) return v;
  if (hasOwn(values, v)) return values[v];
  const lower = v.toLowerCase();
  for (const source of sources) {
    for (const [key, label] of Object.entries(labelsOf(source, namespace))) {
      if (label.trim().toLowerCase() === lower && hasOwn(values, key)) return values[key];
    }
  }
  return v;
}

/**
 * Map category text from a CSV (canonical value, message key, or a label in
 * any of `sources`) to the canonical value. Unknown text is returned trimmed.
 */
export function canonicalizeCategory(value: string, sources: LabelSource[] = []): string {
  return canonicalize(value, CATEGORY, "categories", sources);
}

/** Same as canonicalizeCategory for sub-categories. */
export function canonicalizeSubCategory(
  value: string,
  sources: LabelSource[] = []
): string {
  const canonical = canonicalize(value, SUB_CATEGORY, "subCategories", sources);
  // Legacy name for moving money between one's own accounts.
  return canonical === SUB_CATEGORY.accountTransferLegacy
    ? SUB_CATEGORY.accountTransfer
    : canonical;
}

/** Merchant text for display: the stored placeholder and blanks become common.unspecified. */
export function merchantLabel(
  merchant: string | null | undefined,
  t: (key: string) => string
): string {
  const value = merchant?.trim();
  return !value || value === MERCHANT_PLACEHOLDER ? t("unspecified") : value;
}
