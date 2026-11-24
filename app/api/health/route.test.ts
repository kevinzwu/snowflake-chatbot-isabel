/**
 * Tests for /api/health endpoint
 */

import { GET } from "@/app/api/health/route";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("GET /api/health", () => {
  it("should return 200 with healthy status", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.service).toBe("isabel");
    expect(body.timestamp).toBeDefined();
  });

  it("should return a valid ISO timestamp", async () => {
    const response = await GET();
    const body = await response.json();

    const date = new Date(body.timestamp);
    expect(date.getTime()).not.toBeNaN();
  });

  describe("conversationStorage check", () => {
    const originalBucket = process.env.CONVERSATION_S3_BUCKET;
    const originalDynamoLocal = process.env.DYNAMODB_LOCAL;
    const originalAwsRegion = process.env.AWS_REGION;

    beforeEach(() => {
      // Force isLocalDevelopment() to false regardless of the runner's
      // ambient environment. The documented local dev setup commonly sets
      // DYNAMODB_LOCAL=true (README), which would otherwise make
      // getConversationStorageStatus() resolve via the local fallback
      // bucket and report "ok" even with CONVERSATION_S3_BUCKET unset —
      // making the "misconfigured" assertion below flaky depending on the
      // developer's shell (see PR #155 review).
      delete process.env.DYNAMODB_LOCAL;
      vi.stubEnv("NODE_ENV", "production");
    });

    afterEach(() => {
      if (originalBucket !== undefined) {
        process.env.CONVERSATION_S3_BUCKET = originalBucket;
      } else {
        delete process.env.CONVERSATION_S3_BUCKET;
      }
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

    it("reports 'ok' without affecting the 200 status when configured", async () => {
      process.env.CONVERSATION_S3_BUCKET = "test-conversations-bucket";

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.checks.conversationStorage).toBe("ok");
    });

    it("reports 'misconfigured' without affecting the 200 status when unset", async () => {
      delete process.env.CONVERSATION_S3_BUCKET;

      const response = await GET();
      const body = await response.json();

      // Liveness status must stay 200 — a storage misconfiguration is a
      // partial-degradation, not a reason for ALB/ECS to kill the task.
      expect(response.status).toBe(200);
      expect(body.status).toBe("healthy");
      expect(body.checks.conversationStorage).toBe("misconfigured");
    });
  });
});
