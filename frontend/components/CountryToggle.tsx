"use client";

import { useTranslations } from "next-intl";

import type { BankCountry } from "@/lib/banks";

interface Props {
  value: BankCountry;
  onChange: (country: BankCountry) => void;
  countries: BankCountry[];
  className?: string;
}

/** Canada/Korea segmented control — hidden when only one country is enabled. */
export default function CountryToggle({
  value,
  onChange,
  countries,
  className = "",
}: Props) {
  const t = useTranslations("onboarding");

  if (countries.length <= 1) return null;

  return (
    <div
      className={`flex rounded-xl bg-gray-100 dark:bg-gray-800 p-0.5 ${className}`}
      role="group"
    >
      {countries.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            value === c
              ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
              : "text-gray-500 dark:text-gray-400"
          }`}
        >
          {c === "CA" ? t("countryCanada") : t("countryKorea")}
        </button>
      ))}
    </div>
  );
}
