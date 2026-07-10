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
  webpack: (config, { dev }) => {
    // Avoid corrupted on-disk webpack cache when disk space is low (ENOSPC).
    if (dev) {
      config.cache = { type: "memory" };
    }
    return config;
  },
};

module.exports = withPWA(nextConfig);
