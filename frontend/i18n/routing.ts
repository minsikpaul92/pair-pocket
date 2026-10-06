import { defineRouting } from "next-intl/routing";

import { DEFAULT_LOCALE, locales } from "./locales";

export type { AppLocale } from "./locales";
export { locales };

export const routing = defineRouting({
  locales,
  defaultLocale: DEFAULT_LOCALE,
  // Always show /ko, /en, ... in the URL (no Edge middleware rewrite).
  localePrefix: "always",
  localeDetection: false,
});
