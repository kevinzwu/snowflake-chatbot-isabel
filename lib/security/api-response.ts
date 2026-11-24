/**
 * Secure API Response Utilities
 *
 * Shared helpers for building hardened API responses with:
 * - No-cache headers to prevent sensitive data caching on shared machines
 * - Rate limit headers for client-side awareness
 * - Consistent error response formatting
 *
 * @module lib/security/api-response
 */

import { NextResponse } from "next/server";

/**
 * Standard no-cache headers to prevent browsers and proxies from
 * caching sensitive API responses (conversation data, saved queries).
 */
const NO_CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

/**
 * Applies no-cache headers to a NextResponse.
 * Use on all DynamoDB API responses to prevent cached PII leakage.
 *
 * @example
 * ```ts
 * return withNoCacheHeaders(NextResponse.json(data));
 * ```
 */
export function withNoCacheHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(NO_CACHE_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

/**
 * Applies rate limit headers to a NextResponse.
 *
 * @param response - The response to augment
 * @param remaining - Requests remaining in the current window
 * @param resetIn - Milliseconds until the rate limit window resets
 * @param retryAfter - Seconds until the client should retry (only on 429)
 */
export function withRateLimitHeaders(
  response: NextResponse,
  remaining: number,
  resetIn: number,
  retryAfter?: number,
): NextResponse {
  response.headers.set("X-RateLimit-Remaining", String(remaining));
  response.headers.set("X-RateLimit-Reset", String(Math.ceil(resetIn / 1000)));
  if (retryAfter !== undefined) {
    response.headers.set("Retry-After", String(retryAfter));
  }
  return response;
}

/**
 * Creates a 429 Too Many Requests response with standard headers.
 */
export function rateLimitExceededResponse(
  retryAfter: number,
  remaining: number,
  resetIn: number,
): NextResponse {
  const response = NextResponse.json(
    {
      error: "Too Many Requests",
      message: "Rate limit exceeded. Please try again later.",
      retryAfter,
    },
    { status: 429 },
  );
  withNoCacheHeaders(response);
  withRateLimitHeaders(response, remaining, resetIn, retryAfter);
  return response;
}

/**
 * Creates a 413 Payload Too Large response.
 */
export function payloadTooLargeResponse(
  maxBytes: number,
  message?: string,
): NextResponse {
  return withNoCacheHeaders(
    NextResponse.json(
      {
        error: "Payload Too Large",
        message:
          message ||
          `Request body exceeds maximum size of ${Math.round(maxBytes / 1024)}KB`,
      },
      { status: 413 },
    ),
  );
}

/**
 * Creates a 503 Service Unavailable response for conversation storage
 * misconfiguration (missing CONVERSATION_S3_BUCKET). Distinct from a generic
 * 500 so clients/ops can tell "storage isn't configured" apart from a
 * transient server error, and so /api/health's `checks.conversationStorage`
 * correlates with what users actually see.
 */
export function storageUnavailableResponse(): NextResponse {
  return withNoCacheHeaders(
    NextResponse.json(
      {
        error: "Service Unavailable",
        message:
          "Conversation storage is temporarily unavailable. Your message was not saved — please try again shortly or contact your administrator if this persists.",
      },
      { status: 503 },
    ),
  );
}
