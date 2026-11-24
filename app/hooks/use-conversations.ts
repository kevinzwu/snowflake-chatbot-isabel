"use client";

import type { AgentMessage } from "@/lib/agent-api/types";
import { fetchWithRetry } from "@/lib/api/retry";
import type {
  Conversation,
  ConversationSummary,
  ListConversationsResult,
} from "@/lib/dynamodb/types";
import { useSession } from "next-auth/react";
import * as React from "react";
import { toast } from "sonner";
import useSWR from "swr";

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const error = new Error("Failed to fetch") as Error & { status: number };
    (error as Error & { status: number }).status = res.status;
    throw error;
  }
  return res.json();
};

const DEFAULT_SAVE_ERROR_MESSAGE =
  "Failed to save conversation. Your latest messages may not be preserved.";

/**
 * Extracts the server's `message` field from an error response body, when
 * present, so specific failures (e.g. storage misconfiguration, 503) surface
 * an actionable toast instead of the generic fallback.
 */
function extractErrorMessage(rawBody: string): string | null {
  try {
    const parsed = JSON.parse(rawBody) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : null;
  } catch {
    return null;
  }
}

/** Client-side payload size limit before truncation kicks in (1.5MB) */
const CLIENT_PAYLOAD_LIMIT = 1.5 * 1024 * 1024;

/** Number of recent messages to preserve full content during truncation */
const PRESERVE_RECENT_MESSAGES = 10;

/**
 * Truncate messages to fit within payload limit.
 * Strips tool_results, chart, table, and fetchedTable content from older messages,
 * keeping only text content which cannot be regenerated.
 */
function truncateMessages(messages: AgentMessage[]): AgentMessage[] {
  const estimatedSize = new Blob([JSON.stringify(messages)]).size;
  if (estimatedSize <= CLIENT_PAYLOAD_LIMIT) return messages;

  const preserveFrom = Math.max(0, messages.length - PRESERVE_RECENT_MESSAGES);

  const truncated = messages.map((msg, idx) => {
    // Keep recent messages intact
    if (idx >= preserveFrom) return msg;

    // Strip heavy content blocks from older messages
    const lightContent = msg.content.filter((block) => {
      if ("tool_results" in block) return false;
      if ("chart" in block) return false;
      if ("table" in block) return false;
      if ("tableMarkdown" in block) return false;
      if ("tool_use" in block) return false;
      return true;
    });

    return { ...msg, content: lightContent };
  });

  // If still too large, keep only the most recent 50 messages
  const recheck = new Blob([JSON.stringify(truncated)]).size;
  if (recheck > CLIENT_PAYLOAD_LIMIT) {
    toast.warning(
      "Conversation is too large to save completely. Some older data may be lost.",
    );
    return truncated.slice(-50);
  }

  return truncated;
}

/**
 * Hook for managing conversations list with SWR.
 */
export function useConversations() {
  const { status } = useSession();
  const isAuthenticated = status === "authenticated";

  const { data, error, isLoading, mutate } = useSWR<ListConversationsResult>(
    isAuthenticated ? "/api/conversations" : null,
    fetcher,
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
        if ((error as Error & { status?: number }).status === 401) return;
        if ((error as Error & { status?: number }).status === 403) return;
        if (retryCount >= 3) return;
        setTimeout(() => revalidate({ retryCount }), 5000);
      },
    },
  );

  const conversations = React.useMemo(
    () => data?.conversations ?? [],
    [data?.conversations],
  );

  // Partition conversations into pinned and recent
  const pinnedConversations = React.useMemo(
    () => conversations.filter((c) => c.pinned),
    [conversations],
  );
  const recentConversations = React.useMemo(
    () => conversations.filter((c) => !c.pinned),
    [conversations],
  );
  const pinnedCount = pinnedConversations.length;

  /**
   * Create a new conversation.
   * Uses retry with backoff for transient failures and truncation for oversized payloads.
   */
  const createConversation = React.useCallback(
    async (
      title: string,
      messages: AgentMessage[],
      deepThinking?: boolean,
      model?: "sonnet" | "haiku" | "opus",
    ): Promise<Conversation | null> => {
      try {
        const safeMessages = truncateMessages(messages);
        const res = await fetchWithRetry("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            title,
            messages: safeMessages,
            deepThinking,
            model,
          }),
        });

        if (!res.ok) {
          const errorBody = await res.text();
          console.error("Failed to create conversation:", errorBody);
          toast.error(
            extractErrorMessage(errorBody) || DEFAULT_SAVE_ERROR_MESSAGE,
          );
          return null;
        }

        const conversation = await res.json();
        // Revalidate the list
        mutate();
        return conversation;
      } catch (error) {
        console.error("Failed to create conversation:", error);
        return null;
      }
    },
    [mutate],
  );

  /**
   * Update an existing conversation.
   * Uses retry with backoff for transient failures and truncation for oversized payloads.
   */
  const updateConversation = React.useCallback(
    async (
      conversationId: string,
      messages: AgentMessage[],
      title?: string,
      deepThinking?: boolean,
      model?: "sonnet" | "haiku" | "opus",
    ): Promise<Conversation | null> => {
      try {
        const safeMessages = truncateMessages(messages);
        const res = await fetchWithRetry(
          `/api/conversations/${conversationId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              messages: safeMessages,
              title,
              deepThinking,
              model,
            }),
          },
        );

        if (!res.ok) {
          const errorBody = await res.text();
          console.error("Failed to update conversation:", errorBody);
          toast.error(
            extractErrorMessage(errorBody) || DEFAULT_SAVE_ERROR_MESSAGE,
          );
          return null;
        }

        const conversation = await res.json();
        // Optimistically update the cached list: refresh updatedAt and title
        // so the sidebar order and labels stay in sync without a full re-fetch
        mutate(
          (current) => {
            if (!current) return current;
            const updated = current.conversations.map((c) =>
              c.conversationId === conversationId
                ? {
                    ...c,
                    updatedAt: Date.now(),
                    messageCount: messages.length,
                    ...(title ? { title } : {}),
                  }
                : c,
            );
            // Re-sort by updatedAt descending (newest first)
            updated.sort((a, b) => b.updatedAt - a.updatedAt);
            return { ...current, conversations: updated };
          },
          { revalidate: false },
        );
        return conversation;
      } catch (error) {
        console.error("Failed to update conversation:", error);
        return null;
      }
    },
    [mutate],
  );

  /**
   * Delete a conversation.
   */
  const deleteConversation = React.useCallback(
    async (conversationId: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}`, {
          method: "DELETE",
          credentials: "include",
        });

        if (!res.ok && res.status !== 204) {
          console.error("Failed to delete conversation:", await res.text());
          return false;
        }

        // Optimistically update the list
        mutate(
          (current) => {
            if (!current) return current;
            return {
              ...current,
              conversations: current.conversations.filter(
                (c) => c.conversationId !== conversationId,
              ),
            };
          },
          { revalidate: true },
        );

        return true;
      } catch (error) {
        console.error("Failed to delete conversation:", error);
        return false;
      }
    },
    [mutate],
  );

  /**
   * Archive or unarchive a conversation.
   */
  const archiveConversation = React.useCallback(
    async (conversationId: string, archived: boolean): Promise<boolean> => {
      try {
        const res = await fetch(
          `/api/conversations/${conversationId}/archive`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ archived }),
          },
        );

        if (!res.ok) {
          console.error("Failed to archive conversation:", await res.text());
          return false;
        }

        // Revalidate the list
        mutate();
        return true;
      } catch (error) {
        console.error("Failed to archive conversation:", error);
        return false;
      }
    },
    [mutate],
  );

  /**
   * Pin or unpin a conversation.
   * Pinning also archives the conversation (extends TTL).
   * Returns false if the API rejects (e.g., pin limit exceeded).
   */
  const pinConversation = React.useCallback(
    async (conversationId: string, pinned: boolean): Promise<boolean> => {
      try {
        // Optimistically update the pinned state
        mutate(
          (current) => {
            if (!current) return current;
            return {
              ...current,
              conversations: current.conversations.map((c) =>
                c.conversationId === conversationId
                  ? { ...c, pinned, ...(pinned ? { archived: true } : {}) }
                  : c,
              ),
            };
          },
          { revalidate: false },
        );

        const res = await fetch(`/api/conversations/${conversationId}/pin`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ pinned }),
        });

        if (!res.ok) {
          const errorBody = await res.json().catch(() => null);
          if (res.status === 409) {
            toast.error(
              errorBody?.message ||
                "Maximum of 10 pinned conversations allowed. Unpin a conversation first.",
            );
          } else {
            console.error("Failed to pin conversation:", errorBody);
          }
          // Rollback optimistic update
          mutate();
          return false;
        }

        // Revalidate to get fresh data
        mutate();
        return true;
      } catch (error) {
        console.error("Failed to pin conversation:", error);
        mutate();
        return false;
      }
    },
    [mutate],
  );

  /**
   * Rename a conversation (title-only update via PATCH).
   */
  const renameConversation = React.useCallback(
    async (conversationId: string, title: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ title }),
        });

        if (!res.ok) {
          console.error("Failed to rename conversation:", await res.text());
          return false;
        }

        // Optimistically update the title in the cached list
        // Use revalidate: false to prevent SWR from re-fetching stale data
        // that could overwrite the optimistic update
        mutate(
          (current) => {
            if (!current) return current;
            return {
              ...current,
              conversations: current.conversations.map((c) =>
                c.conversationId === conversationId ? { ...c, title } : c,
              ),
            };
          },
          { revalidate: false },
        );

        return true;
      } catch (error) {
        console.error("Failed to rename conversation:", error);
        return false;
      }
    },
    [mutate],
  );

  return {
    conversations,
    pinnedConversations,
    recentConversations,
    pinnedCount,
    isLoading,
    error,
    createConversation,
    updateConversation,
    deleteConversation,
    archiveConversation,
    pinConversation,
    renameConversation,
    refresh: () => mutate(),
  };
}

/**
 * Hook for fetching a single conversation.
 */
export function useConversation(conversationId: string | null) {
  const { status } = useSession();
  const isAuthenticated = status === "authenticated";

  const { data, error, isLoading, mutate } = useSWR<Conversation>(
    isAuthenticated && conversationId
      ? `/api/conversations/${conversationId}`
      : null,
    fetcher,
    {
      onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
        if ((error as Error & { status?: number }).status === 401) return;
        if ((error as Error & { status?: number }).status === 403) return;
        if (retryCount >= 3) return;
        setTimeout(() => revalidate({ retryCount }), 5000);
      },
    },
  );

  return {
    conversation: data ?? null,
    isLoading,
    error,
    refresh: () => mutate(),
  };
}

export type { Conversation, ConversationSummary };
