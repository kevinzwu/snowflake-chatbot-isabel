import { describe, expect, it } from "vitest";
import {
  AgentMessage,
  AgentMessageRole,
  AgentMessageTextContent,
} from "../../types";
import { buildStandardRequestParams } from "../buildStandardRequestParams";

describe("buildStandardRequestParams", () => {
  const defaultParams = {
    authToken: "test-token",
    messages: [
      {
        id: "msg-1",
        role: AgentMessageRole.USER,
        content: [{ type: "text" as const, text: "hello" }],
      },
    ] as AgentMessage[],
  };

  it("should build headers with JWT auth", () => {
    const { headers } = buildStandardRequestParams(defaultParams);

    expect(headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
      Authorization: "Bearer test-token",
    });
  });

  it("should build body with messages", () => {
    const { body } = buildStandardRequestParams(defaultParams);

    expect(body.messages).toEqual(defaultParams.messages);
    expect(body).not.toHaveProperty("model");
  });

  it("should include optional tools and toolResources when provided", () => {
    const tools = [
      { tool_spec: { type: "cortex_analyst_text_to_sql", name: "test" } },
    ];
    const toolResources = { test: { search_service: "svc" } };

    const { body } = buildStandardRequestParams({
      ...defaultParams,
      tools,
      toolResources,
    });

    expect(body.tools).toEqual(tools);
    expect(body.tool_resources).toEqual(toolResources);
  });

  it("should not include an input field in the body", () => {
    const { body } = buildStandardRequestParams(defaultParams);

    expect(body).not.toHaveProperty("input");
  });

  it("should NOT accept input as a parameter (compile-time check)", () => {
    // This test documents that the `input` field was intentionally removed
    // from AgentRequestBuildParams. If someone adds it back, they must also
    // update this test.
    const paramKeys = Object.keys(defaultParams);
    expect(paramKeys).not.toContain("input");
  });

  it("should pass through messages with file context already injected into text", () => {
    const messagesWithFileContext: AgentMessage[] = [
      {
        id: "msg-1",
        role: AgentMessageRole.USER,
        content: [
          {
            type: "text",
            text: "[Attached File: report.pdf, 5 pages, 9963 characters]\n---\nPage 1 content\n---\nsummarize this",
          },
        ],
      },
    ];

    const { body } = buildStandardRequestParams({
      ...defaultParams,
      messages: messagesWithFileContext,
    });

    expect(
      (body.messages[0].content[0] as AgentMessageTextContent).text,
    ).toContain("[Attached File: report.pdf");
    expect(
      (body.messages[0].content[0] as AgentMessageTextContent).text,
    ).toContain("summarize this");
  });
});
