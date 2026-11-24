/**
 * Route Hardening Middleware
 *
 * Combines all security checks into reusable utilities for API route handlers.
 * Provides a consistent hardening stack based on the canonical pattern from /api/jwt:
 *
 * 1. Session authentication (getServerSession)
 * 2. Session revocation check
 * 3. Group authorization
 * 4. Rate limiting (read vs write)
 * 5. Origin validation (writes only)
 * 6. Request body size validation (writes only)
 *
 * @module lib/security/route-hardening
 */

import { authConfig } from "@/lib/auth-config";
import {
  authorizeSession,
  logAuthorizationAttempt,
  SessionWithGroups,
} from "@/lib/auth/authorization";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import {
  payloadTooLargeResponse,
  rateLimitExceededResponse,
  withNoCacheHeaders,
  withRateLimitHeaders,
} from "./api-response";
import { validateOrigin } from "./csrf";
import { apiRateLimiter, writeRateLimiter } from "./rate-limiter";
import { sessionRevocationManager } from "./session-revocation";

/**
 * Result of a successful authentication + authorization check.
 */
export interface AuthenticatedContext {
  /** The validated session */
  session: SessionWithGroups;
  /** The user's Azure AD object ID (partition key for DynamoDB) */
  userId: string;
  /** The user's email (for rate limiting and audit logging) */
  userEmail: string;
}

/**
 * Performs full authentication, authorization, session revocation,
 * and rate limiting checks for a READ (GET) operation.
 *
 * Returns either an AuthenticatedContext on success, or a NextResponse error.
 *
 * @example
 * ```ts
 * export async function GET() {
 *   const auth = await authenticateReadRequest("/api/conversations");
 *   if (auth instanceof NextResponse) return auth;
 *   const { userId } = auth;
 *   // ... business logic
 * }
 * ```
 */
export async function authenticateReadRequest(
  routePath: string,
): Promise<AuthenticatedContext | NextResponse> {
  // 1. Session authentication
  const session = (await getServerSession(
    authConfig,
  )) as SessionWithGroups | null;

  if (!session?.user?.id) {
    return withNoCacheHeaders(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
  }

  const userEmail = session.user.email || session.user.id;
  const sessionId = session.sessionId;

  // 2. Session revocation check
  if (sessionId && sessionRevocationManager.isRevoked(sessionId)) {
    logAuthorizationAttempt(userEmail, routePath, {
      authorized: false,
      isAdmin: false,
      reason: "Session revoked",
    });
    return withNoCacheHeaders(
      NextResponse.json(
        { error: "Unauthorized", message: "Session has been revoked" },
        { status: 401 },
      ),
    );
  }

  // 3. Group authorization
  const authResult = authorizeSession(session);
  logAuthorizationAttempt(userEmail, routePath, authResult);

  if (!authResult.authorized) {
    return withNoCacheHeaders(
      NextResponse.json(
        { error: "Forbidden", message: authResult.reason },
        { status: 403 },
      ),
    );
  }

  // 4. Rate limiting (read operations: 100 req/min)
  const rateLimitKey = `read:${userEmail}`;
  const rateLimitResult = apiRateLimiter.check(rateLimitKey);

  if (!rateLimitResult.allowed) {
    return rateLimitExceededResponse(
      rateLimitResult.retryAfter || 60,
      rateLimitResult.remaining,
      rateLimitResult.resetIn,
    );
  }

  return {
    session,
    userId: session.user.id,
    userEmail,
  };
}

/**
 * Performs full authentication, authorization, session revocation,
 * rate limiting, CSRF/Origin validation, and body size checks
 * for a WRITE (POST/PUT/DELETE) operation.
 *
 * @param request - The incoming request (needed for Origin header and Content-Length)
 * @param routePath - The route path for audit logging
 * @param maxBodySizeBytes - Maximum allowed body size (default: 400KB)
 *
 * @example
 * ```ts
 * export async function POST(request: NextRequest) {
 *   const auth = await authenticateWriteRequest(request, "/api/conversations", 400 * 1024);
 *   if (auth instanceof NextResponse) return auth;
 *   const { userId } = auth;
 *   // ... business logic
 * }
 * ```
 */
export async function authenticateWriteRequest(
  request: NextRequest,
  routePath: string,
  maxBodySizeBytes: number = 400 * 1024,
): Promise<AuthenticatedContext | NextResponse> {
  // 1. Session authentication
  const session = (await getServerSession(
    authConfig,
  )) as SessionWithGroups | null;

  if (!session?.user?.id) {
    return withNoCacheHeaders(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
  }

  const userEmail = session.user.email || session.user.id;
  const sessionId = session.sessionId;

  // 2. Session revocation check
  if (sessionId && sessionRevocationManager.isRevoked(sessionId)) {
    logAuthorizationAttempt(userEmail, routePath, {
      authorized: false,
      isAdmin: false,
      reason: "Session revoked",
    });
    return withNoCacheHeaders(
      NextResponse.json(
        { error: "Unauthorized", message: "Session has been revoked" },
        { status: 401 },
      ),
    );
  }

  // 3. Group authorization
  const authResult = authorizeSession(session);
  logAuthorizationAttempt(userEmail, routePath, authResult);

  if (!authResult.authorized) {
    return withNoCacheHeaders(
      NextResponse.json(
        { error: "Forbidden", message: authResult.reason },
        { status: 403 },
      ),
    );
  }

  // 4. Rate limiting (write operations: 20 req/min)
  const rateLimitKey = `write:${userEmail}`;
  const rateLimitResult = writeRateLimiter.check(rateLimitKey);

  if (!rateLimitResult.allowed) {
    return rateLimitExceededResponse(
      rateLimitResult.retryAfter || 60,
      rateLimitResult.remaining,
      rateLimitResult.resetIn,
    );
  }

  // 5. CSRF / Origin validation
  const csrfResult = validateOrigin(request);
  if (!csrfResult.valid) {
    console.warn(
      JSON.stringify({
        event: "csrf_validation_failed",
        route: routePath,
        userEmail,
        reason: csrfResult.reason,
        origin: csrfResult.origin,
        timestamp: new Date().toISOString(),
      }),
    );
    return withNoCacheHeaders(
      NextResponse.json(
        { error: "Forbidden", message: "Origin validation failed" },
        { status: 403 },
      ),
    );
  }

  // 6. Request body size check (Content-Length header)
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!isNaN(size) && size > maxBodySizeBytes) {
      return payloadTooLargeResponse(maxBodySizeBytes);
    }
  }

  return {
    session,
    userId: session.user.id,
    userEmail,
  };
}

/**
 * Helper to build a NextResponse.json with no-cache headers and optional rate limit headers.
 */
export function secureJsonResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  status: number = 200,
  rateLimitRemaining?: number,
  rateLimitResetIn?: number,
): NextResponse {
  const response = NextResponse.json(data, { status });
  withNoCacheHeaders(response);
  if (rateLimitRemaining !== undefined && rateLimitResetIn !== undefined) {
    withRateLimitHeaders(response, rateLimitRemaining, rateLimitResetIn);
  }
  return response;
}
