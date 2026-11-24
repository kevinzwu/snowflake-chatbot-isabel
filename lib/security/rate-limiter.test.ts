/**
 * Tests for RateLimiter - sliding window rate limiting
 *
 * Tests cover:
 * - Basic allow/deny behavior
 * - Sliding window correctness
 * - Window expiration and reset
 * - Cleanup of stale entries
 * - Edge cases (exact limit, multiple keys)
 * - Stats reporting
 */

import { RateLimiter } from "@/lib/security/rate-limiter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new RateLimiter({
      windowMs: 60_000, // 1 minute
      maxRequests: 5,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("check()", () => {
    it("should allow requests under the limit", () => {
      const result = limiter.check("user-1");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it("should track remaining requests correctly", () => {
      for (let i = 0; i < 3; i++) {
        limiter.check("user-1");
      }
      const result = limiter.check("user-1");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it("should deny requests at the limit", () => {
      // Exhaust all 5 requests
      for (let i = 0; i < 5; i++) {
        const r = limiter.check("user-1");
        expect(r.allowed).toBe(true);
      }

      // 6th request should be denied
      const result = limiter.check("user-1");
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeDefined();
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it("should return retryAfter in seconds when rate limited", () => {
      for (let i = 0; i < 5; i++) {
        limiter.check("user-1");
      }

      // Advance 30 seconds into the window
      vi.advanceTimersByTime(30_000);

      const result = limiter.check("user-1");
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBe(30); // ~30s remaining
    });

    it("should reset after window expires", () => {
      // Exhaust all requests
      for (let i = 0; i < 5; i++) {
        limiter.check("user-1");
      }
      expect(limiter.check("user-1").allowed).toBe(false);

      // Advance past the window
      vi.advanceTimersByTime(61_000);

      // Should be allowed again with fresh window
      const result = limiter.check("user-1");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it("should track separate keys independently", () => {
      // Exhaust user-1
      for (let i = 0; i < 5; i++) {
        limiter.check("user-1");
      }
      expect(limiter.check("user-1").allowed).toBe(false);

      // user-2 should still be allowed
      const result = limiter.check("user-2");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it("should provide correct resetIn value", () => {
      const result = limiter.check("user-1");
      expect(result.resetIn).toBe(60_000);

      // After 20 seconds
      vi.advanceTimersByTime(20_000);
      const result2 = limiter.check("user-1");
      expect(result2.resetIn).toBe(40_000);
    });
  });

  describe("reset()", () => {
    it("should clear rate limit for a specific key", () => {
      for (let i = 0; i < 5; i++) {
        limiter.check("user-1");
      }
      expect(limiter.check("user-1").allowed).toBe(false);

      limiter.reset("user-1");

      const result = limiter.check("user-1");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it("should not affect other keys when resetting one", () => {
      for (let i = 0; i < 3; i++) {
        limiter.check("user-1");
        limiter.check("user-2");
      }

      limiter.reset("user-1");

      // user-1 resets, user-2 keeps count
      expect(limiter.check("user-1").remaining).toBe(4);
      expect(limiter.check("user-2").remaining).toBe(1);
    });
  });

  describe("getStats()", () => {
    it("should report correct active key count", () => {
      expect(limiter.getStats().activeKeys).toBe(0);

      limiter.check("user-1");
      limiter.check("user-2");
      limiter.check("user-3");

      expect(limiter.getStats().activeKeys).toBe(3);
    });

    it("should report the configuration", () => {
      const stats = limiter.getStats();
      expect(stats.config.windowMs).toBe(60_000);
      expect(stats.config.maxRequests).toBe(5);
    });
  });

  describe("cleanup", () => {
    it("should remove expired entries after window passes", () => {
      limiter.check("user-1");
      limiter.check("user-2");
      expect(limiter.getStats().activeKeys).toBe(2);

      // Advance past the window
      vi.advanceTimersByTime(61_000);

      // Trigger cleanup via timer (setInterval at 60s)
      vi.advanceTimersByTime(60_000);

      // After cleanup, expired entries should be removed
      expect(limiter.getStats().activeKeys).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("should handle empty string key", () => {
      const result = limiter.check("");
      expect(result.allowed).toBe(true);
    });

    it("should handle very long keys", () => {
      const longKey = "a".repeat(1000);
      const result = limiter.check(longKey);
      expect(result.allowed).toBe(true);
    });

    it("should handle rapid successive calls", () => {
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(limiter.check("user-1"));
      }

      // First 5 allowed, rest denied
      expect(results.filter((r) => r.allowed).length).toBe(5);
      expect(results.filter((r) => !r.allowed).length).toBe(5);
    });

    it("should handle single request limit", () => {
      const strictLimiter = new RateLimiter({
        windowMs: 60_000,
        maxRequests: 1,
      });

      expect(strictLimiter.check("user-1").allowed).toBe(true);
      expect(strictLimiter.check("user-1").allowed).toBe(false);
    });
  });
});
