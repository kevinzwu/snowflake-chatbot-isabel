import { expect, test } from "@playwright/test";

/**
 * Rate limiting E2E tests.
 * Tag: @security
 *
 * Verifies rate limiting enforcement on protected endpoints.
 * Requires E2E_SERVICE_TOKEN env var with a valid OAuth service account token
 * to properly exercise the rate limiter (which runs after auth validation).
 * Skipped when credentials are not provided.
 */

test.describe("Rate Limiting @security", () => {
  const serviceToken = process.env.E2E_SERVICE_TOKEN;

  test("service-token endpoint enforces rate limits under burst", async ({
    request,
  }) => {
    test.skip(
      !serviceToken,
      "Requires E2E_SERVICE_TOKEN — rate limiter only runs after valid auth",
    );

    const responses = [];

    // Send 15 rapid requests (limit is 10/min for service-token)
    for (let i = 0; i < 15; i++) {
      const response = await request.post("/api/v1/service-token", {
        headers: {
          Authorization: `Bearer ${serviceToken}`,
        },
      });
      responses.push(response.status());
    }

    // With a valid token, the rate limiter should kick in and return 429
    const has429 = responses.some((status) => status === 429);
    expect(has429).toBe(true);
  });

  test("rate limited response includes Retry-After header", async ({
    request,
  }) => {
    test.skip(
      !serviceToken,
      "Requires E2E_SERVICE_TOKEN — rate limiter only runs after valid auth",
    );

    // Exhaust rate limit
    for (let i = 0; i < 15; i++) {
      await request.post("/api/v1/service-token", {
        headers: {
          Authorization: `Bearer ${serviceToken}`,
        },
      });
    }

    const lastResponse = await request.post("/api/v1/service-token", {
      headers: {
        Authorization: `Bearer ${serviceToken}`,
      },
    });

    expect(lastResponse.status()).toBe(429);

    const retryAfter = lastResponse.headers()["retry-after"];
    expect(retryAfter).toBeTruthy();
  });
});
