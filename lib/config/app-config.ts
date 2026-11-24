import { z } from "zod";
import type { MipLabelConfig } from "@/lib/sensitivity-label";

const required = z.string().trim().min(1, "is required");
const optional = z.string().trim().optional().default("");

const suggestedQueries = optional.transform((value, ctx) => {
  if (!value) return [];
  try {
    const parsed = z.array(z.string()).safeParse(JSON.parse(value));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through to the issue below
  }
  ctx.addIssue({ code: "custom", message: "must be a JSON array of strings" });
  return z.NEVER;
});

const envSchema = z.object({
  SNOWFLAKE_URL: z.url("must be an absolute URL"),
  SNOWFLAKE_DATABASE: required,
  SNOWFLAKE_SCHEMA: required,
  SNOWFLAKE_WAREHOUSE: required,
  AGENT_NAME: required,
  OPUS_AGENT_NAME: optional,
  HAIKU_AGENT_NAME: optional,
  SEMANTIC_MODEL_PATH: required,
  SEARCH_SERVICE_PATH: required,
  SUGGESTED_QUERIES: suggestedQueries,
  SUPPORT_URL: optional,
  NEXTAUTH_URL: z.url("must be an absolute URL"),
  MIP_LABEL_ID: optional,
  MIP_TENANT_ID: optional,
  MIP_LABEL_NAME: optional,
});

/** Keys stored in the <prefix>/<env>/app-config secret (NEXTAUTH_URL is a plain task env var). */
export const APP_CONFIG_SECRET_KEYS = Object.keys(envSchema.shape).filter(
  (key) => key !== "NEXTAUTH_URL",
);

/** Non-sensitive, environment-specific config. Safe to pass to client components. */
export interface AppConfig {
  snowflakeUrl: string;
  database: string;
  schema: string;
  warehouse: string;
  agentNames: { sonnet: string; opus: string; haiku: string };
  semanticModelPath: string;
  searchServicePath: string;
  supportUrl: string;
  suggestedQueries: string[];
  baseUrl: string;
  mipLabel: MipLabelConfig;
}

export class AppConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid app config: ${issues.join("; ")}`);
    this.name = "AppConfigError";
  }
}

/** Reads and validates app config from the server environment. Throws AppConfigError listing every bad key. */
export function getAppConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new AppConfigError(
      result.error.issues.map((issue) => {
        const key = String(issue.path[0]);
        return `${key} ${env[key] === undefined ? "is required" : issue.message}`;
      }),
    );
  }

  const e = result.data;
  const mipLabelName = e.MIP_LABEL_NAME || "Confidential";
  return {
    snowflakeUrl: e.SNOWFLAKE_URL.replace(/\/+$/, ""),
    database: e.SNOWFLAKE_DATABASE,
    schema: e.SNOWFLAKE_SCHEMA,
    warehouse: e.SNOWFLAKE_WAREHOUSE,
    agentNames: {
      sonnet: e.AGENT_NAME,
      opus: e.OPUS_AGENT_NAME,
      haiku: e.HAIKU_AGENT_NAME,
    },
    semanticModelPath: e.SEMANTIC_MODEL_PATH,
    searchServicePath: e.SEARCH_SERVICE_PATH,
    supportUrl: e.SUPPORT_URL,
    suggestedQueries: e.SUGGESTED_QUERIES,
    baseUrl: e.NEXTAUTH_URL.replace(/\/+$/, ""),
    mipLabel: {
      labelId: e.MIP_LABEL_ID,
      siteId: e.MIP_TENANT_ID,
      labelName: mipLabelName,
      enabled: e.MIP_LABEL_ID.length > 0 && e.MIP_TENANT_ID.length > 0,
    },
  };
}
