import { CONVERSATION_RETENTION, searchConversations } from "@/lib/dynamodb";
import { withNoCacheHeaders } from "@/lib/security/api-response";
import { sanitizeInput } from "@/lib/security/input-sanitizer";
import {
  authenticateReadRequest,
  secureJsonResponse,
} from "@/lib/security/route-hardening";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/conversations/search?q=<query>
 * Search conversations by title and message content.
 *
 * Security: session auth → revocation check → group auth → read rate limit → no-cache headers
 *
 * Query params:
 * - q: Search query (required, 2-200 chars)
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateReadRequest("/api/conversations/search");
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const rawQuery = searchParams.get("q");

    if (!rawQuery || typeof rawQuery !== "string") {
      return secureJsonResponse(
        {
          error: "Bad Request",
          message: "Search query parameter 'q' is required",
        },
        400,
      );
    }

    const trimmedQuery = rawQuery.trim();

    if (trimmedQuery.length < CONVERSATION_RETENTION.MIN_SEARCH_QUERY_LENGTH) {
      return secureJsonResponse(
        {
          error: "Bad Request",
          message: `Search query must be at least ${CONVERSATION_RETENTION.MIN_SEARCH_QUERY_LENGTH} characters`,
        },
        400,
      );
    }

    if (trimmedQuery.length > CONVERSATION_RETENTION.MAX_SEARCH_QUERY_LENGTH) {
      return secureJsonResponse(
        {
          error: "Bad Request",
          message: `Search query must not exceed ${CONVERSATION_RETENTION.MAX_SEARCH_QUERY_LENGTH} characters`,
        },
        400,
      );
    }

    // Sanitize the search query
    const sanitizedQuery = sanitizeInput(trimmedQuery);

    const result = await searchConversations(auth.userId, sanitizedQuery);
    return secureJsonResponse(result);
  } catch (error) {
    console.error("Failed to search conversations:", error);
    return withNoCacheHeaders(
      NextResponse.json(
        {
          error: "Internal Server Error",
          message: "Failed to search conversations",
        },
        { status: 500 },
      ),
    );
  }
}
