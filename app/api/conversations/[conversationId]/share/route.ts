import { getAppConfig } from "@/lib/config/app-config";
import { shareConversation, unshareConversation } from "@/lib/dynamodb";
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
 * POST /api/conversations/[conversationId]/share
 * Generate a share link for a conversation.
 * Returns existing token if already shared (idempotent).
 *
 * Security: session auth → revocation → group auth → write rate limit →
 *           origin validation → ID format validation
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateWriteRequest(
    request,
    "/api/conversations/[id]/share",
  );
  if (auth instanceof NextResponse) return auth;

  try {
    const { conversationId: rawConversationId } = await params;

    const idValidation = validateRouteId(rawConversationId, "conversationId");
    if (!idValidation.isValid) {
      return secureJsonResponse(
        { error: "Bad Request", message: idValidation.error },
        400,
      );
    }
    const conversationId = idValidation.value;

    const result = await shareConversation(auth.userId, conversationId);

    const shareUrl = `${getAppConfig().baseUrl}/shared/${result.shareToken}`;

    return secureJsonResponse({
      shareToken: result.shareToken,
      shareUrl,
      alreadyShared: result.alreadyShared,
    });
  } catch (error) {
    if ((error as Error).message === "Conversation not found") {
      return secureJsonResponse(
        { error: "Not Found", message: "Conversation not found" },
        404,
      );
    }
    console.error("Failed to share conversation:", error);
    return withNoCacheHeaders(
      NextResponse.json(
        {
          error: "Internal Server Error",
          message: "Failed to share conversation",
        },
        { status: 500 },
      ),
    );
  }
}

/**
 * DELETE /api/conversations/[conversationId]/share
 * Revoke sharing for a conversation.
 * Idempotent — succeeds even if not currently shared.
 *
 * Security: session auth → revocation → group auth → write rate limit →
 *           origin validation → ID format validation
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateWriteRequest(
    request,
    "/api/conversations/[id]/share",
  );
  if (auth instanceof NextResponse) return auth;

  try {
    const { conversationId: rawConversationId } = await params;

    const idValidation = validateRouteId(rawConversationId, "conversationId");
    if (!idValidation.isValid) {
      return secureJsonResponse(
        { error: "Bad Request", message: idValidation.error },
        400,
      );
    }
    const conversationId = idValidation.value;

    await unshareConversation(auth.userId, conversationId);

    return secureJsonResponse({ message: "Share revoked" });
  } catch (error) {
    if ((error as Error).message === "Conversation not found") {
      return secureJsonResponse(
        { error: "Not Found", message: "Conversation not found" },
        404,
      );
    }
    console.error("Failed to unshare conversation:", error);
    return withNoCacheHeaders(
      NextResponse.json(
        {
          error: "Internal Server Error",
          message: "Failed to revoke share",
        },
        { status: 500 },
      ),
    );
  }
}
