/**
 * Tests for DynamoDB conversation functions: renameConversation and searchConversations
 */

import {
  countConversations,
  listConversations,
  renameConversation,
  searchConversations,
} from "@/lib/dynamodb/conversations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoist mock function so it's available before vi.mock factory runs
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

// Mock the DynamoDB client module
vi.mock("@/lib/dynamodb/client", () => ({
  getDynamoDBClient: () => ({
    send: mockSend,
  }),
  getTableNames: () => ({
    conversations: "isabel-test-conversations",
    savedQueries: "isabel-test-saved-queries",
  }),
}));

describe("renameConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should update only the title and updatedAt fields", async () => {
    const mockConversation = {
      userId: "user-1",
      conversationId: "conv-1",
      title: "New Title",
      messages: [],
      messageCount: 0,
      createdAt: 1000,
      updatedAt: Date.now(),
      archived: false,
    };

    mockSend.mockResolvedValueOnce({
      Attributes: mockConversation,
    });

    const result = await renameConversation("user-1", "conv-1", "New Title");

    expect(result).toEqual(mockConversation);
    expect(mockSend).toHaveBeenCalledOnce();

    // Verify the UpdateCommand was called with correct params
    const command = mockSend.mock.calls[0][0];
    expect(command.input.UpdateExpression).toBe(
      "SET #title = :title, #updatedAt = :updatedAt",
    );
    expect(command.input.ExpressionAttributeValues[":title"]).toBe("New Title");
    expect(command.input.ConditionExpression).toBe("userId = :userId");
  });

  it("should truncate title to 100 characters", async () => {
    const longTitle = "A".repeat(200);

    mockSend.mockResolvedValueOnce({
      Attributes: {
        title: "A".repeat(100),
      },
    });

    await renameConversation("user-1", "conv-1", longTitle);

    const command = mockSend.mock.calls[0][0];
    expect(command.input.ExpressionAttributeValues[":title"]).toBe(
      "A".repeat(100),
    );
  });

  it("should return null when conversation is not found", async () => {
    const error = new Error("Condition not met");
    error.name = "ConditionalCheckFailedException";
    mockSend.mockRejectedValueOnce(error);

    const result = await renameConversation("user-1", "conv-missing", "Title");
    expect(result).toBeNull();
  });

  it("should re-throw unexpected errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("Network error"));

    await expect(
      renameConversation("user-1", "conv-1", "Title"),
    ).rejects.toThrow("Network error");
  });

  it("should work on archived conversations (no archived check in condition)", async () => {
    const archivedConv = {
      userId: "user-1",
      conversationId: "conv-1",
      title: "Renamed Archived",
      archived: true,
    };

    mockSend.mockResolvedValueOnce({
      Attributes: archivedConv,
    });

    const result = await renameConversation(
      "user-1",
      "conv-1",
      "Renamed Archived",
    );
    expect(result).toEqual(archivedConv);

    // Verify the condition does NOT check archived status
    const command = mockSend.mock.calls[0][0];
    expect(command.input.ConditionExpression).not.toContain("archived");
  });
});

describe("searchConversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should match conversations by title", async () => {
    // Phase 1: GSI query returns summaries (no messages)
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          conversationId: "conv-1",
          title: "Vulnerability Report Q4",
          messageCount: 3,
          createdAt: 1000,
          updatedAt: 2000,
          archived: false,
        },
        {
          conversationId: "conv-2",
          title: "Different Topic",
          messageCount: 1,
          createdAt: 500,
          updatedAt: 1500,
          archived: false,
        },
      ],
    });
    // Phase 2: BatchGet for non-title-matched conversations
    mockSend.mockResolvedValueOnce({
      Responses: {
        "isabel-test-conversations": [
          {
            userId: "user-1",
            conversationId: "conv-2",
            title: "Different Topic",
            messages: [],
            messageCount: 1,
            createdAt: 500,
            updatedAt: 1500,
            archived: false,
          },
        ],
      },
    });

    const result = await searchConversations("user-1", "vulnerability");

    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0].conversationId).toBe("conv-1");
    expect(result.matchedInContent["conv-1"]).toBe(false);
  });

  it("should match conversations by message content", async () => {
    // Phase 1: GSI query — title doesn't match "critical"
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          conversationId: "conv-1",
          title: "General Chat",
          messageCount: 2,
          createdAt: 1000,
          updatedAt: 2000,
          archived: false,
        },
      ],
    });
    // Phase 2: BatchGet returns full record for content search
    mockSend.mockResolvedValueOnce({
      Responses: {
        "isabel-test-conversations": [
          {
            userId: "user-1",
            conversationId: "conv-1",
            title: "General Chat",
            messages: [
              {
                role: "user",
                content: [{ text: "Show me critical vulnerabilities" }],
              },
              {
                role: "assistant",
                content: [{ text: "Here are the critical findings..." }],
              },
            ],
            messageCount: 2,
            createdAt: 1000,
            updatedAt: 2000,
            archived: false,
          },
        ],
      },
    });

    const result = await searchConversations("user-1", "critical");

    expect(result.conversations).toHaveLength(1);
    expect(result.matchedInContent["conv-1"]).toBe(true);
  });

  it("should return empty results for no matches", async () => {
    // Phase 1: GSI query — title doesn't match
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          conversationId: "conv-1",
          title: "Hello World",
          messageCount: 1,
          createdAt: 1000,
          updatedAt: 2000,
          archived: false,
        },
      ],
    });
    // Phase 2: BatchGet — content doesn't match either
    mockSend.mockResolvedValueOnce({
      Responses: {
        "isabel-test-conversations": [
          {
            userId: "user-1",
            conversationId: "conv-1",
            title: "Hello World",
            messages: [{ role: "user", content: [{ text: "hi there" }] }],
            messageCount: 1,
            createdAt: 1000,
            updatedAt: 2000,
            archived: false,
          },
        ],
      },
    });

    const result = await searchConversations("user-1", "vulnerability");

    expect(result.conversations).toHaveLength(0);
  });

  it("should be case-insensitive", async () => {
    // Phase 1: GSI query — title matches case-insensitively
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          conversationId: "conv-1",
          title: "CRITICAL Vulnerability Analysis",
          messageCount: 0,
          createdAt: 1000,
          updatedAt: 2000,
          archived: false,
        },
      ],
    });
    // No Phase 2 needed — all conversations matched by title

    const result = await searchConversations("user-1", "critical");

    expect(result.conversations).toHaveLength(1);
  });

  it("should sort results by updatedAt descending", async () => {
    // Phase 1: GSI query — both match by title
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          conversationId: "conv-old",
          title: "Vuln Scan 1",
          messageCount: 0,
          createdAt: 100,
          updatedAt: 1000,
          archived: false,
        },
        {
          conversationId: "conv-new",
          title: "Vuln Scan 2",
          messageCount: 0,
          createdAt: 200,
          updatedAt: 3000,
          archived: false,
        },
      ],
    });
    // No Phase 2 needed — all matched by title

    const result = await searchConversations("user-1", "vuln");

    expect(result.conversations[0].conversationId).toBe("conv-new");
    expect(result.conversations[1].conversationId).toBe("conv-old");
  });

  it("should not include full messages in results", async () => {
    // Phase 1: GSI query — title matches
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          conversationId: "conv-1",
          title: "Test Search",
          messageCount: 1,
          createdAt: 1000,
          updatedAt: 2000,
          archived: false,
        },
      ],
    });
    // No Phase 2 needed — matched by title

    const result = await searchConversations("user-1", "test");

    // ConversationSummary should not have messages
    expect(result.conversations[0]).not.toHaveProperty("messages");
    expect(result.conversations[0]).toHaveProperty("conversationId");
    expect(result.conversations[0]).toHaveProperty("title");
    expect(result.conversations[0]).toHaveProperty("messageCount");
  });

  it("should handle empty Items response", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [],
    });

    const result = await searchConversations("user-1", "anything");

    expect(result.conversations).toHaveLength(0);
    expect(result.matchedInContent).toEqual({});
  });

  it("should handle null Items response", async () => {
    mockSend.mockResolvedValueOnce({
      Items: null,
    });

    const result = await searchConversations("user-1", "anything");

    expect(result.conversations).toHaveLength(0);
  });

  it("should prefer title match over content match for matchedInContent flag", async () => {
    // Phase 1: GSI query — title matches "vulnerability"
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          conversationId: "conv-1",
          title: "Vulnerability Report",
          messageCount: 1,
          createdAt: 1000,
          updatedAt: 2000,
          archived: false,
        },
      ],
    });
    // No Phase 2 needed — matched by title

    const result = await searchConversations("user-1", "vulnerability");

    // Should be false because it matched in title (title takes priority)
    expect(result.matchedInContent["conv-1"]).toBe(false);
  });
});

describe("listConversations pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should follow LastEvaluatedKey across multiple pages", async () => {
    // Page 1: returns 2 items + LastEvaluatedKey
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          conversationId: "conv-1",
          title: "First",
          createdAt: 1000,
          updatedAt: 3000,
          archived: false,
          messageCount: 2,
        },
        {
          conversationId: "conv-2",
          title: "Second",
          createdAt: 900,
          updatedAt: 2000,
          archived: false,
          messageCount: 4,
        },
      ],
      LastEvaluatedKey: { userId: { S: "user-1" }, updatedAt: { N: "2000" } },
    });
    // Page 2: returns 1 item, no more pages
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          conversationId: "conv-3",
          title: "Third",
          createdAt: 800,
          updatedAt: 1000,
          archived: false,
          messageCount: 6,
        },
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await listConversations("user-1", 200);

    expect(result.conversations).toHaveLength(3);
    expect(result.conversations[0].conversationId).toBe("conv-1");
    expect(result.conversations[2].conversationId).toBe("conv-3");
    expect(result.hasMore).toBe(false);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("should stop when limit is reached before pages are exhausted", async () => {
    // Page 1: returns 3 items + LastEvaluatedKey (but limit is 2)
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          conversationId: "conv-1",
          title: "First",
          createdAt: 1000,
          updatedAt: 3000,
          archived: false,
          messageCount: 2,
        },
        {
          conversationId: "conv-2",
          title: "Second",
          createdAt: 900,
          updatedAt: 2000,
          archived: false,
          messageCount: 4,
        },
        {
          conversationId: "conv-3",
          title: "Third",
          createdAt: 800,
          updatedAt: 1000,
          archived: false,
          messageCount: 6,
        },
      ],
      LastEvaluatedKey: { userId: { S: "user-1" }, updatedAt: { N: "1000" } },
    });

    const result = await listConversations("user-1", 2);

    expect(result.conversations).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    // Should not make a second call since we already have enough
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe("countConversations pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should accumulate counts across multiple pages", async () => {
    // Page 1: count of 5 + LastEvaluatedKey
    mockSend.mockResolvedValueOnce({
      Count: 5,
      LastEvaluatedKey: { userId: { S: "user-1" }, updatedAt: { N: "2000" } },
    });
    // Page 2: count of 3, no more pages
    mockSend.mockResolvedValueOnce({
      Count: 3,
      LastEvaluatedKey: undefined,
    });

    const count = await countConversations("user-1");

    expect(count).toBe(8);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("should return count from single page when no pagination needed", async () => {
    mockSend.mockResolvedValueOnce({
      Count: 12,
      LastEvaluatedKey: undefined,
    });

    const count = await countConversations("user-1");

    expect(count).toBe(12);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe("searchConversations pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should collect title matches from all pages", async () => {
    // Phase 1, Page 1: first batch of summaries + LastEvaluatedKey
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          conversationId: "conv-1",
          title: "Vuln Report 1",
          messageCount: 2,
          createdAt: 1000,
          updatedAt: 3000,
          archived: false,
        },
      ],
      LastEvaluatedKey: { userId: { S: "user-1" }, updatedAt: { N: "3000" } },
    });
    // Phase 1, Page 2: second batch, no more pages
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          conversationId: "conv-2",
          title: "Vuln Report 2",
          messageCount: 4,
          createdAt: 500,
          updatedAt: 2000,
          archived: false,
        },
      ],
      LastEvaluatedKey: undefined,
    });
    // No Phase 2 needed — both matched by title

    const result = await searchConversations("user-1", "vuln");

    expect(result.conversations).toHaveLength(2);
    expect(result.conversations[0].conversationId).toBe("conv-1");
    expect(result.conversations[1].conversationId).toBe("conv-2");
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

describe("pinConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should throw PinLimitExceeded when user has 10 pinned conversations", async () => {
    const { pinConversation } = await import("@/lib/dynamodb/conversations");

    // GetCommand: conversation exists and is not pinned
    mockSend.mockResolvedValueOnce({
      Item: { conversationId: "conv-1", pinned: false },
    });

    // countPinnedConversations returns 10
    mockSend.mockResolvedValueOnce({ Count: 10 });

    await expect(pinConversation("user-1", "conv-1")).rejects.toMatchObject({
      name: "PinLimitExceeded",
      message:
        "Maximum of 10 pinned conversations allowed. Unpin a conversation first.",
    });

    // GetCommand + count query, no update attempted
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("should pin successfully when under the limit", async () => {
    const { pinConversation } = await import("@/lib/dynamodb/conversations");

    // GetCommand: conversation exists and is not pinned
    mockSend.mockResolvedValueOnce({
      Item: { conversationId: "conv-1", pinned: false },
    });

    // countPinnedConversations returns 5
    mockSend.mockResolvedValueOnce({ Count: 5 });

    // UpdateCommand returns the updated conversation
    mockSend.mockResolvedValueOnce({
      Attributes: {
        userId: "user-1",
        conversationId: "conv-1",
        pinned: true,
        archived: true,
        updatedAt: Date.now(),
      },
    });

    const result = await pinConversation("user-1", "conv-1");
    expect(result).not.toBeNull();
    expect(result?.pinned).toBe(true);
    expect(result?.archived).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it("should return null when conversation not found", async () => {
    const { pinConversation } = await import("@/lib/dynamodb/conversations");

    // GetCommand: conversation does not exist
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await pinConversation("user-1", "conv-missing");
    expect(result).toBeNull();

    // Only the GetCommand should have been called
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("should be idempotent when conversation is already pinned", async () => {
    const { pinConversation } = await import("@/lib/dynamodb/conversations");

    // GetCommand: conversation exists and is already pinned
    mockSend.mockResolvedValueOnce({
      Item: { conversationId: "conv-1", pinned: true },
    });

    // getConversation: full conversation fetch for return value
    mockSend.mockResolvedValueOnce({
      Item: {
        userId: "user-1",
        conversationId: "conv-1",
        pinned: true,
        archived: true,
        updatedAt: Date.now(),
        messages: [],
      },
    });

    const result = await pinConversation("user-1", "conv-1");
    expect(result).not.toBeNull();
    expect(result?.pinned).toBe(true);

    // GetCommand (projection) + getConversation (full), no count or update
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

describe("unpinConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should unpin without changing archived status", async () => {
    const { unpinConversation } = await import("@/lib/dynamodb/conversations");

    mockSend.mockResolvedValueOnce({
      Attributes: {
        userId: "user-1",
        conversationId: "conv-1",
        pinned: false,
        archived: true, // stays archived
        updatedAt: Date.now(),
      },
    });

    const result = await unpinConversation("user-1", "conv-1");
    expect(result).not.toBeNull();
    expect(result?.pinned).toBe(false);
    expect(result?.archived).toBe(true);

    // Verify the UpdateExpression does NOT include archived
    const command = mockSend.mock.calls[0][0];
    expect(command.input.UpdateExpression).not.toContain("#archived");
  });
});
