import { defineRouting } from "next-intl/routing";

import { locales } from "./locales";

export type { AppLocale } from "./locales";
export { locales };

export const routing = defineRouting({
  locales,
  defaultLocale: "ko",
  localePrefix: "as-needed",
  // Edge middleware does negotiation itself via rewrite; skip Accept-Language.
  localeDetection: false,
});
