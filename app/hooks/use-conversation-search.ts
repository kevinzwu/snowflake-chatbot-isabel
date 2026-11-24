"use client";

import type {
  ConversationSummary,
  SearchConversationsResult,
} from "@/lib/dynamodb/types";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hook for searching conversations by title and message content.
 * Debounces the search query and fetches results from the server.
 */
export function useConversationSearch(debounceMs: number = 300) {
  const { status } = useSession();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ConversationSummary[]>([]);
  const [matchedInContent, setMatchedInContent] = useState<
    Record<string, boolean>
  >({});
  const [isSearching, setIsSearching] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const executeSearch = useCallback(
    async (searchQuery: string) => {
      // Don't fetch if not authenticated
      if (status !== "authenticated") {
        setResults([]);
        setMatchedInContent({});
        setIsSearching(false);
        return;
      }

      // Cancel any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      if (searchQuery.trim().length < 2) {
        setResults([]);
        setMatchedInContent({});
        setIsSearching(false);
        return;
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsSearching(true);

      try {
        const res = await fetch(
          `/api/conversations/search?q=${encodeURIComponent(searchQuery.trim())}`,
          {
            credentials: "include",
            signal: controller.signal,
          },
        );

        if (!res.ok) {
          console.error("Search failed:", await res.text());
          setResults([]);
          setMatchedInContent({});
          return;
        }

        const data: SearchConversationsResult = await res.json();
        setResults(data.conversations);
        setMatchedInContent(data.matchedInContent);
      } catch (error) {
        // Ignore abort errors
        if ((error as Error).name !== "AbortError") {
          console.error("Search failed:", error);
          setResults([]);
          setMatchedInContent({});
        }
      } finally {
        setIsSearching(false);
      }
    },
    [status],
  );

  // Debounce search on query change
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.trim().length < 2) {
      setResults([]);
      setMatchedInContent({});
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    debounceRef.current = setTimeout(() => {
      executeSearch(query);
    }, debounceMs);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, debounceMs, executeSearch]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const clearSearch = useCallback(() => {
    setQuery("");
    setResults([]);
    setMatchedInContent({});
    setIsSearching(false);
  }, []);

  return {
    query,
    setQuery,
    results,
    matchedInContent,
    isSearching,
    clearSearch,
    isActive: query.trim().length > 0,
  };
}
