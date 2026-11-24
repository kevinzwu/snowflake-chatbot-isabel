/**
 * SSE stream parser for Snowflake Cortex Agent responses.
 *
 * Consumes a fetch Response (SSE stream) and collects the full response
 * into a structured result suitable for assertions.
 */

export interface ParsedAgentResponse {
  /** Accumulated response text from response.text.delta events */
  text: string;
  /** Accumulated thinking text from response.thinking.delta events */
  thinking: string;
  /** Tools that were invoked (by name) */
  toolsUsed: string[];
  /** Whether a result_set (tabular data) was returned */
  hasTable: boolean;
  /** Whether a chart was returned */
  hasChart: boolean;
  /** Raw tool results for deeper inspection */
  toolResults: unknown[];
  /** Whether the stream completed successfully (received [DONE]) */
  completed: boolean;
  /** Error message if the stream errored */
  error?: string;
}

/**
 * Parse an SSE stream from the Snowflake Cortex Agent API.
 */
export async function parseAgentSSEStream(
  response: Response,
): Promise<ParsedAgentResponse> {
  const result: ParsedAgentResponse = {
    text: "",
    thinking: "",
    toolsUsed: [],
    hasTable: false,
    hasChart: false,
    toolResults: [],
    completed: false,
  };

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    result.error = `HTTP ${response.status}: ${errorBody}`;
    return result;
  }

  const body = response.body;
  if (!body) {
    result.error = "Response body is null";
    return result;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages (separated by double newline)
      const messages = buffer.split("\n\n");
      buffer = messages.pop() || "";

      for (const message of messages) {
        if (!message.trim()) continue;

        let eventType: string | undefined;
        let eventData: string | undefined;

        for (const line of message.split("\n")) {
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            eventData = line.slice(5).trim();
          }
        }

        if (!eventData) continue;

        if (eventData === "[DONE]" || eventType === "done") {
          result.completed = true;
          continue;
        }

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(eventData);
        } catch {
          continue;
        }

        // Check for error responses
        if (parsed.code) {
          result.error = String(parsed.message || parsed.code);
          continue;
        }

        switch (eventType) {
          case "response.thinking.delta": {
            result.thinking += String(parsed.text || "");
            break;
          }
          case "response.text.delta": {
            result.text += String(parsed.text || "");
            break;
          }
          case "response.tool_use": {
            const toolName = String(parsed.name || parsed.tool_name || "");
            if (toolName && !result.toolsUsed.includes(toolName)) {
              result.toolsUsed.push(toolName);
            }
            break;
          }
          case "response.tool_result": {
            result.toolResults.push(parsed);
            const content = parsed.content as
              Array<{ json?: { result_set?: unknown } }> | undefined;
            if (content?.[0]?.json?.result_set) {
              result.hasTable = true;
            }
            break;
          }
          case "response.chart": {
            result.hasChart = true;
            break;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return result;
}
