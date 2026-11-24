/**
 * DOCX text extractor using mammoth.
 * Converts Word documents to plain text with image placeholders.
 */

import mammoth from "mammoth";
import { sanitizeExtractedText } from "../security/file-validator";

const MAX_CHARS = 100_000;
const PARSE_TIMEOUT_MS = 30_000;

export interface DocxExtractionResult {
  text: string;
  metadata: {
    filename: string;
    characters: number;
    format: "docx";
    truncated: boolean;
  };
}

export async function extractDocxText(
  buffer: Buffer,
  filename: string,
): Promise<DocxExtractionResult> {
  const result = await Promise.race([
    mammoth.extractRawText({ buffer }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("File parsing timed out")),
        PARSE_TIMEOUT_MS,
      ),
    ),
  ]);

  let text = sanitizeExtractedText(result.value);
  let truncated = false;

  if (text.length > MAX_CHARS) {
    text =
      text.slice(0, MAX_CHARS) +
      "\n[Truncated: document exceeded 100,000 character limit]";
    truncated = true;
  }

  return {
    text,
    metadata: {
      filename,
      characters: text.length,
      format: "docx",
      truncated,
    },
  };
}
