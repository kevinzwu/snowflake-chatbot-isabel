/**
 * Component tests for ChatInput file attachment functionality
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Mock usehooks-ts
vi.mock("usehooks-ts", () => ({
  useWindowSize: vi.fn(() => ({ width: 1024, height: 768 })),
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
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
import { toast } from "sonner";

describe("ChatInput file attachment", () => {
  const defaultProps = {
    isLoading: false,
    messagesLength: 1,
    handleSubmit: vi.fn(),
    handleStop: vi.fn(),
  };

  it("should render the file attachment button", () => {
    render(<ChatInput {...defaultProps} />);

    const attachButton = screen.getByTestId("attach-file-button");
    expect(attachButton).toBeInTheDocument();
    expect(attachButton).toHaveAttribute(
      "title",
      "Attach file (PDF, CSV, DOCX)",
    );
  });

  it("should render a hidden file input with multiple attribute", () => {
    render(<ChatInput {...defaultProps} />);

    const fileInput = screen.getByTestId("file-input");
    expect(fileInput).toBeInTheDocument();
    expect(fileInput).toHaveAttribute("type", "file");
    expect(fileInput).toHaveAttribute("multiple");
    expect(fileInput).toHaveClass("hidden");
  });

  it("should reject unsupported file types via client validation", async () => {
    render(<ChatInput {...defaultProps} />);

    const fileInput = screen.getByTestId("file-input") as HTMLInputElement;

    const file = new File(["binary data"], "archive.zip", {
      type: "application/zip",
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(toast.error).toHaveBeenCalledWith(
      "Unsupported file type. Accepted: PDF, CSV, DOCX, PNG, JPG, WEBP",
    );
  });

  it("should reject oversized files via client validation", async () => {
    render(<ChatInput {...defaultProps} />);

    const fileInput = screen.getByTestId("file-input") as HTMLInputElement;

    // Create a "file" object with size > 10 MB
    const bigFile = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(bigFile, "size", { value: 11 * 1024 * 1024 });

    fireEvent.change(fileInput, { target: { files: [bigFile] } });

    expect(toast.error).toHaveBeenCalledWith("File exceeds 10 MB limit");
  });

  it("should show drop zone indicator on drag over", () => {
    render(<ChatInput {...defaultProps} />);

    const container = screen
      .getByPlaceholderText("Ask Isabel anything...")
      .closest("[class*='rounded-2xl']")!;
    fireEvent.dragOver(container);

    expect(screen.getByText(/Drop file here/)).toBeInTheDocument();
  });

  it("should disable attach button while loading", () => {
    render(<ChatInput {...defaultProps} isLoading={true} />);

    const attachButton = screen.getByTestId("attach-file-button");
    expect(attachButton).toBeDisabled();
  });

  it("should reject more than 3 files at once", () => {
    render(<ChatInput {...defaultProps} />);

    const fileInput = screen.getByTestId("file-input") as HTMLInputElement;

    const files = [
      new File(["a"], "a.pdf", { type: "application/pdf" }),
      new File(["b"], "b.pdf", { type: "application/pdf" }),
      new File(["c"], "c.pdf", { type: "application/pdf" }),
      new File(["d"], "d.csv", { type: "text/csv" }),
    ];

    fireEvent.change(fileInput, { target: { files } });

    expect(toast.error).toHaveBeenCalledWith("Maximum 3 files per message");
  });

  it("should reject files exceeding 30MB total budget", () => {
    render(<ChatInput {...defaultProps} />);

    const fileInput = screen.getByTestId("file-input") as HTMLInputElement;

    const file1 = new File(["x"], "big1.pdf", { type: "application/pdf" });
    Object.defineProperty(file1, "size", { value: 9 * 1024 * 1024 });
    const file2 = new File(["x"], "big2.pdf", { type: "application/pdf" });
    Object.defineProperty(file2, "size", { value: 9 * 1024 * 1024 });
    const file3 = new File(["x"], "big3.pdf", { type: "application/pdf" });
    Object.defineProperty(file3, "size", { value: 9 * 1024 * 1024 });

    // Exceeds 30MB total (27MB across 3 files is OK, but let's test with files totaling > 30MB)
    const fileA = new File(["x"], "fileA.pdf", { type: "application/pdf" });
    Object.defineProperty(fileA, "size", { value: 20 * 1024 * 1024 });
    const fileB = new File(["x"], "fileB.pdf", { type: "application/pdf" });
    Object.defineProperty(fileB, "size", { value: 20 * 1024 * 1024 });

    fireEvent.change(fileInput, { target: { files: [fileA, fileB] } });

    expect(toast.error).toHaveBeenCalledWith(
      "Total file size exceeds 30 MB limit",
    );
  });
});
