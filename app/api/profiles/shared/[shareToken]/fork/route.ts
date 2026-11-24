import { forkProfile } from "@/lib/dynamodb";
import {
  authenticateWriteRequest,
  secureJsonResponse,
} from "@/lib/security/route-hardening";
import { NextRequest, NextResponse } from "next/server";

interface RouteParams {
  params: Promise<{ shareToken: string }>;
}

/**
 * POST /api/profiles/shared/[shareToken]/fork
 * Fork a shared profile into the authenticated user's collection.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateWriteRequest(
    request,
    "/api/profiles/shared/[shareToken]/fork",
  );
  if (auth instanceof NextResponse) return auth;

  const { shareToken } = await params;

  try {
    const profile = await forkProfile(auth.userId, shareToken);
    return secureJsonResponse(profile, 201);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("not found")) {
        return secureJsonResponse(
          { error: "Not Found", message: "Shared profile not found" },
          404,
        );
      }
      if (error.message.includes("limit")) {
        return secureJsonResponse(
          { error: "Conflict", message: error.message },
          409,
        );
      }
    }
    console.error("Failed to fork profile:", error);
    return secureJsonResponse(
      { error: "Internal Server Error", message: "Failed to fork profile" },
      500,
    );
  }
}
