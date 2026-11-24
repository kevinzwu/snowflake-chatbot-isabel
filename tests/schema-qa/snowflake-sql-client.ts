/**
 * Direct Snowflake SQL client for schema-qa tests.
 *
 * Executes SQL statements via the Snowflake REST API (/api/v2/statements)
 * with JWT key-pair authentication. Supports parallel execution with a semaphore.
 */

import { generateUserJWT } from "@/lib/snowflake/jwt-generator";

export interface SqlResult {
  success: boolean;
  data?: unknown[][];
  error?: string;
  rowCount?: number;
}

export interface SqlQuery {
  id: string;
  sql: string;
}

interface SnowflakeConfig {
  snowflakeUrl: string;
  database: string;
  schema: string;
  warehouse: string;
  token: string;
}

let cachedConfig: SnowflakeConfig | null = null;

export function getConfig(): SnowflakeConfig {
  if (cachedConfig) return cachedConfig;

  const snowflakeUrl = process.env.SNOWFLAKE_URL;
  if (!snowflakeUrl) {
    throw new Error("SNOWFLAKE_URL is required");
  }

  const { token } = generateUserJWT({
    userId: "schema-qa-test",
    userEmail: "schema-qa@test.internal",
  });

  cachedConfig = {
    snowflakeUrl,
    database: process.env.SNOWFLAKE_DATABASE || "ISABEL_SAMPLE",
    schema: process.env.SNOWFLAKE_SCHEMA || "SECURITY",
    warehouse: process.env.SNOWFLAKE_WAREHOUSE || "ISABEL_WH",
    token,
  };

  return cachedConfig;
}

/**
 * Execute a single SQL statement against Snowflake.
 * Uses the fully-qualified warehouse in the query context.
 */
export async function executeSql(sql: string): Promise<SqlResult> {
  const config = getConfig();

  // For cross-database queries, we need to set the warehouse in the session
  // Using the Snowflake session parameter approach
  const response = await fetch(`${config.snowflakeUrl}/api/v2/statements`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${config.token}`,
      "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
    },
    body: JSON.stringify({
      statement: sql,
      timeout: 60,
      warehouse: config.warehouse,
      parameters: {
        QUERY_TAG: "schema-qa-test",
      },
    }),
  });

  const body = await response.json();

  // Handle async query (202 - query still running)
  if (response.status === 202 && body.statementHandle) {
    return await pollForResult(body.statementHandle, config);
  }

  if (!response.ok || body.status === "failed") {
    return {
      success: false,
      error: body.message || body.data?.error || `HTTP ${response.status}`,
    };
  }

  const data = body.data || [];
  return {
    success: true,
    data,
    rowCount: body.resultSetMetaData?.numRows ?? data.length,
  };
}

/**
 * Poll for async query result.
 */
async function pollForResult(
  statementHandle: string,
  config: SnowflakeConfig,
): Promise<SqlResult> {
  const maxAttempts = 30;
  const pollInterval = 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const response = await fetch(
      `${config.snowflakeUrl}/api/v2/statements/${statementHandle}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${config.token}`,
          "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
        },
      },
    );

    const body = await response.json();

    if (body.status === "failed") {
      return {
        success: false,
        error: body.message || "Query failed",
      };
    }

    if (response.status === 200 && body.status !== "running") {
      const data = body.data || [];
      return {
        success: true,
        data,
        rowCount: body.resultSetMetaData?.numRows ?? data.length,
      };
    }
  }

  return {
    success: false,
    error: `Query timed out after ${maxAttempts * pollInterval}ms (handle: ${statementHandle})`,
  };
}

/**
 * Execute multiple SQL queries in parallel with a concurrency limit.
 */
export async function executeParallel(
  queries: SqlQuery[],
  concurrency: number = 10,
): Promise<Map<string, SqlResult>> {
  const results = new Map<string, SqlResult>();
  let running = 0;
  let index = 0;

  return new Promise((resolve) => {
    function next(): void {
      if (index >= queries.length && running === 0) {
        resolve(results);
        return;
      }

      while (running < concurrency && index < queries.length) {
        const query = queries[index++];
        running++;

        executeSql(query.sql)
          .then((result) => {
            results.set(query.id, result);
          })
          .catch((err) => {
            results.set(query.id, {
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          })
          .finally(() => {
            running--;
            next();
          });
      }
    }

    next();
  });
}
