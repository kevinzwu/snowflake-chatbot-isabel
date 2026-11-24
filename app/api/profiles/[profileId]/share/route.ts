import { shareProfile, unshareProfile } from "@/lib/dynamodb";
import {
  authenticateWriteRequest,
  secureJsonResponse,
} from "@/lib/security/route-hardening";
import { NextRequest, NextResponse } from "next/server";

interface RouteParams {
  params: Promise<{ profileId: string }>;
}

/**
 * POST /api/profiles/[profileId]/share
 * Toggle sharing on a profile.
 *
 * Body: { shared: boolean }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateWriteRequest(
    request,
    "/api/profiles/[profileId]/share",
  );
  if (auth instanceof NextResponse) return auth;

  const { profileId } = await params;

  try {
    const body = await request.json();
    const { shared } = body as { shared: boolean };

    if (typeof shared !== "boolean") {
      return secureJsonResponse(
        { error: "Bad Request", message: "'shared' must be a boolean" },
        400,
      );
    }

    if (shared) {
      const shareToken = await shareProfile(auth.userId, profileId);
      if (!shareToken) {
        return secureJsonResponse(
          { error: "Not Found", message: "Profile not found" },
          404,
        );
      }
      return secureJsonResponse({ shareToken });
    } else {
      const success = await unshareProfile(auth.userId, profileId);
      if (!success) {
        return secureJsonResponse(
          { error: "Not Found", message: "Profile not found" },
          404,
        );
      }
      return secureJsonResponse({ shared: false });
    }
  } catch (error) {
    console.error("Failed to toggle profile sharing:", error);
    return secureJsonResponse(
      {
        error: "Internal Server Error",
        message: "Failed to toggle profile sharing",
      },
      500,
    );
  }
}
