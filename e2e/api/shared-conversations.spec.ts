import { expect, test } from "../fixtures";

/**
 * Shared Conversations E2E tests.
 * Tag: @api
 *
 * Tests the share creation, access, revocation, and fork-on-interact flows.
 * Requires authenticated session with appropriate group membership.
 */

test.describe("Shared Conversations API @api", () => {
  let conversationId: string;
  let shareToken: string;

  test.beforeAll(async ({ authedRequest, envConfig }) => {
    test.skip(!envConfig.allowMutations, "Mutations disabled in this env");

    // Create a conversation to share
    const response = await authedRequest.post("/api/conversations", {
      data: {
        title: "Share Test Conversation",
        messages: [
          {
            id: "share-test-msg-1",
            role: "user",
            content: [{ type: "text", text: "Hello for share test" }],
          },
          {
            id: "share-test-msg-2",
            role: "assistant",
            content: [{ type: "text", text: "Hi there!" }],
          },
        ],
      },
    });

    if (response.status() === 201 || response.status() === 200) {
      const body = await response.json();
      conversationId = body.conversationId;
    }
  });

  test("POST /api/conversations/[id]/share creates a share link", async ({
    authedRequest,
    envConfig,
  }) => {
    test.skip(!envConfig.allowMutations, "Mutations disabled in this env");
    test.skip(!conversationId, "No conversation created in beforeAll");

    const response = await authedRequest.post(
      `/api/conversations/${conversationId}/share`,
    );

    if (response.status() === 200) {
      const body = await response.json();
      expect(body.shareToken).toBeTruthy();
      expect(body.shareUrl).toContain("/shared/");
      expect(body.alreadyShared).toBe(false);
      shareToken = body.shareToken;
    } else {
      expect([401, 403]).toContain(response.status());
    }
  });

  test("POST /api/conversations/[id]/share is idempotent", async ({
    authedRequest,
    envConfig,
  }) => {
    test.skip(!envConfig.allowMutations, "Mutations disabled in this env");
    test.skip(!conversationId, "No conversation created");
    test.skip(!shareToken, "No share token from previous test");

    const response = await authedRequest.post(
      `/api/conversations/${conversationId}/share`,
    );

    if (response.status() === 200) {
      const body = await response.json();
      expect(body.shareToken).toBe(shareToken);
      expect(body.alreadyShared).toBe(true);
    }
  });

  test("GET /api/shared/[token] returns shared conversation", async ({
    authedRequest,
    envConfig,
  }) => {
    test.skip(!envConfig.allowMutations, "Mutations disabled in this env");
    test.skip(!shareToken, "No share token from previous test");

    const response = await authedRequest.get(`/api/shared/${shareToken}`);

    if (response.status() === 200) {
      const body = await response.json();
      expect(body.conversation).toBeTruthy();
      expect(body.conversation.conversationId).toBe(conversationId);
      expect(body.conversation.title).toBe("Share Test Conversation");
      expect(body.conversation.messages).toHaveLength(2);
      expect(body.owner).toBeTruthy();
      expect(body.shareToken).toBe(shareToken);
    } else {
      expect([401, 403]).toContain(response.status());
    }
  });

  test("GET /api/shared/[token] requires authentication", async ({
    request,
  }) => {
    test.skip(!shareToken, "No share token");

    const response = await request.get(`/api/shared/${shareToken}`);
    expect(response.status()).toBe(401);
  });

  test("GET /api/shared/invalid-token returns 404", async ({
    authedRequest,
  }) => {
    const response = await authedRequest.get(
      "/api/shared/00000000-0000-4000-8000-000000000000",
    );

    if (response.status() !== 401 && response.status() !== 403) {
      expect(response.status()).toBe(404);
    }
  });

  test("GET /api/shared/malformed-token returns 404", async ({
    authedRequest,
  }) => {
    const response = await authedRequest.get("/api/shared/not-a-uuid");

    if (response.status() !== 401 && response.status() !== 403) {
      expect(response.status()).toBe(404);
    }
  });

  test("Fork via POST /api/conversations with forkedFrom", async ({
    authedRequest,
    envConfig,
  }) => {
    test.skip(!envConfig.allowMutations, "Mutations disabled in this env");
    test.skip(!shareToken, "No share token");

    // Simulate what the shared page does: create a fork
    const response = await authedRequest.post("/api/conversations", {
      data: {
        title: "Share Test Conversation",
        messages: [
          {
            id: "share-test-msg-1",
            role: "user",
            content: [{ type: "text", text: "Hello for share test" }],
          },
          {
            id: "share-test-msg-2",
            role: "assistant",
            content: [{ type: "text", text: "Hi there!" }],
          },
        ],
        forkedFrom: {
          shareToken,
          conversationId,
          ownerUserId: "original-owner",
        },
      },
    });

    if (response.status() === 201 || response.status() === 200) {
      const body = await response.json();
      expect(body.conversationId).toBeTruthy();
      expect(body.conversationId).not.toBe(conversationId); // Different ID
    } else {
      expect([401, 403]).toContain(response.status());
    }
  });

  test("Owner conversation unchanged after fork", async ({
    authedRequest,
    envConfig,
  }) => {
    test.skip(!envConfig.allowMutations, "Mutations disabled in this env");
    test.skip(!conversationId, "No conversation created");

    const response = await authedRequest.get(
      `/api/conversations/${conversationId}`,
    );

    if (response.status() === 200) {
      const body = await response.json();
      expect(body.title).toBe("Share Test Conversation");
      expect(body.messages).toHaveLength(2);
      // Verify original is still shared
      expect(body.isShared).toBe(true);
      expect(body.shareToken).toBe(shareToken);
    }
  });

  test("DELETE /api/conversations/[id]/share revokes share", async ({
    authedRequest,
    envConfig,
  }) => {
    test.skip(!envConfig.allowMutations, "Mutations disabled in this env");
    test.skip(!conversationId, "No conversation created");

    const response = await authedRequest.delete(
      `/api/conversations/${conversationId}/share`,
    );

    if (response.status() === 200) {
      const body = await response.json();
      expect(body.message).toBe("Share revoked");
    } else {
      expect([401, 403]).toContain(response.status());
    }
  });

  test("GET /api/shared/[token] returns 404 after revocation", async ({
    authedRequest,
    envConfig,
  }) => {
    test.skip(!envConfig.allowMutations, "Mutations disabled in this env");
    test.skip(!shareToken, "No share token");

    const response = await authedRequest.get(`/api/shared/${shareToken}`);

    if (response.status() !== 401 && response.status() !== 403) {
      expect(response.status()).toBe(404);
    }
  });

  // Cleanup
  test.afterAll(async ({ authedRequest }) => {
    if (conversationId) {
      await authedRequest.delete(`/api/conversations/${conversationId}`);
    }
  });
});
