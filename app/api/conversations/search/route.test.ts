/**
 * Tests for GET /api/conversations/search
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock security modules
const mockAuthRead = vi.fn();
vi.mock("@/lib/security/route-hardening", () => ({
  authenticateReadRequest: (...args: unknown[]) => mockAuthRead(...args),
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

vi.mock("@/lib/security/input-sanitizer", () => ({
  sanitizeInput: (input: string) => input,
}));

// Mock DynamoDB
const mockSearchConversations = vi.fn();
vi.mock("@/lib/dynamodb", () => ({
  CONVERSATION_RETENTION: {
    MIN_SEARCH_QUERY_LENGTH: 2,
    MAX_SEARCH_QUERY_LENGTH: 200,
  },
  searchConversations: (...args: unknown[]) => mockSearchConversations(...args),
}));

// Import AFTER mocks
import { GET } from "@/app/api/conversations/search/route";
import { NextRequest } from "next/server";

function createSearchRequest(queryString: string): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/conversations/search${queryString}`,
    { method: "GET" },
  );
}

describe("GET /api/conversations/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthRead.mockResolvedValue({ userId: "test-user" });
  });

  it("should return search results for valid query", async () => {
    const mockResult = {
      conversations: [
        {
          conversationId: "conv-1",
          title: "Vulnerability Report",
          createdAt: 1000,
          updatedAt: 2000,
          archived: false,
          messageCount: 3,
        },
      ],
      matchedInContent: { "conv-1": false },
    };
    mockSearchConversations.mockResolvedValue(mockResult);

    const req = createSearchRequest("?q=vulnerability");
    const response = await GET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0].title).toBe("Vulnerability Report");
    expect(mockSearchConversations).toHaveBeenCalledWith(
      "test-user",
      "vulnerability",
    );
  });

  it("should return 400 when query parameter is missing", async () => {
    const req = createSearchRequest("");
    const response = await GET(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("required");
  });

  it("should return 400 when query is too short", async () => {
    const req = createSearchRequest("?q=a");
    const response = await GET(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("at least 2");
  });

  it("should return 400 when query is too long", async () => {
    const longQuery = "a".repeat(201);
    const req = createSearchRequest(`?q=${longQuery}`);
    const response = await GET(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("200");
  });

  it("should return empty results for no matches", async () => {
    mockSearchConversations.mockResolvedValue({
      conversations: [],
      matchedInContent: {},
    });

    const req = createSearchRequest("?q=nonexistent");
    const response = await GET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.conversations).toHaveLength(0);
  });

  it("should indicate content matches in results", async () => {
    mockSearchConversations.mockResolvedValue({
      conversations: [
        {
          conversationId: "conv-1",
          title: "General Chat",
          createdAt: 1000,
          updatedAt: 2000,
          archived: false,
          messageCount: 5,
        },
      ],
      matchedInContent: { "conv-1": true },
    });

    const req = createSearchRequest("?q=critical");
    const response = await GET(req);
    const body = await response.json();

    expect(body.matchedInContent["conv-1"]).toBe(true);
  });

  it("should return 500 on server error", async () => {
    mockSearchConversations.mockRejectedValue(new Error("DB error"));

    const req = createSearchRequest("?q=test");
    const response = await GET(req);

    expect(response.status).toBe(500);
  });
});
