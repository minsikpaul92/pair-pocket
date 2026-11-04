const createNextIntlPlugin = require("next-intl/plugin");

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const { withSerwist } = require("@serwist/turbopack");

// Service worker (Serwist, see app/sw.ts) stays off in development and on
// Vercel, as it was with next-pwa. (next-pwa + middleware once caused
// MIDDLEWARE_INVOCATION_FAILED on some Vercel deploys.)
const pwaEnabled =
  process.env.NODE_ENV !== "development" && !process.env.VERCEL;

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    // Identifies this deploy so open apps can tell a newer one is available.
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || "dev",
    NEXT_PUBLIC_PWA_ENABLED: pwaEnabled ? "true" : "false",
  },
  async rewrites() {
    // The API is on another site, where browsers block its cookies. Proxying
    // the session routes keeps the refresh cookie first-party to this origin.
    // beforeFiles: otherwise /api/auth/* would match the [locale] pages.
    return {
      beforeFiles: [
        {
          source: "/api/auth/:path*",
          destination: `${apiBaseUrl}/api/auth/:path*`,
        },
      ],
    };
  },
  async redirects() {
    // Without Edge middleware: bare paths must land under default locale.
    // Backend OAuth / invite emails omit the locale prefix.
    return [
      { source: "/", destination: "/en", permanent: false },
      {
        source: "/auth/callback",
        destination: "/en/auth/callback",
        permanent: false,
      },
      // Short address for the unlisted test sign-in page.
      { source: "/test", destination: "/en/auth/test", permanent: false },
      {
        source: "/invite/:token",
        destination: "/en/invite/:token",
        permanent: false,
      },
    ];
  },
};

module.exports = withNextIntl(withSerwist(nextConfig));
