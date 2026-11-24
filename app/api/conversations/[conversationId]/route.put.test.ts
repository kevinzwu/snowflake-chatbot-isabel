/**
 * Tests for PUT /api/conversations/[conversationId] (update messages endpoint)
 *
 * Prior to this PR, the PUT handler had zero test coverage (only PATCH/rename
 * was tested in this directory) — see PR #155 review.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock security modules
const mockAuthWrite = vi.fn();
vi.mock("@/lib/security/route-hardening", () => ({
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

const mockSanitizeInput = vi.fn((input: string) => input);
vi.mock("@/lib/security/input-sanitizer", () => ({
  sanitizeInput: (input: string) => mockSanitizeInput(input),
}));

const mockValidateRouteId = vi.fn();
vi.mock("@/lib/security/validators", () => ({
  validateRouteId: (...args: unknown[]) => mockValidateRouteId(...args),
}));

// Mock DynamoDB
const mockUpdateConversation = vi.fn();
const mockGetConversation = vi.fn();
const mockRenameConversation = vi.fn();
const mockDeleteConversation = vi.fn();
vi.mock("@/lib/dynamodb", () => ({
  CONVERSATION_RETENTION: {
    MAX_TITLE_LENGTH: 100,
    MAX_BODY_SIZE_BYTES: 2 * 1024 * 1024,
    MAX_MESSAGES: 200,
    MAX_CONTENT_BLOCKS: 50,
  },
  // Real class (not a bare mock) so `error instanceof ConversationStorageConfigError`
  // in the route's catch block behaves correctly under test.
  ConversationStorageConfigError: class ConversationStorageConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ConversationStorageConfigError";
    }
  },
  updateConversation: (...args: unknown[]) => mockUpdateConversation(...args),
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  renameConversation: (...args: unknown[]) => mockRenameConversation(...args),
  deleteConversation: (...args: unknown[]) => mockDeleteConversation(...args),
}));

// Import AFTER mocks
import { PUT } from "@/app/api/conversations/[conversationId]/route";
import { NextRequest } from "next/server";

function createRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/conversations/conv-123", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

function createRouteParams(conversationId: string = "conv-123") {
  return { params: Promise.resolve({ conversationId }) };
}

const validMessages = [
  { role: "user", content: [{ text: "Hello" }] },
  { role: "assistant", content: [{ text: "Hi there" }] },
];

describe("PUT /api/conversations/[conversationId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthWrite.mockResolvedValue({
      userId: "test-user",
      userEmail: "test@example.com",
    });
    mockValidateRouteId.mockReturnValue({
      isValid: true,
      value: "conv-123",
    });
    mockSanitizeInput.mockImplementation((input: string) => input);
  });

  it("should update a conversation successfully", async () => {
    mockUpdateConversation.mockResolvedValue({
      userId: "test-user",
      conversationId: "conv-123",
      messages: validMessages,
      messageCount: 2,
      updatedAt: Date.now(),
    });

    const req = createRequest({ messages: validMessages });
    const response = await PUT(req, createRouteParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.conversationId).toBe("conv-123");
    expect(mockUpdateConversation).toHaveBeenCalledOnce();
  });

  it("should return 400 for invalid conversation ID format", async () => {
    mockValidateRouteId.mockReturnValue({
      isValid: false,
      error: "Invalid UUID format",
    });

    const req = createRequest({ messages: validMessages });
    const response = await PUT(req, createRouteParams("bad-id"));

    expect(response.status).toBe(400);
    expect(mockUpdateConversation).not.toHaveBeenCalled();
  });

  it("should return 400 when messages is missing", async () => {
    const req = createRequest({ title: "No messages" });
    const response = await PUT(req, createRouteParams());

    expect(response.status).toBe(400);
  });

  it("should return 400 when messages exceeds MAX_MESSAGES", async () => {
    const tooMany = Array.from({ length: 201 }, () => validMessages[0]);
    const req = createRequest({ messages: tooMany });
    const response = await PUT(req, createRouteParams());

    expect(response.status).toBe(400);
    expect(mockUpdateConversation).not.toHaveBeenCalled();
  });

  it("should return 404 when conversation is not found", async () => {
    mockUpdateConversation.mockResolvedValue(null);

    const req = createRequest({ messages: validMessages });
    const response = await PUT(req, createRouteParams());

    expect(response.status).toBe(404);
  });

  it("should return 503 when conversation storage is misconfigured", async () => {
    const { ConversationStorageConfigError } = await import("@/lib/dynamodb");
    mockUpdateConversation.mockRejectedValue(
      new ConversationStorageConfigError(
        "CONVERSATION_S3_BUCKET environment variable is not configured",
      ),
    );

    const req = createRequest({ messages: validMessages });
    const response = await PUT(req, createRouteParams());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("Service Unavailable");
    expect(mockUpdateConversation).toHaveBeenCalledOnce();
  });

  it("should return 500 (not 503) for a generic/unexpected error", async () => {
    mockUpdateConversation.mockRejectedValue(new Error("DynamoDB is down"));

    const req = createRequest({ messages: validMessages });
    const response = await PUT(req, createRouteParams());

    expect(response.status).toBe(500);
  });

  it("should sanitize user message text before saving", async () => {
    mockUpdateConversation.mockResolvedValue({
      conversationId: "conv-123",
      messages: validMessages,
      messageCount: 2,
    });

    const req = createRequest({
      messages: [
        {
          role: "user",
          content: [{ text: '<script>alert("xss")</script>' }],
        },
      ],
    });
    await PUT(req, createRouteParams());

    expect(mockSanitizeInput).toHaveBeenCalled();
  });
});
