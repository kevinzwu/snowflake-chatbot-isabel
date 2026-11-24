import { getConversationByShareToken } from "@/lib/dynamodb";
import { withNoCacheHeaders } from "@/lib/security/api-response";
import {
  authenticateReadRequest,
  secureJsonResponse,
} from "@/lib/security/route-hardening";
import { NextRequest, NextResponse } from "next/server";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ shareToken: string }>;
}

/**
 * GET /api/shared/[shareToken]
 * Retrieve a shared conversation by its share token.
 * Any authenticated SSO user can access — no ownership check.
 *
 * Security: session auth → revocation → group auth → read rate limit → token format validation
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateReadRequest("/api/shared/[shareToken]");
  if (auth instanceof NextResponse) return auth;

  try {
    const { shareToken } = await params;

    // Validate token format (UUIDv4)
    if (!shareToken || !UUID_REGEX.test(shareToken)) {
      return secureJsonResponse(
        { error: "Not Found", message: "Shared conversation not found" },
        404,
      );
    }

    const conversation = await getConversationByShareToken(shareToken);

    if (!conversation) {
      return secureJsonResponse(
        { error: "Not Found", message: "Shared conversation not found" },
        404,
      );
    }

    // Log access for audit trail
    console.log(
      JSON.stringify({
        action: "shared_conversation_accessed",
        viewerUserId: auth.userId,
        viewerEmail: auth.userEmail,
        shareToken,
        conversationId: conversation.conversationId,
        ownerUserId: conversation.userId,
        timestamp: new Date().toISOString(),
      }),
    );

    // Return conversation with owner metadata for attribution
    return secureJsonResponse({
      conversation: {
        conversationId: conversation.conversationId,
        title: conversation.title,
        messages: conversation.messages,
        messageCount: conversation.messageCount,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        deepThinking: conversation.deepThinking,
      },
      owner: {
        userId: conversation.userId,
      },
      shareToken,
    });
  } catch (error) {
    console.error("Failed to get shared conversation:", error);
    return withNoCacheHeaders(
      NextResponse.json(
        {
          error: "Internal Server Error",
          message: "Failed to retrieve shared conversation",
        },
        { status: 500 },
      ),
    );
  }
}
