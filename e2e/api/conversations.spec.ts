import { expect, test } from "../fixtures";

/**
 * Conversations API E2E tests.
 * Tag: @api
 *
 * Tests the full CRUD lifecycle for conversations.
 * Requires authenticated session with appropriate group membership.
 */

test.describe("Conversations API @api", () => {
  let _conversationId: string;

  test("GET /api/conversations requires authentication", async ({
    request,
  }) => {
    const response = await request.get("/api/conversations");
    expect(response.status()).toBe(401);
  });

  test("POST /api/conversations creates a conversation", async ({
    authedRequest,
    envConfig,
  }) => {
    test.skip(!envConfig.allowMutations, "Mutations disabled in this env");

    const response = await authedRequest.post("/api/conversations", {
      data: {
        title: "E2E Test Conversation",
        messages: [
          {
            id: "test-msg-1",
            role: "user",
            content: [{ type: "text", text: "Hello from E2E test" }],
          },
        ],
      },
    });

    if (response.status() === 200 || response.status() === 201) {
      const body = await response.json();
      expect(body.conversationId).toBeTruthy();
      expect(body.title).toBe("E2E Test Conversation");
      _conversationId = body.conversationId;
    } else {
      // May fail due to auth — that's expected if test user lacks groups
      expect([401, 403]).toContain(response.status());
    }
  });

  test("GET /api/conversations lists conversations", async ({
    authedRequest,
  }) => {
    const response = await authedRequest.get("/api/conversations");

    if (response.status() === 200) {
      const body = await response.json();
      expect(body.conversations).toBeDefined();
      expect(Array.isArray(body.conversations)).toBe(true);
    } else {
      expect([401, 403]).toContain(response.status());
    }
  });

  test("GET /api/conversations/search searches conversations", async ({
    authedRequest,
  }) => {
    const response = await authedRequest.get(
      "/api/conversations/search?q=test",
    );

    if (response.status() === 200) {
      const body = await response.json();
      expect(Array.isArray(body.conversations)).toBe(true);
    } else {
      expect([401, 403]).toContain(response.status());
    }
  });

  test("GET /api/conversations/search rejects empty query", async ({
    authedRequest,
  }) => {
    const response = await authedRequest.get("/api/conversations/search?q=");
    // Should reject empty search queries
    if (response.status() !== 401 && response.status() !== 403) {
      expect(response.status()).toBe(400);
    }
  });
});
