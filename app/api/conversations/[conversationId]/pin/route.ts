import { pinConversation, unpinConversation } from "@/lib/dynamodb";
import { withNoCacheHeaders } from "@/lib/security/api-response";
import {
  authenticateWriteRequest,
  secureJsonResponse,
} from "@/lib/security/route-hardening";
import { validateRouteId } from "@/lib/security/validators";
import { NextRequest, NextResponse } from "next/server";

interface RouteParams {
  params: Promise<{ conversationId: string }>;
}

/**
 * POST /api/conversations/[conversationId]/pin
 * Pin or unpin a conversation.
 * Pinning also archives the conversation (extends TTL to 180 days).
 * Unpinning does NOT change archived status.
 * Maximum 10 pinned conversations per user.
 *
 * Security: session auth → revocation → group auth → write rate limit →
 *           origin validation → body size check → ID format validation
 *
 * Body: { pinned: boolean }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateWriteRequest(
    request,
    "/api/conversations/[id]/pin",
  );
  if (auth instanceof NextResponse) return auth;

  try {
    const { conversationId: rawConversationId } = await params;

    // Validate conversation ID format
    const idValidation = validateRouteId(rawConversationId, "conversationId");
    if (!idValidation.isValid) {
      return secureJsonResponse(
        { error: "Bad Request", message: idValidation.error },
        400,
      );
    }
    const conversationId = idValidation.value;

    const body = await request.json();
    const { pinned } = body as { pinned: boolean };

    if (typeof pinned !== "boolean") {
      return secureJsonResponse(
        { error: "Bad Request", message: "pinned field must be a boolean" },
        400,
      );
    }

    const conversation = pinned
      ? await pinConversation(auth.userId, conversationId)
      : await unpinConversation(auth.userId, conversationId);

    if (!conversation) {
      return secureJsonResponse(
        { error: "Not Found", message: "Conversation not found" },
        404,
      );
    }

    return secureJsonResponse({
      conversationId: conversation.conversationId,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      archived: conversation.archived,
      pinned: conversation.pinned,
      messageCount: conversation.messageCount,
    });
  } catch (error) {
    if ((error as Error).name === "PinLimitExceeded") {
      return secureJsonResponse(
        {
          error: "Pin limit reached",
          message: (error as Error).message,
        },
        409,
      );
    }

    console.error("Failed to pin/unpin conversation:", error);
    return withNoCacheHeaders(
      NextResponse.json(
        {
          error: "Internal Server Error",
          message: "Failed to update pin status",
        },
        { status: 500 },
      ),
    );
  }
}
