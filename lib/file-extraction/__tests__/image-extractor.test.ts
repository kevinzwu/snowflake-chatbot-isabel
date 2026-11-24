import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock jwt-generator
vi.mock("@/lib/snowflake/jwt-generator", () => ({
  generateUserJWT: vi.fn(() => ({
    token: "mock-jwt-token",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  })),
}));

// Mock file-validator sanitize
vi.mock("@/lib/security/file-validator", () => ({
  sanitizeExtractedText: vi.fn((text: string) => text),
}));

import { extractImageText } from "../image-extractor";

// PNG magic bytes
const PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);

// JPEG magic bytes
const JPEG_BUFFER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

// WebP magic bytes (RIFF....WEBP)
const WEBP_BUFFER = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

describe("image-extractor", () => {
  const originalCortexUrl = process.env.SNOWFLAKE_CORTEX_API_URL;
  const originalSnowflakeUrl = process.env.SNOWFLAKE_URL;

  beforeEach(() => {
    process.env.SNOWFLAKE_CORTEX_API_URL =
      "https://test.snowflakecomputing.com";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalCortexUrl !== undefined) {
      process.env.SNOWFLAKE_CORTEX_API_URL = originalCortexUrl;
    } else {
      delete process.env.SNOWFLAKE_CORTEX_API_URL;
    }
    if (originalSnowflakeUrl !== undefined) {
      process.env.SNOWFLAKE_URL = originalSnowflakeUrl;
    } else {
      delete process.env.SNOWFLAKE_URL;
    }
  });

  it("should extract text from a PNG image", async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: "```bash\n$ ls -la\ntotal 42\n```",
          },
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await extractImageText(PNG_BUFFER, "terminal.png");

    expect(result.metadata.format).toBe("image");
    expect(result.metadata.type).toBe("image");
    expect(result.metadata.filename).toBe("terminal.png");
    expect(result.text).toContain("ls -la");

    // Verify the fetch call used correct auth headers
    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    const [url, options] = fetchCall;
    expect(url).toContain("/api/v2/cortex/v1/chat/completions");
    const headers = options?.headers as Record<string, string>;
    expect(headers["X-Snowflake-Authorization-Token-Type"]).toBe("KEYPAIR_JWT");
    expect(headers["Authorization"]).toBe("Bearer mock-jwt-token");

    // Verify the body contains image_url content
    const body = JSON.parse(options?.body as string);
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.messages[0].content[0].type).toBe("image_url");
    expect(body.messages[0].content[0].image_url.url).toContain(
      "data:image/png;base64,",
    );
  });

  it("should detect JPEG MIME type", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ choices: [{ message: { content: "test" } }] }),
    });

    await extractImageText(JPEG_BUFFER, "photo.jpg");

    const body = JSON.parse(
      (vi.mocked(global.fetch).mock.calls[0][1]?.body as string) ?? "{}",
    );
    expect(body.messages[0].content[0].image_url.url).toContain(
      "data:image/jpeg;base64,",
    );
  });

  it("should detect WebP MIME type", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ choices: [{ message: { content: "test" } }] }),
    });

    await extractImageText(WEBP_BUFFER, "capture.webp");

    const body = JSON.parse(
      (vi.mocked(global.fetch).mock.calls[0][1]?.body as string) ?? "{}",
    );
    expect(body.messages[0].content[0].image_url.url).toContain(
      "data:image/webp;base64,",
    );
  });

  it("should throw on Chat Completions API error", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    await expect(extractImageText(PNG_BUFFER, "error.png")).rejects.toThrow(
      "Chat Completions API error (500)",
    );
  });

  it("should throw on timeout", async () => {
    vi.useFakeTimers();

    // Simulate a fetch that never resolves but respects abort signal
    global.fetch = vi.fn().mockImplementation(
      (_url: string, options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (options?.signal) {
            if (options.signal.aborted) {
              reject(new DOMException("Aborted", "AbortError"));
              return;
            }
            options.signal.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }
        }),
    );

    const promise = extractImageText(PNG_BUFFER, "slow.png");

    // Advance timers to trigger the abort
    vi.advanceTimersByTime(30_000);

    await expect(promise).rejects.toThrow("timed out");

    vi.useRealTimers();
  });

  it("should throw when no Snowflake URL is set", async () => {
    delete process.env.SNOWFLAKE_CORTEX_API_URL;
    delete process.env.SNOWFLAKE_URL;

    await expect(extractImageText(PNG_BUFFER, "test.png")).rejects.toThrow(
      "SNOWFLAKE_CORTEX_API_URL",
    );
  });

  it("should return empty text when vision model returns empty", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: "" } }] }),
    });

    const result = await extractImageText(PNG_BUFFER, "blank.png");
    expect(result.text).toBe("");
    expect(result.metadata.characters).toBe(0);
  });
});
