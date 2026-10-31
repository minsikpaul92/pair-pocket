const createNextIntlPlugin = require("next-intl/plugin");

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  register: true,
  // Disable PWA in development and on Vercel until Edge middleware is stable.
  // (next-pwa + middleware has caused MIDDLEWARE_INVOCATION_FAILED on some deploys.)
  disable:
    process.env.NODE_ENV === "development" || Boolean(process.env.VERCEL),
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
  },
});

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const nextConfig = {
  reactStrictMode: true,
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
      {
        source: "/invite/:token",
        destination: "/en/invite/:token",
        permanent: false,
      },
    ];
  },
  webpack: (config, { dev }) => {
    // Avoid corrupted on-disk webpack cache when disk space is low (ENOSPC).
    if (dev) {
      config.cache = { type: "memory" };
    }
    return config;
  },
};

module.exports = withNextIntl(withPWA(nextConfig));
