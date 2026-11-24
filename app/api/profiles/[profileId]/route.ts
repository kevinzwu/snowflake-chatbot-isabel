import { deleteProfile, PROFILE_LIMITS, updateProfile } from "@/lib/dynamodb";
import { sanitizeInput } from "@/lib/security/input-sanitizer";
import {
  authenticateWriteRequest,
  secureJsonResponse,
} from "@/lib/security/route-hardening";
import { NextRequest, NextResponse } from "next/server";

interface RouteParams {
  params: Promise<{ profileId: string }>;
}

/**
 * PATCH /api/profiles/[profileId]
 * Update an existing profile.
 *
 * Body: { name?: string, content?: string, isDefault?: boolean }
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateWriteRequest(
    request,
    "/api/profiles/[profileId]",
  );
  if (auth instanceof NextResponse) return auth;

  const { profileId } = await params;

  try {
    const body = await request.json();
    const { name, content, isDefault } = body as {
      name?: string;
      content?: string;
      isDefault?: boolean;
    };

    // Validate fields if provided
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        return secureJsonResponse(
          { error: "Bad Request", message: "Name cannot be empty" },
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
    }

    if (content !== undefined) {
      if (typeof content !== "string" || content.trim().length === 0) {
        return secureJsonResponse(
          { error: "Bad Request", message: "Content cannot be empty" },
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
    }

    const updated = await updateProfile(auth.userId, profileId, {
      name: name ? sanitizeInput(name.trim()) : undefined,
      content: content ? content.trim() : undefined,
      isDefault: isDefault === undefined ? undefined : isDefault === true,
    });

    if (!updated) {
      return secureJsonResponse(
        { error: "Not Found", message: "Profile not found" },
        404,
      );
    }

    return secureJsonResponse(updated);
  } catch (error) {
    console.error("Failed to update profile:", error);
    return secureJsonResponse(
      { error: "Internal Server Error", message: "Failed to update profile" },
      500,
    );
  }
}

/**
 * DELETE /api/profiles/[profileId]
 * Delete a profile.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateWriteRequest(
    request,
    "/api/profiles/[profileId]",
  );
  if (auth instanceof NextResponse) return auth;

  const { profileId } = await params;

  try {
    const deleted = await deleteProfile(auth.userId, profileId);

    if (!deleted) {
      return secureJsonResponse(
        { error: "Not Found", message: "Profile not found" },
        404,
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete profile:", error);
    return secureJsonResponse(
      { error: "Internal Server Error", message: "Failed to delete profile" },
      500,
    );
  }
}
