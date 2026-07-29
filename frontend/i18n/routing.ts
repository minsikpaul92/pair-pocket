import { defineRouting } from "next-intl/routing";

import { locales } from "./locales";

export type { AppLocale } from "./locales";
export { locales };

export const routing = defineRouting({
  locales,
  defaultLocale: "ko",
  localePrefix: "as-needed",
});
