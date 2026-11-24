import type { AgentMessage } from "@/lib/agent-api/types";

/**
 * Reference to messages stored in S3 when conversation exceeds
 * DynamoDB's 400KB item size limit.
 */
export interface MessageRef {
  /** S3 bucket name */
  bucket: string;
  /** S3 object key (e.g., conversations/{userId}/{conversationId}/messages.json.gz) */
  key: string;
  /** Size of the compressed S3 object in bytes */
  sizeBytes: number;
}

/**
 * Provenance metadata for conversations forked from a shared conversation.
 */
export interface ForkedFrom {
  /** Share token used to access the original conversation */
  shareToken: string;
  /** Original conversation's ID */
  conversationId: string;
  /** Original conversation owner's userId */
  ownerUserId: string;
}

/**
 * An entry in a conversation's profile injection history.
 */
export interface ProfileHistoryEntry {
  /** Profile ID that was injected (null if cleared) */
  profileId: string | null;
  /** Profile name at time of injection */
  profileName: string | null;
  /** Index in the messages array where this profile was applied */
  appliedAtMessageIndex: number;
}

/**
 * A user profile (prompt harness) stored in DynamoDB.
 */
export interface UserProfile {
  /** Azure AD user object ID (partition key) */
  userId: string;
  /** Unique profile identifier (sort key) */
  profileId: string;
  /** User-provided display name for the profile */
  name: string;
  /** The prompt content to inject (max 10000 chars) */
  content: string;
  /** Whether this is the user's default profile for new conversations */
  isDefault: boolean;
  /** Share token for link-based sharing (sparse GSI key) */
  shareToken?: string;
  /** Provenance if this profile was forked from a shared profile */
  forkedFrom?: ProfileForkedFrom;
  /** Unix timestamp in milliseconds when profile was created */
  createdAt: number;
  /** Unix timestamp in milliseconds when profile was last updated */
  updatedAt: number;
}

/**
 * Provenance metadata for profiles forked from a shared profile.
 */
export interface ProfileForkedFrom {
  /** Original profile owner's userId */
  userId: string;
  /** Original profile's profileId */
  profileId: string;
}

/**
 * Input for creating a new user profile.
 */
export interface CreateProfileInput {
  name: string;
  content: string;
  isDefault?: boolean;
}

/**
 * Input for updating an existing profile.
 */
export interface UpdateProfileInput {
  name?: string;
  content?: string;
  isDefault?: boolean;
}

/**
 * Constants for profile limits.
 */
export const PROFILE_LIMITS = {
  /** Maximum profiles per user */
  MAX_PROFILES: 20,
  /** Maximum profile content length in characters */
  MAX_CONTENT_LENGTH: 10000,
  /** Maximum profile name length in characters */
  MAX_NAME_LENGTH: 100,
} as const;

/**
 * A stored conversation in DynamoDB.
 */
export interface Conversation {
  /** Azure AD user object ID (partition key) */
  userId: string;
  /** Unique conversation identifier (sort key) */
  conversationId: string;
  /** Display title - typically first user message truncated */
  title: string;
  /** Full message history */
  messages: AgentMessage[];
  /** Number of messages in the conversation (denormalized for list performance) */
  messageCount: number;
  /** Unix timestamp in milliseconds when conversation was created */
  createdAt: number;
  /** Unix timestamp in milliseconds when conversation was last updated */
  updatedAt: number;
  /** Whether this conversation is archived (180-day extended retention) */
  archived: boolean;
  /** Whether this conversation is pinned to the top of the sidebar */
  pinned: boolean;
  /** Whether this conversation uses deep thinking (Opus agent) */
  deepThinking?: boolean;
  /** Which model is selected for this conversation */
  model?: "sonnet" | "haiku" | "opus";
  /**
   * Reference to messages stored in S3 when payload exceeds 350KB.
   * When present, `messages` is empty and must be fetched from S3.
   */
  messageRef?: MessageRef;
  /**
   * Concatenated text from all messages for search indexing.
   * Only populated when messages overflow to S3. Truncated to 100KB.
   * Internal field — excluded from API responses.
   */
  searchText?: string;
  /**
   * Unix timestamp in SECONDS for DynamoDB TTL.
   * Non-archived: 90-day TTL. Archived: 180-day TTL.
   * Note: DynamoDB TTL requires epoch seconds, not milliseconds.
   */
  expiresAt?: number;
  /**
   * Share token (UUIDv4) for cross-user access via GSI.
   * Present only when conversation is actively shared.
   */
  shareToken?: string;
  /** Whether this conversation is currently shared */
  isShared?: boolean;
  /** Unix timestamp in milliseconds when sharing was enabled */
  sharedAt?: number;
  /**
   * Provenance metadata linking this conversation to a shared original.
   * Present only on conversations created via fork-on-interact.
   */
  forkedFrom?: ForkedFrom;
  /**
   * History of profile injections during this conversation.
   * Each entry records which profile was applied and at what message index.
   */
  profileHistory?: ProfileHistoryEntry[];
}

/**
 * Metadata for conversation list (excludes full messages for performance).
 */
export interface ConversationSummary {
  conversationId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  /** Whether this conversation is pinned to the top of the sidebar */
  pinned: boolean;
  /** Number of messages in conversation */
  messageCount: number;
}

/**
 * A saved/bookmarked query.
 */
export interface SavedQuery {
  /** Azure AD user object ID (partition key) */
  userId: string;
  /** Unique query identifier (sort key) */
  queryId: string;
  /** User-provided name for the query */
  name: string;
  /** The query text to be sent to the AI */
  queryText: string;
  /** Optional description of what the query does */
  description?: string;
  /** Unix timestamp when query was saved */
  createdAt: number;
}

/**
 * Input for creating a new conversation.
 */
export interface CreateConversationInput {
  title: string;
  messages: AgentMessage[];
  deepThinking?: boolean;
  model?: "sonnet" | "haiku" | "opus";
  forkedFrom?: ForkedFrom;
}

/**
 * Input for updating an existing conversation.
 */
export interface UpdateConversationInput {
  messages: AgentMessage[];
  /** Optional new title */
  title?: string;
  deepThinking?: boolean;
  model?: "sonnet" | "haiku" | "opus";
}

/**
 * Input for renaming a conversation (title-only update).
 */
export interface RenameConversationInput {
  title: string;
}

/**
 * Input for creating a new saved query.
 */
export interface CreateSavedQueryInput {
  name: string;
  queryText: string;
  description?: string;
}

/**
 * Result from listing conversations.
 */
export interface ListConversationsResult {
  conversations: ConversationSummary[];
  /** Whether there are more conversations to fetch */
  hasMore: boolean;
}

/**
 * Result from searching conversations.
 */
export interface SearchConversationsResult {
  conversations: ConversationSummary[];
  /** Whether result was matched in message content (not just title) */
  matchedInContent: Record<string, boolean>;
}

/**
 * Constants for conversation retention.
 */
export const CONVERSATION_RETENTION = {
  /** Default TTL in milliseconds (90 days) for non-archived conversations */
  DEFAULT_TTL_MS: 90 * 24 * 60 * 60 * 1000,
  /** Archived TTL in milliseconds (180 days) — archived conversations are NOT permanent */
  ARCHIVED_TTL_MS: 180 * 24 * 60 * 60 * 1000,
  /** Maximum conversations per user */
  MAX_CONVERSATIONS: 200,
  /** Maximum title length */
  MAX_TITLE_LENGTH: 100,
  /** Maximum messages per conversation */
  MAX_MESSAGES: 200,
  /** Maximum content blocks per message (raised from 20 to accommodate multi-tool responses) */
  MAX_CONTENT_BLOCKS: 50,
  /** Maximum request body size in bytes (2MB — S3 overflow handles DynamoDB's 400KB item limit) */
  MAX_BODY_SIZE_BYTES: 2 * 1024 * 1024,
  /** Threshold in bytes for overflowing messages to S3 (350KB — leaves room for metadata in DynamoDB's 400KB limit) */
  S3_OVERFLOW_THRESHOLD_BYTES: 350 * 1024,
  /** Maximum searchText index size in bytes (100KB — stored in DynamoDB for S3-backed conversations) */
  MAX_SEARCH_TEXT_BYTES: 100 * 1024,
  /** Maximum search query length */
  MAX_SEARCH_QUERY_LENGTH: 200,
  /** Minimum search query length */
  MIN_SEARCH_QUERY_LENGTH: 2,
  /** Maximum pinned conversations per user */
  MAX_PINNED_CONVERSATIONS: 10,
} as const;

/**
 * Constants for saved query limits.
 */
export const SAVED_QUERY_LIMITS = {
  /** Maximum name length */
  MAX_NAME_LENGTH: 100,
  /** Maximum query text length */
  MAX_QUERY_TEXT_LENGTH: 5000,
  /** Maximum description length */
  MAX_DESCRIPTION_LENGTH: 500,
} as const;

/**
 * PII Notice:
 *
 * Stored conversation messages WILL contain PII from Snowflake query results:
 * - Employee emails: SECURITY_LEAD, ACCOUNTABLE_LEADER, PRIVACY_LEAD, SINGLE_POC,
 *   ARCHITECT_EMAIL, POINT_OF_CONTACT_EMAIL, ASSIGNED_TO_EMAIL
 * - Employee names: ARCHITECT, POINT_OF_CONTACT, ASSIGNED_TO, DV_REPORTER
 * - External researcher names: RESEARCHER_NAME
 * - Infrastructure identifiers: IP_ADDRESS, FQDN, DNS_NAME, CLOUD_ACCOUNT_ID
 *
 * Mitigations:
 * 1. DynamoDB encryption-at-rest (AWS-managed keys, enabled by default)
 * 2. 30-day TTL on active conversations / 90-day TTL on archived conversations
 * 3. User data isolation via userId partition key (from server-verified OAuth token)
 * 4. All API routes enforce session ownership — never trust client-supplied user identity
 * 5. DynamoDB ConditionExpression enforcement on every write/delete operation
 */
