/**
 * File extraction router.
 * Dispatches to format-specific extractors based on file type.
 *
 * Note: Image extraction is handled client-side via Snowflake Chat Completions
 * (see lib/agent-api/functions/extractTextFromImage.ts). Images bypass this
 * server-side router entirely to stay on PrivateLink.
 */

import type { AllowedFileType } from "../security/file-validator";
import { extractCsvText, type CsvExtractionResult } from "./csv-extractor";
import { extractDocxText, type DocxExtractionResult } from "./docx-extractor";
import { extractPdfText, type PdfExtractionResult } from "./pdf-extractor";

export type ExtractionResult =
  PdfExtractionResult | CsvExtractionResult | DocxExtractionResult;

export async function extractText(
  buffer: Buffer,
  filename: string,
  fileType: AllowedFileType,
): Promise<ExtractionResult> {
  switch (fileType) {
    case "pdf":
      return extractPdfText(buffer, filename);
    case "csv":
      return extractCsvText(buffer, filename);
    case "docx":
      return extractDocxText(buffer, filename);
    case "image":
      // Images are extracted client-side; if they somehow reach here, treat as error
      throw new Error(
        "Image extraction is handled client-side. Images should not reach the server extraction pipeline.",
      );
  }
}

export { type CsvExtractionResult } from "./csv-extractor";
export { type DocxExtractionResult } from "./docx-extractor";
export { type PdfExtractionResult } from "./pdf-extractor";
