import { AgentMessageRole, type AgentMessage } from "@/lib/agent-api/types";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONVERSATION_RETENTION } from "./types";

const gzipAsync = promisify(gzip);

// Mock AWS S3 client
const mockSend = vi.fn();

class MockS3Client {
  send = mockSend;
}

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: MockS3Client,
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
  DeleteObjectCommand: class {
    constructor(public input: unknown) {}
  },
  CopyObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));

function makeMessage(
  text: string,
  role: AgentMessageRole = AgentMessageRole.USER,
): AgentMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content: [{ type: "text", text }],
  };
}

describe("conversation-storage", () => {
  const originalEnv = process.env.CONVERSATION_S3_BUCKET;

  beforeEach(() => {
    process.env.CONVERSATION_S3_BUCKET = "test-conversations-bucket";
    mockSend.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CONVERSATION_S3_BUCKET = originalEnv;
    } else {
      delete process.env.CONVERSATION_S3_BUCKET;
    }
  });

  describe("storeMessagesInS3", () => {
    it("should store gzip-compressed messages and return a messageRef", async () => {
      const { storeMessagesInS3 } = await import("./conversation-storage");

      mockSend.mockResolvedValueOnce({});
      const messages = [
        makeMessage("Hello"),
        makeMessage("World", AgentMessageRole.ASSISTANT),
      ];

      const ref = await storeMessagesInS3("user-1", "conv-1", messages);

      expect(ref.bucket).toBe("test-conversations-bucket");
      expect(ref.key).toBe("conversations/user-1/conv-1/messages.json.gz");
      expect(ref.sizeBytes).toBeGreaterThan(0);

      const putCall = mockSend.mock.calls[0][0].input;
      expect(putCall.Bucket).toBe("test-conversations-bucket");
      expect(putCall.Key).toBe("conversations/user-1/conv-1/messages.json.gz");
      expect(putCall.ContentType).toBe("application/json");
      expect(putCall.ContentEncoding).toBe("gzip");
      expect(putCall.ServerSideEncryption).toBe("aws:kms");
    });

    it("should tag with 'archived' when archived flag is true", async () => {
      const { storeMessagesInS3 } = await import("./conversation-storage");

      mockSend.mockResolvedValueOnce({});
      const messages = [makeMessage("test")];

      await storeMessagesInS3("user-1", "conv-1", messages, true);

      const putCall = mockSend.mock.calls[0][0].input;
      expect(putCall.Tagging).toBe("retention=archived");
    });

    it("should tag with 'default' when not archived", async () => {
      const { storeMessagesInS3 } = await import("./conversation-storage");

      mockSend.mockResolvedValueOnce({});
      const messages = [makeMessage("test")];

      await storeMessagesInS3("user-1", "conv-1", messages, false);

      const putCall = mockSend.mock.calls[0][0].input;
      expect(putCall.Tagging).toBe("retention=default");
    });
  });

  describe("loadMessagesFromS3", () => {
    it("should decompress and parse messages from S3", async () => {
      const { loadMessagesFromS3 } = await import("./conversation-storage");

      const messages = [
        makeMessage("Hello"),
        makeMessage("World", AgentMessageRole.ASSISTANT),
      ];
      const compressed = await gzipAsync(
        Buffer.from(JSON.stringify(messages), "utf-8"),
      );

      mockSend.mockResolvedValueOnce({
        Body: {
          transformToByteArray: () => Promise.resolve(compressed),
        },
      });

      const result = await loadMessagesFromS3({
        bucket: "test-conversations-bucket",
        key: "conversations/user-1/conv-1/messages.json.gz",
        sizeBytes: compressed.length,
      });

      expect(result).toHaveLength(2);
      expect(result[0].content[0]).toEqual({ type: "text", text: "Hello" });
      expect(result[1].role).toBe("assistant");
    });

    it("should throw if response body is empty", async () => {
      const { loadMessagesFromS3 } = await import("./conversation-storage");

      mockSend.mockResolvedValueOnce({ Body: null });

      await expect(
        loadMessagesFromS3({
          bucket: "test-bucket",
          key: "test-key",
          sizeBytes: 100,
        }),
      ).rejects.toThrow("Empty response body");
    });
  });

  describe("deleteMessagesFromS3", () => {
    it("should send a DeleteObject command", async () => {
      const { deleteMessagesFromS3 } = await import("./conversation-storage");

      mockSend.mockResolvedValueOnce({});

      await deleteMessagesFromS3({
        bucket: "test-conversations-bucket",
        key: "conversations/user-1/conv-1/messages.json.gz",
        sizeBytes: 100,
      });

      const deleteCall = mockSend.mock.calls[0][0].input;
      expect(deleteCall.Bucket).toBe("test-conversations-bucket");
      expect(deleteCall.Key).toBe(
        "conversations/user-1/conv-1/messages.json.gz",
      );
    });
  });

  describe("updateMessageLifecycleTag", () => {
    it("should set retention=archived tag when archived", async () => {
      const { updateMessageLifecycleTag } =
        await import("./conversation-storage");

      mockSend.mockResolvedValueOnce({});

      await updateMessageLifecycleTag(
        {
          bucket: "test-bucket",
          key: "test-key",
          sizeBytes: 100,
        },
        true,
      );

      const copyCall = mockSend.mock.calls[0][0].input;
      expect(copyCall.TaggingDirective).toBe("REPLACE");
      expect(copyCall.Tagging).toBe("retention=archived");
    });

    it("should set retention=default tag when unarchived", async () => {
      const { updateMessageLifecycleTag } =
        await import("./conversation-storage");

      mockSend.mockResolvedValueOnce({});

      await updateMessageLifecycleTag(
        {
          bucket: "test-bucket",
          key: "test-key",
          sizeBytes: 100,
        },
        false,
      );

      const copyCall = mockSend.mock.calls[0][0].input;
      expect(copyCall.TaggingDirective).toBe("REPLACE");
      expect(copyCall.Tagging).toBe("retention=default");
    });

    it("copies the object to itself to reset S3's lifecycle age clock (see PR #155 review)", async () => {
      // A bare tag update does NOT reset the LastModified timestamp that S3
      // lifecycle `expiration.days` rules are measured from, so archiving/
      // unarchiving must self-copy the object instead of just retagging it.
      const { updateMessageLifecycleTag } =
        await import("./conversation-storage");

      mockSend.mockResolvedValueOnce({});

      await updateMessageLifecycleTag(
        {
          bucket: "test-bucket",
          key: "conversations/user-1/conv-1/messages.json.gz",
          sizeBytes: 100,
        },
        true,
      );

      const copyCall = mockSend.mock.calls[0][0].input;
      expect(copyCall.Bucket).toBe("test-bucket");
      expect(copyCall.Key).toBe("conversations/user-1/conv-1/messages.json.gz");
      expect(copyCall.CopySource).toBe(
        "test-bucket/conversations/user-1/conv-1/messages.json.gz",
      );
      expect(copyCall.MetadataDirective).toBe("COPY");
    });

    it("uses aws:kms server-side encryption (non-local)", async () => {
      const { updateMessageLifecycleTag } =
        await import("./conversation-storage");

      mockSend.mockResolvedValueOnce({});

      await updateMessageLifecycleTag(
        { bucket: "test-bucket", key: "test-key", sizeBytes: 100 },
        true,
      );

      const copyCall = mockSend.mock.calls[0][0].input;
      expect(copyCall.ServerSideEncryption).toBe("aws:kms");
    });
  });

  describe("buildSearchTextIndex", () => {
    it("should concatenate text content from all messages", async () => {
      const { buildSearchTextIndex } = await import("./conversation-storage");

      const messages = [
        makeMessage("First question"),
        makeMessage("Second answer", AgentMessageRole.ASSISTANT),
      ];

      const result = buildSearchTextIndex(messages);
      expect(result).toBe("First question\nSecond answer");
    });

    it("should skip non-text content blocks", async () => {
      const { buildSearchTextIndex } = await import("./conversation-storage");

      const messages: AgentMessage[] = [
        {
          id: "msg-1",
          role: AgentMessageRole.ASSISTANT,
          content: [
            { type: "text", text: "Here are results" },
            {
              type: "tool_results",
              tool_results: { content: [{ type: "text", text: "data" }] },
            },
          ],
        },
      ];

      const result = buildSearchTextIndex(messages);
      expect(result).toBe("Here are results");
    });

    it("should truncate at MAX_SEARCH_TEXT_BYTES", async () => {
      const { buildSearchTextIndex } = await import("./conversation-storage");

      // Create messages that exceed the limit
      const longText = "x".repeat(
        CONVERSATION_RETENTION.MAX_SEARCH_TEXT_BYTES + 1000,
      );
      const messages = [makeMessage(longText)];

      const result = buildSearchTextIndex(messages);
      expect(Buffer.byteLength(result, "utf-8")).toBeLessThanOrEqual(
        CONVERSATION_RETENTION.MAX_SEARCH_TEXT_BYTES,
      );
    });

    it("should handle messages with no content", async () => {
      const { buildSearchTextIndex } = await import("./conversation-storage");

      const messages: AgentMessage[] = [
        { id: "msg-1", role: AgentMessageRole.USER, content: [] },
      ];

      const result = buildSearchTextIndex(messages);
      expect(result).toBe("");
    });
  });

  describe("shouldOverflowToS3", () => {
    it("should return false for small messages", async () => {
      const { shouldOverflowToS3 } = await import("./conversation-storage");

      const messages = [makeMessage("Hello")];
      expect(shouldOverflowToS3(messages)).toBe(false);
    });

    it("should return true for messages exceeding threshold", async () => {
      const { shouldOverflowToS3 } = await import("./conversation-storage");

      // Create a message larger than the 350KB threshold
      const largeText = "x".repeat(
        CONVERSATION_RETENTION.S3_OVERFLOW_THRESHOLD_BYTES + 1000,
      );
      const messages = [makeMessage(largeText)];
      expect(shouldOverflowToS3(messages)).toBe(true);
    });
  });

  describe("bucket configuration (non-local)", () => {
    const originalDynamoLocal = process.env.DYNAMODB_LOCAL;
    const originalAwsRegion = process.env.AWS_REGION;

    beforeEach(() => {
      // Force isLocalDevelopment() to return false regardless of the test
      // runner's ambient NODE_ENV, so these cases exercise the deployed-env
      // (non-local) code path deterministically. NODE_ENV is read-only on
      // process.env's type, so use vi.stubEnv (vitest restores it via
      // vi.unstubAllEnvs() in afterEach).
      delete process.env.DYNAMODB_LOCAL;
      vi.stubEnv("NODE_ENV", "production");
    });

    afterEach(() => {
      if (originalDynamoLocal !== undefined) {
        process.env.DYNAMODB_LOCAL = originalDynamoLocal;
      } else {
        delete process.env.DYNAMODB_LOCAL;
      }
      vi.unstubAllEnvs();
      if (originalAwsRegion !== undefined) {
        process.env.AWS_REGION = originalAwsRegion;
      } else {
        delete process.env.AWS_REGION;
      }
    });

    it("throws ConversationStorageConfigError when CONVERSATION_S3_BUCKET is unset", async () => {
      delete process.env.CONVERSATION_S3_BUCKET;
      const { storeMessagesInS3, ConversationStorageConfigError } =
        await import("./conversation-storage");

      await expect(
        storeMessagesInS3("user-1", "conv-1", [makeMessage("hi")]),
      ).rejects.toThrow(ConversationStorageConfigError);
    });

    it("getConversationStorageStatus reports unconfigured when bucket is unset", async () => {
      delete process.env.CONVERSATION_S3_BUCKET;
      const { getConversationStorageStatus } =
        await import("./conversation-storage");

      expect(getConversationStorageStatus()).toEqual({
        configured: false,
        bucket: null,
        local: false,
      });
    });

    it("getConversationStorageStatus reports configured when bucket is set", async () => {
      process.env.CONVERSATION_S3_BUCKET = "test-conversations-bucket";
      const { getConversationStorageStatus } =
        await import("./conversation-storage");

      expect(getConversationStorageStatus()).toEqual({
        configured: true,
        bucket: "test-conversations-bucket",
        local: false,
      });
    });

    it("uses aws:kms server-side encryption", async () => {
      process.env.CONVERSATION_S3_BUCKET = "test-conversations-bucket";
      const { storeMessagesInS3 } = await import("./conversation-storage");

      mockSend.mockResolvedValueOnce({});
      await storeMessagesInS3("user-1", "conv-1", [makeMessage("hi")]);

      const putCall = mockSend.mock.calls[0][0].input;
      expect(putCall.ServerSideEncryption).toBe("aws:kms");
    });
  });

  describe("bucket configuration (local development)", () => {
    const originalDynamoLocal = process.env.DYNAMODB_LOCAL;
    const originalAccessKey = process.env.S3_LOCAL_ACCESS_KEY;
    const originalSecretKey = process.env.S3_LOCAL_SECRET_KEY;

    beforeEach(() => {
      process.env.DYNAMODB_LOCAL = "true";
      delete process.env.CONVERSATION_S3_BUCKET;
      process.env.S3_LOCAL_ACCESS_KEY = "test-local-access-key";
      process.env.S3_LOCAL_SECRET_KEY = "test-local-secret-key";
    });

    afterEach(() => {
      if (originalDynamoLocal !== undefined) {
        process.env.DYNAMODB_LOCAL = originalDynamoLocal;
      } else {
        delete process.env.DYNAMODB_LOCAL;
      }
      if (originalAccessKey !== undefined) {
        process.env.S3_LOCAL_ACCESS_KEY = originalAccessKey;
      } else {
        delete process.env.S3_LOCAL_ACCESS_KEY;
      }
      if (originalSecretKey !== undefined) {
        process.env.S3_LOCAL_SECRET_KEY = originalSecretKey;
      } else {
        delete process.env.S3_LOCAL_SECRET_KEY;
      }
    });

    it("falls back to the local default bucket instead of throwing", async () => {
      const { getConversationStorageStatus } =
        await import("./conversation-storage");

      expect(getConversationStorageStatus()).toEqual({
        configured: true,
        bucket: "isabel-local-conversations",
        local: true,
      });
    });

    it("does not set a ServerSideEncryption header (S3 emulator requires an external KMS for any SSE)", async () => {
      const { storeMessagesInS3 } = await import("./conversation-storage");

      mockSend.mockResolvedValueOnce({});
      await storeMessagesInS3("user-1", "conv-1", [makeMessage("hi")]);

      const putCall = mockSend.mock.calls[0][0].input;
      expect(putCall.ServerSideEncryption).toBeUndefined();
    });

    it("still honors an explicit CONVERSATION_S3_BUCKET override", async () => {
      process.env.CONVERSATION_S3_BUCKET = "my-custom-local-bucket";
      const { getConversationStorageStatus } =
        await import("./conversation-storage");

      expect(getConversationStorageStatus()?.bucket).toBe(
        "my-custom-local-bucket",
      );
    });

    it("throws ConversationStorageConfigError when S3_LOCAL_ACCESS_KEY/SECRET_KEY are unset", async () => {
      // No in-code default credential — must be explicitly configured (see
      // .env.example), so a hardcoded fallback doesn't trip
      // secret-scanning tools (Snyk CWE-547).
      delete process.env.S3_LOCAL_ACCESS_KEY;
      delete process.env.S3_LOCAL_SECRET_KEY;
      const { storeMessagesInS3, ConversationStorageConfigError } =
        await import("./conversation-storage");

      await expect(
        storeMessagesInS3("user-1", "conv-1", [makeMessage("hi")]),
      ).rejects.toThrow(ConversationStorageConfigError);
    });
  });
});
