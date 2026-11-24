/**
 * Tests for OAuth Service Account Validation
 *
 * Tests cover:
 * - loadServiceAccounts() configuration parsing
 * - Zod schema validation
 * - validateOAuthToken() behavior (mocked JWKS verification)
 * - Client allowlist enforcement
 * - Error handling for various failure modes
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock jose module before importing the module under test
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

import {
  reloadServiceAccounts,
  validateOAuthToken,
} from "@/lib/security/oauth-service-accounts";
import { jwtVerify } from "jose";

const mockedJwtVerify = vi.mocked(jwtVerify);

describe("OAuth Service Accounts", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset module cache for env-dependent config
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.AZURE_AD_TENANT_ID = "test-tenant-id";
    process.env.AZURE_AD_CLIENT_ID = "test-client-id";
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("loadServiceAccounts via reloadServiceAccounts()", () => {
    it("should return empty array when OAUTH_SERVICE_ACCOUNTS is not set", () => {
      delete process.env.OAUTH_SERVICE_ACCOUNTS;
      // reloadServiceAccounts reloads from env
      reloadServiceAccounts();
      // No errors thrown
    });

    it("should return empty array for invalid JSON", () => {
      process.env.OAUTH_SERVICE_ACCOUNTS = "not-valid-json";
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      reloadServiceAccounts();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("invalid JSON"),
        expect.anything(),
      );
      consoleSpy.mockRestore();
    });

    it("should return empty array for schema validation failure", () => {
      // Missing required fields
      process.env.OAUTH_SERVICE_ACCOUNTS = JSON.stringify([
        { clientId: "", name: "incomplete" },
      ]);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      reloadServiceAccounts();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("validation failed"),
        expect.anything(),
      );
      consoleSpy.mockRestore();
    });

    it("should load valid service accounts", () => {
      process.env.OAUTH_SERVICE_ACCOUNTS = JSON.stringify([
        {
          clientId: "valid-client-id",
          name: "Test Service",
          scopes: ["snowflake:read"],
          enabled: true,
        },
      ]);
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      reloadServiceAccounts();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Loaded 1 OAuth service account"),
      );
      consoleSpy.mockRestore();
    });
  });

  describe("validateOAuthToken()", () => {
    beforeEach(() => {
      // Set up valid service accounts
      process.env.OAUTH_SERVICE_ACCOUNTS = JSON.stringify([
        {
          clientId: "allowed-client-id",
          name: "Allowed Service",
          scopes: ["snowflake:read"],
          enabled: true,
        },
        {
          clientId: "disabled-client-id",
          name: "Disabled Service",
          scopes: ["snowflake:read"],
          enabled: false,
        },
      ]);
      reloadServiceAccounts();
    });

    it("should return invalid for empty token", async () => {
      const result = await validateOAuthToken("");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("missing_token");
    });

    it("should return invalid when Azure AD config is missing", async () => {
      process.env.AZURE_AD_TENANT_ID = "";
      process.env.AZURE_AD_CLIENT_ID = "";

      // Need to re-import to pick up changed env
      vi.resetModules();
      vi.mock("jose", () => ({
        createRemoteJWKSet: vi.fn(() => vi.fn()),
        jwtVerify: vi.fn(),
      }));

      const mod = await import("@/lib/security/oauth-service-accounts");
      const result = await mod.validateOAuthToken("some-token");
      expect(result).toEqual({ valid: false, reason: "server_config_error" });
    });

    it("should validate a valid token from allowed client", async () => {
      mockedJwtVerify.mockResolvedValueOnce({
        payload: {
          azp: "allowed-client-id",
          iss: "https://login.microsoftonline.com/test-tenant-id/v2.0",
          aud: "test-client-id",
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        },
        protectedHeader: { alg: "RS256", kid: "test-key" },
        key: {} as any,
      } as any);

      const result = await validateOAuthToken("valid-bearer-token");
      expect(result.valid).toBe(true);
      expect(result.account?.clientId).toBe("allowed-client-id");
      expect(result.account?.name).toBe("Allowed Service");
    });

    it("should reject token from disabled client", async () => {
      mockedJwtVerify.mockResolvedValueOnce({
        payload: {
          azp: "disabled-client-id",
          iss: "https://login.microsoftonline.com/test-tenant-id/v2.0",
        },
        protectedHeader: { alg: "RS256" },
        key: {} as any,
      } as any);

      const result = await validateOAuthToken("disabled-client-token");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("unauthorized_client");
    });

    it("should reject token from unknown client", async () => {
      mockedJwtVerify.mockResolvedValueOnce({
        payload: {
          azp: "unknown-client-id",
          iss: "https://login.microsoftonline.com/test-tenant-id/v2.0",
        },
        protectedHeader: { alg: "RS256" },
        key: {} as any,
      } as any);

      const result = await validateOAuthToken("unknown-client-token");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("unauthorized_client");
    });

    it("should return token_expired for expired tokens", async () => {
      mockedJwtVerify.mockRejectedValueOnce(
        new Error("JWT expired at 2024-01-01: token is expired"),
      );

      const result = await validateOAuthToken("expired-token");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("token_expired");
    });

    it("should return invalid_signature for bad signatures", async () => {
      mockedJwtVerify.mockRejectedValueOnce(
        new Error("signature verification failed: JWS signature invalid"),
      );

      const result = await validateOAuthToken("bad-sig-token");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid_signature");
    });

    it("should return invalid_audience for wrong audience", async () => {
      mockedJwtVerify.mockRejectedValueOnce(
        new Error("unexpected audience claim value"),
      );

      const result = await validateOAuthToken("wrong-aud-token");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid_audience");
    });

    it("should return invalid_issuer for wrong issuer", async () => {
      mockedJwtVerify.mockRejectedValueOnce(
        new Error("unexpected issuer claim value"),
      );

      const result = await validateOAuthToken("wrong-issuer-token");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid_issuer");
    });

    it("should return validation_failed for unknown errors", async () => {
      mockedJwtVerify.mockRejectedValueOnce(new Error("some other error"));

      const result = await validateOAuthToken("bad-token");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("validation_failed");
    });

    it("should handle missing client ID in payload", async () => {
      mockedJwtVerify.mockResolvedValueOnce({
        payload: {
          // No azp, appid, or sub
          iss: "https://login.microsoftonline.com/test-tenant-id/v2.0",
        },
        protectedHeader: { alg: "RS256" },
        key: {} as any,
      } as any);

      const result = await validateOAuthToken("no-client-id-token");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("missing_client_id");
    });

    it("should extract clientId from appid claim as fallback", async () => {
      mockedJwtVerify.mockResolvedValueOnce({
        payload: {
          appid: "allowed-client-id", // fallback claim
          iss: "https://login.microsoftonline.com/test-tenant-id/v2.0",
        },
        protectedHeader: { alg: "RS256" },
        key: {} as any,
      } as any);

      const result = await validateOAuthToken("appid-token");
      expect(result.valid).toBe(true);
      expect(result.account?.clientId).toBe("allowed-client-id");
    });

    it("should extract clientId from sub claim as last fallback", async () => {
      mockedJwtVerify.mockResolvedValueOnce({
        payload: {
          sub: "allowed-client-id", // last fallback
          iss: "https://login.microsoftonline.com/test-tenant-id/v2.0",
        },
        protectedHeader: { alg: "RS256" },
        key: {} as any,
      } as any);

      const result = await validateOAuthToken("sub-token");
      expect(result.valid).toBe(true);
      expect(result.account?.clientId).toBe("allowed-client-id");
    });
  });
});
