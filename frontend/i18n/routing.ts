import { defineRouting } from "next-intl/routing";

export const locales = ["ko", "en"] as const;
export type AppLocale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: "ko",
  localePrefix: "as-needed",
});
