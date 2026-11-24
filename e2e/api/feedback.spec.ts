import { expect, test } from "../fixtures";

/**
 * Feedback API E2E tests.
 * Tag: @api
 */

test.describe("Feedback Endpoint @api", () => {
  test("POST /api/feedback requires authentication", async ({ request }) => {
    const response = await request.post("/api/feedback", {
      data: {
        requestId: "test-id",
        feedback: "positive",
      },
    });
    expect(response.status()).toBe(401);
  });

  test("POST /api/feedback rejects invalid payload", async ({
    authedRequest,
  }) => {
    const response = await authedRequest.post("/api/feedback", {
      data: {},
    });

    // Should reject missing required fields
    if (response.status() !== 401 && response.status() !== 403) {
      expect(response.status()).toBeGreaterThanOrEqual(400);
    }
  });
});
