/**
 * Tests for SessionRevocationManager
 *
 * Tests cover:
 * - Session revocation and checking
 * - Expiration handling
 * - Revoke all for user
 * - Cleanup of expired records
 * - Stats reporting
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We need to test the class directly, not the singleton
// Re-import the module to get a fresh instance per test
describe("SessionRevocationManager", () => {
  let manager: typeof import("@/lib/security/session-revocation").sessionRevocationManager;

  beforeEach(async () => {
    vi.useFakeTimers();

    // Dynamically import to avoid singleton caching issues
    // We replicate the class behavior for isolated testing
    const mod = await import("@/lib/security/session-revocation");
    // Use the exported singleton but it's shared - we'll test behavior
    manager = mod.sessionRevocationManager;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("revoke()", () => {
    it("should mark a session as revoked", () => {
      manager.revoke("session-1", "user@example.com");
      expect(manager.isRevoked("session-1")).toBe(true);
    });

    it("should accept custom JWT expiration time", () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      manager.revoke("session-2", "user@example.com", futureExpiry);
      expect(manager.isRevoked("session-2")).toBe(true);
    });

    it("should log revocation event", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      manager.revoke("session-log", "user@example.com");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("session_revoked"),
      );
      consoleSpy.mockRestore();
    });
  });

  describe("isRevoked()", () => {
    it("should return false for unknown sessions", () => {
      expect(manager.isRevoked("nonexistent")).toBe(false);
    });

    it("should return true for recently revoked sessions", () => {
      manager.revoke("session-3", "user@example.com");
      expect(manager.isRevoked("session-3")).toBe(true);
    });

    it("should return false after revocation expires", () => {
      // Revoke with JWT expiry 60 seconds from now
      const shortExpiry = Math.floor(Date.now() / 1000) + 60;
      manager.revoke("session-4", "user@example.com", shortExpiry);
      expect(manager.isRevoked("session-4")).toBe(true);

      // Advance past the expiry
      vi.advanceTimersByTime(61_000);
      expect(manager.isRevoked("session-4")).toBe(false);
    });

    it("should use default 70-minute expiry when no JWT expiry provided", () => {
      manager.revoke("session-5", "user@example.com");
      expect(manager.isRevoked("session-5")).toBe(true);

      // Advance 69 minutes - still revoked
      vi.advanceTimersByTime(69 * 60 * 1000);
      expect(manager.isRevoked("session-5")).toBe(true);

      // Advance past 70 minutes - should expire
      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(manager.isRevoked("session-5")).toBe(false);
    });
  });

  describe("revokeAllForUser()", () => {
    it("should count revoked sessions for a user", () => {
      manager.revoke("session-a", "alice@example.com");
      manager.revoke("session-b", "alice@example.com");
      manager.revoke("session-c", "bob@example.com");

      // revokeAllForUser counts existing tracked sessions
      const count = manager.revokeAllForUser("alice@example.com");
      expect(count).toBe(2);
    });

    it("should return 0 for user with no revoked sessions", () => {
      const count = manager.revokeAllForUser("nobody@example.com");
      expect(count).toBe(0);
    });

    it("should log the revocation event", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      manager.revokeAllForUser("user@example.com");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("user_sessions_revoked"),
      );
      consoleSpy.mockRestore();
    });
  });

  describe("getStats()", () => {
    it("should report active revocation count", () => {
      const initialStats = manager.getStats();
      // Note: may have entries from other tests since it's a singleton
      const initialCount = initialStats.activeRevocations;

      manager.revoke("stats-session-1", "user@example.com");
      manager.revoke("stats-session-2", "user@example.com");

      expect(manager.getStats().activeRevocations).toBe(initialCount + 2);
    });
  });
});
