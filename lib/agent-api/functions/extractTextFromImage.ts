/**
 * Client-side image text extraction via Snowflake Chat Completions vision API.
 *
 * Calls Snowflake directly from the browser using the same auth (KEYPAIR_JWT)
 * and network path as the Cortex Agent API, so image data goes only to Snowflake.
 */

const VISION_MODEL = "claude-sonnet-5-5";
const VISION_TIMEOUT_MS = 30_000;

const EXTRACTION_PROMPT = `Extract ALL text content from this screenshot precisely.
This is security validation evidence — likely a terminal session, Burp Suite HTTP capture, or browser screenshot.

Rules:
- Preserve exact command output, HTTP headers/bodies, URLs, and error messages
- Format terminal output as fenced code blocks
- Format HTTP requests/responses with method, URL, headers, and body separated
- If you see a table, reproduce it as a markdown table
- Preserve IP addresses, ports, CVE identifiers, and ticket numbers exactly
- Do NOT summarize or interpret — extract the raw content faithfully
- If the image contains no readable text, describe what the image shows concisely`;

export interface VisionExtractionResult {
  text: string;
  characters: number;
}

/**
 * Extract text from an image using Snowflake Chat Completions vision API.
 * Runs client-side (browser) using the existing JWT and PrivateLink URL.
 */
export async function extractTextFromImage(
  file: File,
  authToken: string,
  snowflakeUrl: string,
): Promise<VisionExtractionResult> {
  // Read file as base64
  const arrayBuffer = await file.arrayBuffer();
  const base64Data = btoa(
    new Uint8Array(arrayBuffer).reduce(
      (data, byte) => data + String.fromCharCode(byte),
      "",
    ),
  );

  // Determine MIME type from file.type (browser provides this)
  const mimeType = file.type || "image/png";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${snowflakeUrl}/api/v2/cortex/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
          "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
        },
        body: JSON.stringify({
          model: VISION_MODEL,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType};base64,${base64Data}`,
                  },
                },
                {
                  type: "text",
                  text: EXTRACTION_PROMPT,
                },
              ],
            },
          ],
          max_completion_tokens: 4096,
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Unknown error");
      throw new Error(
        `Vision extraction failed (${response.status}): ${errorBody}`,
      );
    }

    const result = await response.json();
    const text = result.choices?.[0]?.message?.content?.trim() ?? "";

    return { text, characters: text.length };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Image text extraction timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
