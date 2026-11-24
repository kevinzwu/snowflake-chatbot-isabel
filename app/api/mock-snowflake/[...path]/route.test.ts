import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const RUN_URL =
  "http://localhost:3000/api/mock-snowflake/api/v2/databases/D/schemas/S/agents/ISABEL:run";
const FEEDBACK_URL =
  "http://localhost:3000/api/mock-snowflake/api/v2/databases/D/schemas/S/agents/ISABEL:feedback";

describe("/api/mock-snowflake", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should return 404 when MOCK_SNOWFLAKE is not enabled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MOCK_SNOWFLAKE", "");

    const response = await POST(new NextRequest(RUN_URL, { method: "POST" }));

    expect(response.status).toBe(404);
  });

  it("should return 404 in production even when MOCK_SNOWFLAKE is true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MOCK_SNOWFLAKE", "true");

    const response = await POST(new NextRequest(RUN_URL, { method: "POST" }));

    expect(response.status).toBe(404);
  });

  it("should stream server-sent events for an agent run", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MOCK_SNOWFLAKE", "true");

    const response = await POST(new NextRequest(RUN_URL, { method: "POST" }));
    const reader = response.body!.getReader();
    const first = await reader.read();
    await reader.cancel();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(new TextDecoder().decode(first.value)).toContain(
      "event: response.status",
    );
  });

  it("should return an empty object for other paths", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MOCK_SNOWFLAKE", "true");

    const response = await GET(new NextRequest(FEEDBACK_URL));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });
});
