"use client";

import type { SavedQuery } from "@/lib/dynamodb/types";
import useSWR, { mutate as globalMutate } from "swr";

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const error = new Error("Failed to fetch");
    throw error;
  }
  return res.json();
};

interface SavedQueriesResponse {
  queries: SavedQuery[];
}

const SAVED_QUERIES_KEY = "/api/saved-queries";

/**
 * Standalone save function that does not subscribe to SWR cache.
 * Use this in components that only need to write, not read, saved queries.
 * After saving, invalidates the SWR cache so subscribed components refresh.
 */
export async function saveQueryStandalone(
  name: string,
  queryText: string,
  description?: string,
): Promise<SavedQuery> {
  const res = await fetch(SAVED_QUERIES_KEY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name, queryText, description }),
  });

  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.message || "Failed to save query");
  }

  const query = await res.json();
  // Invalidate the SWR cache so subscribed components (e.g., sidebar) refresh
  globalMutate(SAVED_QUERIES_KEY);
  return query;
}

/**
 * Hook for managing saved queries with SWR.
 */
export function useSavedQueries() {
  const { data, error, isLoading, mutate } = useSWR<SavedQueriesResponse>(
    SAVED_QUERIES_KEY,
    fetcher,
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    },
  );

  const queries = data?.queries ?? [];

  /**
   * Save a new query.
   */
  const saveQuery = async (
    name: string,
    queryText: string,
    description?: string,
  ): Promise<SavedQuery | null> => {
    try {
      const res = await fetch("/api/saved-queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, queryText, description }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to save query");
      }

      const query = await res.json();
      // Revalidate the list
      mutate();
      return query;
    } catch (error) {
      console.error("Failed to save query:", error);
      throw error;
    }
  };

  /**
   * Delete a saved query.
   */
  const deleteQuery = async (queryId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/saved-queries/${queryId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok && res.status !== 204) {
        console.error("Failed to delete query:", await res.text());
        return false;
      }

      // Optimistically update the list
      mutate(
        (current) => {
          if (!current) return current;
          return {
            queries: current.queries.filter((q) => q.queryId !== queryId),
          };
        },
        { revalidate: true },
      );

      return true;
    } catch (error) {
      console.error("Failed to delete query:", error);
      return false;
    }
  };

  return {
    queries,
    isLoading,
    error,
    saveQuery,
    deleteQuery,
    refresh: () => mutate(),
  };
}

export type { SavedQuery };
