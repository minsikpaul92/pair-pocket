import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    // React Compiler rules added by eslint-plugin-react-hooks 7. Existing code
    // predates them, so report as warnings until it is cleaned up.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  // Build output.
  globalIgnores([
    ".next/**",
    "out/**",
    "next-env.d.ts",
  ]),
]);
