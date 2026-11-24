import { test as base, expect, type APIRequestContext } from "@playwright/test";
import { getEnvironment, getEnvironmentConfig } from "./config/environments";

/**
 * Custom Playwright fixtures for Isabel E2E tests.
 *
 * Provides:
 * - `envConfig` — current environment configuration
 * - `request` — overridden to carry no cookies, so "requires authentication" tests see an anonymous caller (the project storage state is signed in)
 * - `authedRequest` — APIRequestContext with session cookies from stored auth state
 */

interface IsabelFixtures {
  envConfig: ReturnType<typeof getEnvironmentConfig>;
  authedRequest: APIRequestContext;
}

/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixtures use `use()` which triggers false positives */
export const test = base.extend<IsabelFixtures>({
  envConfig: async ({}, use) => {
    await use(getEnvironmentConfig());
  },

  request: async ({ playwright, baseURL }, use) => {
    const context = await playwright.request.newContext({
      baseURL: baseURL ?? "http://localhost:3000",
      storageState: { cookies: [], origins: [] },
    });
    await use(context);
    await context.dispose();
  },

  authedRequest: async ({ playwright, baseURL }, use) => {
    const context = await playwright.request.newContext({
      baseURL: baseURL ?? "http://localhost:3000",
      storageState: "playwright/.auth/user.json",
    });
    await use(context);
    await context.dispose();
  },
});

export { expect, getEnvironment };
