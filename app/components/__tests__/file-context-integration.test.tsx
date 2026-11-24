/**
 * Integration test verifying file context is included in agent messages.
 */

import { describe, expect, it, vi } from "vitest";

// Mock usehooks-ts
vi.mock("usehooks-ts", () => ({
  useWindowSize: vi.fn(() => ({ width: 1024, height: 768 })),
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Mock input-sanitizer
vi.mock("@/lib/security/input-sanitizer", () => ({
  validateChatInput: vi.fn((input: string) => ({
    isValid: true,
    sanitizedInput: input,
  })),
  containsDangerousContent: vi.fn(() => false),
}));

import { ChatInput } from "@/app/components/input";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

describe("File context integration", () => {
  it("should include file context in submitted message", async () => {
    const handleSubmit = vi.fn();

    // Mock fetch for file upload
    const mockFetchResponse = {
      ok: true,
      json: async () => ({
        text: "Name,Value\nfoo,bar",
        metadata: {
          filename: "data.csv",
          rows: 1,
          columns: 2,
          characters: 17,
          format: "csv",
          truncated: false,
        },
      }),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockFetchResponse as Response,
    );

    render(
      <ChatInput
        isLoading={false}
        messagesLength={1}
        handleSubmit={handleSubmit}
      />,
    );

    // Attach a file
    const fileInput = screen.getByTestId("file-input") as HTMLInputElement;
    const csvFile = new File(["Name,Value\nfoo,bar"], "data.csv", {
      type: "text/csv",
    });
    fireEvent.change(fileInput, { target: { files: [csvFile] } });

    // Wait for upload to complete
    await waitFor(() => {
      expect(screen.getByText("data.csv")).toBeInTheDocument();
    });

    // Type a question
    const textarea = screen.getByPlaceholderText("Ask Isabel anything...");
    fireEvent.change(textarea, { target: { value: "Analyze this data" } });

    // Submit
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    // Verify the submitted message passes structured data
    expect(handleSubmit).toHaveBeenCalledTimes(1);
    const submittedText = handleSubmit.mock.calls[0][0];
    const submittedAttachments = handleSubmit.mock.calls[0][1];

    // Text should be ONLY the user's typed message
    expect(submittedText).toBe("Analyze this data");
    expect(submittedText).not.toContain("[Attached File:");

    // Attachments should be structured metadata
    expect(submittedAttachments).toHaveLength(1);
    expect(submittedAttachments[0]).toMatchObject({
      filename: "data.csv",
      format: "csv",
      rows: 1,
      columns: 2,
      characters: 17,
      extractedText: "Name,Value\nfoo,bar",
    });
  });

  it("should submit file context alone without text input", async () => {
    const handleSubmit = vi.fn();

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        text: "Some extracted text",
        metadata: {
          filename: "report.pdf",
          pages: 3,
          characters: 19,
          format: "pdf",
          truncated: false,
        },
      }),
    } as Response);

    render(
      <ChatInput
        isLoading={false}
        messagesLength={1}
        handleSubmit={handleSubmit}
      />,
    );

    // Attach a file
    const fileInput = screen.getByTestId("file-input") as HTMLInputElement;
    const pdfFile = new File(["content"], "report.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(fileInput, { target: { files: [pdfFile] } });

    await waitFor(() => {
      expect(screen.getByText("report.pdf")).toBeInTheDocument();
    });

    // Submit without typing anything
    const textarea = screen.getByPlaceholderText("Ask Isabel anything...");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(handleSubmit).toHaveBeenCalledTimes(1);
    const submittedText = handleSubmit.mock.calls[0][0];
    const submittedAttachments = handleSubmit.mock.calls[0][1];

    // Text is empty since user didn't type anything
    expect(submittedText).toBe("");

    // Attachments contain the file data
    expect(submittedAttachments).toHaveLength(1);
    expect(submittedAttachments[0]).toMatchObject({
      filename: "report.pdf",
      format: "pdf",
      pages: 3,
      characters: 19,
      extractedText: "Some extracted text",
    });
  });
});
