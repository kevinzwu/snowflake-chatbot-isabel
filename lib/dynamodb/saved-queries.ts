import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { getDynamoDBClient, getTableNames } from "./client";
import { CreateSavedQueryInput, SavedQuery } from "./types";

const client = getDynamoDBClient();

/** Maximum number of saved queries per user */
const MAX_SAVED_QUERIES = 100;

/**
 * List all saved queries for a user, sorted by most recently created.
 */
export async function listSavedQueries(userId: string): Promise<SavedQuery[]> {
  const { savedQueries: tableName } = getTableNames();

  const command = new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "userId = :userId",
    ExpressionAttributeValues: {
      ":userId": userId,
    },
  });

  const result = await client.send(command);
  const items = (result.Items as SavedQuery[]) || [];

  // Sort by createdAt descending (newest first)
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Create a new saved query.
 */
export async function createSavedQuery(
  userId: string,
  queryId: string,
  input: CreateSavedQueryInput,
): Promise<SavedQuery> {
  const { savedQueries: tableName } = getTableNames();
  const now = Date.now();

  // Check if user has reached the limit
  const existing = await listSavedQueries(userId);
  if (existing.length >= MAX_SAVED_QUERIES) {
    throw new Error(
      `Maximum saved queries limit (${MAX_SAVED_QUERIES}) reached. Please delete some queries first.`,
    );
  }

  // Check for duplicate names
  const duplicateName = existing.find(
    (q) => q.name.toLowerCase() === input.name.toLowerCase(),
  );
  if (duplicateName) {
    throw new Error(`A saved query with name "${input.name}" already exists.`);
  }

  const savedQuery: SavedQuery = {
    userId,
    queryId,
    name: input.name.trim(),
    queryText: input.queryText,
    description: input.description?.trim(),
    createdAt: now,
  };

  const command = new PutCommand({
    TableName: tableName,
    Item: savedQuery,
    // Prevent overwriting existing query
    ConditionExpression:
      "attribute_not_exists(userId) AND attribute_not_exists(queryId)",
  });

  await client.send(command);
  return savedQuery;
}

/**
 * Get a single saved query by ID.
 * Returns null if not found or user doesn't own it.
 */
export async function getSavedQuery(
  userId: string,
  queryId: string,
): Promise<SavedQuery | null> {
  const { savedQueries: tableName } = getTableNames();

  const command = new GetCommand({
    TableName: tableName,
    Key: {
      userId,
      queryId,
    },
  });

  const result = await client.send(command);
  return (result.Item as SavedQuery) || null;
}

/**
 * Delete a saved query.
 * Only deletes if user owns the query.
 */
export async function deleteSavedQuery(
  userId: string,
  queryId: string,
): Promise<boolean> {
  const { savedQueries: tableName } = getTableNames();

  const command = new DeleteCommand({
    TableName: tableName,
    Key: {
      userId,
      queryId,
    },
    // Only delete if user owns this query
    ConditionExpression: "userId = :userId",
    ExpressionAttributeValues: {
      ":userId": userId,
    },
  });

  try {
    await client.send(command);
    return true;
  } catch (error) {
    if ((error as Error).name === "ConditionalCheckFailedException") {
      return false;
    }
    throw error;
  }
}

/**
 * Count user's saved queries.
 */
export async function countSavedQueries(userId: string): Promise<number> {
  const { savedQueries: tableName } = getTableNames();

  const command = new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "userId = :userId",
    ExpressionAttributeValues: {
      ":userId": userId,
    },
    Select: "COUNT",
  });

  const result = await client.send(command);
  return result.Count || 0;
}
