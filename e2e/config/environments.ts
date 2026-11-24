/**
 * Environment configuration for E2E tests.
 * Controls base URLs and auth strategies per deployment target.
 */

export type Environment = "local" | "staging" | "production";

interface EnvironmentConfig {
  baseURL: string;
  /** Whether full mutation tests are allowed (false for production) */
  allowMutations: boolean;
  /** Whether Snowflake-dependent integration tests should run */
  hasSnowflake: boolean;
}

const ENVIRONMENTS: Record<Environment, EnvironmentConfig> = {
  local: {
    baseURL: "http://localhost:3000",
    allowMutations: true,
    hasSnowflake: false,
  },
  staging: {
    baseURL: "https://staging.isabel.example.com",
    allowMutations: true,
    hasSnowflake: true,
  },
  production: {
    baseURL: "https://isabel.example.com",
    allowMutations: false,
    hasSnowflake: true,
  },
};

export function getEnvironment(): Environment {
  const envName = process.env.E2E_ENVIRONMENT;
  if (envName && envName in ENVIRONMENTS) {
    return envName as Environment;
  }

  // Infer from E2E_BASE_URL
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  for (const [name, config] of Object.entries(ENVIRONMENTS)) {
    if (baseURL === config.baseURL) {
      return name as Environment;
    }
  }

  return "local";
}

export function getEnvironmentConfig(): EnvironmentConfig {
  return ENVIRONMENTS[getEnvironment()];
}

export { ENVIRONMENTS };
