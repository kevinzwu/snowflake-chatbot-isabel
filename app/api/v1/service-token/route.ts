/**
 * Service Token API Endpoint (OAuth Version)
 *
 * Provides Snowflake JWT tokens for authenticated service accounts.
 * Authentication via Azure AD OAuth Client Credentials flow.
 *
 * Usage:
 *   1. Service account gets OAuth token from Azure AD:
 *      POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 *      grant_type=client_credentials
 *      client_id=<app-registration-id>
 *      client_secret=<secret>
 *      scope=api://<isabel-app-id>/.default
 *
 *   2. Call this endpoint with the OAuth token:
 *      POST /api/v1/service-token
 *      Authorization: Bearer <oauth-access-token>
 *
 * Response:
 *   {
 *     "token": "eyJ...",
 *     "expiresAt": 1234567890,
 *     "serviceAccountId": "Remediation Team Automation",
 *     "scopes": ["snowflake:write"]
 *   }
 */

import {
  OAuthValidationResult,
  ServiceAccountConfig,
  validateOAuthToken,
} from "@/lib/security/oauth-service-accounts";
import { RateLimiter } from "@/lib/security/rate-limiter";
import { generateServiceAccountJWT as generateJWT } from "@/lib/snowflake/jwt-generator";
import { NextRequest, NextResponse } from "next/server";

// Rate limiter: 10 requests per minute per client ID
const serviceTokenLimiter = new RateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 10,
});

/**
 * Structured logging for audit trail
 */
function logServiceTokenAttempt(
  requestId: string,
  clientId: string | null,
  result: string,
  accountName?: string,
): void {
  console.log(
    JSON.stringify({
      event: "service_token_request",
      timestamp: new Date().toISOString(),
      requestId,
      clientId: clientId || "unknown",
      result,
      accountName: accountName || "none",
    }),
  );
}

/**
 * Generate Snowflake JWT for a service account using shared JWT generator
 */
function generateServiceAccountToken(
  account: ServiceAccountConfig,
  oauthClaims: OAuthValidationResult["claims"],
): {
  token: string;
  expiresAt: number;
} {
  return generateJWT({
    clientId: account.clientId,
    name: account.name,
    scopes: account.scopes,
    oid: oauthClaims?.oid,
    appName: oauthClaims?.app_displayname,
  });
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("X-Request-ID") || crypto.randomUUID();

  // 1. Extract Bearer token from Authorization header
  const authHeader = request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logServiceTokenAttempt(requestId, null, "missing_auth");
    return NextResponse.json(
      { error: "Missing Authorization header. Use: Bearer <oauth-token>" },
      { status: 401 },
    );
  }

  const bearerToken = authHeader.substring(7); // Remove "Bearer " prefix

  // 2. Validate OAuth token with Azure AD
  const validation = await validateOAuthToken(bearerToken);

  if (!validation.valid || !validation.account) {
    logServiceTokenAttempt(
      requestId,
      validation.claims?.azp || null,
      validation.reason || "invalid",
    );

    // Map internal reasons to user-friendly messages
    const errorMessages: Record<string, string> = {
      token_expired: "OAuth token has expired. Please obtain a new token.",
      invalid_signature: "Invalid token signature.",
      invalid_audience:
        "Token audience does not match Isabel. Use scope api://<isabel-app-id>/.default",
      invalid_issuer: "Token issuer is not valid.",
      unauthorized_client:
        "This application is not authorized to access Isabel.",
      missing_token: "No token provided.",
    };

    return NextResponse.json(
      {
        error: "Authentication failed",
        message:
          errorMessages[validation.reason || ""] ||
          "Invalid or expired OAuth token",
      },
      { status: 401 },
    );
  }

  const account = validation.account;
  const clientId = account.clientId;

  // 3. Rate limit check (by client ID)
  const rateLimitResult = serviceTokenLimiter.check(clientId);
  if (!rateLimitResult.allowed) {
    logServiceTokenAttempt(requestId, clientId, "rate_limited", account.name);
    return NextResponse.json(
      {
        error: "Rate limit exceeded",
        retryAfter: rateLimitResult.retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimitResult.retryAfter),
          "X-RateLimit-Limit": "10",
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  // 4. Generate Snowflake JWT
  try {
    const { token, expiresAt } = generateServiceAccountToken(
      account,
      validation.claims,
    );

    logServiceTokenAttempt(requestId, clientId, "success", account.name);

    // Return with no-cache headers to prevent any caching
    // JWTs should always be freshly generated
    return NextResponse.json(
      {
        token,
        expiresAt,
        serviceAccountId: account.name,
        scopes: account.scopes,
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
  } catch (error) {
    console.error("Service token generation failed:", error);
    logServiceTokenAttempt(
      requestId,
      clientId,
      "generation_failed",
      account.name,
    );
    return NextResponse.json(
      { error: "Token generation failed" },
      { status: 500 },
    );
  }
}

// Only POST is allowed
export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export async function PUT() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export async function DELETE() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
