import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E test configuration for Isabel.
 *
 * Environment targeting via E2E_BASE_URL:
 *   - Local:  http://localhost:3000 (default)
 *   - Remote: any deployed URL
 *
 * Usage:
 *   pnpm exec playwright test                          # run all tests
 *   pnpm exec playwright test --grep @smoke            # smoke tests only
 *   pnpm exec playwright test --grep @api              # API tests only
 *   E2E_BASE_URL=https://isabel.example.com pnpm exec playwright test
 */

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const isCI = !!process.env.CI;
const isLocal = baseURL.includes("localhost");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  timeout: 30_000,

  reporter: isCI
    ? [
        ["html", { open: "never" }],
        ["json", { outputFile: "playwright-report/results.json" }],
        ["junit", { outputFile: "playwright-report/junit.xml" }],
      ]
    : [["html", { open: "on-failure" }]],

  expect: {
    timeout: 10_000,
  },

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
  },

  projects: [
    // Auth setup — runs first, authenticates once for all test projects
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },

    // Main test project — Chromium with authenticated state
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },

    // Mobile viewport
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"],
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup"],
      grep: /@responsive/,
    },
  ],

  // Start local dev server when testing locally (not against deployed envs)
  ...(isLocal
    ? {
        webServer: {
          // next dev, not next start: demo mode is disabled when NODE_ENV=production
          command: "node node_modules/next/dist/bin/next dev",
          url: baseURL,
          reuseExistingServer: !isCI,
          timeout: 120_000,
        },
      }
    : {}),
});
