import { describe, expect, it } from "vitest";
import {
  AgentMessage,
  AgentMessageRole,
  AgentMessageTextContent,
  FileAttachmentMeta,
} from "../../types";
import { assembleAgentInput } from "../assembleAgentInput";

/**
 * Tests for the file context injection pattern used in useAgentAPIQuery.
 * This replicates the inline logic that:
 * 1. Assembles agent input (file context + user text)
 * 2. Injects it into the last user message of the API-bound messages
 * 3. Leaves display messages unchanged
 */
describe("file context injection into API messages", () => {
  function injectFileContext(
    apiMessages: AgentMessage[],
    input: string,
    attachments?: FileAttachmentMeta[],
  ): void {
    const agentInput = assembleAgentInput(input, attachments);
    if (agentInput !== input && apiMessages.length > 0) {
      const lastMsg = apiMessages[apiMessages.length - 1];
      if (
        lastMsg.role === AgentMessageRole.USER &&
        lastMsg.content[0]?.type === "text"
      ) {
        (lastMsg.content[0] as AgentMessageTextContent).text = agentInput;
      }
    }
  }

  /** Helper to read text from a message's first content block */
  function textOf(msg: AgentMessage): string {
    return (msg.content[0] as AgentMessageTextContent).text;
  }

  const pdfAttachment: FileAttachmentMeta = {
    filename: "report.pdf",
    format: "pdf",
    pages: 5,
    characters: 9963,
    extractedText: "Page 1 content\nPage 2 content",
  };

  const csvAttachment: FileAttachmentMeta = {
    filename: "hosts.csv",
    format: "csv",
    rows: 10,
    columns: 3,
    characters: 500,
    extractedText: "host,ip,status\nhost1,1.2.3.4,active",
  };

  it("should inject file context into the last user message for API payload", () => {
    const apiMessages: AgentMessage[] = [
      {
        id: "msg-1",
        role: AgentMessageRole.USER,
        content: [{ type: "text", text: "summarize this" }],
      },
    ];

    injectFileContext(apiMessages, "summarize this", [pdfAttachment]);

    expect(textOf(apiMessages[0])).toContain(
      "[Attached File: report.pdf, 5 pages, 9963 characters]",
    );
    expect(textOf(apiMessages[0])).toContain("Page 1 content\nPage 2 content");
    expect(textOf(apiMessages[0])).toContain("summarize this");
  });

  it("should not modify messages when there are no attachments", () => {
    const apiMessages: AgentMessage[] = [
      {
        id: "msg-1",
        role: AgentMessageRole.USER,
        content: [{ type: "text", text: "plain question" }],
      },
    ];

    injectFileContext(apiMessages, "plain question");

    expect(textOf(apiMessages[0])).toBe("plain question");
  });

  it("should not modify messages when attachments array is empty", () => {
    const apiMessages: AgentMessage[] = [
      {
        id: "msg-1",
        role: AgentMessageRole.USER,
        content: [{ type: "text", text: "plain question" }],
      },
    ];

    injectFileContext(apiMessages, "plain question", []);

    expect(textOf(apiMessages[0])).toBe("plain question");
  });

  it("should inject multiple file contexts in order", () => {
    const apiMessages: AgentMessage[] = [
      {
        id: "msg-1",
        role: AgentMessageRole.USER,
        content: [{ type: "text", text: "compare these" }],
      },
    ];

    injectFileContext(apiMessages, "compare these", [
      pdfAttachment,
      csvAttachment,
    ]);

    const text = textOf(apiMessages[0]);
    const pdfIdx = text.indexOf("[Attached File: report.pdf");
    const csvIdx = text.indexOf("[Attached File: hosts.csv");
    const userIdx = text.indexOf("compare these");

    expect(pdfIdx).toBeLessThan(csvIdx);
    expect(csvIdx).toBeLessThan(userIdx);
  });

  it("should only modify the last user message, not earlier messages", () => {
    const apiMessages: AgentMessage[] = [
      {
        id: "msg-1",
        role: AgentMessageRole.USER,
        content: [{ type: "text", text: "first question" }],
      },
      {
        id: "msg-2",
        role: AgentMessageRole.ASSISTANT,
        content: [{ type: "text", text: "first answer" }],
      },
      {
        id: "msg-3",
        role: AgentMessageRole.USER,
        content: [{ type: "text", text: "follow up" }],
      },
    ];

    injectFileContext(apiMessages, "follow up", [pdfAttachment]);

    // First user message unchanged
    expect(textOf(apiMessages[0])).toBe("first question");
    // Last user message has file context
    expect(textOf(apiMessages[2])).toContain("[Attached File: report.pdf");
  });

  it("should leave display messages unaffected when API messages are a separate copy", () => {
    const displayMessages: AgentMessage[] = [
      {
        id: "msg-1",
        role: AgentMessageRole.USER,
        content: [{ type: "text", text: "summarize" }],
        attachments: [pdfAttachment],
      },
    ];

    // API messages are a separate array (simulating removeFetchedTableFromMessages)
    const apiMessages: AgentMessage[] = [
      {
        id: "msg-1",
        role: AgentMessageRole.USER,
        content: [{ type: "text", text: "summarize" }],
      },
    ];

    injectFileContext(apiMessages, "summarize", [pdfAttachment]);

    // Display message text unchanged
    expect(textOf(displayMessages[0])).toBe("summarize");
    // API message has file context
    expect(textOf(apiMessages[0])).toContain("[Attached File: report.pdf");
  });

  it("should handle empty API messages array gracefully", () => {
    const apiMessages: AgentMessage[] = [];

    // Should not throw
    injectFileContext(apiMessages, "hello", [pdfAttachment]);

    expect(apiMessages).toHaveLength(0);
  });
});
