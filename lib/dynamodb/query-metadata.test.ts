import { AgentMessage, AgentMessageRole } from "@/lib/agent-api/types";
import { describe, expect, it } from "vitest";
import { extractQueryMetadata } from "./query-metadata";

function makeUserMessage(text: string, id = "u1"): AgentMessage {
  return {
    id,
    role: AgentMessageRole.USER,
    content: [{ type: "text", text }],
  };
}

function makeAssistantMessage(
  content: AgentMessage["content"],
  id = "a1",
): AgentMessage {
  return { id, role: AgentMessageRole.ASSISTANT, content };
}

describe("extractQueryMetadata", () => {
  it("should return nulls for empty messages", () => {
    const result = extractQueryMetadata([]);
    expect(result).toEqual({
      queryText: null,
      toolsInvoked: [],
      sqlGenerated: null,
    });
  });

  it("should extract query text from a single user message", () => {
    const messages = [makeUserMessage("How many critical vulns?")];
    const result = extractQueryMetadata(messages);
    expect(result.queryText).toBe("How many critical vulns?");
    expect(result.toolsInvoked).toEqual([]);
    expect(result.sqlGenerated).toBeNull();
  });

  it("should extract the LAST user query in a multi-turn conversation", () => {
    const messages: AgentMessage[] = [
      makeUserMessage("First question", "u1"),
      makeAssistantMessage([{ type: "text", text: "First answer" }], "a1"),
      makeUserMessage("Second question", "u2"),
      makeAssistantMessage([{ type: "text", text: "Second answer" }], "a2"),
    ];
    const result = extractQueryMetadata(messages);
    expect(result.queryText).toBe("Second question");
  });

  it("should concatenate multiple text blocks in a user message", () => {
    const messages: AgentMessage[] = [
      {
        id: "u1",
        role: AgentMessageRole.USER,
        content: [
          { type: "text", text: "Part one" },
          { type: "text", text: "Part two" },
        ],
      },
    ];
    const result = extractQueryMetadata(messages);
    expect(result.queryText).toBe("Part one\nPart two");
  });

  it("should extract tool names from assistant tool_use blocks", () => {
    const messages: AgentMessage[] = [
      makeUserMessage("Show me vulns"),
      makeAssistantMessage([
        { type: "tool_use", tool_use: { name: "analyst1", input: {} } },
        { type: "tool_results", tool_results: { content: [] } },
        { type: "text", text: "Here are the results" },
      ]),
    ];
    const result = extractQueryMetadata(messages);
    expect(result.toolsInvoked).toEqual(["analyst1"]);
  });

  it("should deduplicate tool names", () => {
    const messages: AgentMessage[] = [
      makeUserMessage("Complex query"),
      makeAssistantMessage([
        { type: "tool_use", tool_use: { name: "analyst1", input: {} } },
        { type: "tool_results", tool_results: { content: [] } },
        { type: "tool_use", tool_use: { name: "analyst1", input: {} } },
        { type: "tool_results", tool_results: { content: [] } },
        { type: "tool_use", tool_use: { name: "search1", input: {} } },
        { type: "tool_results", tool_results: { content: [] } },
      ]),
    ];
    const result = extractQueryMetadata(messages);
    expect(result.toolsInvoked).toEqual(
      expect.arrayContaining(["analyst1", "search1"]),
    );
    expect(result.toolsInvoked).toHaveLength(2);
  });

  it("should extract SQL from tool_results content", () => {
    const messages: AgentMessage[] = [
      makeUserMessage("Count vulns"),
      makeAssistantMessage([
        { type: "tool_use", tool_use: { name: "analyst1", input: {} } },
        {
          type: "tool_results",
          tool_results: {
            content: [
              {
                json: {
                  sql: "SELECT COUNT(*) FROM VULNERABILITIES WHERE SEVERITY = 'Critical'",
                  result_set: { data: [[42]], columns: ["count"] },
                },
              },
            ],
          },
        },
      ]),
    ];
    const result = extractQueryMetadata(messages);
    expect(result.sqlGenerated).toBe(
      "SELECT COUNT(*) FROM VULNERABILITIES WHERE SEVERITY = 'Critical'",
    );
  });

  it("should return null sqlGenerated when no SQL in tool_results", () => {
    const messages: AgentMessage[] = [
      makeUserMessage("Search for XSS"),
      makeAssistantMessage([
        { type: "tool_use", tool_use: { name: "search1", input: {} } },
        {
          type: "tool_results",
          tool_results: {
            content: [{ json: { text: "Some search result" } }],
          },
        },
      ]),
    ];
    const result = extractQueryMetadata(messages);
    expect(result.sqlGenerated).toBeNull();
  });

  it("should truncate SQL to 500 characters", () => {
    const longSql = "SELECT " + "a, ".repeat(200) + "b FROM T";
    expect(longSql.length).toBeGreaterThan(500);

    const messages: AgentMessage[] = [
      makeUserMessage("Wide query"),
      makeAssistantMessage([
        {
          type: "tool_results",
          tool_results: {
            content: [{ json: { sql: longSql } }],
          },
        },
      ]),
    ];
    const result = extractQueryMetadata(messages);
    expect(result.sqlGenerated).toHaveLength(500);
    expect(result.sqlGenerated).toBe(longSql.slice(0, 500));
  });

  it("should return only the first SQL when multiple tool_results have SQL", () => {
    const messages: AgentMessage[] = [
      makeUserMessage("Multi-SQL"),
      makeAssistantMessage([
        {
          type: "tool_results",
          tool_results: {
            content: [{ json: { sql: "SELECT 1" } }],
          },
        },
        {
          type: "tool_results",
          tool_results: {
            content: [{ json: { sql: "SELECT 2" } }],
          },
        },
      ]),
    ];
    const result = extractQueryMetadata(messages);
    expect(result.sqlGenerated).toBe("SELECT 1");
  });

  it("should handle user message with no assistant response", () => {
    const messages: AgentMessage[] = [
      makeUserMessage("First Q", "u1"),
      makeAssistantMessage([{ type: "text", text: "Answer" }], "a1"),
      makeUserMessage("Second Q with no response yet", "u2"),
    ];
    const result = extractQueryMetadata(messages);
    expect(result.queryText).toBe("Second Q with no response yet");
    expect(result.toolsInvoked).toEqual([]);
    expect(result.sqlGenerated).toBeNull();
  });
});
