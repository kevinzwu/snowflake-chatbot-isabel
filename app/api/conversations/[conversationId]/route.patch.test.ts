/**
 * Tests for PATCH /api/conversations/[conversationId] (rename endpoint)
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
const mockRenameConversation = vi.fn();
const mockGetConversation = vi.fn();
const mockUpdateConversation = vi.fn();
const mockDeleteConversation = vi.fn();
vi.mock("@/lib/dynamodb", () => ({
  CONVERSATION_RETENTION: {
    MAX_TITLE_LENGTH: 100,
    MAX_BODY_SIZE_BYTES: 2 * 1024 * 1024,
    MAX_MESSAGES: 200,
    MAX_CONTENT_BLOCKS: 50,
  },
  renameConversation: (...args: unknown[]) => mockRenameConversation(...args),
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  updateConversation: (...args: unknown[]) => mockUpdateConversation(...args),
  deleteConversation: (...args: unknown[]) => mockDeleteConversation(...args),
}));

// Import AFTER mocks
import { PATCH } from "@/app/api/conversations/[conversationId]/route";
import { NextRequest } from "next/server";

function createRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/conversations/conv-123", {
    method: "PATCH",
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

describe("PATCH /api/conversations/[conversationId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthWrite.mockResolvedValue({ userId: "test-user" });
    mockValidateRouteId.mockReturnValue({
      isValid: true,
      value: "conv-123",
    });
    mockSanitizeInput.mockImplementation((input: string) => input);
  });

  it("should rename a conversation successfully", async () => {
    const renamedConv = {
      userId: "test-user",
      conversationId: "conv-123",
      title: "My Custom Name",
      updatedAt: Date.now(),
    };
    mockRenameConversation.mockResolvedValue(renamedConv);

    const req = createRequest({ title: "My Custom Name" });
    const response = await PATCH(req, createRouteParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.title).toBe("My Custom Name");
    expect(mockRenameConversation).toHaveBeenCalledWith(
      "test-user",
      "conv-123",
      "My Custom Name",
    );
  });

  it("should return 400 when title is missing", async () => {
    const req = createRequest({});
    const response = await PATCH(req, createRouteParams());

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toBe("Title is required");
  });

  it("should return 400 when title is empty after trimming", async () => {
    const req = createRequest({ title: "   " });
    const response = await PATCH(req, createRouteParams());

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toBe("Title cannot be empty");
  });

  it("should return 400 when title exceeds max length", async () => {
    const longTitle = "A".repeat(101);
    const req = createRequest({ title: longTitle });
    const response = await PATCH(req, createRouteParams());

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("100 characters");
  });

  it("should return 400 for invalid conversation ID format", async () => {
    mockValidateRouteId.mockReturnValue({
      isValid: false,
      error: "Invalid UUID format",
    });

    const req = createRequest({ title: "New Name" });
    const response = await PATCH(req, createRouteParams("bad-id"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toBe("Invalid UUID format");
  });

  it("should return 404 when conversation is not found", async () => {
    mockRenameConversation.mockResolvedValue(null);

    const req = createRequest({ title: "New Name" });
    const response = await PATCH(req, createRouteParams());

    expect(response.status).toBe(404);
  });

  it("should sanitize the title before saving", async () => {
    mockSanitizeInput.mockReturnValue("Cleaned Title");
    mockRenameConversation.mockResolvedValue({
      title: "Cleaned Title",
    });

    const req = createRequest({ title: '<script>alert("xss")</script>' });
    await PATCH(req, createRouteParams());

    expect(mockSanitizeInput).toHaveBeenCalled();
    expect(mockRenameConversation).toHaveBeenCalledWith(
      "test-user",
      "conv-123",
      "Cleaned Title",
    );
  });

  it("should trim title whitespace", async () => {
    mockRenameConversation.mockResolvedValue({
      title: "Trimmed Title",
    });

    const req = createRequest({ title: "  Trimmed Title  " });
    await PATCH(req, createRouteParams());

    expect(mockSanitizeInput).toHaveBeenCalledWith("Trimmed Title");
  });
});
