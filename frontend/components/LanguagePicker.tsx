"use client";

import { useLocale, useTranslations } from "next-intl";

import { usePathname, useRouter } from "@/i18n/navigation";
import {
  LOCALE_OPTIONS,
  type AppLocale,
  isBetaLocale,
} from "@/i18n/locales";

const MAX_LOCALES = 2;

interface Props {
  className?: string;
  /** Persist preferred locale via callback after UI switch. */
  onLocaleSelected?: (locale: AppLocale) => void | Promise<void>;
  /** Larger selectable list for onboarding / settings. */
  variant?: "toggle" | "list";
  /**
   * Multi-select mode (onboarding): up to 2 languages.
   * Order: [primary, secondary?]. First tap = primary, second = secondary.
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
  const tOnboarding = useTranslations("onboarding");

  const multi = Boolean(onSelectedLocalesChange);
  const selected = selectedLocales ?? [];

  async function applyActiveLocale(next: AppLocale | null) {
    if (!next) return;
    await onLocaleSelected?.(next);
    if (next !== locale) {
      router.replace(pathname, { locale: next });
    }
  }

  async function switchLocale(next: AppLocale) {
    if (next === locale) return;
    await onLocaleSelected?.(next);
    router.replace(pathname, { locale: next });
  }

  async function toggleMulti(next: AppLocale) {
    if (!onSelectedLocalesChange) return;

    const index = selected.indexOf(next);
    let nextSelected: AppLocale[];

    if (index >= 0) {
      // Deselect. If primary is removed, secondary (if any) becomes primary.
      nextSelected = selected.filter((code) => code !== next);
    } else if (selected.length >= MAX_LOCALES) {
      // Already have primary + secondary; ignore new taps.
      return;
    } else {
      // First tap → primary, second tap → secondary.
      nextSelected = [...selected, next];
    }

    onSelectedLocalesChange(nextSelected);
    if (nextSelected[0]) {
      await applyActiveLocale(nextSelected[0]);
    }
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
            {item.code === "ko" ? "KO" : "EN"}
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
      aria-multiselectable={multi || undefined}
    >
      {multi && (
        <p className="text-xs text-gray-500 dark:text-gray-400 px-0.5">
          {tOnboarding("languageMultiHelp")}
        </p>
      )}
      {LOCALE_OPTIONS.map((item) => {
        const isPrimary = selected[0] === item.code;
        const isSecondary = selected[1] === item.code;
        const isSelected = isPrimary || isSecondary;

        let rowClass =
          "bg-white dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700";
        if (isPrimary) {
          rowClass =
            "bg-blue-500 text-white border border-blue-500 hover:bg-blue-600";
        } else if (isSecondary) {
          rowClass =
            "bg-violet-500 text-white border border-violet-500 hover:bg-violet-600";
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
              {isPrimary && (
                <span className="rounded-md bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  {tOnboarding("languagePrimary")}
                </span>
              )}
              {isSecondary && (
                <span className="rounded-md bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  {tOnboarding("languageSecondary")}
                </span>
              )}
              {isBetaLocale(item.code) && (
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    isSelected
                      ? "bg-white/20 text-white"
                      : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                  }`}
                >
                  Beta
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
