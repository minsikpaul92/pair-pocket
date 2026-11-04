import type { BankCountry } from "@/lib/banks";
import type { LedgerScope, UserSettings } from "@/lib/api";
import { preferredLocalesList } from "@/lib/api";

/** Ledger currency of each country. */
export type CountryCurrency = "CAD" | "KRW";

export interface CountryInfo {
  code: BankCountry;
  currency: CountryCurrency;
  /** UI language that turned this country on before countries were stored. */
  legacyLocale?: string;
}

/**
 * Countries PairPocket supports, in display order. To add a country, add it
 * here (and to BankCountry, the backend AccountCountry enum and
 * settingsPage.countryList in the message files). Settings, the header
 * country toggle and onboarding read from this list.
 */
export const COUNTRIES: CountryInfo[] = [
  { code: "CA", currency: "CAD" },
  { code: "KR", currency: "KRW", legacyLocale: "ko" },
];

/** PairPocket is Canada-first: the home country is always on. */
export const HOME_COUNTRY: BankCountry = "CA";

const COUNTRY_ORDER: BankCountry[] = COUNTRIES.map((c) => c.code);

/**
 * Countries implied by preferred UI languages (for settings saved before
 * countries were stored, and for onboarding's starting choice): the home
 * country plus any country whose language is chosen.
 */
export function countriesForLocales(locales: string[]): BankCountry[] {
  return COUNTRIES.filter(
    (c) =>
      c.code === HOME_COUNTRY ||
      (c.legacyLocale !== undefined && locales.includes(c.legacyLocale))
  ).map((c) => c.code);
}

/**
 * Countries shown for a user: the Settings choice, or for older settings
 * without one, the countries their languages imply. The home country always
 * comes first.
 */
export function enabledCountriesFromSettings(
  settings: Pick<
    UserSettings,
    "enabled_countries" | "preferred_locales" | "preferred_locale"
  > | null | undefined
): BankCountry[] {
  const chosen = settings?.enabled_countries;
  if (chosen?.length) {
    return COUNTRY_ORDER.filter((c) => c === HOME_COUNTRY || chosen.includes(c));
  }
  return countriesForLocales(preferredLocalesList(settings));
}

/** Header ledger scopes for the enabled countries ("All" once there are two). */
export function ledgerScopesForCountries(
  countries: BankCountry[]
): LedgerScope[] {
  const scopes: LedgerScope[] = COUNTRIES.filter((c) =>
    countries.includes(c.code)
  ).map((c) => c.currency);
  if (scopes.length === 0) return [countryToLedgerScope(HOME_COUNTRY)];
  return scopes.length >= 2 ? ["ALL", ...scopes] : scopes;
}

export function defaultCountry(countries: BankCountry[]): BankCountry {
  return countries[0] ?? HOME_COUNTRY;
}

export function countryToLedgerScope(country: BankCountry): CountryCurrency {
  return COUNTRIES.find((c) => c.code === country)?.currency ?? "CAD";
}
