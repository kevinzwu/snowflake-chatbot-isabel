/**
 * POST /api/v1/extract-text
 *
 * Accepts multipart/form-data with a single file field.
 * Validates the file (type, size, magic bytes, content safety),
 * extracts plain text, and returns { text, metadata }.
 *
 * Authentication: Requires NextAuth session.
 * Rate limited: 5 requests/minute per user.
 */

import { authConfig } from "@/lib/auth-config";
import { extractText } from "@/lib/file-extraction";
import { sanitizeFilename, validateFile } from "@/lib/security/file-validator";
import { fileExtractionRateLimiter } from "@/lib/security/rate-limiter";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Authentication
  const session = await getServerSession(authConfig);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Rate limiting
  const rateLimitKey = session.user.email || session.user.id || "unknown";
  const rateLimitResult = fileExtractionRateLimiter.check(rateLimitKey);

  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        error: "Too Many Requests",
        message: `Rate limit exceeded. Please try again in ${rateLimitResult.retryAfter} seconds.`,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimitResult.retryAfter),
          "X-RateLimit-Limit": "5",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(
            Math.ceil((Date.now() + rateLimitResult.resetIn) / 1000),
          ),
        },
      },
    );
  }

  // 3. Content-Type validation
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Content-Type must be multipart/form-data" },
      { status: 415 },
    );
  }

  // 4. Parse multipart form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Failed to parse form data" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "No file provided. Include a 'file' field in the form data." },
      { status: 400 },
    );
  }

  // 5. Size check (early, before reading into memory)
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File exceeds maximum size of 10 MB" },
      { status: 413 },
    );
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }

  // 6. Read file into buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // 7. Sanitize filename before type detection, logging, and response metadata
  const safeFilename = sanitizeFilename(file.name);

  // 8. Validate file (magic bytes + content safety)
  const validation = await validateFile(buffer, safeFilename);
  if (!validation.valid) {
    const status = validation.error?.includes("size") ? 413 : 422;
    return NextResponse.json({ error: validation.error }, { status });
  }

  // 9. Extract text
  try {
    const result = await extractText(buffer, safeFilename, validation.fileType);

    return NextResponse.json(
      {
        text: result.text,
        metadata: result.metadata,
      },
      {
        status: 200,
        headers: {
          "X-RateLimit-Limit": "5",
          "X-RateLimit-Remaining": String(rateLimitResult.remaining),
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Extraction failed";

    if (message === "File parsing timed out") {
      return NextResponse.json(
        { error: "File parsing timed out" },
        { status: 422 },
      );
    }

    if (message.includes("Image text extraction timed out")) {
      return NextResponse.json(
        { error: "Image text extraction timed out" },
        { status: 422 },
      );
    }

    if (message.includes("Chat Completions API error")) {
      console.error("[extract-text] Vision API error:", message);
      return NextResponse.json(
        { error: "Failed to extract text from image" },
        { status: 502 },
      );
    }

    console.error("[extract-text] Extraction error:", message);
    return NextResponse.json(
      { error: "Failed to extract text from file" },
      { status: 500 },
    );
  }
}
