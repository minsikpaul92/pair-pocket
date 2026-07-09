const createNextIntlPlugin = require("next-intl/plugin");

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  register: true,
  // Disable PWA in development to avoid noisy service-worker caching while iterating.
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    skipWaiting: true,
  },
});

const nextConfig = {
  reactStrictMode: true,
};

module.exports = withNextIntl(withPWA(nextConfig));
