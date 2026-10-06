import registry from "./locales.json";

/**
 * Locale registry. `locales.json` is the single list of UI languages; the
 * message pack for each lives at `messages/<code>.json`.
 *
 * - `ko` is the source of truth: every key is written there first.
 * - Any other pack may be partial. Missing or empty keys fall back to `en`,
 *   then `ko`, so a new language works as soon as its file is translated.
 * - `beta: true` shows a Beta badge until the pack is fully translated.
 *
 * Add a language with `npm run i18n:new -- <code>` (see docs/I18N.md).
 */

export type AppLocale = string;

export type LocaleMeta = {
  code: AppLocale;
  label: string;
  native: string;
  /** Compact label for the header toggle. */
  short: string;
  /** BCP 47 tag for Intl date and number formatting. */
  intl: string;
  beta: boolean;
  /** Extra packs to try before this one, after the base and fallback packs. */
  fallback?: string[];
};

export const LOCALE_OPTIONS: LocaleMeta[] = registry.locales;

export const locales: AppLocale[] = LOCALE_OPTIONS.map((item) => item.code);

/** Pack every key is written in first. */
export const BASE_LOCALE: AppLocale = registry.baseLocale;
/** Pack shown for keys a language has not translated yet. */
export const FALLBACK_LOCALE: AppLocale = registry.fallbackLocale;
/** Locale for bare URLs and first visits. */
export const DEFAULT_LOCALE: AppLocale = registry.defaultLocale;

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return Boolean(value) && locales.includes(value as AppLocale);
}

export function localeMeta(locale: string): LocaleMeta | undefined {
  return LOCALE_OPTIONS.find((item) => item.code === locale);
}

export function isBetaLocale(locale: string): boolean {
  return localeMeta(locale)?.beta ?? true;
}

/** BCP 47 tag for `Intl` / `toLocale*String` for a UI locale. */
export function intlLocale(locale: string): string {
  return localeMeta(locale)?.intl ?? localeMeta(FALLBACK_LOCALE)?.intl ?? "en-CA";
}

/**
 * Packs merged for a locale, least specific first. The last pack wins for
 * each key it defines.
 */
export function messageChain(locale: string): AppLocale[] {
  const chain = [BASE_LOCALE];
  if (locale !== BASE_LOCALE) {
    chain.push(FALLBACK_LOCALE, ...(localeMeta(locale)?.fallback ?? []), locale);
  }
  return chain.filter((code, index) => chain.indexOf(code) === index);
}
