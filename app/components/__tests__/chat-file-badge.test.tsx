import type { FileAttachmentMeta } from "@/lib/agent-api/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatFileBadge } from "../chat-file-badge";

const pdfAttachment: FileAttachmentMeta = {
  filename: "report.pdf",
  format: "pdf",
  pages: 5,
  characters: 9963,
  extractedText:
    "Page 1 content\nPage 2 content\nDetailed vulnerability data...",
};

const csvAttachment: FileAttachmentMeta = {
  filename: "hosts.csv",
  format: "csv",
  rows: 142,
  columns: 3,
  characters: 2100,
  extractedText: "host|ip|status\nhost1|1.2.3.4|active",
};

const docxAttachment: FileAttachmentMeta = {
  filename: "findings.docx",
  format: "docx",
  characters: 800,
  extractedText: "Finding 1: Critical vulnerability found...",
};

describe("ChatFileBadge", () => {
  it("renders collapsed badge with filename and PDF metadata", () => {
    render(<ChatFileBadge attachment={pdfAttachment} />);

    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("5 pages · 9,963 chars")).toBeInTheDocument();
    expect(screen.queryByTestId("file-badge-content")).not.toBeInTheDocument();
  });

  it("renders CSV metadata with rows and columns", () => {
    render(<ChatFileBadge attachment={csvAttachment} />);

    expect(screen.getByText("hosts.csv")).toBeInTheDocument();
    expect(
      screen.getByText("142 rows · 3 cols · 2,100 chars"),
    ).toBeInTheDocument();
  });

  it("renders DOCX metadata with only characters", () => {
    render(<ChatFileBadge attachment={docxAttachment} />);

    expect(screen.getByText("findings.docx")).toBeInTheDocument();
    expect(screen.getByText("800 chars")).toBeInTheDocument();
  });

  it("expands to show extracted text when toggle is clicked", () => {
    render(<ChatFileBadge attachment={pdfAttachment} />);

    // Initially collapsed
    expect(screen.queryByTestId("file-badge-content")).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByTestId("file-badge-toggle"));

    // Text is now visible
    const content = screen.getByTestId("file-badge-content");
    expect(content).toBeInTheDocument();
    expect(content).toHaveTextContent("Page 1 content");
  });

  it("collapses when toggle is clicked again", () => {
    render(<ChatFileBadge attachment={pdfAttachment} />);

    // Expand
    fireEvent.click(screen.getByTestId("file-badge-toggle"));
    expect(screen.getByTestId("file-badge-content")).toBeInTheDocument();

    // Collapse
    fireEvent.click(screen.getByTestId("file-badge-toggle"));
    expect(screen.queryByTestId("file-badge-content")).not.toBeInTheDocument();
  });

  it("has bounded scroll container when expanded", () => {
    render(<ChatFileBadge attachment={pdfAttachment} />);

    fireEvent.click(screen.getByTestId("file-badge-toggle"));

    const content = screen.getByTestId("file-badge-content");
    expect(content.className).toContain("max-h-64");
    expect(content.className).toContain("overflow-y-auto");
  });

  it("sets aria-expanded attribute correctly", () => {
    render(<ChatFileBadge attachment={pdfAttachment} />);

    const toggle = screen.getByTestId("file-badge-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});
