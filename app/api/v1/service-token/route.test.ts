/**
 * Integration tests for /api/v1/service-token endpoint
 *
 * Tests the service token route with mocked OAuth validation.
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock OAuth validation
vi.mock("@/lib/security/oauth-service-accounts", () => ({
  validateOAuthToken: vi.fn(),
}));

// Mock JWT generator
vi.mock("@/lib/snowflake/jwt-generator", () => ({
  generateServiceAccountJWT: vi.fn(() => ({
    token: "mock-service-jwt",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  })),
}));

import { GET, POST } from "@/app/api/v1/service-token/route";
import { validateOAuthToken } from "@/lib/security/oauth-service-accounts";

const mockedValidateOAuth = vi.mocked(validateOAuthToken);

function createRequest(options: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}) {
  const url = "http://localhost:3000/api/v1/service-token";
  return new NextRequest(url, {
    method: options.method || "POST",
    headers: options.headers || {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

describe("POST /api/v1/service-token", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 401 when no Authorization header", async () => {
    const request = createRequest({ headers: {} });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toContain("Missing Authorization");
  });

  it("should return 401 when Authorization header is not Bearer", async () => {
    const request = createRequest({
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  it("should return 401 for invalid OAuth token", async () => {
    mockedValidateOAuth.mockResolvedValueOnce({
      valid: false,
      reason: "token_expired",
    });

    const request = createRequest({
      headers: { Authorization: "Bearer expired-token" },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.message).toContain("expired");
  });

  it("should return 401 for unauthorized client", async () => {
    mockedValidateOAuth.mockResolvedValueOnce({
      valid: false,
      reason: "unauthorized_client",
    });

    const request = createRequest({
      headers: { Authorization: "Bearer unauthorized-token" },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.message).toContain("not authorized");
  });

  it("should return service JWT for valid OAuth token", async () => {
    mockedValidateOAuth.mockResolvedValueOnce({
      valid: true,
      account: {
        clientId: "valid-client",
        name: "Test Service",
        scopes: ["snowflake:read"],
        enabled: true,
      },
      claims: {
        azp: "valid-client",
        iss: "https://login.microsoftonline.com/test-tenant/v2.0",
        aud: "test-client-id",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      },
    });

    const request = createRequest({
      headers: { Authorization: "Bearer valid-oauth-token" },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.token).toBe("mock-service-jwt");
    expect(body.serviceAccountId).toBe("Test Service");
    expect(body.scopes).toEqual(["snowflake:read"]);

    // Verify no-cache headers
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("should return 500 when JWT generation fails", async () => {
    mockedValidateOAuth.mockResolvedValueOnce({
      valid: true,
      account: {
        clientId: "valid-client",
        name: "Test Service",
        scopes: ["snowflake:read"],
        enabled: true,
      },
      claims: {
        azp: "valid-client",
        iss: "https://login.microsoftonline.com/test-tenant/v2.0",
      },
    });

    // Make JWT generation throw
    const { generateServiceAccountJWT } =
      await import("@/lib/snowflake/jwt-generator");
    vi.mocked(generateServiceAccountJWT).mockImplementationOnce(() => {
      throw new Error("RSA key not found");
    });

    const request = createRequest({
      headers: { Authorization: "Bearer valid-oauth-token" },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain("Token generation failed");
  });

  it("should include X-Request-ID in logging", async () => {
    mockedValidateOAuth.mockResolvedValueOnce({
      valid: false,
      reason: "invalid_signature",
    });

    const consoleSpy = vi.spyOn(console, "log");
    const request = createRequest({
      headers: {
        Authorization: "Bearer bad-token",
        "X-Request-ID": "custom-req-id",
      },
    });

    await POST(request);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("custom-req-id"),
    );
  });
});

describe("GET /api/v1/service-token", () => {
  it("should return 405 Method Not Allowed", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(405);
    expect(body.error).toContain("Method not allowed");
  });
});
