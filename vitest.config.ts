import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "node_modules",
      ".next",
      "deploy",
      "bin",
      "docs",
      "public",
      "e2e",
      "tests/prompt-qa",
      "tests/schema-qa",
    ],
    coverage: {
      provider: "v8",
      include: [
        "lib/**/*.ts",
        "app/api/**/*.ts",
        "app/functions/**/*.ts",
        "app/components/**/*.tsx",
      ],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "**/types.ts",
        "**/index.ts",
        "lib/agent-api/constants.ts",
      ],
      reporter: ["text", "text-summary", "html", "lcov"],
      // Start with achievable thresholds; increase as more tests are added
      // Target: 80% global once agent-api and component coverage improves
      thresholds: {
        global: {
          branches: 25,
          functions: 20,
          lines: 25,
          statements: 25,
        },
      },
    },
    testTimeout: 10000,
    retry: 1,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
