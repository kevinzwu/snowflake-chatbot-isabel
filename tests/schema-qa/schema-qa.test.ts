/**
 * Schema QA Tests — Validates the semantic model YAML against live Snowflake.
 *
 * Three validation layers:
 *   1. Table existence — every table in YAML exists in Snowflake
 *   2. Column expressions — every expr field is valid SQL
 *   3. Relationships — FK joins resolve with data
 *   4. Fixtures — known records exist
 *
 * Prerequisites:
 *   - SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_RSA_KEY env vars set
 *   - SNOWFLAKE_URL env var set
 *   - Network access to Snowflake
 *
 * Run:
 *   npm run test:schema-qa
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fixtures from "./fixtures.json";
import { parseSemanticModel, SemanticModel } from "./parse-semantic-model";
import {
  executeParallel,
  getConfig,
  SqlQuery,
  SqlResult,
} from "./snowflake-sql-client";

/**
 * Prefix an expression with a table alias.
 * Simple columns: "NAME" → "l.NAME", '"sys_id"' → 'l."sys_id"'
 * Complex expressions (CAST, CASE, functions): replace bare column refs with aliased ones.
 */
const SQL_KEYWORDS = new Set([
  "AS",
  "VARCHAR",
  "INT",
  "INTEGER",
  "NUMBER",
  "FLOAT",
  "BOOLEAN",
  "DATE",
  "TIMESTAMP",
  "STRING",
  "CAST",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "NULL",
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS",
  "LIKE",
  "BETWEEN",
  "TRUE",
  "FALSE",
  "SELECT",
  "FROM",
  "WHERE",
  "LIMIT",
  "JOIN",
  "ON",
  "LEFT",
  "RIGHT",
  "OUTER",
]);

function prefixWithAlias(alias: string, expr: string): string {
  // Simple column name (bare word, possibly quoted)
  if (/^"?[A-Za-z_][A-Za-z0-9_]*"?$/.test(expr)) {
    return `${alias}.${expr}`;
  }
  // Complex expression — only prefix words that look like column names (not SQL keywords)
  return expr.replace(/\b([A-Z_][A-Z0-9_]*)\b(?!\s*\()/g, (match) => {
    if (SQL_KEYWORDS.has(match)) return match;
    return `${alias}.${match}`;
  });
}

let model: SemanticModel;

const summary = {
  tablesTotal: 0,
  tablesPassed: 0,
  columnsTotal: 0,
  columnsPassed: 0,
  relationshipsTotal: 0,
  relationshipsPassed: 0,
  fixturesTotal: 0,
  fixturesPassed: 0,
  startTime: 0,
};

beforeAll(() => {
  const requiredEnvVars = [
    "SNOWFLAKE_ACCOUNT",
    "SNOWFLAKE_USER",
    "SNOWFLAKE_RSA_KEY",
    "SNOWFLAKE_URL",
  ];
  const missing = requiredEnvVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  // Verify we can build config (generates JWT)
  getConfig();

  model = parseSemanticModel();
  summary.startTime = Date.now();
});

afterAll(() => {
  const duration = ((Date.now() - summary.startTime) / 1000).toFixed(1);
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║              SCHEMA QA RESULTS SUMMARY                    ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(
    `║  Tables:        ${summary.tablesPassed}/${summary.tablesTotal} passed`,
  );
  console.log(
    `║  Columns:       ${summary.columnsPassed}/${summary.columnsTotal} passed`,
  );
  console.log(
    `║  Relationships: ${summary.relationshipsPassed}/${summary.relationshipsTotal} passed`,
  );
  console.log(
    `║  Fixtures:      ${summary.fixturesPassed}/${summary.fixturesTotal} passed`,
  );
  console.log(`║  Duration:      ${duration}s`);
  console.log("╚══════════════════════════════════════════════════════════╝\n");
});

describe("Layer 1: Table Existence", () => {
  let results: Map<string, SqlResult>;

  beforeAll(async () => {
    const queries: SqlQuery[] = model.tables.map((t) => ({
      id: t.name,
      sql: `SELECT 1 FROM ${t.fqn} LIMIT 1`,
    }));

    summary.tablesTotal = queries.length;
    results = await executeParallel(queries, 10);
  });

  it("all tables exist in Snowflake", () => {
    const failures: string[] = [];

    for (const table of model.tables) {
      const result = results.get(table.name);
      if (!result?.success) {
        failures.push(
          `${table.name} (${table.fqn}): ${result?.error || "no result"}`,
        );
      } else {
        summary.tablesPassed++;
      }
    }

    if (failures.length > 0) {
      expect.fail(
        `${failures.length} table(s) not found:\n  ${failures.join("\n  ")}`,
      );
    }
  });
});

describe("Layer 2: Column Expressions", () => {
  let results: Map<string, SqlResult>;

  beforeAll(async () => {
    const queries: SqlQuery[] = model.tables
      .filter((t) => t.expressions.length > 0)
      .map((t) => {
        const selectCols = t.expressions
          .map((e, i) => `${e.expr} AS col_${i}`)
          .join(", ");
        return {
          id: t.name,
          sql: `SELECT ${selectCols} FROM ${t.fqn} LIMIT 1`,
        };
      });

    summary.columnsTotal = queries.length;
    results = await executeParallel(queries, 10);
  });

  it("all column expressions are valid SQL", () => {
    const failures: string[] = [];

    for (const table of model.tables) {
      if (table.expressions.length === 0) continue;

      const result = results.get(table.name);
      if (!result?.success) {
        failures.push(
          `${table.name} (${table.fqn}): ${result?.error || "no result"}`,
        );
      } else {
        summary.columnsPassed++;
      }
    }

    if (failures.length > 0) {
      expect.fail(
        `${failures.length} table(s) have invalid column expressions:\n  ${failures.join("\n  ")}`,
      );
    }
  });
});

describe("Layer 3: Relationships", () => {
  let results: Map<string, SqlResult>;

  beforeAll(async () => {
    const queries: SqlQuery[] = model.relationships.map((r) => {
      const joinConditions = r.columns
        .map((c) => {
          const leftExpr = prefixWithAlias("l", c.leftExpr);
          const rightExpr = prefixWithAlias("r", c.rightExpr);
          return `${leftExpr} = ${rightExpr}`;
        })
        .join(" AND ");

      return {
        id: r.name,
        sql: `SELECT 1 FROM ${r.leftTableFqn} l JOIN ${r.rightTableFqn} r ON ${joinConditions} LIMIT 1`,
      };
    });

    summary.relationshipsTotal = queries.length;
    results = await executeParallel(queries, 10);
  });

  it("all relationships resolve with matching data", () => {
    const failures: string[] = [];

    for (const rel of model.relationships) {
      const result = results.get(rel.name);
      if (!result?.success) {
        failures.push(
          `${rel.name} (${rel.leftTable}.${rel.columns[0]?.leftColumn} → ${rel.rightTable}.${rel.columns[0]?.rightColumn}): ${result?.error || "no result"}`,
        );
      } else if (result.rowCount === 0 && rel.joinType !== "left_outer") {
        // left_outer joins may legitimately have 0 matching rows
        failures.push(
          `${rel.name}: JOIN returned 0 rows — FK values don't match (${rel.leftTable} → ${rel.rightTable})`,
        );
      } else {
        summary.relationshipsPassed++;
      }
    }

    if (failures.length > 0) {
      expect.fail(
        `${failures.length} relationship(s) broken:\n  ${failures.join("\n  ")}`,
      );
    }
  });
});

describe("Layer 4: Data Fixtures", () => {
  let results: Map<string, SqlResult>;

  beforeAll(async () => {
    const fixtureEntries = Object.entries(
      fixtures as Record<string, { column: string; value: string }>,
    );

    const queries: SqlQuery[] = fixtureEntries
      .map(([tableName, fixture]) => {
        const tableDef = model.tables.find((t) => t.name === tableName);
        if (!tableDef) return null;

        // Handle numeric columns (no quotes around value)
        const isNumeric = /^\d+$/.test(fixture.value);
        const valueExpr = isNumeric
          ? fixture.value
          : `'${fixture.value.replace(/'/g, "''")}'`;

        return {
          id: tableName,
          sql: `SELECT 1 FROM ${tableDef.fqn} WHERE ${fixture.column} = ${valueExpr} LIMIT 1`,
        };
      })
      .filter(Boolean) as SqlQuery[];

    summary.fixturesTotal = queries.length;
    results = await executeParallel(queries, 10);
  });

  it("all fixture records exist", () => {
    const failures: string[] = [];
    const fixtureEntries = Object.entries(
      fixtures as Record<string, { column: string; value: string }>,
    );

    for (const [tableName, fixture] of fixtureEntries) {
      const result = results.get(tableName);
      if (!result?.success) {
        failures.push(
          `${tableName}: query failed — ${result?.error || "no result"}`,
        );
      } else if (result.rowCount === 0) {
        failures.push(
          `${tableName}: fixture record not found (${fixture.column} = '${fixture.value}')`,
        );
      } else {
        summary.fixturesPassed++;
      }
    }

    if (failures.length > 0) {
      expect.fail(
        `${failures.length} fixture(s) missing:\n  ${failures.join("\n  ")}`,
      );
    }
  });
});
