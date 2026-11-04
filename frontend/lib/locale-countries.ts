import type { BankCountry } from "@/lib/banks";
import type { LedgerScope, UserSettings } from "@/lib/api";
import { preferredLocalesList } from "@/lib/api";

const COUNTRY_ORDER: BankCountry[] = ["CA", "KR"];

/**
 * Markets enabled by preferred UI languages.
 *
 * PairPocket is Canada-first:
 * - English only → Canada only
 * - Korean included (alone or with English) → Canada + Korea
 * - Anything else / empty → Canada
 */
export function countriesForLocales(locales: string[]): BankCountry[] {
  const hasKorean = locales.some((loc) => loc === "ko");
  if (hasKorean) return [...COUNTRY_ORDER];
  return ["CA"];
}

/**
 * Countries shown for a user: the Settings choice, or for older settings
 * without one, the countries their languages imply. Canada always comes first.
 */
export function enabledCountriesFromSettings(
  settings: Pick<
    UserSettings,
    "enabled_countries" | "preferred_locales" | "preferred_locale"
  > | null | undefined
): BankCountry[] {
  const chosen = settings?.enabled_countries;
  if (chosen?.length) {
    return COUNTRY_ORDER.filter((c) => c === "CA" || chosen.includes(c));
  }
  return countriesForLocales(preferredLocalesList(settings));
}

/** Header ledger scopes for the enabled countries. */
export function ledgerScopesForCountries(
  countries: BankCountry[]
): LedgerScope[] {
  if (countries.length >= 2) return ["ALL", "CAD", "KRW"];
  if (countries[0] === "KR") return ["KRW"];
  return ["CAD"];
}

export function defaultCountry(countries: BankCountry[]): BankCountry {
  return countries[0] ?? "CA";
}

export function countryToLedgerScope(country: BankCountry): "CAD" | "KRW" {
  return country === "KR" ? "KRW" : "CAD";
}
