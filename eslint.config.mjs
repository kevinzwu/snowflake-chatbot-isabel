import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "coverage/**",
    ".turbo/**",
    "deploy/aws/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
  // eslint-plugin-react-hooks 7 added strict React Compiler rules. Existing
  // components predate them; they are warnings until each is refactored.
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  // Allow explicit any in test files - common pattern for mocking
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
