import { getProfileByShareToken } from "@/lib/dynamodb";
import {
  authenticateReadRequest,
  secureJsonResponse,
} from "@/lib/security/route-hardening";
import { NextResponse } from "next/server";

interface RouteParams {
  params: Promise<{ shareToken: string }>;
}

/**
 * GET /api/profiles/shared/[shareToken]
 * View a shared profile's public details (name and content only).
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const auth = await authenticateReadRequest("/api/profiles/shared");
  if (auth instanceof NextResponse) return auth;

  const { shareToken } = await params;

  try {
    const profile = await getProfileByShareToken(shareToken);

    if (!profile) {
      return secureJsonResponse(
        { error: "Not Found", message: "Shared profile not found" },
        404,
      );
    }

    // Return only public-safe fields (no userId)
    return secureJsonResponse({
      profileId: profile.profileId,
      name: profile.name,
      content: profile.content,
    });
  } catch (error) {
    console.error("Failed to get shared profile:", error);
    return secureJsonResponse(
      {
        error: "Internal Server Error",
        message: "Failed to get shared profile",
      },
      500,
    );
  }
}
