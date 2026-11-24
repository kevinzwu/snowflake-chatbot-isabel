import { describe, expect, it } from "vitest";
import { FileAttachmentMeta } from "../../types";
import { assembleAgentInput } from "../assembleAgentInput";

describe("assembleAgentInput", () => {
  it("should return user text unchanged when no attachments", () => {
    expect(assembleAgentInput("hello world")).toBe("hello world");
  });

  it("should return user text unchanged when attachments is empty array", () => {
    expect(assembleAgentInput("hello world", [])).toBe("hello world");
  });

  it("should return user text unchanged when attachments is undefined", () => {
    expect(assembleAgentInput("hello world", undefined)).toBe("hello world");
  });

  it("should prepend single PDF attachment context before user text", () => {
    const attachments: FileAttachmentMeta[] = [
      {
        filename: "report.pdf",
        format: "pdf",
        pages: 5,
        characters: 9963,
        extractedText: "Page 1 content\nPage 2 content",
      },
    ];

    const result = assembleAgentInput("summarize this", attachments);

    expect(result).toBe(
      "[Attached File: report.pdf, 5 pages, 9963 characters]\n" +
        "---\n" +
        "Page 1 content\nPage 2 content\n" +
        "---\n" +
        "summarize this",
    );
  });

  it("should prepend single CSV attachment with rows and columns", () => {
    const attachments: FileAttachmentMeta[] = [
      {
        filename: "hosts.csv",
        format: "csv",
        rows: 142,
        columns: 3,
        characters: 2100,
        extractedText: "host|ip|status\n---\nhost1|1.2.3.4|active",
      },
    ];

    const result = assembleAgentInput("analyze this data", attachments);

    expect(result).toContain(
      "[Attached File: hosts.csv, 142 rows, 3 columns, 2100 characters]",
    );
    expect(result).toContain("host|ip|status");
    expect(result).toMatch(/analyze this data$/);
  });

  it("should prepend multiple attachments in order before user text", () => {
    const attachments: FileAttachmentMeta[] = [
      {
        filename: "vuln.pdf",
        format: "pdf",
        pages: 3,
        characters: 5000,
        extractedText: "vulnerability details",
      },
      {
        filename: "hosts.csv",
        format: "csv",
        rows: 10,
        columns: 2,
        characters: 500,
        extractedText: "host|status",
      },
      {
        filename: "findings.docx",
        format: "docx",
        characters: 1200,
        extractedText: "finding text",
      },
    ];

    const result = assembleAgentInput("compare these", attachments);

    // Verify order: first attachment appears first
    const pdfIndex = result.indexOf("[Attached File: vuln.pdf");
    const csvIndex = result.indexOf("[Attached File: hosts.csv");
    const docxIndex = result.indexOf("[Attached File: findings.docx");
    const userTextIndex = result.indexOf("compare these");

    expect(pdfIndex).toBeLessThan(csvIndex);
    expect(csvIndex).toBeLessThan(docxIndex);
    expect(docxIndex).toBeLessThan(userTextIndex);
  });

  it("should handle DOCX without pages or rows metadata", () => {
    const attachments: FileAttachmentMeta[] = [
      {
        filename: "doc.docx",
        format: "docx",
        characters: 800,
        extractedText: "document text",
      },
    ];

    const result = assembleAgentInput("read this", attachments);

    expect(result).toContain("[Attached File: doc.docx, 800 characters]");
    expect(result).not.toContain("pages");
    expect(result).not.toContain("rows");
  });

  it("should handle attachments with empty user text", () => {
    const attachments: FileAttachmentMeta[] = [
      {
        filename: "report.pdf",
        format: "pdf",
        pages: 1,
        characters: 100,
        extractedText: "content",
      },
    ];

    const result = assembleAgentInput("", attachments);

    expect(result).toContain("[Attached File: report.pdf");
    expect(result).toContain("content");
    // Should not have trailing user text
    expect(result).toMatch(/---$/);
  });
});
