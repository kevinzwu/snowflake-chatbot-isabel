/**
 * Global test setup for Vitest
 *
 * Runs before all tests. Sets up:
 * - Testing Library DOM matchers
 * - MSW mock server for HTTP interception
 * - Test environment variables
 */

import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { server } from "./mocks/server";

// Set test environment variables
// NODE_ENV is already set to 'test' by Vitest
process.env.AZURE_AD_TENANT_ID = "test-tenant-id";
process.env.AZURE_AD_CLIENT_ID = "test-client-id";
process.env.ALLOWED_AZURE_AD_GROUPS = "group-1-id,group-2-id";
process.env.ADMIN_AZURE_AD_GROUPS = "admin-group-id";
process.env.SNOWFLAKE_ACCOUNT = "TEST_ACCOUNT";
process.env.SNOWFLAKE_USER = "TEST_USER";

// Start MSW server before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: "warn" });
});

// Reset handlers after each test for isolation
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
});

// Clean up after all tests
afterAll(() => {
  server.close();
});
