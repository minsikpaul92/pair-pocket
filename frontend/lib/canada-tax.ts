/**
 * General sales tax rate a shopper pays in each province or territory, as a
 * percent of the pre-tax price: federal GST plus any provincial tax, which the
 * HST provinces already include. Checked against the CRA and taxtips.ca 2026
 * tables. Quebec's QST is added to GST rather than compounded.
 *
 * The codes match the backend's `CanadaProvince`.
 */
export const CANADA_PROVINCES = [
  { code: "AB", percent: 5 },
  { code: "BC", percent: 12 },
  { code: "MB", percent: 12 },
  { code: "NB", percent: 15 },
  { code: "NL", percent: 15 },
  { code: "NS", percent: 14 },
  { code: "NT", percent: 5 },
  { code: "NU", percent: 5 },
  { code: "ON", percent: 13 },
  { code: "PE", percent: 15 },
  { code: "QC", percent: 14.975 },
  { code: "SK", percent: 11 },
  { code: "YT", percent: 5 },
] as const;

export type CanadaProvince = (typeof CANADA_PROVINCES)[number]["code"];

export const DEFAULT_SALES_TAX_PROVINCE: CanadaProvince = "ON";

export function isCanadaProvince(code: unknown): code is CanadaProvince {
  return CANADA_PROVINCES.some((p) => p.code === code);
}

/** Sales tax percent for a province code; unknown or missing falls back to Ontario. */
export function salesTaxPercent(code: string | null | undefined): number {
  const found = CANADA_PROVINCES.find((p) => p.code === code);
  return (found ?? CANADA_PROVINCES.find((p) => p.code === DEFAULT_SALES_TAX_PROVINCE)!)
    .percent;
}

/** 13 -> "13", 14.975 -> "14.975" (no float noise, no trailing zeros). */
export function formatTaxPercent(percent: number): string {
  return String(Number(percent.toFixed(3)));
}
