import { NextRequest, NextResponse } from "next/server";

import { routing } from "./i18n/routing";

/**
 * Lightweight locale routing for Vercel Edge.
 * Avoids next-intl's createMiddleware (ua-parser / negotiator), which has
 * caused MIDDLEWARE_INVOCATION_FAILED on some Vercel runtimes.
 */
export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const firstSegment = pathname.split("/")[1] ?? "";
  const hasLocale = (routing.locales as readonly string[]).includes(
    firstSegment
  );

  if (hasLocale) {
    return NextResponse.next();
  }

  // localePrefix: "as-needed" — default locale is served without a URL prefix.
  const url = request.nextUrl.clone();
  url.pathname =
    pathname === "/"
      ? `/${routing.defaultLocale}`
      : `/${routing.defaultLocale}${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
