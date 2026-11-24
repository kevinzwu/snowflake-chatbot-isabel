/**
 * Tests for POST /api/v1/extract-text
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next-auth's getServerSession
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

// Mock auth config
vi.mock("@/lib/auth-config", () => ({
  authConfig: {},
}));

// Mock file-extraction
vi.mock("@/lib/file-extraction", () => ({
  extractText: vi.fn(),
}));

// Mock file-validator
vi.mock("@/lib/security/file-validator", () => ({
  validateFile: vi.fn(),
  sanitizeFilename: vi.fn((name: string) => name),
}));

// Mock rate limiter
vi.mock("@/lib/security/rate-limiter", () => ({
  fileExtractionRateLimiter: {
    check: vi.fn(() => ({ allowed: true, remaining: 4, resetIn: 60000 })),
  },
}));

import { POST } from "@/app/api/v1/extract-text/route";
import { extractText } from "@/lib/file-extraction";
import { validateFile } from "@/lib/security/file-validator";
import { fileExtractionRateLimiter } from "@/lib/security/rate-limiter";
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedValidateFile = vi.mocked(validateFile);
const mockedExtractText = vi.mocked(extractText);
const mockedRateLimiter = vi.mocked(fileExtractionRateLimiter.check);

function createRequest(options: {
  contentType?: string;
  file?: { name: string; content: string; type?: string } | null;
  noFile?: boolean;
}): NextRequest {
  const { contentType, file, noFile } = options;

  // Build a mock request with the right content-type
  const mockFormData = new FormData();
  if (file) {
    mockFormData.append(
      "file",
      new File([file.content], file.name, { type: file.type }),
    );
  }

  const headers: Record<string, string> = {};
  if (contentType) {
    headers["Content-Type"] = contentType;
  } else {
    headers["Content-Type"] = "multipart/form-data; boundary=---test";
  }

  const req = new NextRequest("http://localhost:3000/api/v1/extract-text", {
    method: "POST",
    headers,
  });

  // Override formData() to return our mock
  if (!noFile && !contentType?.includes("application/json")) {
    req.formData = async () => mockFormData;
  }

  return req;
}

describe("POST /api/v1/extract-text", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@example.com" },
      expires: "2099-01-01",
    } as never);
    mockedRateLimiter.mockReturnValue({
      allowed: true,
      remaining: 4,
      resetIn: 60000,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 401 when no session exists", async () => {
    mockedGetServerSession.mockResolvedValueOnce(null);

    const request = createRequest({
      file: { name: "test.csv", content: "a,b" },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 429 when rate limited", async () => {
    mockedRateLimiter.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      resetIn: 30000,
      retryAfter: 30,
    });

    const request = createRequest({
      file: { name: "test.csv", content: "a,b" },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toBe("Too Many Requests");
  });

  it("should return 415 for wrong Content-Type", async () => {
    const request = createRequest({ contentType: "application/json" });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(415);
    expect(body.error).toContain("multipart/form-data");
  });

  it("should return 400 when no file is provided", async () => {
    const request = createRequest({});
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("No file provided");
  });

  it("should return 422 when file validation fails", async () => {
    mockedValidateFile.mockResolvedValueOnce({
      valid: false,
      error: "File content does not match declared type",
    });

    const request = createRequest({
      file: { name: "fake.pdf", content: "not a pdf" },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toContain("does not match");
  });

  it("should return 200 with extracted text on success", async () => {
    mockedValidateFile.mockResolvedValueOnce({
      valid: true,
      fileType: "csv",
    });
    mockedExtractText.mockResolvedValueOnce({
      text: "Name | Value\n--- | ---\nfoo | bar",
      metadata: {
        filename: "data.csv",
        rows: 1,
        columns: 2,
        characters: 30,
        format: "csv" as const,
        truncated: false,
      },
    });

    const request = createRequest({
      file: { name: "data.csv", content: "Name,Value\nfoo,bar" },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.text).toContain("Name | Value");
    expect(body.metadata.format).toBe("csv");
    expect(body.metadata.filename).toBe("data.csv");
  });

  it("should return 422 when extraction times out", async () => {
    mockedValidateFile.mockResolvedValueOnce({
      valid: true,
      fileType: "pdf",
    });
    mockedExtractText.mockRejectedValueOnce(
      new Error("File parsing timed out"),
    );

    const request = createRequest({
      file: { name: "slow.pdf", content: "content" },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe("File parsing timed out");
  });

  it("should return 500 on unexpected extraction errors", async () => {
    mockedValidateFile.mockResolvedValueOnce({
      valid: true,
      fileType: "pdf",
    });
    mockedExtractText.mockRejectedValueOnce(new Error("Parser crashed"));

    const request = createRequest({
      file: { name: "bad.pdf", content: "content" },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain("Failed to extract");
  });

  it("should return 413 when image exceeds 3.75MB size limit", async () => {
    mockedValidateFile.mockResolvedValueOnce({
      valid: false,
      error: "File exceeds maximum size of 3.75 MB",
    });

    const request = createRequest({
      file: { name: "large.png", content: "x".repeat(100) },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body.error).toContain("3.75 MB");
  });

  it("should return 502 when Chat Completions API fails for image", async () => {
    mockedValidateFile.mockResolvedValueOnce({
      valid: true,
      fileType: "image",
    });
    mockedExtractText.mockRejectedValueOnce(
      new Error("Chat Completions API error (500): Internal Server Error"),
    );

    const request = createRequest({
      file: { name: "screenshot.png", content: "png data" },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toContain("Failed to extract text from image");
  });

  it("should return 422 when image extraction times out", async () => {
    mockedValidateFile.mockResolvedValueOnce({
      valid: true,
      fileType: "image",
    });
    mockedExtractText.mockRejectedValueOnce(
      new Error("Image text extraction timed out after 30 seconds"),
    );

    const request = createRequest({
      file: { name: "slow.png", content: "png data" },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toContain("Image text extraction timed out");
  });
});
