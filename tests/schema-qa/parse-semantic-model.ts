/**
 * Parse the semantic model YAML and extract table/column/relationship definitions.
 */

import fs from "fs";
import path from "path";
import { parse } from "yaml";

export interface ExpressionDef {
  name: string;
  expr: string;
}

export interface TableDef {
  name: string;
  database: string;
  schema: string;
  table: string;
  fqn: string;
  expressions: ExpressionDef[];
}

export interface RelationshipDef {
  name: string;
  leftTable: string;
  leftTableFqn: string;
  rightTable: string;
  rightTableFqn: string;
  columns: {
    leftColumn: string;
    leftExpr: string;
    rightColumn: string;
    rightExpr: string;
  }[];
  joinType: string;
}

export interface SemanticModel {
  tables: TableDef[];
  relationships: RelationshipDef[];
}

/**
 * Parse the semantic model YAML from the workspace root.
 */
export function parseSemanticModel(filePath?: string): SemanticModel {
  const yamlPath =
    filePath || path.resolve(process.cwd(), "examples/semantic_model.yaml");
  const content = fs.readFileSync(yamlPath, "utf-8");
  const doc = parse(content) as Record<string, unknown>;

  const tables = extractTables(doc);
  const tableMap = new Map(tables.map((t) => [t.name, t]));
  const relationships = extractRelationships(doc, tableMap);

  return { tables, relationships };
}

function extractTables(doc: Record<string, unknown>): TableDef[] {
  const rawTables = doc.tables as Array<Record<string, unknown>>;
  if (!rawTables) return [];

  return rawTables.map((t) => {
    const baseTable = t.base_table as Record<string, string>;
    const database = baseTable.database;
    const schema = baseTable.schema;
    const table = baseTable.table;
    const fqn = `${database}.${schema}.${table}`;

    const expressions: ExpressionDef[] = [];

    // Extract from dimensions, facts, time_dimensions
    for (const section of ["dimensions", "facts", "time_dimensions"]) {
      const fields = t[section] as Array<Record<string, unknown>> | undefined;
      if (!fields) continue;

      for (const field of fields) {
        if (field.expr) {
          expressions.push({
            name: field.name as string,
            expr: field.expr as string,
          });
        }
      }
    }

    return {
      name: t.name as string,
      database,
      schema,
      table,
      fqn,
      expressions,
    };
  });
}

function extractRelationships(
  doc: Record<string, unknown>,
  tableMap: Map<string, TableDef>,
): RelationshipDef[] {
  const rawRels = doc.relationships as Array<Record<string, unknown>>;
  if (!rawRels) return [];

  return rawRels.map((r) => {
    const leftTableName = r.left_table as string;
    const rightTableName = r.right_table as string;
    const leftDef = tableMap.get(leftTableName);
    const rightDef = tableMap.get(rightTableName);

    const columns = (
      r.relationship_columns as Array<Record<string, string>>
    ).map((c) => ({
      leftColumn: c.left_column,
      leftExpr: resolveColumnExpr(leftDef, c.left_column),
      rightColumn: c.right_column,
      rightExpr: resolveColumnExpr(rightDef, c.right_column),
    }));

    return {
      name: r.name as string,
      leftTable: leftTableName,
      leftTableFqn: leftDef?.fqn || `UNKNOWN.UNKNOWN.${leftTableName}`,
      rightTable: rightTableName,
      rightTableFqn: rightDef?.fqn || `UNKNOWN.UNKNOWN.${rightTableName}`,
      columns,
      joinType: (r.join_type as string) || "left_outer",
    };
  });
}

/**
 * Resolve a semantic model column name to its physical expr.
 * The relationship_columns reference dimension NAMES, but we need
 * the physical expr for SQL (e.g., "APPLICATIONID" → "CAST(APP_ID AS VARCHAR)").
 */
function resolveColumnExpr(
  tableDef: TableDef | undefined,
  columnName: string,
): string {
  if (!tableDef) return columnName;

  const match = tableDef.expressions.find((e) => e.name === columnName);
  if (match) return match.expr;

  // Fallback: use the column name as-is (it might be a physical column)
  return columnName;
}
