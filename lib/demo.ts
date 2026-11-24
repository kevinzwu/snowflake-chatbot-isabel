/**
 * Demo mode lets the app run with no Azure AD and no Snowflake account:
 *   - DEV_AUTH=true       replaces Azure AD with a "Dev Login" button
 *   - MOCK_SNOWFLAKE=true serves canned agent responses from /api/mock-snowflake
 *
 * Both flags are ignored when NODE_ENV is "production", and startup fails if
 * either is set there, so a demo setting can never weaken a real deployment.
 */

/** The group every dev-login user belongs to (see .env.demo.example). */
export const DEV_USER_GROUP = "local-dev";

export function isDemoAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function isDevAuthEnabled(): boolean {
  return isDemoAllowed() && process.env.DEV_AUTH === "true";
}

export function isMockSnowflakeEnabled(): boolean {
  return isDemoAllowed() && process.env.MOCK_SNOWFLAKE === "true";
}

/** Demo flags that are set while NODE_ENV is "production". Empty means safe. */
export function demoFlagsSetInProduction(): string[] {
  if (isDemoAllowed()) return [];
  return ["DEV_AUTH", "MOCK_SNOWFLAKE"].filter(
    (flag) => process.env[flag] === "true",
  );
}
