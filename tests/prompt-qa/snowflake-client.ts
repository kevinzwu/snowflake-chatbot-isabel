/**
 * Snowflake Cortex Agent client for prompt QA tests.
 *
 * Generates a JWT locally (using the same RSA key-pair auth as the app)
 * and sends prompts directly to the Snowflake Cortex Agent API.
 */

import { generateUserJWT } from "@/lib/snowflake/jwt-generator";

export interface AgentClientConfig {
  snowflakeUrl: string;
  database: string;
  schema: string;
  agentName: string;
  semanticModelPath: string;
  searchServicePath: string;
  warehouse: string;
}

/**
 * Build config from environment variables (same as app uses).
 */
export function getAgentConfig(): AgentClientConfig {
  const snowflakeUrl = process.env.SNOWFLAKE_URL;
  if (!snowflakeUrl) {
    throw new Error(
      "SNOWFLAKE_URL is required. Set it in .env.local or environment.",
    );
  }

  return {
    snowflakeUrl,
    database: process.env.SNOWFLAKE_DATABASE || "ISABEL_SAMPLE",
    schema: process.env.SNOWFLAKE_SCHEMA || "SECURITY",
    agentName: process.env.AGENT_NAME || "ISABEL",
    semanticModelPath:
      process.env.SEMANTIC_MODEL_PATH ||
      "@ISABEL_SAMPLE.SECURITY.MODELS/semantic_model.yaml",
    searchServicePath:
      process.env.SEARCH_SERVICE_PATH ||
      "ISABEL_SAMPLE.SECURITY.VULNERABILITY_CATALOG_SEARCH",
    warehouse: process.env.SNOWFLAKE_WAREHOUSE || "ISABEL_WH",
  };
}

/**
 * Generate a fresh Snowflake JWT for test use.
 */
export function getTestJWT(): string {
  const { token } = generateUserJWT({
    userId: "prompt-qa-test",
    userEmail: "prompt-qa@test.internal",
  });
  return token;
}

/**
 * Send a prompt to the Cortex Agent and return the raw SSE Response.
 */
export async function sendPrompt(
  prompt: string,
  config: AgentClientConfig,
  token: string,
): Promise<Response> {
  const url = `${config.snowflakeUrl}/api/v2/databases/${config.database}/schemas/${config.schema}/agents/${config.agentName}:run`;

  const body = {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: prompt }],
      },
    ],
    tools: [
      {
        tool_spec: {
          type: "cortex_analyst_text_to_sql",
          name: "analyst1",
        },
      },
      {
        tool_spec: {
          type: "cortex_search",
          name: "search1",
        },
      },
    ],
    tool_resources: {
      analyst1: {
        semantic_model_file: config.semanticModelPath,
        execution_environment: {
          type: "warehouse",
          warehouse: config.warehouse,
          query_timeout: 60,
        },
      },
      search1: {
        name: config.searchServicePath,
        max_results: 10,
      },
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  return response;
}
