import type { AgentMessage } from "@/lib/agent-api/types";
import {
  CONVERSATION_RETENTION,
  ConversationStorageConfigError,
  deleteConversation,
  getConversation,
  renameConversation,
  updateConversation,
} from "@/lib/dynamodb";
import {
  storageUnavailableResponse,
  withNoCacheHeaders,
} from "@/lib/security/api-response";
import { sanitizeInput } from "@/lib/security/input-sanitizer";
import {
  authenticateReadRequest,
  authenticateWriteRequest,
  secureJsonResponse,
} from "@/lib/security/route-hardening";
import { validateRouteId } from "@/lib/security/validators";
import { NextRequest, NextResponse } from "next/server";

interface RouteParams {
  params: Promise<{ conversationId: string }>;
}

/**
 * Sanitizes user message content to prevent stored XSS.
 * Only processes user-role messages — assistant responses contain
 * legitimate vulnerability data (payloads, code samples) that must
 * be preserved verbatim.
 */
function sanitizeMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => {
    if (message.role !== "user") return message;
    return {
      ...message,
      content: message.content?.map((block) => {
        if ("text" in block && typeof block.text === "string") {
          return { ...block, text: sanitizeInput(block.text) };
        }
        return block;
      }),
    };
  });
}

/**
 * GET /api/conversations/[conversationId]
 * Get a single conversation by ID.
 *
 * Security: session auth → revocation → group auth → read rate limit → ID format validation
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateReadRequest("/api/conversations/[id]");
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

    const conversation = await getConversation(auth.userId, conversationId);

    if (!conversation) {
      return secureJsonResponse(
        { error: "Not Found", message: "Conversation not found" },
        404,
      );
    }

    return secureJsonResponse(conversation);
  } catch (error) {
    console.error("Failed to get conversation:", error);
    return withNoCacheHeaders(
      NextResponse.json(
        {
          error: "Internal Server Error",
          message: "Failed to get conversation",
        },
        { status: 500 },
      ),
    );
  }
}

/**
 * PUT /api/conversations/[conversationId]
 * Update a conversation's messages.
 *
 * Security: session auth → revocation → group auth → write rate limit →
 *           origin validation → body size check → ID format → message count cap
 *
 * Body: { messages: AgentMessage[], title?: string }
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateWriteRequest(
    request,
    "/api/conversations/[id]",
    CONVERSATION_RETENTION.MAX_BODY_SIZE_BYTES,
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
    const { messages, title, deepThinking, model } = body as {
      messages: AgentMessage[];
      title?: string;
      deepThinking?: boolean;
      model?: "sonnet" | "haiku" | "opus";
    };

    if (!messages || !Array.isArray(messages)) {
      return secureJsonResponse(
        { error: "Bad Request", message: "Messages array is required" },
        400,
      );
    }

    // Enforce message count cap
    if (messages.length > CONVERSATION_RETENTION.MAX_MESSAGES) {
      return secureJsonResponse(
        {
          error: "Bad Request",
          message: `Messages array exceeds maximum of ${CONVERSATION_RETENTION.MAX_MESSAGES} messages`,
        },
        400,
      );
    }

    // Enforce content block cap per message
    for (const msg of messages) {
      if (
        msg.content &&
        msg.content.length > CONVERSATION_RETENTION.MAX_CONTENT_BLOCKS
      ) {
        return secureJsonResponse(
          {
            error: "Bad Request",
            message: `Message content exceeds maximum of ${CONVERSATION_RETENTION.MAX_CONTENT_BLOCKS} blocks per message`,
          },
          400,
        );
      }
    }

    // Sanitize messages and title to prevent XSS
    const sanitizedMessages = sanitizeMessages(messages);
    const sanitizedTitle = title ? sanitizeInput(title) : undefined;

    const conversation = await updateConversation(
      auth.userId,
      conversationId,
      {
        messages: sanitizedMessages,
        title: sanitizedTitle,
        deepThinking: deepThinking === true ? true : undefined,
        model,
      },
      auth.userEmail,
    );

    if (!conversation) {
      return secureJsonResponse(
        { error: "Not Found", message: "Conversation not found" },
        404,
      );
    }

    return secureJsonResponse(conversation);
  } catch (error) {
    if (error instanceof ConversationStorageConfigError) {
      console.error(
        JSON.stringify({
          event: "conversation_storage_misconfigured",
          route: "/api/conversations/[id]",
          message: error.message,
          timestamp: new Date().toISOString(),
        }),
      );
      return storageUnavailableResponse();
    }
    console.error("Failed to update conversation:", error);
    return withNoCacheHeaders(
      NextResponse.json(
        {
          error: "Internal Server Error",
          message: "Failed to update conversation",
        },
        { status: 500 },
      ),
    );
  }
}

/**
 * DELETE /api/conversations/[conversationId]
 * Delete a conversation.
 *
 * Security: session auth → revocation → group auth → write rate limit →
 *           origin validation → ID format validation
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateWriteRequest(
    request,
    "/api/conversations/[id]",
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

    const deleted = await deleteConversation(
      auth.userId,
      conversationId,
      auth.userEmail,
    );

    if (!deleted) {
      return secureJsonResponse(
        { error: "Not Found", message: "Conversation not found" },
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
    console.error("Failed to delete conversation:", error);
    return withNoCacheHeaders(
      NextResponse.json(
        {
          error: "Internal Server Error",
          message: "Failed to delete conversation",
        },
        { status: 500 },
      ),
    );
  }
}

/**
 * PATCH /api/conversations/[conversationId]
 * Rename a conversation (title-only update).
 *
 * Security: session auth → revocation → group auth → write rate limit →
 *           origin validation → body size check → ID format → title validation
 *
 * Body: { title: string }
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateWriteRequest(
    request,
    "/api/conversations/[id]",
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
    const { title } = body as { title: string };

    if (!title || typeof title !== "string") {
      return secureJsonResponse(
        { error: "Bad Request", message: "Title is required" },
        400,
      );
    }

    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      return secureJsonResponse(
        { error: "Bad Request", message: "Title cannot be empty" },
        400,
      );
    }

    if (trimmedTitle.length > CONVERSATION_RETENTION.MAX_TITLE_LENGTH) {
      return secureJsonResponse(
        {
          error: "Bad Request",
          message: `Title exceeds maximum of ${CONVERSATION_RETENTION.MAX_TITLE_LENGTH} characters`,
        },
        400,
      );
    }

    // Sanitize title to prevent XSS
    const sanitizedTitle = sanitizeInput(trimmedTitle);

    const conversation = await renameConversation(
      auth.userId,
      conversationId,
      sanitizedTitle,
    );

    if (!conversation) {
      return secureJsonResponse(
        { error: "Not Found", message: "Conversation not found" },
        404,
      );
    }

    return secureJsonResponse(conversation);
  } catch (error) {
    console.error("Failed to rename conversation:", error);
    return withNoCacheHeaders(
      NextResponse.json(
        {
          error: "Internal Server Error",
          message: "Failed to rename conversation",
        },
        { status: 500 },
      ),
    );
  }
}
