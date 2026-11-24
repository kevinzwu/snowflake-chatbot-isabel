/**
 * CSRF / Origin Validation
 *
 * Validates the Origin header on mutating requests (POST, PUT, DELETE)
 * to prevent Cross-Site Request Forgery attacks.
 *
 * NextAuth.js provides CSRF protection for its own `/api/auth/*` routes
 * via Double Submit Cookie, but custom API routes need their own protection.
 *
 * For same-origin APIs behind SameSite=Lax cookies:
 * - GET requests: low risk (no state changes)
 * - POST/PUT/DELETE: medium risk — cross-origin fetch() can bypass SameSite=Lax
 *   in some edge cases. Origin header validation provides defense-in-depth.
 *
 * @module lib/security/csrf
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
 */

import { NextRequest } from "next/server";

/**
 * Extracts the origin from the request's Origin or Referer header.
 * Returns null if neither header is present.
 */
function extractRequestOrigin(request: NextRequest): string | null {
  // Prefer Origin header (set by browsers on all cross-origin requests)
  const origin = request.headers.get("origin");
  if (origin) {
    return origin;
  }

  // Fall back to Referer header (may be stripped by privacy settings)
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const url = new URL(referer);
      return url.origin;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Gets the list of allowed origins for the application.
 * Derived from NEXTAUTH_URL environment variable + localhost for development.
 */
function getAllowedOrigins(): string[] {
  const origins: string[] = [];

  const nextAuthUrl = process.env.NEXTAUTH_URL;
  if (nextAuthUrl) {
    try {
      const url = new URL(nextAuthUrl);
      origins.push(url.origin);
    } catch {
      // Invalid NEXTAUTH_URL — skip
    }
  }

  // Always allow localhost in development
  if (process.env.NODE_ENV === "development") {
    origins.push("http://localhost:3000");
    origins.push("http://localhost:3001");
  }

  return origins;
}

/**
 * Validates the Origin header on a mutating request.
 *
 * @param request - The incoming Next.js request
 * @returns Object with validation result and details
 *
 * @example
 * ```ts
 * const csrf = validateOrigin(request);
 * if (!csrf.valid) {
 *   return NextResponse.json({ error: "Forbidden", message: csrf.reason }, { status: 403 });
 * }
 * ```
 */
export function validateOrigin(request: NextRequest): {
  valid: boolean;
  reason?: string;
  origin?: string;
} {
  const requestOrigin = extractRequestOrigin(request);

  // If no Origin or Referer header is present, reject the request.
  // Browsers ALWAYS send Origin on cross-origin requests and on same-origin
  // POST/PUT/DELETE. Absence indicates a non-browser client (curl, etc.)
  // or a privacy-stripping proxy. For API routes that require browser access,
  // this is the safest default.
  if (!requestOrigin) {
    return {
      valid: false,
      reason: "Missing Origin header on mutating request",
    };
  }

  const allowedOrigins = getAllowedOrigins();

  // If no allowed origins configured (misconfiguration), fail closed
  if (allowedOrigins.length === 0) {
    console.error(
      JSON.stringify({
        event: "csrf_no_allowed_origins",
        message:
          "No allowed origins configured. Set NEXTAUTH_URL environment variable.",
        timestamp: new Date().toISOString(),
      }),
    );
    return {
      valid: false,
      reason: "Server misconfiguration: no allowed origins",
      origin: requestOrigin,
    };
  }

  if (!allowedOrigins.includes(requestOrigin)) {
    console.warn(
      JSON.stringify({
        event: "csrf_origin_rejected",
        requestOrigin,
        allowedOrigins,
        timestamp: new Date().toISOString(),
      }),
    );
    return {
      valid: false,
      reason: "Origin not allowed",
      origin: requestOrigin,
    };
  }

  return { valid: true, origin: requestOrigin };
}
