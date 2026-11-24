import { getConversationStorageStatus } from "@/lib/dynamodb";
import { NextResponse } from "next/server";

export async function GET() {
  // Cheap (no network call) config check — surfaces a missing
  // CONVERSATION_S3_BUCKET immediately instead of only discovering it when a
  // user's large conversation silently fails to save. Deliberately does NOT
  // affect the top-level "healthy" status or HTTP code: this endpoint backs
  // the ALB/ECS liveness check (deploy/aws/app/variables.tf
  // alb_health_check_path), and a storage misconfiguration should not cause
  // otherwise-healthy tasks to be killed/restarted.
  const conversationStorage = getConversationStorageStatus();
  if (!conversationStorage.configured) {
    console.error(
      JSON.stringify({
        event: "conversation_storage_misconfigured",
        message:
          "CONVERSATION_S3_BUCKET is not set — large conversation saves will fail",
        timestamp: new Date().toISOString(),
      }),
    );
  }

  return NextResponse.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "isabel",
    checks: {
      conversationStorage: conversationStorage.configured
        ? "ok"
        : "misconfigured",
    },
  });
}
