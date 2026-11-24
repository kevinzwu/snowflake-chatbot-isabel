import { createProfile, listProfiles, PROFILE_LIMITS } from "@/lib/dynamodb";
import { sanitizeInput } from "@/lib/security/input-sanitizer";
import {
  authenticateReadRequest,
  authenticateWriteRequest,
  secureJsonResponse,
} from "@/lib/security/route-hardening";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/profiles
 * List all profiles for the authenticated user.
 */
export async function GET() {
  const auth = await authenticateReadRequest("/api/profiles");
  if (auth instanceof NextResponse) return auth;

  try {
    const profiles = await listProfiles(auth.userId);
    return secureJsonResponse({ profiles });
  } catch (error) {
    console.error("Failed to list profiles:", error);
    return secureJsonResponse(
      { error: "Internal Server Error", message: "Failed to list profiles" },
      500,
    );
  }
}

/**
 * POST /api/profiles
 * Create a new profile.
 *
 * Body: { name: string, content: string, isDefault?: boolean }
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateWriteRequest(request, "/api/profiles");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { name, content, isDefault } = body as {
      name: string;
      content: string;
      isDefault?: boolean;
    };

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return secureJsonResponse(
        { error: "Bad Request", message: "Name is required" },
        400,
      );
    }

    if (
      !content ||
      typeof content !== "string" ||
      content.trim().length === 0
    ) {
      return secureJsonResponse(
        { error: "Bad Request", message: "Content is required" },
        400,
      );
    }

    if (name.length > PROFILE_LIMITS.MAX_NAME_LENGTH) {
      return secureJsonResponse(
        {
          error: "Bad Request",
          message: `Name exceeds maximum length of ${PROFILE_LIMITS.MAX_NAME_LENGTH} characters`,
        },
        400,
      );
    }

    if (content.length > PROFILE_LIMITS.MAX_CONTENT_LENGTH) {
      return secureJsonResponse(
        {
          error: "Bad Request",
          message: `Content exceeds maximum length of ${PROFILE_LIMITS.MAX_CONTENT_LENGTH} characters`,
        },
        400,
      );
    }

    const sanitizedName = sanitizeInput(name.trim());
    // Content is intentionally NOT sanitized — it's injected as prompt text,
    // not rendered as HTML. Sanitizing would break user formatting.
    const trimmedContent = content.trim();

    const profile = await createProfile(auth.userId, {
      name: sanitizedName,
      content: trimmedContent,
      isDefault: isDefault === true,
    });

    return secureJsonResponse(profile, 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes("limit")) {
      return secureJsonResponse(
        { error: "Conflict", message: error.message },
        409,
      );
    }
    console.error("Failed to create profile:", error);
    return secureJsonResponse(
      { error: "Internal Server Error", message: "Failed to create profile" },
      500,
    );
  }
}
