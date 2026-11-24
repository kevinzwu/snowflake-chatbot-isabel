/**
 * Tests for POST/DELETE /api/conversations/[conversationId]/share
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthWrite = vi.fn();
const mockAuthRead = vi.fn();
vi.mock("@/lib/security/route-hardening", () => ({
  authenticateWriteRequest: (...args: unknown[]) => mockAuthWrite(...args),
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

const mockShareConversation = vi.fn();
const mockUnshareConversation = vi.fn();
vi.mock("@/lib/dynamodb", () => ({
  shareConversation: (...args: unknown[]) => mockShareConversation(...args),
  unshareConversation: (...args: unknown[]) => mockUnshareConversation(...args),
}));

vi.mock("@/lib/config/app-config", () => ({
  getAppConfig: () => ({ baseUrl: "https://app.example.com" }),
}));

vi.mock("@/lib/security/validators", () => ({
  validateRouteId: (id: string) => ({
    isValid: /^[0-9a-f-]{36}$/.test(id),
    value: id,
    error: "Invalid ID format",
  }),
}));

import { NextRequest, NextResponse } from "next/server";
import { DELETE, POST } from "./route";

function createRequest(method: string): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/conversations/conv-123/share",
    { method, headers: { Origin: "http://localhost:3000" } },
  );
}

const validConversationId = "11111111-2222-4333-8444-555555555555";
const routeParams = {
  params: Promise.resolve({ conversationId: validConversationId }),
};

describe("POST /api/conversations/[id]/share", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthWrite.mockResolvedValue({
      userId: "user-1",
      userEmail: "test@example.com",
    });
  });

  it("should return share token on success", async () => {
    mockShareConversation.mockResolvedValue({
      shareToken: "new-token-uuid",
      alreadyShared: false,
    });

    const response = await POST(createRequest("POST"), routeParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.shareToken).toBe("new-token-uuid");
    expect(body.alreadyShared).toBe(false);
    expect(body.shareUrl).toBe("https://app.example.com/shared/new-token-uuid");
  });

  it("should return existing token if already shared", async () => {
    mockShareConversation.mockResolvedValue({
      shareToken: "existing-token",
      alreadyShared: true,
    });

    const response = await POST(createRequest("POST"), routeParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.alreadyShared).toBe(true);
  });

  it("should return 404 if conversation not found", async () => {
    mockShareConversation.mockRejectedValue(
      new Error("Conversation not found"),
    );

    const response = await POST(createRequest("POST"), routeParams);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Not Found");
  });

  it("should return 400 for invalid conversation ID", async () => {
    const badParams = {
      params: Promise.resolve({ conversationId: "invalid!@#" }),
    };

    const response = await POST(createRequest("POST"), badParams);

    expect(response.status).toBe(400);
  });

  it("should return auth error if not authenticated", async () => {
    mockAuthWrite.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const response = await POST(createRequest("POST"), routeParams);

    expect(response.status).toBe(401);
  });
});

describe("DELETE /api/conversations/[id]/share", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthWrite.mockResolvedValue({
      userId: "user-1",
      userEmail: "test@example.com",
    });
  });

  it("should revoke share successfully", async () => {
    mockUnshareConversation.mockResolvedValue(undefined);

    const response = await DELETE(createRequest("DELETE"), routeParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe("Share revoked");
  });

  it("should return 404 if conversation not found", async () => {
    mockUnshareConversation.mockRejectedValue(
      new Error("Conversation not found"),
    );

    const response = await DELETE(createRequest("DELETE"), routeParams);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Not Found");
  });
});
