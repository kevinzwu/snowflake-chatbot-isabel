import { AgentApiState } from "@/lib/agent-api";
import { AgentMessageRole, type AgentMessage } from "@/lib/agent-api/types";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PreviewMessage } from "./message";

// Mock child components to isolate the rendering logic
vi.mock("./chat-sql-component", () => ({
  ChatSQLComponent: ({ sql }: { sql: string }) => (
    <div data-testid="sql-component">{sql}</div>
  ),
}));

vi.mock("./chat-text-component", () => ({
  ChatTextComponent: ({ text }: { text: string }) => (
    <div data-testid="text-component">{text}</div>
  ),
}));

vi.mock("./chat-chart-component", () => ({
  ChatChartComponent: () => <div data-testid="chart-component" />,
}));

vi.mock("./chat-table-component", () => ({
  ChatTableComponent: () => <div data-testid="table-component" />,
}));

vi.mock("./chat-citations-component", () => ({
  ChatCitationsComponent: () => null,
}));

vi.mock("./chat-related-queries-component", () => ({
  ChatRelatedQueriesComponent: () => null,
}));

vi.mock("./chat-data2-message", () => ({
  Data2AnalyticsMessage: () => null,
}));

vi.mock("./chat-file-badge", () => ({
  ChatFileBadge: () => null,
}));

vi.mock("./chat-thinking-message", () => ({
  ThinkingMessage: () => null,
}));

vi.mock("./message-feedback", () => ({
  MessageFeedback: () => null,
}));

vi.mock("../functions/postProcessAgentText", () => ({
  postProcessAgentText: (text: string) => ({ text, citations: [] }),
}));

function buildMessageWithSql(sql: string): AgentMessage {
  return {
    id: "msg-1",
    role: AgentMessageRole.ASSISTANT,
    content: [
      {
        type: "tool_results",
        tool_results: {
          content: [{ json: { sql, text: "Query executed" } }],
          name: "analyst1",
        },
      },
    ],
  };
}

describe("PreviewMessage — admin-only SQL display", () => {
  const defaultProps = {
    agentState: AgentApiState.IDLE,
    isLatestAssistantMessage: false,
  };

  it("should render ChatSQLComponent when isAdmin is true", () => {
    const message = buildMessageWithSql("SELECT * FROM vulnerabilities");

    render(
      <PreviewMessage {...defaultProps} message={message} isAdmin={true} />,
    );

    expect(screen.getByTestId("sql-component")).toBeInTheDocument();
    expect(screen.getByTestId("sql-component")).toHaveTextContent(
      "SELECT * FROM vulnerabilities",
    );
  });

  it("should NOT render ChatSQLComponent when isAdmin is false", () => {
    const message = buildMessageWithSql("SELECT * FROM vulnerabilities");

    render(
      <PreviewMessage {...defaultProps} message={message} isAdmin={false} />,
    );

    expect(screen.queryByTestId("sql-component")).not.toBeInTheDocument();
  });

  it("should NOT render ChatSQLComponent when isAdmin is undefined", () => {
    const message = buildMessageWithSql("SELECT * FROM vulnerabilities");

    render(<PreviewMessage {...defaultProps} message={message} />);

    expect(screen.queryByTestId("sql-component")).not.toBeInTheDocument();
  });

  it("should still render other content (text) regardless of isAdmin", () => {
    const message = buildMessageWithSql("SELECT 1");

    render(
      <PreviewMessage {...defaultProps} message={message} isAdmin={false} />,
    );

    // The tool_results content has a "text" field which should render regardless
    expect(screen.getByTestId("text-component")).toBeInTheDocument();
    expect(screen.queryByTestId("sql-component")).not.toBeInTheDocument();
  });
});
