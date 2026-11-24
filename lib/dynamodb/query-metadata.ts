import type { AgentMessage } from "@/lib/agent-api/types";

/** Maximum SQL length to include in log entries */
const MAX_SQL_LENGTH = 500;

/**
 * Per-query metadata extracted from a conversation's messages array.
 * Used for structured CloudWatch logging at conversation save time.
 */
export interface QueryMetadata {
  /** Full text of the last user message */
  queryText: string | null;
  /** Deduplicated list of tool names invoked in the assistant response */
  toolsInvoked: string[];
  /** First SQL statement found in tool results (truncated to 500 chars), or null */
  sqlGenerated: string | null;
}

/**
 * Extract per-query metadata from the most recent user→assistant exchange
 * in a conversation messages array.
 *
 * Scans backwards to find the last user message, then extracts:
 * - The user's query text (concatenated from all text-type content blocks)
 * - Tool names from the subsequent assistant response's tool_use blocks
 * - The first SQL statement from tool_results content
 */
export function extractQueryMetadata(messages: AgentMessage[]): QueryMetadata {
  const result: QueryMetadata = {
    queryText: null,
    toolsInvoked: [],
    sqlGenerated: null,
  };

  if (!messages || messages.length === 0) {
    return result;
  }

  // Find the last user message (scan backwards)
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }

  if (lastUserIndex === -1) {
    return result;
  }

  // Extract query text from the last user message
  const userMessage = messages[lastUserIndex];
  const textParts: string[] = [];
  for (const block of userMessage.content) {
    if (
      "text" in block &&
      typeof block.text === "string" &&
      block.type === "text"
    ) {
      textParts.push(block.text);
    }
  }
  result.queryText = textParts.length > 0 ? textParts.join("\n") : null;

  // Find the assistant response following the last user message
  const toolNames = new Set<string>();
  for (let i = lastUserIndex + 1; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;

    for (const block of msg.content) {
      // Extract tool names from tool_use blocks
      if ("tool_use" in block && block.tool_use?.name) {
        toolNames.add(block.tool_use.name);
      }

      // Extract SQL from tool_results blocks
      if ("tool_results" in block && block.tool_results?.content) {
        for (const item of block.tool_results.content) {
          if (item?.json?.sql && !result.sqlGenerated) {
            const sql = String(item.json.sql);
            result.sqlGenerated =
              sql.length > MAX_SQL_LENGTH ? sql.slice(0, MAX_SQL_LENGTH) : sql;
          }
        }
      }
    }
  }

  result.toolsInvoked = Array.from(toolNames);

  return result;
}
