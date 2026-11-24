import { deleteSavedQuery, getSavedQuery } from "@/lib/dynamodb";
import { withNoCacheHeaders } from "@/lib/security/api-response";
import {
  authenticateReadRequest,
  authenticateWriteRequest,
  secureJsonResponse,
} from "@/lib/security/route-hardening";
import { validateRouteId } from "@/lib/security/validators";
import { NextRequest, NextResponse } from "next/server";

interface RouteParams {
  params: Promise<{ queryId: string }>;
}

/**
 * GET /api/saved-queries/[queryId]
 * Get a single saved query by ID.
 *
 * Security: session auth → revocation → group auth → read rate limit → ID format validation
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateReadRequest("/api/saved-queries/[id]");
  if (auth instanceof NextResponse) return auth;

  try {
    const { queryId: rawQueryId } = await params;

    // Validate query ID format (was missing — security gap)
    const idValidation = validateRouteId(rawQueryId, "queryId");
    if (!idValidation.isValid) {
      return secureJsonResponse(
        { error: "Bad Request", message: idValidation.error },
        400,
      );
    }
    const queryId = idValidation.value;

    const query = await getSavedQuery(auth.userId, queryId);

    if (!query) {
      return secureJsonResponse(
        { error: "Not Found", message: "Saved query not found" },
        404,
      );
    }

    return secureJsonResponse(query);
  } catch (error) {
    console.error("Failed to get saved query:", error);
    return withNoCacheHeaders(
      NextResponse.json(
        {
          error: "Internal Server Error",
          message: "Failed to get saved query",
        },
        { status: 500 },
      ),
    );
  }
}

/**
 * DELETE /api/saved-queries/[queryId]
 * Delete a saved query.
 *
 * Security: session auth → revocation → group auth → write rate limit →
 *           origin validation → ID format validation
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateWriteRequest(
    request,
    "/api/saved-queries/[id]",
  );
  if (auth instanceof NextResponse) return auth;

  try {
    const { queryId: rawQueryId } = await params;

    // Validate query ID format (was missing — security gap)
    const idValidation = validateRouteId(rawQueryId, "queryId");
    if (!idValidation.isValid) {
      return secureJsonResponse(
        { error: "Bad Request", message: idValidation.error },
        400,
      );
    }
    const queryId = idValidation.value;

    const deleted = await deleteSavedQuery(auth.userId, queryId);

    if (!deleted) {
      return secureJsonResponse(
        { error: "Not Found", message: "Saved query not found" },
        404,
      );
    }

    return new NextResponse(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    console.error("Failed to delete saved query:", error);
    return withNoCacheHeaders(
      NextResponse.json(
        {
          error: "Internal Server Error",
          message: "Failed to delete saved query",
        },
        { status: 500 },
      ),
    );
  }
}
