import { expect, test } from "@playwright/test";

/**
 * Service Token API E2E tests.
 * Tag: @api
 *
 * Tests the OAuth Client Credentials flow for service accounts.
 * These tests verify the endpoint's security without valid OAuth tokens.
 */

test.describe("Service Token Endpoint @api @live", () => {
  test("POST /api/v1/service-token requires Authorization header", async ({
    request,
  }) => {
    const response = await request.post("/api/v1/service-token");
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.error).toBeTruthy();
  });

  test("POST /api/v1/service-token rejects invalid bearer token", async ({
    request,
  }) => {
    const response = await request.post("/api/v1/service-token", {
      headers: {
        Authorization: "Bearer invalid-token-value",
      },
    });

    expect(response.status()).toBe(401);
  });

  test("POST /api/v1/service-token rejects non-Bearer auth", async ({
    request,
  }) => {
    const response = await request.post("/api/v1/service-token", {
      headers: {
        Authorization: "Basic dXNlcjpwYXNz",
      },
    });

    expect(response.status()).toBe(401);
  });

  test("GET /api/v1/service-token rejects wrong HTTP method", async ({
    request,
  }) => {
    const response = await request.get("/api/v1/service-token");
    expect(response.status()).toBe(405);
  });

  test("POST /api/v1/service-token does not leak sensitive info in errors", async ({
    request,
  }) => {
    const response = await request.post("/api/v1/service-token", {
      headers: {
        Authorization: "Bearer fake-token",
      },
    });

    const body = await response.json();
    // Should not contain stack traces or internal details
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("stack");
    expect(bodyStr).not.toContain("SNOWFLAKE_");
    expect(bodyStr).not.toContain("AZURE_AD_CLIENT_SECRET");
  });
});
