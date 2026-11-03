import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = [
  {
    // Build output and the service worker files next-pwa writes into public/.
    ignores: [
      ".next/**",
      "out/**",
      "next-env.d.ts",
      "public/sw.js",
      "public/workbox-*.js",
      "public/swe-worker-*.js",
      "public/fallback-*.js",
    ],
  },
  ...compat.extends("next/core-web-vitals"),
];

export default eslintConfig;
