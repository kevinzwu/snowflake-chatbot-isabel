/**
 * PDF text extractor using pdf-parse v2.
 * Extracts text content from PDF text layers with character limit and timeout.
 *
 * Uses `pdf-parse/worker` for proper Node.js/serverless support:
 *  - CanvasFactory: provides DOMMatrix polyfill for environments without it
 *  - getPath(): resolves the bundled worker file, avoiding "fake worker" failures
 *
 * @see https://github.com/mehmet-kozan/pdf-parse/blob/main/docs/troubleshooting.md
 */

import { sanitizeExtractedText } from "../security/file-validator";

const MAX_CHARS = 100_000;
const PARSE_TIMEOUT_MS = 30_000;

export interface PdfExtractionResult {
  text: string;
  metadata: {
    filename: string;
    pages: number;
    characters: number;
    format: "pdf";
    truncated: boolean;
  };
}

let workerConfigured = false;

export async function extractPdfText(
  buffer: Buffer,
  filename: string,
): Promise<PdfExtractionResult> {
  // Dynamic import so CSV/DOCX extraction isn't blocked if pdf-parse fails to load
  const { CanvasFactory, getPath } = await import("pdf-parse/worker");
  const { PDFParse } = await import("pdf-parse");

  // Configure worker once — must happen before any PDFParse operation
  if (!workerConfigured) {
    PDFParse.setWorker(getPath());
    workerConfigured = true;
  }

  const parser = new PDFParse({ data: buffer, CanvasFactory });

  try {
    const textResult = await Promise.race([
      parser.getText(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("File parsing timed out")),
          PARSE_TIMEOUT_MS,
        ),
      ),
    ]);

    let text = sanitizeExtractedText(textResult.text);
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
        pages: textResult.total,
        characters: text.length,
        format: "pdf",
        truncated,
      },
    };
  } finally {
    await parser.destroy();
  }
}
