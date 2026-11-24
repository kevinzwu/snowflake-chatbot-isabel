import { afterEach, describe, expect, it, vi } from "vitest";
import {
  demoFlagsSetInProduction,
  isDemoAllowed,
  isDevAuthEnabled,
  isMockSnowflakeEnabled,
} from "./demo";

describe("demo flags", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should allow demo mode outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isDemoAllowed()).toBe(true);
  });

  it("should not allow demo mode in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isDemoAllowed()).toBe(false);
  });

  it("should enable dev auth only when the flag is true and demo mode is allowed", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_AUTH", "true");
    expect(isDevAuthEnabled()).toBe(true);

    vi.stubEnv("DEV_AUTH", "false");
    expect(isDevAuthEnabled()).toBe(false);
  });

  it("should ignore DEV_AUTH and MOCK_SNOWFLAKE in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_AUTH", "true");
    vi.stubEnv("MOCK_SNOWFLAKE", "true");

    expect(isDevAuthEnabled()).toBe(false);
    expect(isMockSnowflakeEnabled()).toBe(false);
  });

  it("should list the demo flags that are set in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_AUTH", "true");
    vi.stubEnv("MOCK_SNOWFLAKE", "false");

    expect(demoFlagsSetInProduction()).toEqual(["DEV_AUTH"]);
  });

  it("should report no flags outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_AUTH", "true");

    expect(demoFlagsSetInProduction()).toEqual([]);
  });
});

describe("startup guardrail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("should exit with an error when a demo flag is set in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MOCK_SNOWFLAKE", "true");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../instrumentation-node")).rejects.toThrow(
      "process.exit",
    );

    expect(exit).toHaveBeenCalledWith(1);
    expect(error.mock.calls[0][0]).toContain("MOCK_SNOWFLAKE");
  });
});
