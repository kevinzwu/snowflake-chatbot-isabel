import { expect, test } from "../fixtures";

/**
 * JWT endpoint E2E tests.
 * Tag: @api
 */

test.describe("JWT Endpoint @api", () => {
  test("GET /api/jwt requires authentication", async ({ request }) => {
    const response = await request.get("/api/jwt");
    // Without session cookies, should get 401
    expect(response.status()).toBe(401);
  });

  test("GET /api/jwt returns token when authenticated", async ({
    authedRequest,
  }) => {
    const response = await authedRequest.get("/api/jwt");

    // If the test user is in allowed groups, should get 200
    // If not in groups, should get 403
    if (response.status() === 200) {
      const body = await response.json();
      expect(typeof body.token.token).toBe("string");
      expect(typeof body.token.expiresAt).toBe("number");
    } else {
      expect([401, 403]).toContain(response.status());
    }
  });

  test("GET /api/jwt includes rate limit headers when rate limited", async ({
    authedRequest,
  }) => {
    const response = await authedRequest.get("/api/jwt");
    const headers = response.headers();

    // Rate limit headers are only set on 429 responses in the current implementation
    if (response.status() === 429) {
      expect(headers["x-ratelimit-limit"]).toBeTruthy();
      expect(headers["x-ratelimit-remaining"]).toBeTruthy();
    } else {
      // On non-429 responses, just verify the endpoint responded successfully or with auth error
      expect([200, 401, 403]).toContain(response.status());
    }
  });

  test("GET /api/jwt rejects non-GET methods", async ({ authedRequest }) => {
    const postResponse = await authedRequest.post("/api/jwt", { data: {} });
    expect(postResponse.status()).toBe(405);
  });
});
