import { Session } from "next-auth";
import { signIn, useSession } from "next-auth/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * Custom hook for user session utilities.
 * Detects session expiry and redirects to sign-in.
 */
export function useUserSession() {
  const { data: session, status } = useSession();
  const wasAuthenticatedRef = useRef(false);

  // Track if the user was previously authenticated
  useEffect(() => {
    if (status === "authenticated") {
      wasAuthenticatedRef.current = true;
    }
  }, [status]);

  // Detect session expiry: was authenticated → now unauthenticated
  useEffect(() => {
    if (status === "unauthenticated" && wasAuthenticatedRef.current) {
      wasAuthenticatedRef.current = false;
      toast.info("Your session has expired. Redirecting to sign in...");
      signIn("azure-ad");
    }
  }, [status]);

  return {
    user: session?.user,
    sessionId: session?.sessionId,
    provider: session?.provider,
    loginTime: session?.loginTime,
    isLoading: status === "loading",
    isAuthenticated: status === "authenticated",
    isUnauthenticated: status === "unauthenticated",
  };
}

/**
 * Get user display name with fallback
 */
export function getUserDisplayName(session: Session | null): string {
  if (!session?.user) return "Unknown User";
  return session.user.name || session.user.email || "Unknown User";
}

/**
 * Get session duration in minutes
 */
export function getSessionDuration(session: Session | null): number {
  if (!session?.loginTime) return 0;
  return Math.floor((Date.now() - session.loginTime) / 60000);
}

/**
 * Check if session is about to expire (within 5 minutes)
 */
export function isSessionExpiringSoon(session: Session | null): boolean {
  const duration = getSessionDuration(session);
  const maxSessionMinutes = 8 * 60; // 8 hours in minutes
  return duration > maxSessionMinutes - 5;
}
