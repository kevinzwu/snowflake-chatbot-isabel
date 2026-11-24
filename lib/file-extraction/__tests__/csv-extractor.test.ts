import { describe, expect, it } from "vitest";
import { extractCsvText } from "../csv-extractor";

describe("csv-extractor", () => {
  it("should extract standard CSV with headers", () => {
    const csv = "Name,Value,Status\nfoo,bar,active\nbaz,qux,inactive\n";
    const buffer = Buffer.from(csv, "utf-8");
    const result = extractCsvText(buffer, "data.csv");

    expect(result.metadata.format).toBe("csv");
    expect(result.metadata.filename).toBe("data.csv");
    expect(result.metadata.rows).toBe(2);
    expect(result.metadata.columns).toBe(3);
    expect(result.text).toContain("Name | Value | Status");
    expect(result.text).toContain("foo | bar | active");
  });

  it("should auto-detect semicolon delimiter", () => {
    const csv = "Name;Value\nfoo;bar\n";
    const buffer = Buffer.from(csv, "utf-8");
    const result = extractCsvText(buffer, "data.csv");

    expect(result.metadata.columns).toBe(2);
    expect(result.text).toContain("Name | Value");
    expect(result.text).toContain("foo | bar");
  });

  it("should auto-detect tab delimiter", () => {
    const csv = "Name\tValue\nfoo\tbar\n";
    const buffer = Buffer.from(csv, "utf-8");
    const result = extractCsvText(buffer, "data.csv");

    expect(result.metadata.columns).toBe(2);
    expect(result.text).toContain("Name | Value");
  });

  it("should neutralize formula injection in cells", () => {
    const csv = "Name,Formula\ntest,=CMD()\nother,+HYPERLINK()\n";
    const buffer = Buffer.from(csv, "utf-8");
    const result = extractCsvText(buffer, "data.csv");

    expect(result.text).toContain("'=CMD()");
    expect(result.text).toContain("'+HYPERLINK()");
  });

  it("should handle empty CSV", () => {
    const buffer = Buffer.from("", "utf-8");
    const result = extractCsvText(buffer, "empty.csv");

    expect(result.text).toBe("");
    expect(result.metadata.rows).toBe(0);
    expect(result.metadata.columns).toBe(0);
  });

  it("should truncate text exceeding 100K characters", () => {
    // Create a CSV with many rows
    const header = "Col1,Col2\n";
    const row = "x".repeat(500) + "," + "y".repeat(500) + "\n";
    const csv = header + row.repeat(200);
    const buffer = Buffer.from(csv, "utf-8");
    const result = extractCsvText(buffer, "large.csv");

    expect(result.metadata.truncated).toBeDefined();
    // Text should be capped
    expect(result.text.length).toBeLessThanOrEqual(110_000);
  });

  it("should sanitize HTML in cell content", () => {
    const csv = "Name,Comment\ntest,<script>alert(1)</script>\n";
    const buffer = Buffer.from(csv, "utf-8");
    const result = extractCsvText(buffer, "data.csv");

    expect(result.text).not.toContain("<script>");
    expect(result.text).toContain("alert(1)");
  });
});
