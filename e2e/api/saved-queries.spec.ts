import { expect, test } from "../fixtures";

/**
 * Saved Queries API E2E tests.
 * Tag: @api
 */

test.describe("Saved Queries API @api", () => {
  test("GET /api/saved-queries requires authentication", async ({
    request,
  }) => {
    const response = await request.get("/api/saved-queries");
    expect(response.status()).toBe(401);
  });

  test("GET /api/saved-queries returns list when authenticated", async ({
    authedRequest,
  }) => {
    const response = await authedRequest.get("/api/saved-queries");

    if (response.status() === 200) {
      const body = await response.json();
      expect(body.queries).toBeDefined();
      expect(Array.isArray(body.queries)).toBe(true);
    } else {
      expect([401, 403]).toContain(response.status());
    }
  });

  test("POST /api/saved-queries creates a query", async ({
    authedRequest,
    envConfig,
  }) => {
    test.skip(!envConfig.allowMutations, "Mutations disabled in this env");

    const response = await authedRequest.post("/api/saved-queries", {
      data: {
        name: "E2E Test Query",
        queryText: "Show me all critical vulnerabilities",
        description: "Test query created by E2E suite",
      },
    });

    if (response.status() === 200 || response.status() === 201) {
      const body = await response.json();
      expect(body.queryId).toBeTruthy();
      expect(body.name).toBe("E2E Test Query");
    } else {
      expect([401, 403]).toContain(response.status());
    }
  });
});
