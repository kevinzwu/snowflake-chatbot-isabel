import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import shortUUID from "short-uuid";
import { getDynamoDBClient, getTableNames } from "./client";
import {
  CreateProfileInput,
  PROFILE_LIMITS,
  ProfileForkedFrom,
  UpdateProfileInput,
  UserProfile,
} from "./types";

const client = getDynamoDBClient();

/**
 * List all profiles for a user, sorted by most recently updated.
 */
export async function listProfiles(userId: string): Promise<UserProfile[]> {
  const { userProfiles: tableName } = getTableNames();

  const command = new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "userId = :userId",
    ExpressionAttributeValues: {
      ":userId": userId,
    },
  });

  const result = await client.send(command);
  const items = (result.Items as UserProfile[]) || [];

  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Get a specific profile by userId and profileId.
 */
export async function getProfile(
  userId: string,
  profileId: string,
): Promise<UserProfile | null> {
  const { userProfiles: tableName } = getTableNames();

  const command = new GetCommand({
    TableName: tableName,
    Key: { userId, profileId },
  });

  const result = await client.send(command);
  return (result.Item as UserProfile) || null;
}

/**
 * Create a new profile. Enforces per-user limit and validates content length.
 */
export async function createProfile(
  userId: string,
  input: CreateProfileInput,
): Promise<UserProfile> {
  const { userProfiles: tableName } = getTableNames();

  // Validate input
  if (!input.name || input.name.length === 0) {
    throw new Error("Profile name is required.");
  }
  if (input.name.length > PROFILE_LIMITS.MAX_NAME_LENGTH) {
    throw new Error(
      `Profile name must not exceed ${PROFILE_LIMITS.MAX_NAME_LENGTH} characters.`,
    );
  }
  if (!input.content || input.content.length === 0) {
    throw new Error("Profile content is required.");
  }
  if (input.content.length > PROFILE_LIMITS.MAX_CONTENT_LENGTH) {
    throw new Error(
      `Profile content must not exceed ${PROFILE_LIMITS.MAX_CONTENT_LENGTH} characters.`,
    );
  }

  // Check profile limit
  const existing = await listProfiles(userId);
  if (existing.length >= PROFILE_LIMITS.MAX_PROFILES) {
    throw new Error(
      `Maximum profiles limit (${PROFILE_LIMITS.MAX_PROFILES}) reached. Please delete some profiles first.`,
    );
  }

  const now = Date.now();
  const profileId = shortUUID.generate();

  // If setting as default, unset the current default first
  if (input.isDefault) {
    await unsetCurrentDefault(userId, existing);
  }

  const profile: UserProfile = {
    userId,
    profileId,
    name: input.name,
    content: input.content,
    isDefault: input.isDefault || false,
    createdAt: now,
    updatedAt: now,
  };

  const command = new PutCommand({
    TableName: tableName,
    Item: profile,
  });

  await client.send(command);
  return profile;
}

/**
 * Update an existing profile's name, content, or default status.
 */
export async function updateProfile(
  userId: string,
  profileId: string,
  input: UpdateProfileInput,
): Promise<UserProfile | null> {
  const { userProfiles: tableName } = getTableNames();

  // Validate input
  if (input.name !== undefined) {
    if (input.name.length === 0) {
      throw new Error("Profile name is required.");
    }
    if (input.name.length > PROFILE_LIMITS.MAX_NAME_LENGTH) {
      throw new Error(
        `Profile name must not exceed ${PROFILE_LIMITS.MAX_NAME_LENGTH} characters.`,
      );
    }
  }
  if (input.content !== undefined) {
    if (input.content.length === 0) {
      throw new Error("Profile content is required.");
    }
    if (input.content.length > PROFILE_LIMITS.MAX_CONTENT_LENGTH) {
      throw new Error(
        `Profile content must not exceed ${PROFILE_LIMITS.MAX_CONTENT_LENGTH} characters.`,
      );
    }
  }

  // If setting as default, unset the current default first
  if (input.isDefault === true) {
    const existing = await listProfiles(userId);
    await unsetCurrentDefault(userId, existing);
  }

  // Build update expression
  const expressionParts: string[] = [];
  const expressionValues: Record<string, unknown> = {};
  const expressionNames: Record<string, string> = {};

  if (input.name !== undefined) {
    expressionParts.push("#n = :name");
    expressionValues[":name"] = input.name;
    expressionNames["#n"] = "name";
  }
  if (input.content !== undefined) {
    expressionParts.push("#c = :content");
    expressionValues[":content"] = input.content;
    expressionNames["#c"] = "content";
  }
  if (input.isDefault !== undefined) {
    expressionParts.push("isDefault = :isDefault");
    expressionValues[":isDefault"] = input.isDefault;
  }

  // Always update timestamp
  expressionParts.push("updatedAt = :updatedAt");
  expressionValues[":updatedAt"] = Date.now();

  const command = new UpdateCommand({
    TableName: tableName,
    Key: { userId, profileId },
    UpdateExpression: `SET ${expressionParts.join(", ")}`,
    ExpressionAttributeValues: expressionValues,
    ...(Object.keys(expressionNames).length > 0 && {
      ExpressionAttributeNames: expressionNames,
    }),
    ConditionExpression: "attribute_exists(userId)",
    ReturnValues: "ALL_NEW",
  });

  try {
    const result = await client.send(command);
    return result.Attributes as UserProfile;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.name === "ConditionalCheckFailedException"
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Delete a profile.
 */
export async function deleteProfile(
  userId: string,
  profileId: string,
): Promise<boolean> {
  const { userProfiles: tableName } = getTableNames();

  const command = new DeleteCommand({
    TableName: tableName,
    Key: { userId, profileId },
    ConditionExpression: "attribute_exists(userId)",
  });

  try {
    await client.send(command);
    return true;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.name === "ConditionalCheckFailedException"
    ) {
      return false;
    }
    throw error;
  }
}

/**
 * Set a profile as default, atomically unsetting the previous default.
 */
export async function setDefaultProfile(
  userId: string,
  profileId: string,
): Promise<UserProfile | null> {
  return updateProfile(userId, profileId, { isDefault: true });
}

/**
 * Generate a share token for a profile, enabling link-based sharing.
 */
export async function shareProfile(
  userId: string,
  profileId: string,
): Promise<string | null> {
  const { userProfiles: tableName } = getTableNames();
  const shareToken = shortUUID.generate();

  const command = new UpdateCommand({
    TableName: tableName,
    Key: { userId, profileId },
    UpdateExpression: "SET shareToken = :token, updatedAt = :updatedAt",
    ExpressionAttributeValues: {
      ":token": shareToken,
      ":updatedAt": Date.now(),
    },
    ConditionExpression: "attribute_exists(userId)",
    ReturnValues: "ALL_NEW",
  });

  try {
    await client.send(command);
    return shareToken;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.name === "ConditionalCheckFailedException"
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Remove the share token from a profile, disabling sharing.
 */
export async function unshareProfile(
  userId: string,
  profileId: string,
): Promise<boolean> {
  const { userProfiles: tableName } = getTableNames();

  const command = new UpdateCommand({
    TableName: tableName,
    Key: { userId, profileId },
    UpdateExpression: "SET updatedAt = :updatedAt REMOVE shareToken",
    ExpressionAttributeValues: {
      ":updatedAt": Date.now(),
    },
    ConditionExpression: "attribute_exists(userId)",
  });

  try {
    await client.send(command);
    return true;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.name === "ConditionalCheckFailedException"
    ) {
      return false;
    }
    throw error;
  }
}

/**
 * Look up a shared profile by its share token (uses GSI).
 */
export async function getProfileByShareToken(
  shareToken: string,
): Promise<UserProfile | null> {
  const { userProfiles: tableName } = getTableNames();

  const command = new QueryCommand({
    TableName: tableName,
    IndexName: "shareToken-index",
    KeyConditionExpression: "shareToken = :token",
    ExpressionAttributeValues: {
      ":token": shareToken,
    },
    Limit: 1,
  });

  const result = await client.send(command);
  return (result.Items?.[0] as UserProfile) || null;
}

/**
 * Fork a shared profile into a user's collection.
 */
export async function forkProfile(
  userId: string,
  shareToken: string,
): Promise<UserProfile> {
  // Look up the shared profile
  const sourceProfile = await getProfileByShareToken(shareToken);
  if (!sourceProfile) {
    throw new Error("Shared profile not found.");
  }

  const forkedFrom: ProfileForkedFrom = {
    userId: sourceProfile.userId,
    profileId: sourceProfile.profileId,
  };

  // Create a copy in the user's collection
  const { userProfiles: tableName } = getTableNames();

  // Check limit
  const existing = await listProfiles(userId);
  if (existing.length >= PROFILE_LIMITS.MAX_PROFILES) {
    throw new Error(
      `Maximum profiles limit (${PROFILE_LIMITS.MAX_PROFILES}) reached. Please delete some profiles first.`,
    );
  }

  const now = Date.now();
  const profileId = shortUUID.generate();

  const profile: UserProfile = {
    userId,
    profileId,
    name: sourceProfile.name,
    content: sourceProfile.content,
    isDefault: false,
    forkedFrom,
    createdAt: now,
    updatedAt: now,
  };

  const command = new PutCommand({
    TableName: tableName,
    Item: profile,
  });

  await client.send(command);
  return profile;
}

/**
 * Helper: Unset the current default profile for a user.
 */
async function unsetCurrentDefault(
  userId: string,
  profiles: UserProfile[],
): Promise<void> {
  const { userProfiles: tableName } = getTableNames();
  const currentDefault = profiles.find((p) => p.isDefault);

  if (currentDefault) {
    const command = new UpdateCommand({
      TableName: tableName,
      Key: { userId, profileId: currentDefault.profileId },
      UpdateExpression: "SET isDefault = :false, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":false": false,
        ":updatedAt": Date.now(),
      },
    });

    await client.send(command);
  }
}
