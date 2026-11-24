/**
 * Tests for Snowflake JWT Generator
 *
 * Tests cover:
 * - getRSAKey() - key loading from env var and file
 * - loadPrivateKey() - key parsing (unencrypted, encrypted)
 * - calculatePublicKeyFingerprint() - SHA256 fingerprint
 * - getSnowflakeConfig() - env-based config
 * - generateUserJWT() - token generation with user context
 * - generateServiceAccountJWT() - token generation with service context
 */

import { createPrivateKey, generateKeyPairSync } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Generate a real test RSA key pair for testing
const { privateKey: testPrivateKeyObj, publicKey: _testPublicKeyObj } =
  generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

const testPrivateKeyPem = testPrivateKeyObj as string;

describe("JWT Generator", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.SNOWFLAKE_ACCOUNT = "TEST_ACCOUNT";
    process.env.SNOWFLAKE_USER = "TEST_USER";
    process.env.SNOWFLAKE_RSA_KEY = testPrivateKeyPem;
    process.env.SNOWFLAKE_RSA_PASSPHRASE = "";
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("getRSAKey()", () => {
    it("should load RSA key from environment variable", async () => {
      const mod = await import("@/lib/snowflake/jwt-generator");
      const key = mod.getRSAKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.toString()).toContain("BEGIN PRIVATE KEY");
    });

    it("should handle base64-encoded key", async () => {
      process.env.SNOWFLAKE_RSA_KEY =
        Buffer.from(testPrivateKeyPem).toString("base64");
      const mod = await import("@/lib/snowflake/jwt-generator");
      const key = mod.getRSAKey();
      expect(key.toString()).toContain("BEGIN PRIVATE KEY");
    });

    it("should handle escaped newlines in key", async () => {
      process.env.SNOWFLAKE_RSA_KEY = testPrivateKeyPem.replace(/\n/g, "\\n");
      const mod = await import("@/lib/snowflake/jwt-generator");
      const key = mod.getRSAKey();
      expect(key.toString()).toContain("BEGIN PRIVATE KEY");
    });

    it("should throw when no key is available and no file exists", async () => {
      delete process.env.SNOWFLAKE_RSA_KEY;

      // Dynamically import fs and spy on existsSync
      const fs = await import("fs");
      const existsSpy = vi
        .spyOn(fs.default, "existsSync")
        .mockReturnValue(false);

      const mod = await import("@/lib/snowflake/jwt-generator");
      expect(() => mod.getRSAKey()).toThrow("RSA key not found");

      existsSpy.mockRestore();
    });
  });

  describe("loadPrivateKey()", () => {
    it("should load an unencrypted PKCS#8 key", async () => {
      const mod = await import("@/lib/snowflake/jwt-generator");
      const { privateKey, rsaKeyString } = mod.loadPrivateKey();
      expect(privateKey).toBeDefined();
      expect(rsaKeyString).toContain("BEGIN PRIVATE KEY");
    });

    it("should throw for encrypted key without passphrase", async () => {
      // Create an encrypted key
      const { privateKey: encryptedKeyPem } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: {
          type: "pkcs8",
          format: "pem",
          cipher: "aes-256-cbc",
          passphrase: "test-passphrase",
        },
      });

      process.env.SNOWFLAKE_RSA_KEY = encryptedKeyPem as string;
      delete process.env.SNOWFLAKE_RSA_PASSPHRASE;

      const mod = await import("@/lib/snowflake/jwt-generator");
      expect(() => mod.loadPrivateKey()).toThrow(
        "Key is encrypted but no passphrase provided",
      );
    });

    it("should load encrypted key with correct passphrase", async () => {
      const passphrase = "test-secure-passphrase";
      const { privateKey: encryptedKeyPem } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: {
          type: "pkcs8",
          format: "pem",
          cipher: "aes-256-cbc",
          passphrase,
        },
      });

      process.env.SNOWFLAKE_RSA_KEY = encryptedKeyPem as string;
      process.env.SNOWFLAKE_RSA_PASSPHRASE = passphrase;

      const mod = await import("@/lib/snowflake/jwt-generator");
      const { privateKey, rsaKeyString } = mod.loadPrivateKey();
      expect(privateKey).toBeDefined();
      expect(rsaKeyString).toContain("BEGIN PRIVATE KEY");
    });
  });

  describe("calculatePublicKeyFingerprint()", () => {
    it("should return SHA256-prefixed fingerprint", async () => {
      const mod = await import("@/lib/snowflake/jwt-generator");
      const keyObj = createPrivateKey({
        key: testPrivateKeyPem,
        format: "pem",
      });
      const fingerprint = mod.calculatePublicKeyFingerprint(keyObj);
      expect(fingerprint).toMatch(/^SHA256:.+$/);
      // Base64 encoded SHA256 hash should be 44 characters including padding
      const hash = fingerprint.replace("SHA256:", "");
      expect(hash.length).toBeGreaterThan(0);
    });

    it("should produce consistent fingerprints for same key", async () => {
      const mod = await import("@/lib/snowflake/jwt-generator");
      const keyObj = createPrivateKey({
        key: testPrivateKeyPem,
        format: "pem",
      });
      const fp1 = mod.calculatePublicKeyFingerprint(keyObj);
      const fp2 = mod.calculatePublicKeyFingerprint(keyObj);
      expect(fp1).toBe(fp2);
    });
  });

  describe("getSnowflakeConfig()", () => {
    it("should return uppercased account and user", async () => {
      process.env.SNOWFLAKE_ACCOUNT = "my_account";
      process.env.SNOWFLAKE_USER = "my_user";

      const mod = await import("@/lib/snowflake/jwt-generator");
      const config = mod.getSnowflakeConfig();
      expect(config.account).toBe("MY_ACCOUNT");
      expect(config.user).toBe("MY_USER");
      expect(config.qualifiedUsername).toBe("MY_ACCOUNT.MY_USER");
    });

    it("should handle missing env vars", async () => {
      delete process.env.SNOWFLAKE_ACCOUNT;
      delete process.env.SNOWFLAKE_USER;

      const mod = await import("@/lib/snowflake/jwt-generator");
      const config = mod.getSnowflakeConfig();
      expect(config.account).toBe("");
      expect(config.user).toBe("");
    });
  });

  describe("generateUserJWT()", () => {
    it("should generate a valid JWT token", async () => {
      const mod = await import("@/lib/snowflake/jwt-generator");
      const result = mod.generateUserJWT({
        sessionId: "test-session",
        userId: "user-123",
        userEmail: "test@example.com",
        isAdmin: false,
        groupCount: 2,
      });

      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe("string");
      // JWT has 3 parts separated by dots
      expect(result.token.split(".")).toHaveLength(3);
      expect(result.expiresAt).toBeGreaterThan(0);
    });

    it("should set expiry 2 minutes before actual JWT expiry", async () => {
      const mod = await import("@/lib/snowflake/jwt-generator");
      const nowInSeconds = Math.floor(Date.now() / 1000);
      const result = mod.generateUserJWT({ userEmail: "test@example.com" });

      // expiresAt should be ~58 minutes from now (1 hour - 2 min buffer)
      const expectedExpiry = nowInSeconds + 3600 - 120;
      expect(result.expiresAt).toBeCloseTo(expectedExpiry, -1);
    });

    it("should include user context in token payload", async () => {
      const mod = await import("@/lib/snowflake/jwt-generator");
      const jwt = await import("jsonwebtoken");

      const result = mod.generateUserJWT({
        userEmail: "test@example.com",
        isAdmin: true,
      });

      const decoded = jwt.default.decode(result.token) as Record<string, any>;
      expect(decoded).toBeDefined();
      expect(decoded.userContext.userEmail).toBe("test@example.com");
      expect(decoded.userContext.isAdmin).toBe(true);
      expect(decoded.iss).toContain("TEST_ACCOUNT.TEST_USER");
      expect(decoded.sub).toBe("TEST_ACCOUNT.TEST_USER");
    });
  });

  describe("generateServiceAccountJWT()", () => {
    it("should generate a valid JWT for service accounts", async () => {
      const mod = await import("@/lib/snowflake/jwt-generator");
      const result = mod.generateServiceAccountJWT({
        clientId: "service-client-id",
        name: "Test Service",
        scopes: ["snowflake:read"],
      });

      expect(result.token).toBeDefined();
      expect(result.token.split(".")).toHaveLength(3);
      expect(result.expiresAt).toBeGreaterThan(0);
    });

    it("should include service context in token payload", async () => {
      const mod = await import("@/lib/snowflake/jwt-generator");
      const jwt = await import("jsonwebtoken");

      const result = mod.generateServiceAccountJWT({
        clientId: "service-client-id",
        name: "Test Service",
        scopes: ["snowflake:read", "snowflake:write"],
        oid: "object-id-123",
        appName: "My App",
      });

      const decoded = jwt.default.decode(result.token) as Record<string, any>;
      expect(decoded.svc.clientId).toBe("service-client-id");
      expect(decoded.svc.name).toBe("Test Service");
      expect(decoded.svc.scopes).toEqual(["snowflake:read", "snowflake:write"]);
      expect(decoded.svc.oid).toBe("object-id-123");
    });
  });
});
