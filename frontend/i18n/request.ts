import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";

import { messagePackLocale } from "./locales";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  // Beta locales fall back to English message packs until post-publish.
  const pack = messagePackLocale(locale);

  return {
    locale,
    messages: (await import(`../messages/${pack}.json`)).default,
  };
});
