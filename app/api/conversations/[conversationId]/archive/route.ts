import { archiveConversation, unarchiveConversation } from "@/lib/dynamodb";
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
 * POST /api/conversations/[conversationId]/archive
 * Archive or unarchive a conversation.
 * Archived conversations get 90-day extended TTL (not permanent).
 *
 * Security: session auth → revocation → group auth → write rate limit →
 *           origin validation → body size check → ID format validation
 *
 * Body: { archived: boolean }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateWriteRequest(
    request,
    "/api/conversations/[id]/archive",
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
    const { archived } = body as { archived: boolean };

    if (typeof archived !== "boolean") {
      return secureJsonResponse(
        { error: "Bad Request", message: "archived field must be a boolean" },
        400,
      );
    }

    const conversation = archived
      ? await archiveConversation(auth.userId, conversationId)
      : await unarchiveConversation(auth.userId, conversationId);

    if (!conversation) {
      return secureJsonResponse(
        { error: "Not Found", message: "Conversation not found" },
        404,
      );
    }

    return secureJsonResponse(conversation);
  } catch (error) {
    console.error("Failed to archive/unarchive conversation:", error);
    return withNoCacheHeaders(
      NextResponse.json(
        {
          error: "Internal Server Error",
          message: "Failed to update archive status",
        },
        { status: 500 },
      ),
    );
  }
}
