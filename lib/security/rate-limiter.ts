/**
 * In-memory rate limiter for API endpoints
 * Uses a sliding window algorithm to track requests per user
 *
 * Note: For multi-instance deployments (ECS with multiple tasks),
 * consider using Redis or AWS ElastiCache for distributed rate limiting.
 * This in-memory implementation works well for single-task deployments.
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface RateLimiterConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
}

class RateLimiter {
  private requests: Map<string, RateLimitEntry> = new Map();
  private config: RateLimiterConfig;

  constructor(config: RateLimiterConfig) {
    this.config = config;

    // Clean up expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Check if a request is allowed for the given key (usually user email or IP)
   * Returns { allowed: boolean, remaining: number, resetIn: number }
   */
  check(key: string): {
    allowed: boolean;
    remaining: number;
    resetIn: number;
    retryAfter?: number;
  } {
    const now = Date.now();
    const entry = this.requests.get(key);

    // If no entry or window has expired, start fresh
    if (!entry || now - entry.windowStart >= this.config.windowMs) {
      this.requests.set(key, { count: 1, windowStart: now });
      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetIn: this.config.windowMs,
      };
    }

    // Window still active, check count
    if (entry.count >= this.config.maxRequests) {
      const resetIn = this.config.windowMs - (now - entry.windowStart);
      return {
        allowed: false,
        remaining: 0,
        resetIn,
        retryAfter: Math.ceil(resetIn / 1000),
      };
    }

    // Increment and allow
    entry.count++;
    const resetIn = this.config.windowMs - (now - entry.windowStart);
    return {
      allowed: true,
      remaining: this.config.maxRequests - entry.count,
      resetIn,
    };
  }

  /**
   * Clean up expired entries to prevent memory leaks
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.requests.entries()) {
      if (now - entry.windowStart >= this.config.windowMs) {
        this.requests.delete(key);
      }
    }
  }

  /**
   * Reset rate limit for a specific key (useful for testing)
   */
  reset(key: string): void {
    this.requests.delete(key);
  }

  /**
   * Get current stats (useful for monitoring)
   */
  getStats(): { activeKeys: number; config: RateLimiterConfig } {
    return {
      activeKeys: this.requests.size,
      config: this.config,
    };
  }
}

// JWT endpoint rate limiter: 30 requests per minute per user
// (raised from 10 to accommodate multi-tab usage and mount-triggered fetches)
export const jwtRateLimiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30,
});

// General API rate limiter: 100 requests per minute per user
export const apiRateLimiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100,
});

// Auth attempt rate limiter: 5 attempts per 5 minutes per IP (for failed auths)
export const authAttemptLimiter = new RateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  maxRequests: 5,
});

// Write operation rate limiter: 20 writes per minute per user
// Applied to POST, PUT, DELETE on conversation and saved-query routes
export const writeRateLimiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 20,
});

// File extraction rate limiter: 5 extractions per minute per user
// File processing is resource-intensive (CPU + memory)
export const fileExtractionRateLimiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 5,
});

export { RateLimiter };
export type { RateLimiterConfig };
