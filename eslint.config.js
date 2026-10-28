import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["dist/**", "dist-node/**", "dist-sea/**", "node_modules/**", "tests/**", "work/**", "apps/android/build/**", "apps/android/.local/**", "apps/android/test-results/**", "apps/android/tests/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "apps/android/web/**/*.ts", "vitest.config.ts"],
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: ["tools/**/*.mjs", "bin/**/*.mjs", "apps/android/tools/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", Native: "readonly", window: "readonly", visualViewport: "readonly", innerWidth: "readonly", innerHeight: "readonly", document: "readonly" } },
  },
];
