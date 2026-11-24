import type { AgentMessage } from "@/lib/agent-api/types";
import {
  CONVERSATION_RETENTION,
  ConversationStorageConfigError,
  countConversations,
  createConversation,
  ForkedFrom,
  listConversations,
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
import { NextRequest, NextResponse } from "next/server";

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

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates forkedFrom metadata shape and format.
 * Returns validated object or null if invalid.
 */
function validateForkedFrom(input: unknown): ForkedFrom | null {
  if (!input || typeof input !== "object") return null;
  const { shareToken, conversationId, ownerUserId } = input as Record<
    string,
    unknown
  >;
  if (
    typeof shareToken !== "string" ||
    typeof conversationId !== "string" ||
    typeof ownerUserId !== "string"
  )
    return null;
  if (!UUID_V4_REGEX.test(shareToken) || !UUID_V4_REGEX.test(conversationId))
    return null;
  return { shareToken, conversationId, ownerUserId };
}

/**
 * GET /api/conversations
 * List all conversations for the authenticated user.
 *
 * Security: session auth → revocation check → group auth → read rate limit → no-cache headers
 */
export async function GET() {
  const auth = await authenticateReadRequest("/api/conversations");
  if (auth instanceof NextResponse) return auth;

  try {
    const result = await listConversations(auth.userId);
    return secureJsonResponse(result);
  } catch (error) {
    console.error("Failed to list conversations:", error);
    return withNoCacheHeaders(
      NextResponse.json(
        {
          error: "Internal Server Error",
          message: "Failed to list conversations",
        },
        { status: 500 },
      ),
    );
  }
}

/**
 * POST /api/conversations
 * Create a new conversation.
 *
 * Security: session auth → revocation check → group auth → write rate limit →
 *           origin validation → body size check → message count cap → no-cache headers
 *
 * Body: { title: string, messages: AgentMessage[] }
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateWriteRequest(
    request,
    "/api/conversations",
    CONVERSATION_RETENTION.MAX_BODY_SIZE_BYTES,
  );
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { title, messages, deepThinking, model, forkedFrom } = body as {
      title?: string;
      messages: AgentMessage[];
      deepThinking?: boolean;
      model?: "sonnet" | "haiku" | "opus";
      forkedFrom?: {
        shareToken: string;
        conversationId: string;
        ownerUserId: string;
      };
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
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

    const userId = auth.userId;

    // Check conversation limit
    const currentCount = await countConversations(userId);
    if (currentCount >= CONVERSATION_RETENTION.MAX_CONVERSATIONS) {
      return secureJsonResponse(
        {
          error: "Limit Reached",
          message: `Maximum conversations limit (${CONVERSATION_RETENTION.MAX_CONVERSATIONS}) reached. Please delete or archive old conversations to make room.`,
        },
        409,
      );
    }

    // Sanitize messages to prevent XSS
    const sanitizedMessages = sanitizeMessages(messages);

    // Generate title from first user message if not provided
    const firstUserMessage = sanitizedMessages.find((m) => m.role === "user");
    const firstContent = firstUserMessage?.content?.[0];
    const titleText =
      firstContent && "text" in firstContent ? firstContent.text : null;
    // Sanitize title input
    const rawTitle = title || titleText?.slice(0, 100) || "New Conversation";
    const conversationTitle = sanitizeInput(rawTitle);

    // Validate forkedFrom if provided (defense-in-depth)
    const validatedForkedFrom = forkedFrom
      ? validateForkedFrom(forkedFrom)
      : undefined;

    const conversationId = crypto.randomUUID();
    const conversation = await createConversation(
      userId,
      conversationId,
      {
        title: conversationTitle,
        messages: sanitizedMessages,
        deepThinking: deepThinking === true ? true : undefined,
        model,
        ...(validatedForkedFrom && { forkedFrom: validatedForkedFrom }),
      },
      auth.userEmail,
    );

    return secureJsonResponse(conversation, 201);
  } catch (error) {
    if (error instanceof ConversationStorageConfigError) {
      console.error(
        JSON.stringify({
          event: "conversation_storage_misconfigured",
          route: "/api/conversations",
          message: error.message,
          timestamp: new Date().toISOString(),
        }),
      );
      return storageUnavailableResponse();
    }
    console.error("Failed to create conversation:", error);
    return withNoCacheHeaders(
      NextResponse.json(
        {
          error: "Internal Server Error",
          message: "Failed to create conversation",
        },
        { status: 500 },
      ),
    );
  }
}
