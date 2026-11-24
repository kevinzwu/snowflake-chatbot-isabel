/**
 * Markdown table parser utility.
 *
 * This file lives in lib/ (outside Tailwind's content scan paths)
 * to avoid Tailwind JIT interpreting regex patterns as CSS class names.
 */

/**
 * Check whether a line is a markdown table separator row (e.g. |---|:---:|---:|).
 * Uses only simple string checks — no regex with special character classes.
 */
function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  // A separator row contains only |, -, :, and whitespace
  for (const ch of trimmed) {
    if (ch !== "|" && ch !== "-" && ch !== ":" && ch !== " ") {
      return false;
    }
  }
  // Must contain at least one dash to be a separator
  return trimmed.includes("-");
}

/**
 * Parse a markdown table string into structured header + row arrays.
 */
export function parseMarkdownTable(markdown: string): {
  headers: string[];
  rows: string[][];
} {
  const lines = markdown
    .trim()
    .split("\n")
    .filter((line) => line.trim());
  const headers: string[] = [];
  const rows: string[][] = [];

  if (lines.length === 0) {
    return { headers, rows };
  }

  // Parse header row (first line with | characters)
  // Use slice(1, -1) to strip leading/trailing empty segments from pipes,
  // preserving intentionally blank cells in the middle.
  const headerLine = lines[0];
  if (headerLine.includes("|")) {
    const parts = headerLine.split("|");
    const headerCells = parts.slice(1, -1).map((cell) => cell.trim());
    headers.push(...headerCells);
  }

  // Skip the separator line (second line with dashes)
  // Parse data rows (remaining lines)
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("|") && !isSeparatorRow(line)) {
      const parts = line.split("|");
      const cells = parts.slice(1, -1).map((cell) => cell.trim());
      // Pad or truncate to match header count for consistent column alignment
      if (headers.length > 0) {
        while (cells.length < headers.length) cells.push("");
        if (cells.length > headers.length) cells.length = headers.length;
      }
      if (cells.length > 0) {
        rows.push(cells);
      }
    }
  }

  return { headers, rows };
}
