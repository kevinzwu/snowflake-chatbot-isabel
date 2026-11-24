import { getAppConfig } from "@/lib/config/app-config";
import { withNoCacheHeaders } from "@/lib/security/api-response";
import { sanitizeInput } from "@/lib/security/input-sanitizer";
import {
  authenticateWriteRequest,
  secureJsonResponse,
} from "@/lib/security/route-hardening";
import { isValidSnowflakeIdentifier } from "@/lib/security/validators";
import { NextRequest, NextResponse } from "next/server";

export interface FeedbackRequest {
  database: string;
  schema: string;
  agentName: string;
  origRequestId?: string;
  positive: boolean;
  feedbackMessage?: string;
  categories?: string[];
  threadId?: number;
}

/**
 * POST /api/feedback
 * Proxy feedback to Snowflake Cortex Agents Feedback API.
 *
 * Security: session auth → revocation → group auth → write rate limit →
 *           origin validation → body size → Snowflake identifier validation (SSRF prevention)
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateWriteRequest(request, "/api/feedback");
  if (auth instanceof NextResponse) return auth;

  try {
    const body: FeedbackRequest = await request.json();
    const {
      database,
      schema,
      agentName,
      origRequestId,
      positive,
      feedbackMessage,
      categories,
      threadId,
    } = body;

    // Validate required fields
    if (!database || !schema || !agentName || typeof positive !== "boolean") {
      return secureJsonResponse(
        {
          error:
            "Missing required fields: database, schema, agentName, positive",
        },
        400,
      );
    }

    // ── SSRF Prevention ──────────────────────────────────────────────
    // database, schema, and agentName are interpolated into the Snowflake
    // API URL. Without validation an attacker could inject path-traversal
    // sequences (e.g. "../../evil") or other URL manipulation payloads.
    // Only allow valid unquoted Snowflake SQL identifiers.
    if (!isValidSnowflakeIdentifier(database)) {
      return secureJsonResponse({ error: "Invalid database identifier" }, 400);
    }
    if (!isValidSnowflakeIdentifier(schema)) {
      return secureJsonResponse({ error: "Invalid schema identifier" }, 400);
    }
    if (!isValidSnowflakeIdentifier(agentName)) {
      return secureJsonResponse({ error: "Invalid agentName identifier" }, 400);
    }

    // Sanitize user-provided text fields to prevent XSS
    const sanitizedFeedbackMessage = feedbackMessage
      ? sanitizeInput(feedbackMessage)
      : undefined;
    const sanitizedCategories = categories?.map((cat) => sanitizeInput(cat));

    // Get authorization token from headers (JWT for Snowflake API proxy)
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return secureJsonResponse({ error: "Missing authorization header" }, 401);
    }

    const { snowflakeUrl } = getAppConfig();

    // Build feedback request body using sanitized values
    const feedbackBody: Record<string, unknown> = {
      positive,
    };

    if (origRequestId) {
      feedbackBody.orig_request_id = origRequestId;
    }
    if (sanitizedFeedbackMessage) {
      feedbackBody.feedback_message = sanitizedFeedbackMessage;
    }
    if (sanitizedCategories && sanitizedCategories.length > 0) {
      feedbackBody.categories = sanitizedCategories;
    }
    if (threadId) {
      feedbackBody.thread_id = threadId;
    }

    // Make request to Snowflake Cortex Agents Feedback API
    // Safe: database, schema, agentName are validated Snowflake identifiers
    const feedbackUrl = `${snowflakeUrl}/api/v2/databases/${database}/schemas/${schema}/agents/${agentName}:feedback`;

    let response;
    try {
      response = await fetch(feedbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
        },
        body: JSON.stringify(feedbackBody),
      });
    } catch (fetchError) {
      console.error("Fetch error:", fetchError);
      return withNoCacheHeaders(
        NextResponse.json(
          {
            error: "Failed to connect to Snowflake",
            details:
              fetchError instanceof Error
                ? fetchError.message
                : "Network error",
          },
          { status: 503 },
        ),
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Snowflake API error:", {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      });

      // Check if feedback API is not available (404, 501, etc.)
      if (response.status === 404 || response.status === 501) {
        return withNoCacheHeaders(
          NextResponse.json(
            {
              error: "Feedback API not available",
              details:
                "The Snowflake Cortex Agents Feedback API may not be enabled for this environment. Please contact your Snowflake administrator.",
              status: response.status,
            },
            { status: 503 },
          ),
        );
      }

      return withNoCacheHeaders(
        NextResponse.json(
          {
            error: "Failed to submit feedback to Snowflake",
            details: errorText,
          },
          { status: response.status },
        ),
      );
    }

    // Snowflake may return empty response or 204 No Content
    const responseText = await response.text();
    let result;

    if (responseText) {
      try {
        result = JSON.parse(responseText);
      } catch {
        console.warn("Non-JSON response from Snowflake:", responseText);
        result = { status: "Feedback submitted successfully" };
      }
    } else {
      result = { status: "Feedback submitted successfully" };
    }

    return secureJsonResponse(result);
  } catch (error) {
    console.error("Error submitting feedback:", error);
    console.error("Error stack:", error instanceof Error ? error.stack : "N/A");
    return withNoCacheHeaders(
      NextResponse.json(
        {
          error: "Internal server error",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 },
      ),
    );
  }
}
