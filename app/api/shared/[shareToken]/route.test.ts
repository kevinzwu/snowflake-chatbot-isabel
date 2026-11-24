/**
 * Tests for GET /api/shared/[shareToken]
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthRead = vi.fn();
vi.mock("@/lib/security/route-hardening", () => ({
  authenticateReadRequest: (...args: unknown[]) => mockAuthRead(...args),
  secureJsonResponse: (data: unknown, status: number = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  },
}));

vi.mock("@/lib/security/api-response", () => ({
  withNoCacheHeaders: (res: Response) => res,
}));

const mockGetByToken = vi.fn();
vi.mock("@/lib/dynamodb", () => ({
  getConversationByShareToken: (...args: unknown[]) => mockGetByToken(...args),
}));

import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";

function createRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/shared/some-token", {
    method: "GET",
  });
}

const validToken = "11111111-2222-4333-8444-555555555555";

describe("GET /api/shared/[shareToken]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthRead.mockResolvedValue({
      userId: "viewer-user",
      userEmail: "viewer@example.com",
    });
  });

  it("should return shared conversation with owner metadata", async () => {
    const mockConversation = {
      userId: "owner-user",
      conversationId: "conv-1",
      title: "Shared Conv",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      messageCount: 1,
      createdAt: 1000,
      updatedAt: 2000,
      isShared: true,
    };
    mockGetByToken.mockResolvedValue(mockConversation);

    const params = { params: Promise.resolve({ shareToken: validToken }) };
    const response = await GET(createRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.conversation.conversationId).toBe("conv-1");
    expect(body.conversation.title).toBe("Shared Conv");
    expect(body.owner.userId).toBe("owner-user");
    expect(body.shareToken).toBe(validToken);
  });

  it("should return 404 for invalid token format", async () => {
    const params = {
      params: Promise.resolve({ shareToken: "not-a-uuid" }),
    };

    const response = await GET(createRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Not Found");
  });

  it("should return 404 for revoked/unknown token", async () => {
    mockGetByToken.mockResolvedValue(null);

    const params = { params: Promise.resolve({ shareToken: validToken }) };
    const response = await GET(createRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Not Found");
  });

  it("should return auth error if not authenticated", async () => {
    mockAuthRead.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const params = { params: Promise.resolve({ shareToken: validToken }) };
    const response = await GET(createRequest(), params);

    expect(response.status).toBe(401);
  });
});
