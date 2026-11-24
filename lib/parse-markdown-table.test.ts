/**
 * Tests for parseMarkdownTable utility
 *
 * Tests cover:
 * - Standard markdown tables
 * - Empty/missing data
 * - Padding/truncating rows to match header count
 * - Separator row detection
 * - Edge cases (no pipes, extra separators)
 */

import { parseMarkdownTable } from "@/lib/parse-markdown-table";
import { describe, expect, it } from "vitest";

describe("parseMarkdownTable()", () => {
  it("should parse a standard markdown table", () => {
    const table = `
| Name | Age | City |
|------|-----|------|
| Alice | 30 | NYC |
| Bob | 25 | LA |
    `;

    const result = parseMarkdownTable(table);
    expect(result.headers).toEqual(["Name", "Age", "City"]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(["Alice", "30", "NYC"]);
    expect(result.rows[1]).toEqual(["Bob", "25", "LA"]);
  });

  it("should handle empty input", () => {
    const result = parseMarkdownTable("");
    expect(result.headers).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  it("should handle whitespace-only input", () => {
    const result = parseMarkdownTable("   \n  \n  ");
    expect(result.headers).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  it("should handle table with no data rows", () => {
    const table = `
| Header 1 | Header 2 |
|----------|----------|
    `;

    const result = parseMarkdownTable(table);
    expect(result.headers).toEqual(["Header 1", "Header 2"]);
    expect(result.rows).toEqual([]);
  });

  it("should trim cell content", () => {
    const table = `
|  Name  |  Age  |
|--------|-------|
|  Alice |  30   |
    `;

    const result = parseMarkdownTable(table);
    expect(result.headers).toEqual(["Name", "Age"]);
    expect(result.rows[0]).toEqual(["Alice", "30"]);
  });

  it("should pad short rows to match header count", () => {
    const table = `
| A | B | C |
|---|---|---|
| 1 |
    `;

    const result = parseMarkdownTable(table);
    expect(result.rows[0]).toEqual(["1", "", ""]);
  });

  it("should truncate long rows to match header count", () => {
    const table = `
| A | B |
|---|---|
| 1 | 2 | 3 | 4 |
    `;

    const result = parseMarkdownTable(table);
    expect(result.rows[0]).toEqual(["1", "2"]);
  });

  it("should handle alignment separators", () => {
    const table = `
| Left | Center | Right |
|:-----|:------:|------:|
| a | b | c |
    `;

    const result = parseMarkdownTable(table);
    expect(result.headers).toEqual(["Left", "Center", "Right"]);
    expect(result.rows[0]).toEqual(["a", "b", "c"]);
  });

  it("should skip separator-like rows in data", () => {
    const table = `
| A | B |
|---|---|
| 1 | 2 |
|---|---|
| 3 | 4 |
    `;

    const result = parseMarkdownTable(table);
    // The middle separator should be skipped
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(["1", "2"]);
    expect(result.rows[1]).toEqual(["3", "4"]);
  });

  it("should handle single-column table", () => {
    const table = `
| Name |
|------|
| Alice |
| Bob |
    `;

    const result = parseMarkdownTable(table);
    expect(result.headers).toEqual(["Name"]);
    expect(result.rows).toHaveLength(2);
  });

  it("should handle table with special characters in cells", () => {
    const table = `
| Vuln ID | Description |
|---------|-------------|
| CVE-2024-1234 | SQL injection in login |
| VULN0012345 | XSS via user input |
    `;

    const result = parseMarkdownTable(table);
    expect(result.rows[0][0]).toBe("CVE-2024-1234");
    expect(result.rows[1][0]).toBe("VULN0012345");
  });
});
