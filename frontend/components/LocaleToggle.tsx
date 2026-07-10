"use client";

import { useLocale, useTranslations } from "next-intl";

import { usePathname, useRouter } from "@/i18n/navigation";
import { locales, type AppLocale } from "@/i18n/routing";

const LOCALE_LABEL: Record<AppLocale, string> = {
  ko: "KO",
  en: "EN",
};

interface Props {
  className?: string;
}

export default function LocaleToggle({ className = "" }: Props) {
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("common");

  function switchLocale(next: AppLocale) {
    if (next === locale) return;
    router.replace(pathname, { locale: next });
  }

  return (
    <div
      className={`flex rounded-xl bg-gray-100 dark:bg-gray-800 p-0.5 ${className}`}
      role="group"
      aria-label={t("language")}
    >
      {locales.map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => switchLocale(loc)}
          aria-pressed={locale === loc}
          className={`flex-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
            locale === loc
              ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          }`}
        >
          {LOCALE_LABEL[loc]}
        </button>
      ))}
    </div>
  );
}
