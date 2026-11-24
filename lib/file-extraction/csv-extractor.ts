/**
 * CSV text extractor using csv-parse.
 * Parses CSV files with auto-delimiter detection and formula injection neutralization.
 */

import { parse } from "csv-parse/sync";
import {
  neutralizeCsvFormulas,
  sanitizeExtractedText,
} from "../security/file-validator";

const MAX_CHARS = 100_000;

export interface CsvExtractionResult {
  text: string;
  metadata: {
    filename: string;
    rows: number;
    columns: number;
    characters: number;
    format: "csv";
    truncated: boolean;
  };
}

/** Try parsing with a specific delimiter. Returns null if it fails or produces a single column. */
function tryParse(content: string, delimiter: string): string[][] | null {
  try {
    const records: string[][] = parse(content, {
      delimiter,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    });
    // Must have at least 1 row and more than 1 column to be valid
    if (records.length > 0 && records[0].length > 1) {
      return records;
    }
    return null;
  } catch {
    return null;
  }
}

export function extractCsvText(
  buffer: Buffer,
  filename: string,
): CsvExtractionResult {
  const content = buffer.toString("utf-8");

  // Auto-detect delimiter: try comma, semicolon, tab
  const delimiters = [",", ";", "\t"];
  let records: string[][] | null = null;

  for (const delim of delimiters) {
    records = tryParse(content, delim);
    if (records) break;
  }

  // Fallback: single-column parse with comma
  if (!records) {
    try {
      records = parse(content, {
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch {
      records = [];
    }
  }

  if (!records || records.length === 0) {
    return {
      text: "",
      metadata: {
        filename,
        rows: 0,
        columns: 0,
        characters: 0,
        format: "csv",
        truncated: false,
      },
    };
  }

  // Neutralize formula injection and build text
  const neutralized = records.map((row) =>
    row.map((cell) => neutralizeCsvFormulas(cell)),
  );

  // Format as readable text: header row + data rows
  const headers = neutralized[0];
  const dataRows = neutralized.slice(1);

  const lines: string[] = [];
  lines.push(headers.join(" | "));
  lines.push(headers.map(() => "---").join(" | "));

  for (const row of dataRows) {
    lines.push(row.join(" | "));
  }

  let text = sanitizeExtractedText(lines.join("\n"));
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
      rows: records.length - 1, // Exclude header row
      columns: headers.length,
      characters: text.length,
      format: "csv",
      truncated,
    },
  };
}
