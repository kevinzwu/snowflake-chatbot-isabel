import path from "path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    test: {
      environment: "node",
      include: ["tests/schema-qa/**/*.test.ts"],
      testTimeout: 120_000,
      hookTimeout: 120_000,
      env,
    },
  };
});
