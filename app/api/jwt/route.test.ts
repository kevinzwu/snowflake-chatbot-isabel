/**
 * Integration tests for /api/jwt endpoint
 *
 * Tests the JWT generation route handler with mocked auth dependencies.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next-auth's getServerSession
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

// Mock auth config
vi.mock("@/lib/auth-config", () => ({
  authConfig: {},
}));

// Mock JWT generator
vi.mock("@/lib/snowflake/jwt-generator", () => ({
  generateUserJWT: vi.fn(() => ({
    token: "mock-jwt-token",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  })),
}));

// Mock rate limiter
vi.mock("@/lib/security/rate-limiter", () => ({
  jwtRateLimiter: {
    check: vi.fn(() => ({ allowed: true, remaining: 29, resetIn: 60000 })),
  },
}));

// Mock session revocation
vi.mock("@/lib/security/session-revocation", () => ({
  sessionRevocationManager: {
    isRevoked: vi.fn(() => false),
  },
}));

import { GET } from "@/app/api/jwt/route";
import { jwtRateLimiter } from "@/lib/security/rate-limiter";
import { sessionRevocationManager } from "@/lib/security/session-revocation";
import { getServerSession } from "next-auth";

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedRateLimiter = vi.mocked(jwtRateLimiter.check);
const mockedIsRevoked = vi.mocked(sessionRevocationManager.isRevoked);

describe("GET /api/jwt", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 401 when no session exists", async () => {
    mockedGetServerSession.mockResolvedValueOnce(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 401 when session has no user", async () => {
    mockedGetServerSession.mockResolvedValueOnce({ expires: "" } as any);

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("should return 429 when rate limited", async () => {
    mockedGetServerSession.mockResolvedValueOnce({
      user: { name: "Test", email: "test@example.com" },
      groups: ["group-1-id"],
      expires: new Date().toISOString(),
    } as any);

    mockedRateLimiter.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      resetIn: 30000,
      retryAfter: 30,
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toBe("Too Many Requests");
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("should return 401 when session is revoked", async () => {
    mockedGetServerSession.mockResolvedValueOnce({
      user: { name: "Test", email: "test@example.com" },
      groups: ["group-1-id"],
      sessionId: "revoked-session",
      expires: new Date().toISOString(),
    } as any);

    mockedIsRevoked.mockReturnValueOnce(true);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Session Revoked");
  });

  it("should return 403 when user is not in allowed groups", async () => {
    mockedGetServerSession.mockResolvedValueOnce({
      user: { name: "Outsider", email: "outsider@example.com" },
      groups: ["unauthorized-group"],
      expires: new Date().toISOString(),
    } as any);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Forbidden");
  });

  it("should return JWT for authorized user", async () => {
    mockedGetServerSession.mockResolvedValueOnce({
      user: {
        name: "Authorized User",
        email: "authorized@example.com",
        id: "user-123",
      },
      groups: ["group-1-id"],
      sessionId: "valid-session",
      loginTime: Date.now(),
      provider: "azure-ad",
      expires: new Date().toISOString(),
    } as any);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.token).toBeDefined();
    expect(body.token.token).toBe("mock-jwt-token");
    expect(body.token.expiresAt).toBeGreaterThan(0);
    expect(body.token.userContext).toBeDefined();

    // Verify no-cache headers
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Pragma")).toBe("no-cache");
  });
});
