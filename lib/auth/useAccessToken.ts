"use client";

import { useSession } from "next-auth/react";
import React from "react";

export interface Token {
  token: string;
  expiresAt: number;
  userContext?: {
    isAdmin?: boolean;
    sessionId: string;
    userId: string;
    userEmail: string;
    loginTime: number;
    provider: string;
  };
}

// ── Module-level state for deduplication and backoff ──

/** In-flight fetch promise — concurrent callers share this */
let pendingFetch: Promise<Token | null> | null = null;

/** Timestamp (ms) until which we're rate-limited (from 429 Retry-After) */
let rateLimitedUntil = 0;

/** Consecutive failure count for exponential backoff */
let consecutiveFailures = 0;

/** Maximum backoff delay in milliseconds */
const MAX_BACKOFF_MS = 30_000;

/** Stale token grace period in seconds */
const STALE_TOKEN_GRACE_SECONDS = 60;

/**
 * Calculate backoff delay from consecutive failure count.
 * 1s → 2s → 4s → 8s → 16s → 30s (capped)
 */
function getBackoffMs(): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(1000 * Math.pow(2, consecutiveFailures - 1), MAX_BACKOFF_MS);
}

/**
 * Fetch a fresh JWT token from the server.
 *
 * Features:
 * - Request deduplication: concurrent calls share one in-flight request
 * - 429 detection: respects Retry-After header, suppresses fetches until window expires
 * - Exponential backoff: delays retries on consecutive failures (1s → 2s → 4s → max 30s)
 */
async function fetchJWTToken(): Promise<Token | null> {
  // If rate-limited, skip until the window expires
  if (Date.now() < rateLimitedUntil) {
    return null;
  }

  // If backoff is active, skip
  const backoffMs = getBackoffMs();
  if (backoffMs > 0) {
    // Allow fetch only after backoff delay
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }

  // Deduplicate: if a fetch is already in-flight, return its promise
  if (pendingFetch) {
    return pendingFetch;
  }

  pendingFetch = (async (): Promise<Token | null> => {
    try {
      const response = await fetch(`/api/jwt?_t=${Date.now()}`, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
        },
      });

      if (response.status === 429) {
        // Respect Retry-After header
        const retryAfter = response.headers.get("Retry-After");
        const delaySec = retryAfter ? parseInt(retryAfter, 10) : 60;
        rateLimitedUntil = Date.now() + delaySec * 1000;
        consecutiveFailures++;
        console.warn(
          `JWT rate limited. Retry after ${delaySec}s (failures: ${consecutiveFailures})`,
        );
        return null;
      }

      if (!response.ok) {
        consecutiveFailures++;
        console.error(
          `JWT fetch failed: ${response.status} (failures: ${consecutiveFailures})`,
        );
        return null;
      }

      const { token: newToken } = await response.json();
      // Reset backoff on success
      consecutiveFailures = 0;
      rateLimitedUntil = 0;
      return newToken;
    } catch (error) {
      consecutiveFailures++;
      console.error(
        `JWT fetch error (failures: ${consecutiveFailures}):`,
        error,
      );
      return null;
    } finally {
      pendingFetch = null;
    }
  })();

  return pendingFetch;
}

export function useAccessToken() {
  const { data: session, status } = useSession();
  const [token, setToken] = React.useState<Token | null>(null);
  const mountedRef = React.useRef(false);

  // Fetch token on initial mount and when session changes
  React.useEffect(() => {
    const initToken = async () => {
      if (!session) return;

      const newToken = await fetchJWTToken();
      // Stale token grace: only update if we got a valid token,
      // otherwise keep the existing one
      if (newToken) {
        setToken(newToken);
      }
    };

    if (status === "authenticated" && session) {
      initToken();
      mountedRef.current = true;
    } else if (status === "unauthenticated") {
      setToken(null);
      mountedRef.current = false;
    }
  }, [session, status]);

  // Proactive token refresh — refresh before expiration, not after.
  // Stale token grace: keep expired token for up to 60s while retrying.
  React.useEffect(() => {
    if (!token?.expiresAt || !session) return;

    const intervalId = setInterval(async () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const refreshThreshold = token.expiresAt - 300;

      if (currentTime >= refreshThreshold) {
        console.log("Proactively refreshing JWT token before expiration");
        const newToken = await fetchJWTToken();
        if (newToken) {
          setToken(newToken);
        }
        // If fetch fails, keep the current token (stale grace period).
        // Only clear after STALE_TOKEN_GRACE_SECONDS past expiry.
        else if (currentTime > token.expiresAt + STALE_TOKEN_GRACE_SECONDS) {
          console.warn("JWT token expired beyond grace period, clearing");
          setToken(null);
        }
      }
    }, 60000);

    return () => clearInterval(intervalId);
  }, [token?.expiresAt, session]);

  return {
    token: token?.token ?? "",
    userContext: token?.userContext,
    isLoading: status === "loading",
    isAuthenticated: status === "authenticated" && !!token?.token,
  };
}
