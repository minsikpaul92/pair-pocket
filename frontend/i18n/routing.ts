import { defineRouting } from "next-intl/routing";

import { locales } from "./locales";

export type { AppLocale } from "./locales";
export { locales };

export const routing = defineRouting({
  locales,
  defaultLocale: "en",
  // Always show /ko, /en, ... in the URL (no Edge middleware rewrite).
  localePrefix: "always",
  localeDetection: false,
});
