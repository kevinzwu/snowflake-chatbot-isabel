import { authConfig } from "@/lib/auth-config";
import {
  authorizeSession,
  logAuthorizationAttempt,
  SessionWithGroups,
} from "@/lib/auth/authorization";
import { jwtRateLimiter } from "@/lib/security/rate-limiter";
import { sessionRevocationManager } from "@/lib/security/session-revocation";
import { generateUserJWT } from "@/lib/snowflake/jwt-generator";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

export async function GET() {
  // Get the user session to include user context in JWT
  const session = (await getServerSession(
    authConfig,
  )) as SessionWithGroups | null;

  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limiting check - 30 requests per minute per user
  const rateLimitKey = session.user.email || session.user.id || "unknown";
  const rateLimitResult = jwtRateLimiter.check(rateLimitKey);

  if (!rateLimitResult.allowed) {
    console.warn(
      `Rate limit exceeded for user ${session.user.email}: ${rateLimitResult.retryAfter}s until reset`,
    );
    return NextResponse.json(
      {
        error: "Too Many Requests",
        message: `Rate limit exceeded. Please try again in ${rateLimitResult.retryAfter} seconds.`,
        retryAfter: rateLimitResult.retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimitResult.retryAfter),
          "X-RateLimit-Limit": "30",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(
            Math.ceil((Date.now() + rateLimitResult.resetIn) / 1000),
          ),
        },
      },
    );
  }

  // Check if session has been revoked (user signed out)
  if (
    session.sessionId &&
    sessionRevocationManager.isRevoked(session.sessionId)
  ) {
    console.warn(
      `Revoked session attempted JWT access: ${session.user.email}, sessionId: ${session.sessionId}`,
    );
    return NextResponse.json(
      {
        error: "Session Revoked",
        message: "Your session has been invalidated. Please sign in again.",
      },
      { status: 401 },
    );
  }

  // Perform group-based authorization check
  const authResult = authorizeSession(session);
  logAuthorizationAttempt(session.user.email, "/api/jwt", authResult);

  if (!authResult.authorized) {
    console.warn(
      `JWT access denied for user ${session.user.email}: ${authResult.reason}`,
    );
    return NextResponse.json(
      {
        error: "Forbidden",
        message:
          "You do not have permission to access this resource. Please contact your administrator to request access.",
        reason: authResult.reason,
      },
      { status: 403 },
    );
  }

  try {
    const userContext = {
      sessionId: session.sessionId,
      userId: session.user.id,
      userEmail: session.user.email,
      loginTime: session.loginTime,
      provider: session.provider,
      isAdmin: authResult.isAdmin,
      groupCount: authResult.userGroups?.length || 0,
    };

    const { token, expiresAt } = generateUserJWT(userContext);

    // Log token generation for security audit
    console.log(
      `Snowflake JWT generated for user: ${session.user.email} (${session.user.id}), isAdmin: ${authResult.isAdmin}`,
    );

    // Return with no-cache headers to prevent browser/CDN caching
    // JWTs should always be freshly generated
    return NextResponse.json(
      {
        token: {
          token,
          expiresAt,
          userContext, // Include user context in response for client-side use
        },
      },
      {
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      },
    );
  } catch (error: unknown) {
    console.error("JWT generation error:", error);
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: "Unknown error" }, { status: 500 });
  }
}
