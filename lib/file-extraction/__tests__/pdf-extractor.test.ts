import { describe, expect, it, vi } from "vitest";

let mockGetTextResult: {
  text: string;
  total: number;
  pages: Array<{ num: number; text: string }>;
};

// Mock pdf-parse/worker (must be before pdf-parse mock)
vi.mock("pdf-parse/worker", () => ({
  CanvasFactory: class {},
  getPath: () => "/mock/worker/path",
  getData: () => "mock-worker-data",
}));

// Mock pdf-parse v2
vi.mock("pdf-parse", () => ({
  PDFParse: Object.assign(
    class {
      async getText() {
        return mockGetTextResult;
      }
      async destroy() {}
    },
    { setWorker: vi.fn() },
  ),
}));

import { extractPdfText } from "../pdf-extractor";

function setMockTextResult(result: typeof mockGetTextResult): void {
  mockGetTextResult = result;
}

describe("pdf-extractor", () => {
  it("should extract text from a valid PDF", async () => {
    setMockTextResult({
      text: "Hello World\nThis is a test document.",
      total: 2,
      pages: [
        { num: 1, text: "Hello World" },
        { num: 2, text: "This is a test document." },
      ],
    });

    const buffer = Buffer.from("%PDF-1.5", "utf-8");
    const result = await extractPdfText(buffer, "report.pdf");

    expect(result.metadata.format).toBe("pdf");
    expect(result.metadata.filename).toBe("report.pdf");
    expect(result.metadata.pages).toBe(2);
    expect(result.text).toBe("Hello World\nThis is a test document.");
    expect(result.metadata.truncated).toBe(false);
  });

  it("should truncate text exceeding 100K characters", async () => {
    const longText = "x".repeat(150_000);
    setMockTextResult({
      text: longText,
      total: 50,
      pages: [{ num: 1, text: longText }],
    });

    const buffer = Buffer.from("%PDF-1.5", "utf-8");
    const result = await extractPdfText(buffer, "huge.pdf");

    expect(result.metadata.truncated).toBe(true);
    expect(result.text).toContain(
      "[Truncated: document exceeded 100,000 character limit]",
    );
    expect(result.text.length).toBeLessThan(150_000);
  });

  it("should return empty text for image-only PDFs", async () => {
    setMockTextResult({
      text: "",
      total: 1,
      pages: [{ num: 1, text: "" }],
    });

    const buffer = Buffer.from("%PDF-1.5", "utf-8");
    const result = await extractPdfText(buffer, "scanned.pdf");

    expect(result.text).toBe("");
    expect(result.metadata.characters).toBe(0);
  });

  it("should sanitize extracted text", async () => {
    setMockTextResult({
      text: "<script>alert(1)</script>Hello\x00World",
      total: 1,
      pages: [{ num: 1, text: "<script>alert(1)</script>Hello\x00World" }],
    });

    const buffer = Buffer.from("%PDF-1.5", "utf-8");
    const result = await extractPdfText(buffer, "test.pdf");

    expect(result.text).not.toContain("<script>");
    expect(result.text).not.toContain("\x00");
    expect(result.text).toContain("alert(1)");
    expect(result.text).toContain("HelloWorld");
  });
});
