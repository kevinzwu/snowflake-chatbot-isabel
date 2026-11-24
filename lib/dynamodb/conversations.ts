import {
  BatchGetCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { getDynamoDBClient, getTableNames } from "./client";
import {
  buildSearchTextIndex,
  loadMessagesFromS3,
  shouldOverflowToS3,
  storeMessagesInS3,
  updateMessageLifecycleTag,
} from "./conversation-storage";
import { extractQueryMetadata } from "./query-metadata";
import {
  CONVERSATION_RETENTION,
  Conversation,
  ConversationSummary,
  CreateConversationInput,
  ListConversationsResult,
  SearchConversationsResult,
  UpdateConversationInput,
} from "./types";

const client = getDynamoDBClient();

/**
 * List conversations for a user, sorted by most recently updated.
 * Returns summaries without full message history for performance.
 * Paginates through DynamoDB's 1MB query pages to return complete results.
 */
export async function listConversations(
  userId: string,
  limit: number = CONVERSATION_RETENTION.MAX_CONVERSATIONS,
): Promise<ListConversationsResult> {
  const { conversations: tableName } = getTableNames();

  const allItems: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const command = new QueryCommand({
      TableName: tableName,
      IndexName: "userId-updatedAt-index",
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId,
      },
      ScanIndexForward: false, // Descending order (newest first)
      Limit: limit + 1 - allItems.length, // Only fetch what we still need
      ProjectionExpression:
        "conversationId, title, createdAt, updatedAt, archived, pinned, messageCount",
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
    });

    const result = await client.send(command);
    allItems.push(...(result.Items || []));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey && allItems.length <= limit);

  const hasMore = allItems.length > limit;
  const conversations: ConversationSummary[] = allItems
    .slice(0, limit)
    .map((item) => ({
      conversationId: item.conversationId as string,
      title: item.title as string,
      createdAt: item.createdAt as number,
      updatedAt: item.updatedAt as number,
      archived: (item.archived as boolean) || false,
      pinned: (item.pinned as boolean) || false,
      messageCount: (item.messageCount as number) ?? 0,
    }));

  return { conversations, hasMore };
}

/**
 * Get a single conversation by ID.
 * Returns null if not found or user doesn't own it.
 * If messages are stored in S3, fetches and rehydrates them.
 * Excludes internal `searchText` field from the response.
 */
export async function getConversation(
  userId: string,
  conversationId: string,
): Promise<Conversation | null> {
  const { conversations: tableName } = getTableNames();

  const command = new GetCommand({
    TableName: tableName,
    Key: {
      userId,
      conversationId,
    },
  });

  const result = await client.send(command);
  if (!result.Item) return null;

  const conversation = result.Item as Conversation;

  // If messages are in S3, fetch and rehydrate
  if (conversation.messageRef) {
    conversation.messages = await loadMessagesFromS3(conversation.messageRef);
  }

  // Exclude internal search index from API response
  delete (conversation as unknown as Record<string, unknown>).searchText;

  return conversation;
}

/**
 * Create a new conversation.
 * Automatically sets TTL for 90-day expiration.
 * If messages exceed 350KB, overflows to S3 with a searchText index.
 */
export async function createConversation(
  userId: string,
  conversationId: string,
  input: CreateConversationInput,
  userEmail?: string,
): Promise<Conversation> {
  const { conversations: tableName } = getTableNames();
  const now = Date.now();

  // Calculate TTL (90 days from now, in seconds for DynamoDB)
  const expiresAt = Math.floor(
    (now + CONVERSATION_RETENTION.DEFAULT_TTL_MS) / 1000,
  );

  const overflow = shouldOverflowToS3(input.messages);

  const conversation: Conversation = {
    userId,
    conversationId,
    title: input.title.slice(0, CONVERSATION_RETENTION.MAX_TITLE_LENGTH),
    messages: overflow ? [] : input.messages,
    messageCount: input.messages.length,
    createdAt: now,
    updatedAt: now,
    archived: false,
    pinned: false,
    expiresAt,
    ...(input.deepThinking != null && { deepThinking: input.deepThinking }),
    ...(input.model && { model: input.model }),
    ...(input.forkedFrom && { forkedFrom: input.forkedFrom }),
  };

  // Overflow large messages to S3
  if (overflow) {
    conversation.messageRef = await storeMessagesInS3(
      userId,
      conversationId,
      input.messages,
    );
    conversation.searchText = buildSearchTextIndex(input.messages);
  }

  const command = new PutCommand({
    TableName: tableName,
    Item: conversation,
    // Prevent overwriting existing conversation
    ConditionExpression:
      "attribute_not_exists(userId) AND attribute_not_exists(conversationId)",
  });

  await client.send(command);

  const queryMeta = extractQueryMetadata(input.messages);
  console.log(
    JSON.stringify({
      action: "conversation_created",
      conversationId,
      userEmail: userEmail || undefined,
      messageCount: input.messages.length,
      s3Overflow: overflow,
      timestamp: new Date(now).toISOString(),
      isNewConversation: true,
      deepThinking: input.deepThinking ?? false,
      queryText: queryMeta.queryText,
      toolsInvoked: queryMeta.toolsInvoked,
      sqlGenerated: queryMeta.sqlGenerated,
    }),
  );

  // Return with full messages for the caller (even if stored in S3),
  // but strip internal storage/indexing fields (consistent with getConversation/updateConversation).
  const {
    searchText: _searchText,
    messageRef: _messageRef,
    ...publicConversation
  } = conversation;
  return { ...publicConversation, messages: input.messages };
}

/**
 * Update an existing conversation with new messages.
 * Only updates if user owns the conversation.
 * Refreshes TTL for non-archived conversations on each update.
 * If messages exceed 350KB, overflows to S3 with a searchText index.
 */
export async function updateConversation(
  userId: string,
  conversationId: string,
  input: UpdateConversationInput,
  userEmail?: string,
): Promise<Conversation | null> {
  const { conversations: tableName } = getTableNames();
  const now = Date.now();

  // Calculate refreshed TTL (90 days from now, in seconds for DynamoDB)
  const refreshedExpiresAt = Math.floor(
    (now + CONVERSATION_RETENTION.DEFAULT_TTL_MS) / 1000,
  );

  const overflow = shouldOverflowToS3(input.messages);

  // Build update expression dynamically
  const updateParts: string[] = [
    "#updatedAt = :updatedAt",
    "#messages = :messages",
    "#messageCount = :messageCount",
    "#expiresAt = :expiresAt",
  ];
  const expressionAttributeNames: Record<string, string> = {
    "#updatedAt": "updatedAt",
    "#messages": "messages",
    "#messageCount": "messageCount",
    "#expiresAt": "expiresAt",
  };
  const expressionAttributeValues: Record<string, unknown> = {
    ":updatedAt": now,
    ":messages": overflow ? [] : input.messages,
    ":messageCount": input.messages.length,
    ":expiresAt": refreshedExpiresAt,
    ":userId": userId,
    ":archived": false,
  };

  // Handle S3 overflow
  if (overflow) {
    const messageRef = await storeMessagesInS3(
      userId,
      conversationId,
      input.messages,
    );
    const searchText = buildSearchTextIndex(input.messages);

    updateParts.push("#messageRef = :messageRef");
    expressionAttributeNames["#messageRef"] = "messageRef";
    expressionAttributeValues[":messageRef"] = messageRef;

    updateParts.push("#searchText = :searchText");
    expressionAttributeNames["#searchText"] = "searchText";
    expressionAttributeValues[":searchText"] = searchText;
  } else {
    // Remove S3 refs if previously overflowed but no longer needed
    updateParts.push("#messageRef = :emptyRef");
    expressionAttributeNames["#messageRef"] = "messageRef";
    expressionAttributeValues[":emptyRef"] = null;

    updateParts.push("#searchText = :emptySearch");
    expressionAttributeNames["#searchText"] = "searchText";
    expressionAttributeValues[":emptySearch"] = null;
  }

  if (input.title) {
    updateParts.push("#title = :title");
    expressionAttributeNames["#title"] = "title";
    expressionAttributeValues[":title"] = input.title.slice(
      0,
      CONVERSATION_RETENTION.MAX_TITLE_LENGTH,
    );
  }

  if (input.deepThinking != null) {
    updateParts.push("#deepThinking = :deepThinking");
    expressionAttributeNames["#deepThinking"] = "deepThinking";
    expressionAttributeValues[":deepThinking"] = input.deepThinking;
  }

  if (input.model) {
    updateParts.push("#model = :model");
    expressionAttributeNames["#model"] = "model";
    expressionAttributeValues[":model"] = input.model;
  }

  const command = new UpdateCommand({
    TableName: tableName,
    Key: {
      userId,
      conversationId,
    },
    UpdateExpression: `SET ${updateParts.join(", ")}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    // Only update if user owns this conversation and it's not archived
    // (archived conversations should not have TTL refreshed)
    ConditionExpression:
      "userId = :userId AND (archived = :archived OR attribute_not_exists(archived))",
    ReturnValues: "ALL_NEW",
  });

  try {
    const result = await client.send(command);

    const queryMeta = extractQueryMetadata(input.messages);
    console.log(
      JSON.stringify({
        action: "conversation_updated",
        conversationId,
        userEmail: userEmail || undefined,
        messageCount: input.messages.length,
        s3Overflow: overflow,
        timestamp: new Date(now).toISOString(),
        isNewConversation: false,
        deepThinking: input.deepThinking ?? false,
        queryText: queryMeta.queryText,
        toolsInvoked: queryMeta.toolsInvoked,
        sqlGenerated: queryMeta.sqlGenerated,
      }),
    );

    // Return with full messages for the caller
    const updated = result.Attributes as Conversation;
    if (overflow) {
      updated.messages = input.messages;
    }
    delete (updated as unknown as Record<string, unknown>).searchText;
    return updated;
  } catch (error) {
    // ConditionalCheckFailedException means user doesn't own this conversation
    if ((error as Error).name === "ConditionalCheckFailedException") {
      return null;
    }
    throw error;
  }
}

/**
 * Delete a conversation.
 * Only deletes if user owns the conversation.
 */
export async function deleteConversation(
  userId: string,
  conversationId: string,
  userEmail?: string,
): Promise<boolean> {
  const { conversations: tableName } = getTableNames();

  const command = new DeleteCommand({
    TableName: tableName,
    Key: {
      userId,
      conversationId,
    },
    // Only delete if user owns this conversation
    ConditionExpression: "userId = :userId",
    ExpressionAttributeValues: {
      ":userId": userId,
    },
  });

  try {
    await client.send(command);

    console.log(
      JSON.stringify({
        action: "conversation_deleted",
        conversationId,
        userEmail: userEmail || undefined,
        timestamp: new Date().toISOString(),
      }),
    );

    return true;
  } catch (error) {
    if ((error as Error).name === "ConditionalCheckFailedException") {
      return false;
    }
    throw error;
  }
}

/**
 * Archive a conversation (sets 180-day extended TTL).
 * Archived conversations are NOT permanent — they expire after 180 days.
 * If messages are in S3, updates the lifecycle tag.
 */
export async function archiveConversation(
  userId: string,
  conversationId: string,
): Promise<Conversation | null> {
  const { conversations: tableName } = getTableNames();
  const now = Date.now();

  // Calculate 180-day TTL for archived conversations (in seconds for DynamoDB)
  const archivedExpiresAt = Math.floor(
    (now + CONVERSATION_RETENTION.ARCHIVED_TTL_MS) / 1000,
  );

  const command = new UpdateCommand({
    TableName: tableName,
    Key: {
      userId,
      conversationId,
    },
    UpdateExpression:
      "SET #archived = :archived, #updatedAt = :updatedAt, #expiresAt = :expiresAt",
    ExpressionAttributeNames: {
      "#archived": "archived",
      "#updatedAt": "updatedAt",
      "#expiresAt": "expiresAt",
    },
    ExpressionAttributeValues: {
      ":archived": true,
      ":updatedAt": now,
      ":expiresAt": archivedExpiresAt,
      ":userId": userId,
    },
    ConditionExpression: "userId = :userId",
    ReturnValues: "ALL_NEW",
  });

  try {
    const result = await client.send(command);
    const conversation = result.Attributes as Conversation;

    // Update S3 lifecycle tag if messages are in S3
    if (conversation.messageRef) {
      await updateMessageLifecycleTag(conversation.messageRef, true);
    }

    return conversation;
  } catch (error) {
    if ((error as Error).name === "ConditionalCheckFailedException") {
      return null;
    }
    throw error;
  }
}

/**
 * Unarchive a conversation (restores TTL for auto-cleanup).
 * If messages are in S3, updates the lifecycle tag.
 */
export async function unarchiveConversation(
  userId: string,
  conversationId: string,
): Promise<Conversation | null> {
  const { conversations: tableName } = getTableNames();
  const now = Date.now();
  const expiresAt = Math.floor(
    (now + CONVERSATION_RETENTION.DEFAULT_TTL_MS) / 1000,
  );

  const command = new UpdateCommand({
    TableName: tableName,
    Key: {
      userId,
      conversationId,
    },
    UpdateExpression:
      "SET #archived = :archived, #updatedAt = :updatedAt, #expiresAt = :expiresAt",
    ExpressionAttributeNames: {
      "#archived": "archived",
      "#updatedAt": "updatedAt",
      "#expiresAt": "expiresAt",
    },
    ExpressionAttributeValues: {
      ":archived": false,
      ":updatedAt": now,
      ":expiresAt": expiresAt,
      ":userId": userId,
    },
    ConditionExpression: "userId = :userId",
    ReturnValues: "ALL_NEW",
  });

  try {
    const result = await client.send(command);
    const conversation = result.Attributes as Conversation;

    // Update S3 lifecycle tag if messages are in S3
    if (conversation.messageRef) {
      await updateMessageLifecycleTag(conversation.messageRef, false);
    }

    return conversation;
  } catch (error) {
    if ((error as Error).name === "ConditionalCheckFailedException") {
      return null;
    }
    throw error;
  }
}

/** Maximum number of pinned conversations per user */
const MAX_PINNED_CONVERSATIONS =
  CONVERSATION_RETENTION.MAX_PINNED_CONVERSATIONS;

/**
 * Count pinned conversations for a user.
 * Uses a Query on userId-updatedAt-index with a FilterExpression (pinned items are few).
 */
export async function countPinnedConversations(
  userId: string,
): Promise<number> {
  const { conversations: tableName } = getTableNames();

  const command = new QueryCommand({
    TableName: tableName,
    IndexName: "userId-updatedAt-index",
    KeyConditionExpression: "userId = :userId",
    FilterExpression: "#pinned = :pinned",
    ExpressionAttributeNames: {
      "#pinned": "pinned",
    },
    ExpressionAttributeValues: {
      ":userId": userId,
      ":pinned": true,
    },
    Select: "COUNT",
  });

  const result = await client.send(command);
  return result.Count ?? 0;
}

/**
 * Pin a conversation.
 * Pinning also archives the conversation (extends TTL to 180 days).
 * Enforces a maximum of 10 pinned conversations per user.
 * Returns null if conversation not found, throws if pin limit exceeded.
 */
export async function pinConversation(
  userId: string,
  conversationId: string,
): Promise<Conversation | null> {
  const { conversations: tableName } = getTableNames();

  // First, verify the conversation exists and check if already pinned
  const getCommand = new GetCommand({
    TableName: tableName,
    Key: { userId, conversationId },
    ProjectionExpression: "conversationId, pinned",
  });

  const existing = await client.send(getCommand);
  if (!existing.Item) {
    return null;
  }

  // If already pinned, return current state (idempotent)
  if (existing.Item.pinned) {
    const fullConversation = await getConversation(userId, conversationId);
    return fullConversation;
  }

  // Enforce pin limit only when transitioning from unpinned → pinned
  const pinnedCount = await countPinnedConversations(userId);
  if (pinnedCount >= MAX_PINNED_CONVERSATIONS) {
    const error = new Error(
      "Maximum of 10 pinned conversations allowed. Unpin a conversation first.",
    );
    error.name = "PinLimitExceeded";
    throw error;
  }

  const now = Date.now();
  const archivedExpiresAt = Math.floor(
    (now + CONVERSATION_RETENTION.ARCHIVED_TTL_MS) / 1000,
  );

  const command = new UpdateCommand({
    TableName: tableName,
    Key: {
      userId,
      conversationId,
    },
    UpdateExpression:
      "SET #pinned = :pinned, #archived = :archived, #updatedAt = :updatedAt, #expiresAt = :expiresAt",
    ExpressionAttributeNames: {
      "#pinned": "pinned",
      "#archived": "archived",
      "#updatedAt": "updatedAt",
      "#expiresAt": "expiresAt",
    },
    ExpressionAttributeValues: {
      ":pinned": true,
      ":archived": true,
      ":updatedAt": now,
      ":expiresAt": archivedExpiresAt,
      ":userId": userId,
    },
    ConditionExpression: "userId = :userId",
    ReturnValues: "ALL_NEW",
  });

  try {
    const result = await client.send(command);
    const conversation = result.Attributes as Conversation;

    // Update S3 lifecycle tag since pinning also archives
    if (conversation.messageRef) {
      await updateMessageLifecycleTag(conversation.messageRef, true);
    }

    return conversation;
  } catch (error) {
    if ((error as Error).name === "ConditionalCheckFailedException") {
      return null;
    }
    throw error;
  }
}

/**
 * Unpin a conversation.
 * Does NOT change archived status (pinning implies archive, unpinning keeps it).
 */
export async function unpinConversation(
  userId: string,
  conversationId: string,
): Promise<Conversation | null> {
  const { conversations: tableName } = getTableNames();
  const now = Date.now();

  const command = new UpdateCommand({
    TableName: tableName,
    Key: {
      userId,
      conversationId,
    },
    UpdateExpression: "SET #pinned = :pinned, #updatedAt = :updatedAt",
    ExpressionAttributeNames: {
      "#pinned": "pinned",
      "#updatedAt": "updatedAt",
    },
    ExpressionAttributeValues: {
      ":pinned": false,
      ":updatedAt": now,
      ":userId": userId,
    },
    ConditionExpression: "userId = :userId",
    ReturnValues: "ALL_NEW",
  });

  try {
    const result = await client.send(command);
    return result.Attributes as Conversation;
  } catch (error) {
    if ((error as Error).name === "ConditionalCheckFailedException") {
      return null;
    }
    throw error;
  }
}

/**
 * Count user's conversations (for enforcing limits).
 * Paginates through DynamoDB's 1MB query pages to return accurate totals.
 */
export async function countConversations(userId: string): Promise<number> {
  const { conversations: tableName } = getTableNames();

  let totalCount = 0;
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const command = new QueryCommand({
      TableName: tableName,
      IndexName: "userId-updatedAt-index",
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId,
      },
      Select: "COUNT",
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
    });

    const result = await client.send(command);
    totalCount += result.Count || 0;
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return totalCount;
}

/**
 * Get the oldest non-archived conversation for a user.
 * Used for enforcing conversation limits.
 */
export async function getOldestNonArchivedConversation(
  userId: string,
): Promise<ConversationSummary | null> {
  const { conversations: tableName } = getTableNames();

  const command = new QueryCommand({
    TableName: tableName,
    IndexName: "userId-updatedAt-index",
    KeyConditionExpression: "userId = :userId",
    FilterExpression: "archived = :archived",
    ExpressionAttributeValues: {
      ":userId": userId,
      ":archived": false,
    },
    ScanIndexForward: true, // Ascending order (oldest first)
    Limit: 1,
    ProjectionExpression:
      "conversationId, title, createdAt, updatedAt, archived",
  });

  const result = await client.send(command);
  const item = result.Items?.[0];

  if (!item) return null;

  return {
    conversationId: item.conversationId,
    title: item.title,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    archived: item.archived || false,
    pinned: item.pinned || false,
    messageCount: 0, // Not fetched in this query
  };
}

/**
 * Rename a conversation (title-only update).
 * Works on both active and archived conversations.
 * Does NOT refresh TTL or update messages.
 */
export async function renameConversation(
  userId: string,
  conversationId: string,
  title: string,
): Promise<Conversation | null> {
  const { conversations: tableName } = getTableNames();
  const now = Date.now();

  const command = new UpdateCommand({
    TableName: tableName,
    Key: {
      userId,
      conversationId,
    },
    UpdateExpression: "SET #title = :title, #updatedAt = :updatedAt",
    ExpressionAttributeNames: {
      "#title": "title",
      "#updatedAt": "updatedAt",
    },
    ExpressionAttributeValues: {
      ":title": title.slice(0, CONVERSATION_RETENTION.MAX_TITLE_LENGTH),
      ":updatedAt": now,
      ":userId": userId,
    },
    // Only update if user owns this conversation
    ConditionExpression: "userId = :userId",
    ReturnValues: "ALL_NEW",
  });

  try {
    const result = await client.send(command);
    return result.Attributes as Conversation;
  } catch (error) {
    if ((error as Error).name === "ConditionalCheckFailedException") {
      return null;
    }
    throw error;
  }
}

/**
 * Search conversations by title and message content.
 * Fetches all conversations for the user and filters in-memory.
 * Returns summaries (no full messages) with match source indicators.
 */
export async function searchConversations(
  userId: string,
  query: string,
): Promise<SearchConversationsResult> {
  const { conversations: tableName } = getTableNames();
  const normalizedQuery = query.toLowerCase().trim();

  // ── Phase 1: Lightweight title search via GSI (no message bodies) ──
  // This is cheap and fast — only fetches metadata fields.
  // Paginates through all DynamoDB query pages to ensure complete results.
  const summaries: ConversationSummary[] = [];
  let titleLastKey: Record<string, unknown> | undefined;

  do {
    const titleCommand = new QueryCommand({
      TableName: tableName,
      IndexName: "userId-updatedAt-index",
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId,
      },
      ProjectionExpression:
        "conversationId, title, createdAt, updatedAt, archived, pinned, messageCount",
      ...(titleLastKey && { ExclusiveStartKey: titleLastKey }),
    });

    const titleResult = await client.send(titleCommand);
    summaries.push(...((titleResult.Items || []) as ConversationSummary[]));
    titleLastKey = titleResult.LastEvaluatedKey;
  } while (titleLastKey);

  const conversations: ConversationSummary[] = [];
  const matchedInContent: Record<string, boolean> = {};
  const titleMissIds: string[] = [];

  for (const item of summaries) {
    if ((item.title || "").toLowerCase().includes(normalizedQuery)) {
      conversations.push({
        conversationId: item.conversationId,
        title: item.title,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        archived: item.archived || false,
        pinned: item.pinned || false,
        messageCount: item.messageCount ?? 0,
      });
      matchedInContent[item.conversationId] = false;
    } else {
      titleMissIds.push(item.conversationId);
    }
  }

  // ── Phase 2: Content search — fetch full records only for non-title matches ──
  // BatchGetItem supports up to 100 keys per call (25 per batch in practice).
  // Only runs when there are conversations whose titles didn't match.
  // For S3-backed conversations, uses the `searchText` index instead of full messages.
  if (titleMissIds.length > 0) {
    const BATCH_SIZE = 25;
    for (let i = 0; i < titleMissIds.length; i += BATCH_SIZE) {
      const batch = titleMissIds.slice(i, i + BATCH_SIZE);
      const keys = batch.map((cid) => ({ userId, conversationId: cid }));

      const batchCommand = new BatchGetCommand({
        RequestItems: {
          [tableName]: { Keys: keys },
        },
      });

      const batchResult = await client.send(batchCommand);
      const items = (batchResult.Responses?.[tableName] ||
        []) as Conversation[];

      for (const item of items) {
        let contentMatch = false;

        // For S3-backed conversations, search the searchText index
        if (item.messageRef && item.searchText) {
          contentMatch = item.searchText
            .toLowerCase()
            .includes(normalizedQuery);
        } else if (item.messages) {
          // For inline conversations, search message content directly
          for (const message of item.messages) {
            if (message.content) {
              for (const block of message.content) {
                if (
                  "text" in block &&
                  typeof block.text === "string" &&
                  block.text.toLowerCase().includes(normalizedQuery)
                ) {
                  contentMatch = true;
                  break;
                }
              }
            }
            if (contentMatch) break;
          }
        }
        if (contentMatch) {
          conversations.push({
            conversationId: item.conversationId,
            title: item.title,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            archived: item.archived || false,
            pinned: item.pinned || false,
            messageCount: item.messageCount ?? 0,
          });
          matchedInContent[item.conversationId] = true;
        }
      }
    }
  }

  // Sort by updatedAt descending (newest first)
  conversations.sort((a, b) => b.updatedAt - a.updatedAt);

  return { conversations, matchedInContent };
}

/**
 * Generate a share token for a conversation, making it accessible via share link.
 * Only the owner can share their conversation.
 * If already shared, returns the existing share token (idempotent).
 */
export async function shareConversation(
  userId: string,
  conversationId: string,
): Promise<{ shareToken: string; alreadyShared: boolean }> {
  const { conversations: tableName } = getTableNames();

  // Lightweight check — only fetch sharing fields, skip S3 message rehydration
  const getCmd = new GetCommand({
    TableName: tableName,
    Key: { userId, conversationId },
    ProjectionExpression: "#isShared, #shareToken",
    ExpressionAttributeNames: {
      "#isShared": "isShared",
      "#shareToken": "shareToken",
    },
  });
  const existing = await client.send(getCmd);
  if (!existing.Item) {
    throw new Error("Conversation not found");
  }
  if (existing.Item.isShared && existing.Item.shareToken) {
    return {
      shareToken: existing.Item.shareToken as string,
      alreadyShared: true,
    };
  }

  const shareToken = crypto.randomUUID();
  const now = Date.now();

  const command = new UpdateCommand({
    TableName: tableName,
    Key: { userId, conversationId },
    UpdateExpression:
      "SET #shareToken = :shareToken, #isShared = :isShared, #sharedAt = :sharedAt",
    ExpressionAttributeNames: {
      "#shareToken": "shareToken",
      "#isShared": "isShared",
      "#sharedAt": "sharedAt",
    },
    ExpressionAttributeValues: {
      ":shareToken": shareToken,
      ":isShared": true,
      ":sharedAt": now,
      ":userId": userId,
    },
    ConditionExpression: "userId = :userId",
    ReturnValues: "ALL_NEW",
  });

  await client.send(command);

  console.log(
    JSON.stringify({
      action: "conversation_shared",
      conversationId,
      shareToken,
      timestamp: new Date(now).toISOString(),
    }),
  );

  return { shareToken, alreadyShared: false };
}

/**
 * Revoke sharing for a conversation, removing the share token.
 * Idempotent — succeeds even if conversation is not currently shared.
 */
export async function unshareConversation(
  userId: string,
  conversationId: string,
): Promise<void> {
  const { conversations: tableName } = getTableNames();

  const command = new UpdateCommand({
    TableName: tableName,
    Key: { userId, conversationId },
    UpdateExpression: "SET #isShared = :isShared REMOVE #shareToken, #sharedAt",
    ExpressionAttributeNames: {
      "#shareToken": "shareToken",
      "#sharedAt": "sharedAt",
      "#isShared": "isShared",
    },
    ExpressionAttributeValues: {
      ":isShared": false,
      ":userId": userId,
    },
    ConditionExpression: "userId = :userId",
  });

  try {
    await client.send(command);
    console.log(
      JSON.stringify({
        action: "conversation_unshared",
        conversationId,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (error) {
    if ((error as Error).name === "ConditionalCheckFailedException") {
      throw new Error("Conversation not found");
    }
    throw error;
  }
}

/**
 * Retrieve a conversation by its share token via GSI.
 * Returns the full conversation with messages (rehydrated from S3 if needed).
 * Returns null if token is invalid or conversation is not shared.
 */
export async function getConversationByShareToken(
  shareToken: string,
): Promise<Conversation | null> {
  const { conversations: tableName } = getTableNames();

  const command = new QueryCommand({
    TableName: tableName,
    IndexName: "shareToken-index",
    KeyConditionExpression: "#shareToken = :shareToken",
    ExpressionAttributeNames: {
      "#shareToken": "shareToken",
    },
    ExpressionAttributeValues: {
      ":shareToken": shareToken,
    },
    Limit: 1,
  });

  const result = await client.send(command);
  if (!result.Items || result.Items.length === 0) return null;

  const conversation = result.Items[0] as Conversation;

  // Verify sharing is active
  if (!conversation.isShared) return null;

  // Rehydrate S3 messages if needed
  if (conversation.messageRef) {
    conversation.messages = await loadMessagesFromS3(conversation.messageRef);
  }

  // Exclude internal fields
  delete (conversation as unknown as Record<string, unknown>).searchText;

  return conversation;
}
