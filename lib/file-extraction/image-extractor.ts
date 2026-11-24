/**
 * Server-side image text extractor (DEPRECATED — kept as fallback reference).
 *
 * Primary image extraction now happens CLIENT-SIDE via:
 *   lib/agent-api/functions/extractTextFromImage.ts
 *
 * Calling Snowflake directly from the browser keeps image data on the same
 * network path as the Cortex Agent API.
 *
 * This file is retained for potential server-side use cases (e.g., Service
 * Account API) but is not imported by the extraction router.
 */

import { sanitizeExtractedText } from "../security/file-validator";
import { generateUserJWT } from "../snowflake/jwt-generator";

const VISION_TIMEOUT_MS = 30_000;
const VISION_MODEL = "claude-sonnet-5-5";

const EXTRACTION_PROMPT = `Extract ALL text content from this screenshot precisely.
This is security validation evidence — likely a terminal session, Burp Suite HTTP capture, or browser screenshot.

Rules:
- Preserve exact command output, HTTP headers/bodies, URLs, and error messages
- Format terminal output as fenced code blocks
- Format HTTP requests/responses with method, URL, headers, and body separated
- If you see a table, reproduce it as a markdown table
- Preserve IP addresses, ports, CVE identifiers, and ticket numbers exactly
- Do NOT summarize or interpret — extract the raw content faithfully
- If the image contains no readable text, respond with an empty string`;

export interface ImageExtractionResult {
  text: string;
  metadata: {
    filename: string;
    characters: number;
    format: "image";
    type: "image";
  };
}

/**
 * Detect MIME type from image buffer magic bytes.
 */
function detectMimeType(
  buffer: Buffer,
): "image/png" | "image/jpeg" | "image/webp" {
  // PNG: 89 50 4E 47
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  // WebP: RIFF....WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  // Fallback — should not reach here if file-validator passed
  return "image/png";
}

export async function extractImageText(
  buffer: Buffer,
  filename: string,
): Promise<ImageExtractionResult> {
  // Prefer dedicated Cortex API URL (may differ from PrivateLink Agent API URL),
  // fall back to the general Snowflake URL
  const snowflakeUrl =
    process.env.SNOWFLAKE_CORTEX_API_URL || process.env.SNOWFLAKE_URL;
  if (!snowflakeUrl) {
    throw new Error(
      "SNOWFLAKE_CORTEX_API_URL or SNOWFLAKE_URL is required for image text extraction",
    );
  }

  // Base64 encode the image
  const base64Data = buffer.toString("base64");
  const mimeType = detectMimeType(buffer);

  // Generate a JWT for the Chat Completions API call
  const { token } = generateUserJWT({});

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${snowflakeUrl}/api/v2/cortex/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
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
        `Chat Completions API error (${response.status}): ${errorBody}`,
      );
    }

    const result = await response.json();
    const extractedText = result.choices?.[0]?.message?.content?.trim() ?? "";

    const sanitized = sanitizeExtractedText(extractedText);

    return {
      text: sanitized,
      metadata: {
        filename,
        characters: sanitized.length,
        format: "image",
        type: "image",
      },
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Image text extraction timed out after 30 seconds");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
