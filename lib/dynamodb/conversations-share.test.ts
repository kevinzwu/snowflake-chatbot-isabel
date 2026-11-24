/**
 * Tests for DynamoDB conversation sharing functions:
 * shareConversation, unshareConversation, getConversationByShareToken
 */

import {
  getConversationByShareToken,
  shareConversation,
  unshareConversation,
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

// Mock S3 functions
vi.mock("@/lib/dynamodb/conversation-storage", () => ({
  loadMessagesFromS3: vi.fn().mockResolvedValue([]),
  saveMessagesToS3: vi.fn().mockResolvedValue("s3://bucket/key"),
}));

describe("shareConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should generate a share token and update the conversation", async () => {
    // First call: getConversation (GetCommand)
    mockSend.mockResolvedValueOnce({
      Item: {
        userId: "user-1",
        conversationId: "conv-1",
        title: "Test",
        messages: [],
        isShared: false,
      },
    });
    // Second call: UpdateCommand
    mockSend.mockResolvedValueOnce({ Attributes: {} });

    const result = await shareConversation("user-1", "conv-1");

    expect(result.shareToken).toBeDefined();
    expect(result.shareToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(result.alreadyShared).toBe(false);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("should return existing token if already shared (idempotent)", async () => {
    // getConversation returns already-shared conversation
    mockSend.mockResolvedValueOnce({
      Item: {
        userId: "user-1",
        conversationId: "conv-1",
        title: "Test",
        messages: [],
        isShared: true,
        shareToken: "existing-token-uuid",
      },
    });

    const result = await shareConversation("user-1", "conv-1");

    expect(result.shareToken).toBe("existing-token-uuid");
    expect(result.alreadyShared).toBe(true);
    // Only 1 call (getConversation), no UpdateCommand
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("should throw if conversation not found", async () => {
    // getConversation returns no Item
    mockSend.mockResolvedValueOnce({ Item: undefined });

    await expect(shareConversation("user-1", "conv-1")).rejects.toThrow(
      "Conversation not found",
    );
  });
});

describe("unshareConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should remove shareToken and set isShared to false", async () => {
    mockSend.mockResolvedValueOnce({});

    await unshareConversation("user-1", "conv-1");

    expect(mockSend).toHaveBeenCalledOnce();
    const command = mockSend.mock.calls[0][0];
    expect(command.input.UpdateExpression).toContain("REMOVE #shareToken");
    expect(command.input.ExpressionAttributeValues[":isShared"]).toBe(false);
  });

  it("should throw if conversation not found (condition check fails)", async () => {
    const error = new Error("ConditionalCheckFailedException");
    error.name = "ConditionalCheckFailedException";
    mockSend.mockRejectedValueOnce(error);

    await expect(unshareConversation("user-1", "conv-1")).rejects.toThrow(
      "Conversation not found",
    );
  });

  it("should be idempotent (succeeds even if not currently shared)", async () => {
    mockSend.mockResolvedValueOnce({});

    await expect(
      unshareConversation("user-1", "conv-1"),
    ).resolves.toBeUndefined();
  });
});

describe("getConversationByShareToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return conversation when token is valid and shared", async () => {
    const mockConversation = {
      userId: "user-1",
      conversationId: "conv-1",
      title: "Shared Conv",
      messages: [
        { id: "1", role: "user", content: [{ type: "text", text: "hi" }] },
      ],
      isShared: true,
      shareToken: "valid-token",
      sharedAt: Date.now(),
    };

    mockSend.mockResolvedValueOnce({ Items: [mockConversation] });

    const result = await getConversationByShareToken("valid-token");

    expect(result).not.toBeNull();
    expect(result?.conversationId).toBe("conv-1");
    expect(result?.isShared).toBe(true);

    // Verify GSI query
    const command = mockSend.mock.calls[0][0];
    expect(command.input.IndexName).toBe("shareToken-index");
    expect(command.input.ExpressionAttributeValues[":shareToken"]).toBe(
      "valid-token",
    );
  });

  it("should return null for invalid/unknown token", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await getConversationByShareToken("unknown-token");

    expect(result).toBeNull();
  });

  it("should return null if conversation exists but isShared is false", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          userId: "user-1",
          conversationId: "conv-1",
          isShared: false,
          shareToken: "token",
        },
      ],
    });

    const result = await getConversationByShareToken("token");

    expect(result).toBeNull();
  });
});
