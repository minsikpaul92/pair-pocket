"use client";

import { useLocale, useTranslations } from "next-intl";

import { usePathname, useRouter } from "@/i18n/navigation";
import {
  LOCALE_OPTIONS,
  type AppLocale,
  isBetaLocale,
} from "@/i18n/locales";
import { updatePreferredLocales } from "@/lib/api";

interface Props {
  className?: string;
  /** Persist preferred locale via callback after UI switch. */
  onLocaleSelected?: (locale: AppLocale) => void | Promise<void>;
  /** Larger selectable list for onboarding / settings. */
  variant?: "toggle" | "list" | "select";
  /**
   * Onboarding mode: one language is selected and tapping another replaces it.
   */
  selectedLocales?: AppLocale[];
  onSelectedLocalesChange?: (locales: AppLocale[]) => void;
}

export default function LanguagePicker({
  className = "",
  onLocaleSelected,
  variant = "list",
  selectedLocales,
  onSelectedLocalesChange,
}: Props) {
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("common");

  const multi = Boolean(onSelectedLocalesChange);
  const selected = selectedLocales ?? [];

  async function applyActiveLocale(next: AppLocale | null) {
    if (!next) return;
    if (typeof window !== "undefined") {
      window.localStorage.setItem("pairpocket_user_locale", next);
    }
    if (onLocaleSelected) {
      await onLocaleSelected(next);
    } else {
      await updatePreferredLocales([next]).catch(() => null);
    }
    if (next !== locale) {
      router.replace(pathname, { locale: next });
    }
  }

  async function switchLocale(next: AppLocale) {
    if (next === locale) return;
    if (typeof window !== "undefined") {
      window.localStorage.setItem("pairpocket_user_locale", next);
    }
    if (onLocaleSelected) {
      await onLocaleSelected(next);
    } else {
      await updatePreferredLocales([next]).catch(() => null);
    }
    router.replace(pathname, { locale: next });
  }

  async function toggleMulti(next: AppLocale) {
    if (!onSelectedLocalesChange) return;

    onSelectedLocalesChange([next]);
    await applyActiveLocale(next);
  }

  if (variant === "select") {
    return (
      <select
        value={locale}
        onChange={(e) => void switchLocale(e.target.value as AppLocale)}
        aria-label={t("language")}
        className={`input-field bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:text-white ${className}`}
      >
        {LOCALE_OPTIONS.map((item) => (
          <option key={item.code} value={item.code}>
            {item.native}
            {item.beta ? ` (${t("beta")})` : ""}
          </option>
        ))}
      </select>
    );
  }

  if (variant === "toggle") {
    const compact = LOCALE_OPTIONS.filter((item) => !item.beta);
    return (
      <div
        className={`flex rounded-xl bg-gray-100 dark:bg-gray-800 p-0.5 ${className}`}
        role="group"
        aria-label={t("language")}
      >
        {compact.map((item) => (
          <button
            key={item.code}
            type="button"
            onClick={() => switchLocale(item.code)}
            aria-pressed={locale === item.code}
            className={`flex-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
              locale === item.code
                ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {item.short}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      className={`space-y-2 ${className}`}
      role="listbox"
      aria-label={t("language")}
    >
      {LOCALE_OPTIONS.map((item) => {
        const isSelected = multi ? selected[0] === item.code : locale === item.code;

        let rowClass =
          "bg-white dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700";
        if (isSelected) {
          rowClass =
            "bg-blue-500 text-white border border-blue-500 hover:bg-blue-600";
        }

        return (
          <button
            key={item.code}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => (multi ? toggleMulti(item.code) : switchLocale(item.code))}
            className={`flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition-colors ${rowClass}`}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                {item.label}
              </span>
              <span
                className={`block truncate text-xs ${
                  isSelected ? "text-white/80" : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {item.native}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {isBetaLocale(item.code) && (
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    isSelected
                      ? "bg-white/20 text-white"
                      : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                  }`}
                >
                  {t("beta")}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
