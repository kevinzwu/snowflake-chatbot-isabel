/**
 * Tests for POST /api/conversations (create conversation)
 * Verifies 409 response on overflow instead of silent deletion.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock security modules
const mockAuthWrite = vi.fn();
vi.mock("@/lib/security/route-hardening", () => ({
  authenticateReadRequest: vi.fn(),
  authenticateWriteRequest: (...args: unknown[]) => mockAuthWrite(...args),
  secureJsonResponse: (data: unknown, status: number = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  },
}));

vi.mock("@/lib/security/api-response", () => ({
  withNoCacheHeaders: (res: Response) => res,
  storageUnavailableResponse: () =>
    new Response(
      JSON.stringify({
        error: "Service Unavailable",
        message: "Conversation storage is temporarily unavailable.",
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    ),
}));

vi.mock("@/lib/security/input-sanitizer", () => ({
  sanitizeInput: (input: string) => input,
}));

// Mock DynamoDB
const mockCountConversations = vi.fn();
const mockCreateConversation = vi.fn();
const mockListConversations = vi.fn();
vi.mock("@/lib/dynamodb", () => ({
  CONVERSATION_RETENTION: {
    MAX_CONVERSATIONS: 200,
    MAX_BODY_SIZE_BYTES: 2 * 1024 * 1024,
    MAX_MESSAGES: 200,
    MAX_CONTENT_BLOCKS: 50,
    MAX_TITLE_LENGTH: 100,
  },
  // Real class (not a bare mock) so `error instanceof ConversationStorageConfigError`
  // in the route's catch block behaves correctly under test.
  ConversationStorageConfigError: class ConversationStorageConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ConversationStorageConfigError";
    }
  },
  countConversations: (...args: unknown[]) => mockCountConversations(...args),
  createConversation: (...args: unknown[]) => mockCreateConversation(...args),
  listConversations: (...args: unknown[]) => mockListConversations(...args),
}));

// Import AFTER mocks
import { POST } from "@/app/api/conversations/route";
import { NextRequest } from "next/server";

function createRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/conversations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

const validMessages = [
  { role: "user", content: [{ text: "Hello" }] },
  { role: "assistant", content: [{ text: "Hi there" }] },
];

describe("POST /api/conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthWrite.mockResolvedValue({ userId: "test-user" });
  });

  it("should create a conversation when under the limit", async () => {
    mockCountConversations.mockResolvedValue(10);
    mockCreateConversation.mockResolvedValue({
      userId: "test-user",
      conversationId: "new-conv",
      title: "Hello",
      messages: validMessages,
      messageCount: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archived: false,
    });

    const req = createRequest({ messages: validMessages });
    const response = await POST(req);

    expect(response.status).toBe(201);
    expect(mockCreateConversation).toHaveBeenCalledOnce();
  });

  it("should return 409 when user has 200 conversations", async () => {
    mockCountConversations.mockResolvedValue(200);

    const req = createRequest({ messages: validMessages });
    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("Limit Reached");
    expect(body.message).toContain("200");
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("should return 409 without silently deleting conversations", async () => {
    mockCountConversations.mockResolvedValue(200);

    const req = createRequest({ messages: validMessages });
    await POST(req);

    // Verify no delete operations were attempted
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("should return 400 for empty messages array", async () => {
    const req = createRequest({ messages: [] });
    const response = await POST(req);

    expect(response.status).toBe(400);
  });

  it("should return 400 for missing messages", async () => {
    const req = createRequest({ title: "No messages" });
    const response = await POST(req);

    expect(response.status).toBe(400);
  });

  it("should pass forkedFrom metadata to createConversation", async () => {
    const forkedFrom = {
      shareToken: "11111111-2222-4333-8444-555555555555",
      conversationId: "22222222-3333-4444-8555-666666666666",
      ownerUserId: "owner-user",
    };

    mockCountConversations.mockResolvedValue(10);
    mockCreateConversation.mockResolvedValue({
      userId: "test-user",
      conversationId: "forked-conv",
      title: "Forked",
      messages: validMessages,
      messageCount: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archived: false,
      forkedFrom,
    });

    const req = createRequest({ messages: validMessages, forkedFrom });
    const response = await POST(req);

    expect(response.status).toBe(201);
    expect(mockCreateConversation).toHaveBeenCalledOnce();
    // Verify forkedFrom was passed through
    const createCall = mockCreateConversation.mock.calls[0];
    const input = createCall[2]; // third arg is the input object
    expect(input.forkedFrom).toEqual(forkedFrom);
  });

  it("should return 503 when conversation storage is misconfigured", async () => {
    const { ConversationStorageConfigError } = await import("@/lib/dynamodb");
    mockCountConversations.mockResolvedValue(10);
    mockCreateConversation.mockRejectedValue(
      new ConversationStorageConfigError(
        "CONVERSATION_S3_BUCKET environment variable is not configured",
      ),
    );

    const req = createRequest({ messages: validMessages });
    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("Service Unavailable");
    expect(mockCreateConversation).toHaveBeenCalledOnce();
  });

  it("should return 500 (not 503) for a generic/unexpected error", async () => {
    mockCountConversations.mockResolvedValue(10);
    mockCreateConversation.mockRejectedValue(new Error("DynamoDB is down"));

    const req = createRequest({ messages: validMessages });
    const response = await POST(req);

    expect(response.status).toBe(500);
  });
});
