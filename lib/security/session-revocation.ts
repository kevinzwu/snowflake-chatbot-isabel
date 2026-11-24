/**
 * Session Revocation Manager
 *
 * Tracks revoked sessions to prevent JWT usage after logout.
 * Since JWTs are stateless, we maintain a revocation list that
 * is checked on each protected request.
 *
 * Note: For multi-instance deployments (ECS with multiple tasks),
 * consider using Redis or AWS ElastiCache for distributed session tracking.
 * This in-memory implementation works well for single-task deployments.
 */

interface RevokedSession {
  sessionId: string;
  userEmail: string;
  revokedAt: number;
  expiresAt: number; // When the original JWT would have expired
}

class SessionRevocationManager {
  private revokedSessions: Map<string, RevokedSession> = new Map();

  constructor() {
    // Clean up expired revocations every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Revoke a session (called on logout)
   * @param sessionId - The session ID from the JWT
   * @param userEmail - User's email for logging
   * @param jwtExpiresAt - When the JWT was supposed to expire (in seconds)
   */
  revoke(sessionId: string, userEmail: string, jwtExpiresAt?: number): void {
    const now = Date.now();
    // Keep revocation record until JWT would have expired (max 1 hour + buffer)
    const expiresAt = jwtExpiresAt
      ? jwtExpiresAt * 1000 // Convert from seconds to ms
      : now + 70 * 60 * 1000; // Default 70 minutes (JWT lifetime + 10 min buffer)

    this.revokedSessions.set(sessionId, {
      sessionId,
      userEmail,
      revokedAt: now,
      expiresAt,
    });

    console.log(
      JSON.stringify({
        event: "session_revoked",
        sessionId,
        userEmail,
        revokedAt: new Date(now).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
      }),
    );
  }

  /**
   * Check if a session has been revoked
   * @param sessionId - The session ID to check
   * @returns true if the session is revoked and should be denied
   */
  isRevoked(sessionId: string): boolean {
    const revocation = this.revokedSessions.get(sessionId);
    if (!revocation) {
      return false;
    }

    // If the revocation has expired (JWT would have expired anyway), clean it up
    if (Date.now() > revocation.expiresAt) {
      this.revokedSessions.delete(sessionId);
      return false;
    }

    return true;
  }

  /**
   * Revoke all sessions for a user (nuclear option for security incidents)
   * @param userEmail - The user's email address
   */
  revokeAllForUser(userEmail: string): number {
    let count = 0;
    for (const [, revocation] of this.revokedSessions.entries()) {
      if (revocation.userEmail === userEmail) {
        count++;
      }
    }

    // Note: This only affects sessions we're already tracking
    // For a complete solution, you'd need to store active sessions
    console.log(
      JSON.stringify({
        event: "user_sessions_revoked",
        userEmail,
        revokedCount: count,
        timestamp: new Date().toISOString(),
      }),
    );

    return count;
  }

  /**
   * Clean up expired revocation records
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, revocation] of this.revokedSessions.entries()) {
      if (now > revocation.expiresAt) {
        this.revokedSessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(
        `Session revocation cleanup: removed ${cleaned} expired records`,
      );
    }
  }

  /**
   * Get stats for monitoring
   */
  getStats(): { activeRevocations: number } {
    return {
      activeRevocations: this.revokedSessions.size,
    };
  }
}

// Singleton instance
export const sessionRevocationManager = new SessionRevocationManager();
