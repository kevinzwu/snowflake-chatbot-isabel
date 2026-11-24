import { isMockSnowflakeEnabled } from "@/lib/demo";
import { mockAgentStream } from "@/lib/demo/mock-agent-stream";
import { NextRequest, NextResponse } from "next/server";

/**
 * Stand-in for the Snowflake REST API in demo mode (MOCK_SNOWFLAKE=true).
 * Point SNOWFLAKE_URL at <app>/api/mock-snowflake. An agent ":run" call gets a
 * canned SSE stream; every other call (feedback, for example) gets "{}".
 * Returns 404 unless demo mode is enabled and NODE_ENV is not production.
 */
async function handle(request: NextRequest): Promise<Response> {
  if (!isMockSnowflakeEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (request.nextUrl.pathname.endsWith(":run")) {
    return new Response(mockAgentStream(), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  return NextResponse.json({});
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
