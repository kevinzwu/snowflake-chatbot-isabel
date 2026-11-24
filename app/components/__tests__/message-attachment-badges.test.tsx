/**
 * Integration test: messages with attachments render file badges, not inline text.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Mock framer-motion to avoid animation issues in tests
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({
      children,
      ...props
    }: {
      children: React.ReactNode;
      [key: string]: unknown;
    }) => {
      const safeProps: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
          safeProps[key] = value;
        }
      }
      return <div {...safeProps}>{children}</div>;
    },
  },
}));

// Mock the saved queries module used by ChatTextComponent
vi.mock("@/app/hooks/use-saved-queries", () => ({
  saveQueryStandalone: vi.fn(),
  useSavedQueries: () => ({
    saveQuery: vi.fn(),
    queries: [],
    isLoading: false,
  }),
}));

import { PreviewMessage } from "@/app/components/message";
import { AgentMessage, AgentMessageRole } from "@/lib/agent-api/types";
import { AgentApiState } from "@/lib/agent-api/useAgentAPIQuery";

describe("Message rendering with attachments", () => {
  it("renders file badges for user messages with attachments", () => {
    const message: AgentMessage = {
      id: "test-1",
      role: AgentMessageRole.USER,
      content: [{ type: "text", text: "summarize this" }],
      attachments: [
        {
          filename: "report.pdf",
          format: "pdf",
          pages: 5,
          characters: 9963,
          extractedText:
            "Vulnerability details text that should not appear inline",
        },
      ],
    };

    render(
      <PreviewMessage
        message={message}
        agentState={AgentApiState.IDLE}
        isLatestAssistantMessage={false}
      />,
    );

    // Badge should be visible
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("5 pages · 9,963 chars")).toBeInTheDocument();

    // User's typed text should be visible
    expect(screen.getByText("summarize this")).toBeInTheDocument();

    // Extracted text should NOT be visible (badge is collapsed)
    expect(
      screen.queryByText(
        "Vulnerability details text that should not appear inline",
      ),
    ).not.toBeInTheDocument();
  });

  it("renders multiple file badges", () => {
    const message: AgentMessage = {
      id: "test-2",
      role: AgentMessageRole.USER,
      content: [{ type: "text", text: "compare these" }],
      attachments: [
        {
          filename: "vuln.pdf",
          format: "pdf",
          pages: 3,
          characters: 5000,
          extractedText: "pdf text",
        },
        {
          filename: "hosts.csv",
          format: "csv",
          rows: 10,
          columns: 2,
          characters: 500,
          extractedText: "csv text",
        },
      ],
    };

    render(
      <PreviewMessage
        message={message}
        agentState={AgentApiState.IDLE}
        isLatestAssistantMessage={false}
      />,
    );

    expect(screen.getByText("vuln.pdf")).toBeInTheDocument();
    expect(screen.getByText("hosts.csv")).toBeInTheDocument();
    expect(screen.getByText("compare these")).toBeInTheDocument();
  });

  it("does not render badges for user messages without attachments", () => {
    const message: AgentMessage = {
      id: "test-3",
      role: AgentMessageRole.USER,
      content: [{ type: "text", text: "hello" }],
    };

    render(
      <PreviewMessage
        message={message}
        agentState={AgentApiState.IDLE}
        isLatestAssistantMessage={false}
      />,
    );

    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.queryAllByTestId("file-badge")).toHaveLength(0);
  });

  it("does not render badges for assistant messages even if attachments exist", () => {
    // This shouldn't happen in practice, but test defensive behavior
    const message: AgentMessage = {
      id: "test-4",
      role: AgentMessageRole.ASSISTANT,
      content: [{ type: "text", text: "Here is the summary" }],
      attachments: [
        {
          filename: "report.pdf",
          format: "pdf",
          characters: 100,
          extractedText: "text",
        },
      ],
    };

    render(
      <PreviewMessage
        message={message}
        agentState={AgentApiState.IDLE}
        isLatestAssistantMessage={true}
      />,
    );

    expect(screen.getByText("Here is the summary")).toBeInTheDocument();
    expect(screen.queryAllByTestId("file-badge")).toHaveLength(0);
  });

  it("expanded badge shows extracted text in bounded container", () => {
    const message: AgentMessage = {
      id: "test-5",
      role: AgentMessageRole.USER,
      content: [{ type: "text", text: "analyze" }],
      attachments: [
        {
          filename: "data.csv",
          format: "csv",
          rows: 5,
          columns: 3,
          characters: 200,
          extractedText: "host|ip|status\nhost1|1.2.3.4|active",
        },
      ],
    };

    render(
      <PreviewMessage
        message={message}
        agentState={AgentApiState.IDLE}
        isLatestAssistantMessage={false}
      />,
    );

    // Click to expand
    fireEvent.click(screen.getByTestId("file-badge-toggle"));

    const content = screen.getByTestId("file-badge-content");
    expect(content).toHaveTextContent("host|ip|status");
    expect(content.className).toContain("max-h-64");
  });
});
