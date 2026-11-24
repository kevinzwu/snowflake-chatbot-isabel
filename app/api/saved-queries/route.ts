import {
  createSavedQuery,
  listSavedQueries,
  SAVED_QUERY_LIMITS,
} from "@/lib/dynamodb";
import { withNoCacheHeaders } from "@/lib/security/api-response";
import { sanitizeInput } from "@/lib/security/input-sanitizer";
import {
  authenticateReadRequest,
  authenticateWriteRequest,
  secureJsonResponse,
} from "@/lib/security/route-hardening";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/saved-queries
 * List all saved queries for the authenticated user.
 *
 * Security: session auth → revocation → group auth → read rate limit → no-cache headers
 */
export async function GET() {
  const auth = await authenticateReadRequest("/api/saved-queries");
  if (auth instanceof NextResponse) return auth;

  try {
    const queries = await listSavedQueries(auth.userId);
    return secureJsonResponse({ queries });
  } catch (error) {
    console.error("Failed to list saved queries:", error);
    return withNoCacheHeaders(
      NextResponse.json(
        {
          error: "Internal Server Error",
          message: "Failed to list saved queries",
        },
        { status: 500 },
      ),
    );
  }
}

/**
 * POST /api/saved-queries
 * Create a new saved query.
 *
 * Security: session auth → revocation → group auth → write rate limit →
 *           origin validation → body size check → field length validation
 *
 * Body: { name: string, queryText: string, description?: string }
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateWriteRequest(request, "/api/saved-queries");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { name, queryText, description } = body as {
      name: string;
      queryText: string;
      description?: string;
    };

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return secureJsonResponse(
        { error: "Bad Request", message: "Name is required" },
        400,
      );
    }

    if (
      !queryText ||
      typeof queryText !== "string" ||
      queryText.trim().length === 0
    ) {
      return secureJsonResponse(
        { error: "Bad Request", message: "Query text is required" },
        400,
      );
    }

    // Enforce field length limits
    if (name.length > SAVED_QUERY_LIMITS.MAX_NAME_LENGTH) {
      return secureJsonResponse(
        {
          error: "Bad Request",
          message: `Name exceeds maximum length of ${SAVED_QUERY_LIMITS.MAX_NAME_LENGTH} characters`,
        },
        400,
      );
    }

    if (queryText.length > SAVED_QUERY_LIMITS.MAX_QUERY_TEXT_LENGTH) {
      return secureJsonResponse(
        {
          error: "Bad Request",
          message: `Query text exceeds maximum length of ${SAVED_QUERY_LIMITS.MAX_QUERY_TEXT_LENGTH} characters`,
        },
        400,
      );
    }

    if (
      description &&
      description.length > SAVED_QUERY_LIMITS.MAX_DESCRIPTION_LENGTH
    ) {
      return secureJsonResponse(
        {
          error: "Bad Request",
          message: `Description exceeds maximum length of ${SAVED_QUERY_LIMITS.MAX_DESCRIPTION_LENGTH} characters`,
        },
        400,
      );
    }

    const queryId = crypto.randomUUID();

    // Sanitize all user inputs to prevent XSS
    const sanitizedName = sanitizeInput(name.trim());
    const sanitizedQueryText = sanitizeInput(queryText.trim());
    const sanitizedDescription = description
      ? sanitizeInput(description.trim())
      : undefined;

    const savedQuery = await createSavedQuery(auth.userId, queryId, {
      name: sanitizedName,
      queryText: sanitizedQueryText,
      description: sanitizedDescription,
    });

    return secureJsonResponse(savedQuery, 201);
  } catch (error) {
    // Handle specific errors
    if (error instanceof Error) {
      if (error.message.includes("limit")) {
        return secureJsonResponse(
          { error: "Limit Reached", message: error.message },
          409,
        );
      }
      if (error.message.includes("already exists")) {
        return secureJsonResponse(
          { error: "Conflict", message: error.message },
          409,
        );
      }
    }

    console.error("Failed to create saved query:", error);
    return withNoCacheHeaders(
      NextResponse.json(
        {
          error: "Internal Server Error",
          message: "Failed to create saved query",
        },
        { status: 500 },
      ),
    );
  }
}
