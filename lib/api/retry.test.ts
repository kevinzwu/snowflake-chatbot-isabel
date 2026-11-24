import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./retry";

describe("fetchWithRetry", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("should return response on first success", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("ok", { status: 200 }));

    const res = await fetchWithRetry("/test", { method: "GET" });

    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("should not retry on client errors (400, 401, 403, 413)", async () => {
    for (const status of [400, 401, 403, 413]) {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(new Response("error", { status }));

      const res = await fetchWithRetry("/test", { method: "GET" });

      expect(res.status).toBe(status);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("should not retry on 429 (rate limit)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("rate limited", { status: 429 }));

    const res = await fetchWithRetry("/test", { method: "GET" });

    expect(res.status).toBe(429);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("should retry on 500/502/503/504", async () => {
    for (const status of [500, 502, 503, 504]) {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("error", { status }))
        .mockResolvedValueOnce(new Response("ok", { status: 200 }));

      const res = await fetchWithRetry(
        "/test",
        { method: "GET" },
        {
          initialBackoffMs: 10,
          maxRetries: 3,
        },
      );

      expect(res.status).toBe(200);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    }
  });

  it("should return last response after exhausting retries", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("server error", { status: 503 }));

    const res = await fetchWithRetry(
      "/test",
      { method: "GET" },
      {
        maxRetries: 2,
        initialBackoffMs: 10,
      },
    );

    expect(res.status).toBe(503);
    // initial + 2 retries = 3 calls
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("should not retry on 429 even with Retry-After header", async () => {
    const headers = new Headers();
    headers.set("Retry-After", "5");

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", { status: 429, headers }),
      );

    const res = await fetchWithRetry(
      "/test",
      { method: "GET" },
      {
        maxRetries: 3,
        initialBackoffMs: 10,
      },
    );

    expect(res.status).toBe(429);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("should throw on network error after exhausting retries", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    await expect(
      fetchWithRetry(
        "/test",
        { method: "GET" },
        {
          maxRetries: 2,
          initialBackoffMs: 10,
        },
      ),
    ).rejects.toThrow("Network error");

    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("should recover from network error on retry", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await fetchWithRetry(
      "/test",
      { method: "GET" },
      {
        maxRetries: 3,
        initialBackoffMs: 10,
      },
    );

    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("should use default config when none provided", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("ok", { status: 200 }));

    const res = await fetchWithRetry("/test", { method: "GET" });

    expect(res.status).toBe(200);
  });
});
