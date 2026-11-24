/**
 * Fetch with automatic retry for transient failures.
 *
 * Retries on: 500, 502, 503, 504 (server errors)
 * Does NOT retry on: 400, 401, 403, 413 (client errors), 429 (rate limit)
 * 429 is not retried because retrying self-imposed rate limits consumes
 * additional budget and worsens the problem.
 */

interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial backoff delay in ms (default: 1000). Doubles on each retry. */
  initialBackoffMs?: number;
  /** Maximum backoff delay in ms (default: 10000) */
  maxBackoffMs?: number;
}

const RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504]);

const DEFAULT_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  initialBackoffMs: 1000,
  maxBackoffMs: 10_000,
};

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  config: RetryConfig = {},
): Promise<Response> {
  const { maxRetries, initialBackoffMs, maxBackoffMs } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Success or non-retryable error — return immediately
      if (response.ok || !RETRYABLE_STATUS_CODES.has(response.status)) {
        return response;
      }

      lastResponse = response;

      // Don't retry if we've exhausted attempts
      if (attempt === maxRetries) {
        return response;
      }

      // Calculate delay
      const delayMs = Math.min(
        initialBackoffMs * Math.pow(2, attempt),
        maxBackoffMs,
      );

      console.warn(
        `Retry ${attempt + 1}/${maxRetries} for ${url} (status: ${response.status}, delay: ${delayMs}ms)`,
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      // Network error — retry if we have attempts left
      if (attempt === maxRetries) {
        throw error;
      }

      const delayMs = Math.min(
        initialBackoffMs * Math.pow(2, attempt),
        maxBackoffMs,
      );

      console.warn(
        `Retry ${attempt + 1}/${maxRetries} for ${url} (network error, delay: ${delayMs}ms)`,
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // Should not reach here, but TypeScript needs it
  return lastResponse!;
}
