import type { AgentMessage } from "@/lib/agent-api/types";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { isLocalDevelopment } from "./client";
import type { MessageRef } from "./types";
import { CONVERSATION_RETENTION } from "./types";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** Default bucket used in local development when CONVERSATION_S3_BUCKET is unset. */
const LOCAL_DEFAULT_BUCKET = "isabel-local-conversations";

/**
 * Thrown when conversation S3 overflow storage is not configured for a
 * non-local environment (missing CONVERSATION_S3_BUCKET). Distinct from
 * generic errors so callers (API routes, health checks) can surface a
 * specific, actionable response instead of an opaque 500.
 */
export class ConversationStorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationStorageConfigError";
  }
}

let s3Client: S3Client | null = null;

/**
 * Resolves local S3 (S3 emulator) credentials from the environment.
 * No in-code default: hardcoded credential strings (even well-known public
 * defaults like S3 emulator's "local") trip static-analysis secret scanners
 * (Snyk CWE-547), so local dev must set these explicitly — see
 * .env.example / docker-compose.yml's s3 service.
 */
function getLocalS3Credentials(): {
  accessKeyId: string;
  secretAccessKey: string;
} {
  const accessKeyId = process.env.S3_LOCAL_ACCESS_KEY;
  const secretAccessKey = process.env.S3_LOCAL_SECRET_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new ConversationStorageConfigError(
      "S3_LOCAL_ACCESS_KEY and S3_LOCAL_SECRET_KEY must be set for local development (see .env.example)",
    );
  }
  return { accessKeyId, secretAccessKey };
}

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = isLocalDevelopment()
      ? new S3Client({
          region: "local",
          endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
          forcePathStyle: true, // required for S3 emulator / path-style local endpoints
          credentials: getLocalS3Credentials(),
        })
      : new S3Client({ region: "us-east-1" });
  }
  return s3Client;
}

function getBucketName(): string {
  const bucket = process.env.CONVERSATION_S3_BUCKET;
  if (bucket) return bucket;

  // Local development: fall back to a well-known bucket name instead of
  // hard-failing, so `npm run dev` works without extra config once S3 emulator is
  // running (see bin/setup-local-s3.js). Deployed environments must set
  // CONVERSATION_S3_BUCKET explicitly — see deploy/aws/app/conversations-bucket.tf.
  if (isLocalDevelopment()) {
    return LOCAL_DEFAULT_BUCKET;
  }

  throw new ConversationStorageConfigError(
    "CONVERSATION_S3_BUCKET environment variable is not configured",
  );
}

/**
 * Cheap (no network call) check of whether conversation S3 overflow storage
 * is configured for the current environment. Used by /api/health to surface
 * this class of misconfiguration immediately instead of only discovering it
 * when a user's large conversation silently fails to save.
 */
export function getConversationStorageStatus(): {
  configured: boolean;
  bucket: string | null;
  local: boolean;
} {
  try {
    return {
      configured: true,
      bucket: getBucketName(),
      local: isLocalDevelopment(),
    };
  } catch {
    return { configured: false, bucket: null, local: isLocalDevelopment() };
  }
}

function getObjectKey(userId: string, conversationId: string): string {
  return `conversations/${userId}/${conversationId}/messages.json.gz`;
}

/**
 * Store conversation messages in S3 when they exceed the DynamoDB item size limit.
 * Messages are gzip-compressed before upload.
 */
export async function storeMessagesInS3(
  userId: string,
  conversationId: string,
  messages: AgentMessage[],
  archived: boolean = false,
): Promise<MessageRef> {
  const client = getS3Client();
  const bucket = getBucketName();
  const key = getObjectKey(userId, conversationId);

  const jsonBytes = Buffer.from(JSON.stringify(messages), "utf-8");
  const compressed = await gzipAsync(jsonBytes);

  // S3 emulator (local dev) rejects SSE headers entirely unless a KMS backend is
  // configured (even AES256), so skip encryption-at-rest locally; production
  // relies on the bucket's default SSE-KMS configuration
  // (deploy/aws/app/conversations-bucket.tf) plus explicit aws:kms here.
  const isLocal = isLocalDevelopment();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: compressed,
      ContentType: "application/json",
      ContentEncoding: "gzip",
      ...(isLocal ? {} : { ServerSideEncryption: "aws:kms" as const }),
      Tagging: `retention=${archived ? "archived" : "default"}`,
    }),
  );

  return {
    bucket,
    key,
    sizeBytes: compressed.length,
  };
}

/**
 * Load conversation messages from S3 and decompress.
 */
export async function loadMessagesFromS3(
  messageRef: MessageRef,
): Promise<AgentMessage[]> {
  const client = getS3Client();

  const response = await client.send(
    new GetObjectCommand({
      Bucket: messageRef.bucket,
      Key: messageRef.key,
    }),
  );

  if (!response.Body) {
    throw new Error(`Empty response body from S3 for key: ${messageRef.key}`);
  }

  const compressed = Buffer.from(await response.Body.transformToByteArray());
  const decompressed = await gunzipAsync(compressed);
  return JSON.parse(decompressed.toString("utf-8")) as AgentMessage[];
}

/**
 * Delete conversation messages from S3.
 * Used by cleanup Lambda or direct delete operations.
 */
export async function deleteMessagesFromS3(
  messageRef: MessageRef,
): Promise<void> {
  const client = getS3Client();

  await client.send(
    new DeleteObjectCommand({
      Bucket: messageRef.bucket,
      Key: messageRef.key,
    }),
  );
}

/**
 * Update S3 object lifecycle tag when a conversation is archived/unarchived.
 *
 * Uses a self-copy (CopyObjectCommand) rather than a plain
 * PutObjectTaggingCommand. S3 lifecycle `expiration.days` rules are always
 * measured from the object's LastModified/creation time, never from when its
 * tags change — a bare tag update does NOT reset that clock. Without the
 * self-copy, an object archived late in its 90-day "default" window would
 * still be deleted on that ORIGINAL schedule (not a fresh 180 days from the
 * archive action), eventually leaving a live DynamoDB record pointing at a
 * deleted S3 object (NoSuchKey). Same failure mode in reverse for unarchive.
 * Copying the object to itself resets LastModified to "now", keeping the
 * lifecycle rules (deploy/aws/app/conversations-bucket.tf) in sync with
 * DynamoDB's own expiresAt reset on each archive/unarchive (see PR #155 review).
 */
export async function updateMessageLifecycleTag(
  messageRef: MessageRef,
  archived: boolean,
): Promise<void> {
  const client = getS3Client();
  const tagging = `retention=${archived ? "archived" : "default"}`;

  // CopySource must be URL-encoded per-segment (not blanket-encoded, which
  // would turn the key's own "/" separators into "%2F" and break the path).
  const encodedKey = messageRef.key
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  await client.send(
    new CopyObjectCommand({
      Bucket: messageRef.bucket,
      Key: messageRef.key,
      CopySource: `${messageRef.bucket}/${encodedKey}`,
      TaggingDirective: "REPLACE",
      Tagging: tagging,
      MetadataDirective: "COPY",
      ...(isLocalDevelopment()
        ? {}
        : { ServerSideEncryption: "aws:kms" as const }),
    }),
  );
}

/**
 * Build a searchText index from messages.
 * Concatenates text blocks from all messages, truncated to MAX_SEARCH_TEXT_BYTES.
 * Used for DynamoDB-side content search without fetching from S3.
 */
export function buildSearchTextIndex(messages: AgentMessage[]): string {
  const parts: string[] = [];
  let totalBytes = 0;

  for (const message of messages) {
    if (!message.content) continue;
    for (const block of message.content) {
      if ("text" in block && typeof block.text === "string") {
        const text = block.text;
        const textBytes = Buffer.byteLength(text, "utf-8");

        if (
          totalBytes + textBytes >
          CONVERSATION_RETENTION.MAX_SEARCH_TEXT_BYTES
        ) {
          // Truncate to fit within limit
          const remaining =
            CONVERSATION_RETENTION.MAX_SEARCH_TEXT_BYTES - totalBytes;
          if (remaining > 0) {
            parts.push(text.slice(0, remaining));
          }
          return parts.join("\n");
        }

        parts.push(text);
        totalBytes += textBytes;
      }
    }
  }

  return parts.join("\n");
}

/**
 * Check if a serialized message array exceeds the S3 overflow threshold.
 */
export function shouldOverflowToS3(messages: AgentMessage[]): boolean {
  const serialized = JSON.stringify(messages);
  return (
    Buffer.byteLength(serialized, "utf-8") >
    CONVERSATION_RETENTION.S3_OVERFLOW_THRESHOLD_BYTES
  );
}
