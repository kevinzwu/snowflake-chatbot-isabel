/**
 * Tests for authorization module
 *
 * Tests cover:
 * - Group parsing from environment variables
 * - isUserInAllowedGroups() - group membership checks
 * - isUserAdmin() - admin elevation checks
 * - authorizeSession() - full session validation
 * - Fail-closed behavior (deny when no groups configured)
 * - Case-insensitive group matching
 * - logAuthorizationAttempt()
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Authorization", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getAllowedGroups / getAdminGroups", () => {
    it("should parse comma-separated group IDs", async () => {
      process.env.ALLOWED_AZURE_AD_GROUPS = "group-a, group-b, group-c";
      process.env.ADMIN_AZURE_AD_GROUPS = "admin-1";

      const mod = await import("@/lib/auth/authorization");
      expect(mod.getAllowedGroups()).toEqual(["group-a", "group-b", "group-c"]);
      expect(mod.getAdminGroups()).toEqual(["admin-1"]);
    });

    it("should return empty array for empty env var", async () => {
      process.env.ALLOWED_AZURE_AD_GROUPS = "";
      process.env.ADMIN_AZURE_AD_GROUPS = "";

      const mod = await import("@/lib/auth/authorization");
      expect(mod.getAllowedGroups()).toEqual([]);
      expect(mod.getAdminGroups()).toEqual([]);
    });

    it("should handle whitespace-only env var", async () => {
      process.env.ALLOWED_AZURE_AD_GROUPS = "   ";
      const mod = await import("@/lib/auth/authorization");
      expect(mod.getAllowedGroups()).toEqual([]);
    });

    it("should lowercase group IDs", async () => {
      process.env.ALLOWED_AZURE_AD_GROUPS = "Group-A,GROUP-B";
      const mod = await import("@/lib/auth/authorization");
      expect(mod.getAllowedGroups()).toEqual(["group-a", "group-b"]);
    });
  });

  describe("isUserInAllowedGroups()", () => {
    it("should return true when user is in an allowed group", async () => {
      process.env.ALLOWED_AZURE_AD_GROUPS = "group-1-id,group-2-id";
      process.env.ADMIN_AZURE_AD_GROUPS = "";
      const mod = await import("@/lib/auth/authorization");

      expect(mod.isUserInAllowedGroups(["group-1-id"])).toBe(true);
    });

    it("should return true when user is in admin group", async () => {
      process.env.ALLOWED_AZURE_AD_GROUPS = "";
      process.env.ADMIN_AZURE_AD_GROUPS = "admin-group-id";
      const mod = await import("@/lib/auth/authorization");

      expect(mod.isUserInAllowedGroups(["admin-group-id"])).toBe(true);
    });

    it("should return false when user has no matching groups", async () => {
      process.env.ALLOWED_AZURE_AD_GROUPS = "group-1-id";
      process.env.ADMIN_AZURE_AD_GROUPS = "";
      const mod = await import("@/lib/auth/authorization");

      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(mod.isUserInAllowedGroups(["other-group"])).toBe(false);
    });

    it("should return false when user has no groups (undefined)", async () => {
      process.env.ALLOWED_AZURE_AD_GROUPS = "group-1-id";
      const mod = await import("@/lib/auth/authorization");

      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(mod.isUserInAllowedGroups(undefined)).toBe(false);
    });

    it("should return false when user has empty groups array", async () => {
      process.env.ALLOWED_AZURE_AD_GROUPS = "group-1-id";
      const mod = await import("@/lib/auth/authorization");

      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(mod.isUserInAllowedGroups([])).toBe(false);
    });

    it("should deny access when no groups configured (fail-closed)", async () => {
      process.env.ALLOWED_AZURE_AD_GROUPS = "";
      process.env.ADMIN_AZURE_AD_GROUPS = "";
      const mod = await import("@/lib/auth/authorization");

      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(mod.isUserInAllowedGroups(["any-group"])).toBe(false);
    });

    it("should be case-insensitive for group matching", async () => {
      process.env.ALLOWED_AZURE_AD_GROUPS = "Group-1-ID";
      process.env.ADMIN_AZURE_AD_GROUPS = "";
      const mod = await import("@/lib/auth/authorization");

      expect(mod.isUserInAllowedGroups(["GROUP-1-id"])).toBe(true);
    });
  });

  describe("isUserAdmin()", () => {
    it("should return true when user is in admin group", async () => {
      process.env.ADMIN_AZURE_AD_GROUPS = "admin-group-id";
      const mod = await import("@/lib/auth/authorization");

      expect(mod.isUserAdmin(["admin-group-id"])).toBe(true);
    });

    it("should return false when user is not in admin group", async () => {
      process.env.ADMIN_AZURE_AD_GROUPS = "admin-group-id";
      const mod = await import("@/lib/auth/authorization");

      expect(mod.isUserAdmin(["regular-group"])).toBe(false);
    });

    it("should return false when no admin groups configured", async () => {
      process.env.ADMIN_AZURE_AD_GROUPS = "";
      const mod = await import("@/lib/auth/authorization");

      expect(mod.isUserAdmin(["any-group"])).toBe(false);
    });

    it("should return false for undefined groups", async () => {
      process.env.ADMIN_AZURE_AD_GROUPS = "admin-group-id";
      const mod = await import("@/lib/auth/authorization");

      expect(mod.isUserAdmin(undefined)).toBe(false);
    });

    it("should return false for empty groups", async () => {
      process.env.ADMIN_AZURE_AD_GROUPS = "admin-group-id";
      const mod = await import("@/lib/auth/authorization");

      expect(mod.isUserAdmin([])).toBe(false);
    });
  });

  describe("authorizeSession()", () => {
    it("should deny access for null session", async () => {
      process.env.ALLOWED_AZURE_AD_GROUPS = "group-1-id";
      const mod = await import("@/lib/auth/authorization");

      const result = mod.authorizeSession(null);
      expect(result.authorized).toBe(false);
      expect(result.isAdmin).toBe(false);
      expect(result.reason).toBe("No session found");
    });

    it("should deny access for session with no user", async () => {
      process.env.ALLOWED_AZURE_AD_GROUPS = "group-1-id";
      const mod = await import("@/lib/auth/authorization");

      const result = mod.authorizeSession({ user: undefined } as any);
      expect(result.authorized).toBe(false);
      expect(result.reason).toBe("No user in session");
    });

    it("should authorize user in allowed group", async () => {
      process.env.ALLOWED_AZURE_AD_GROUPS = "group-1-id";
      process.env.ADMIN_AZURE_AD_GROUPS = "";
      const mod = await import("@/lib/auth/authorization");

      const result = mod.authorizeSession({
        user: {
          id: "user-1",
          name: "Test",
          email: "test@example.com",
          groups: ["group-1-id"],
        },
        groups: ["group-1-id"],
        expires: new Date().toISOString(),
        sessionId: "session-1",
        provider: "azure-ad",
        loginTime: Date.now(),
      });
      expect(result.authorized).toBe(true);
      expect(result.isAdmin).toBe(false);
    });

    it("should identify admin users", async () => {
      process.env.ALLOWED_AZURE_AD_GROUPS = "group-1-id";
      process.env.ADMIN_AZURE_AD_GROUPS = "admin-group-id";
      const mod = await import("@/lib/auth/authorization");

      const result = mod.authorizeSession({
        user: { id: "admin-1", name: "Admin", email: "admin@example.com" },
        groups: ["admin-group-id"],
        expires: new Date().toISOString(),
        sessionId: "session-1",
        provider: "azure-ad",
        loginTime: Date.now(),
      });
      expect(result.authorized).toBe(true);
      expect(result.isAdmin).toBe(true);
    });

    it("should deny user not in any allowed group", async () => {
      process.env.ALLOWED_AZURE_AD_GROUPS = "group-1-id";
      process.env.ADMIN_AZURE_AD_GROUPS = "";
      const mod = await import("@/lib/auth/authorization");

      vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = mod.authorizeSession({
        user: {
          id: "outsider-1",
          name: "Outsider",
          email: "outsider@example.com",
        },
        groups: ["other-group"],
        expires: new Date().toISOString(),
        sessionId: "session-1",
        provider: "azure-ad",
        loginTime: Date.now(),
      });
      expect(result.authorized).toBe(false);
      expect(result.reason).toBe(
        "User is not a member of any authorized group",
      );
    });

    it("should use session.user.groups as fallback", async () => {
      process.env.ALLOWED_AZURE_AD_GROUPS = "group-1-id";
      process.env.ADMIN_AZURE_AD_GROUPS = "";
      const mod = await import("@/lib/auth/authorization");

      const result = mod.authorizeSession({
        user: {
          name: "Test",
          email: "test@example.com",
          groups: ["group-1-id"],
        },
        // No top-level groups property
        expires: new Date().toISOString(),
      } as any);
      expect(result.authorized).toBe(true);
    });
  });

  describe("logAuthorizationAttempt()", () => {
    it("should log authorization attempt with structured JSON", async () => {
      process.env.ALLOWED_AZURE_AD_GROUPS = "group-1-id";
      const mod = await import("@/lib/auth/authorization");

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      mod.logAuthorizationAttempt("user@example.com", "/api/jwt", {
        authorized: true,
        isAdmin: false,
        userGroups: ["group-1-id"],
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("authorization_attempt"),
      );

      const loggedJson = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(loggedJson.user).toBe("user@example.com");
      expect(loggedJson.resource).toBe("/api/jwt");
      expect(loggedJson.status).toBe("GRANTED");

      consoleSpy.mockRestore();
    });

    it("should log DENIED status for unauthorized attempts", async () => {
      const mod = await import("@/lib/auth/authorization");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      mod.logAuthorizationAttempt("hacker@evil.com", "/api/jwt", {
        authorized: false,
        isAdmin: false,
        reason: "Not in allowed groups",
      });

      const loggedJson = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(loggedJson.status).toBe("DENIED");

      consoleSpy.mockRestore();
    });

    it("should handle null email gracefully", async () => {
      const mod = await import("@/lib/auth/authorization");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      mod.logAuthorizationAttempt(null, "/api/jwt", {
        authorized: false,
        isAdmin: false,
      });

      const loggedJson = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(loggedJson.user).toBe("unknown");

      consoleSpy.mockRestore();
    });
  });
});
