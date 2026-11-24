import { describe, expect, it, vi } from "vitest";
import { extractDocxText } from "../docx-extractor";

// Mock mammoth to avoid needing real DOCX files
vi.mock("mammoth", () => ({
  default: {
    extractRawText: vi.fn(),
    images: {
      imgElement: vi.fn(() => vi.fn()),
    },
  },
}));

import mammoth from "mammoth";
const mockedMammoth = vi.mocked(mammoth);

describe("docx-extractor", () => {
  it("should extract text from a valid DOCX", async () => {
    mockedMammoth.extractRawText.mockResolvedValueOnce({
      value: "Hello World\n\nThis is a DOCX document.",
      messages: [],
    });

    const buffer = Buffer.alloc(10);
    const result = await extractDocxText(buffer, "document.docx");

    expect(result.metadata.format).toBe("docx");
    expect(result.metadata.filename).toBe("document.docx");
    expect(result.text).toBe("Hello World\n\nThis is a DOCX document.");
    expect(result.metadata.truncated).toBe(false);
  });

  it("should truncate text exceeding 100K characters", async () => {
    const longText = "y".repeat(150_000);
    mockedMammoth.extractRawText.mockResolvedValueOnce({
      value: longText,
      messages: [],
    });

    const buffer = Buffer.alloc(10);
    const result = await extractDocxText(buffer, "huge.docx");

    expect(result.metadata.truncated).toBe(true);
    expect(result.text).toContain(
      "[Truncated: document exceeded 100,000 character limit]",
    );
  });

  it("should sanitize extracted text", async () => {
    mockedMammoth.extractRawText.mockResolvedValueOnce({
      value: "<p>Hello</p>\x00World\x01End",
      messages: [],
    });

    const buffer = Buffer.alloc(10);
    const result = await extractDocxText(buffer, "test.docx");

    expect(result.text).not.toContain("<p>");
    expect(result.text).not.toContain("\x00");
    expect(result.text).not.toContain("\x01");
    expect(result.text).toContain("Hello");
    expect(result.text).toContain("WorldEnd");
  });

  it("should return empty text for empty DOCX", async () => {
    mockedMammoth.extractRawText.mockResolvedValueOnce({
      value: "",
      messages: [],
    });

    const buffer = Buffer.alloc(10);
    const result = await extractDocxText(buffer, "empty.docx");

    expect(result.text).toBe("");
    expect(result.metadata.characters).toBe(0);
  });
});
