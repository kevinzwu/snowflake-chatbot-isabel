import { expect, test } from "@playwright/test";

/**
 * Unauthorized access tests.
 *
 * Verifies that protected API endpoints reject unauthenticated requests.
 * Uses empty auth state — no session cookies.
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Unauthorized Access @api @security", () => {
  const protectedEndpoints = [
    { method: "GET" as const, path: "/api/jwt" },
    { method: "GET" as const, path: "/api/conversations" },
    { method: "POST" as const, path: "/api/conversations" },
    { method: "GET" as const, path: "/api/saved-queries" },
    { method: "POST" as const, path: "/api/feedback" },
  ];

  for (const { method, path } of protectedEndpoints) {
    test(`${method} ${path} returns 401 without auth`, async ({ request }) => {
      const response =
        method === "GET"
          ? await request.get(path)
          : await request.post(path, { data: {} });

      expect(response.status()).toBe(401);
    });
  }

  test("protected endpoints do not leak error details", async ({ request }) => {
    const response = await request.get("/api/jwt");
    const body = await response.json();
    const bodyStr = JSON.stringify(body);

    // Should not contain stack traces, env vars, or internal paths
    expect(bodyStr).not.toContain("node_modules");
    expect(bodyStr).not.toContain("SNOWFLAKE_");
    expect(bodyStr).not.toContain("AZURE_AD_CLIENT_SECRET");
    expect(bodyStr).not.toContain("Error:");
  });
});
