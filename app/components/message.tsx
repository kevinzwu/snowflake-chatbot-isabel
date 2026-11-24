"use client";

import {
  AgentApiState,
  AgentMessage,
  AgentMessageChartContent,
  AgentMessageFetchedTableContent,
  AgentMessageRole,
  AgentMessageTextContent,
  AgentMessageThinkingContent,
  AgentMessageToolResultsContent,
  AgentMessageToolUseContent,
  Citation,
  CortexSearchCitationSource,
  RELATED_QUERIES_REGEX,
  RelatedQuery,
} from "@/lib/agent-api";
import { prettifyChartSpec } from "@/lib/agent-api/functions/chat/prettifyChartSpec";
import equal from "fast-deep-equal";
import { AnimatePresence, motion } from "framer-motion";
import { memo } from "react";
import { postProcessAgentText } from "../functions/postProcessAgentText";
import { ChatChartComponent } from "./chat-chart-component";
import { ChatCitationsComponent } from "./chat-citations-component";
import { Data2AnalyticsMessage } from "./chat-data2-message";
import { ChatFileBadge } from "./chat-file-badge";
import { ChatRelatedQueriesComponent } from "./chat-related-queries-component";
import { ChatSQLComponent } from "./chat-sql-component";
import { ChatTableComponent } from "./chat-table-component";
import { ChatTextComponent } from "./chat-text-component";
import { ThinkingMessage } from "./chat-thinking-message";
import { MessageFeedback } from "./message-feedback";

const PurePreviewMessage = ({
  message,
  agentState,
  isLatestAssistantMessage,
  authToken,
  database,
  schema,
  agentName,
  toolStatusMessage,
  isAdmin,
}: {
  message: AgentMessage;
  agentState: AgentApiState;
  isLatestAssistantMessage: boolean;
  authToken?: string | null;
  database?: string;
  schema?: string;
  agentName?: string;
  toolStatusMessage?: string | null;
  isAdmin?: boolean;
}) => {
  // if only the search citations are available without text
  if (
    message.content.length === 2 &&
    message.content[0]?.type === "tool_use" &&
    (message?.content[0] as AgentMessageToolUseContent)?.tool_use?.name ===
      "search1"
  ) {
    return null;
  }

  let agentApiText = "";
  const role = message.role;
  const citations: Citation[] = [];
  const relatedQueries: RelatedQuery[] = [];
  const agentResponses: React.ReactElement[] = [];

  // First pass: collect all citations from tool_results to avoid race conditions
  message.content.forEach((content) => {
    if (content.type === "tool_results") {
      const toolResultsContent = (content as AgentMessageToolResultsContent)
        .tool_results.content[0].json;

      // if search response (check for searchResults regardless of which tool was used)
      if ("searchResults" in toolResultsContent) {
        citations.push(
          ...toolResultsContent.searchResults.map(
            (result: CortexSearchCitationSource) => ({
              text: result.text,
              number: parseInt(String(result.source_id), 10),
            }),
          ),
        );
      }
    }
  });

  // Second pass: iterate over the message content and populate the agentResponses array
  // this logic is useful until we get names / keys associated with each text / tool_results responses to differentiate
  message.content.forEach((content, contentIndex) => {
    // if thinking content
    if (content.type === "thinking") {
      const { text } = content as AgentMessageThinkingContent;
      agentResponses.push(
        <ThinkingMessage
          key={`thinking-${contentIndex}`}
          content={text}
          isComplete={agentState !== AgentApiState.THINKING}
        />,
      );
    }
    // if plain text
    else if (content.type === "text") {
      const { text } = content as AgentMessageTextContent;
      if (!text) return;
      agentApiText = text;

      if (citations.length > 0) {
        relatedQueries.push(
          ...text.matchAll(RELATED_QUERIES_REGEX).map((match) => ({
            relatedQuery: match[1].trim(),
            answer: match[2].trim(),
          })),
        );
      }

      const postProcessedText = postProcessAgentText(
        text,
        relatedQueries,
        citations,
      );

      agentResponses.push(
        <ChatTextComponent
          key={`text-${contentIndex}`}
          text={postProcessedText}
          role={role}
        />,
      );
      // if analyst / search / data2analytics response
    } else if (content.type === "tool_results") {
      const toolResultsContent = (content as AgentMessageToolResultsContent)
        .tool_results.content[0].json;

      // Note: citations are already collected in the first pass above

      // if analyst text response (brief tool summary — excluded from PDF)
      if ("text" in toolResultsContent) {
        const { text } = toolResultsContent;
        agentResponses.push(
          <div
            key={`tool-text-${contentIndex}-${text.substring(0, 40)}`}
            data-pdf-exclude="true"
          >
            <ChatTextComponent role={role} text={text} />
          </div>,
        );
      }

      // if analyst sql response (admin-only)
      if ("sql" in toolResultsContent && isAdmin === true) {
        const { sql } = toolResultsContent;
        agentResponses.push(
          <ChatSQLComponent key={`sql-${contentIndex}`} sql={sql} />,
        );
      }

      // if execute sql response
    } else if (content.type === "fetched_table") {
      const tableContent = content as AgentMessageFetchedTableContent;
      agentResponses.push(
        <ChatTableComponent
          key={`table-${contentIndex}`}
          tableMarkdown={tableContent.tableMarkdown}
          toolResult={tableContent.toolResult}
        />,
      );
    } else if (content.type === "chart") {
      const chart_content = content as AgentMessageChartContent;
      const chartSpec = prettifyChartSpec(
        JSON.parse(chart_content.chart.chart_spec),
      );
      agentResponses.push(
        <ChatChartComponent
          key={`chart-${contentIndex}`}
          chartSpec={chartSpec}
        />,
      );
    }
  });

  // Don't hide user messages that have file attachments (e.g. image-only submissions)
  const hasAttachments =
    role === AgentMessageRole.USER && (message.attachments?.length ?? 0) > 0;
  if (agentResponses.length === 0 && !hasAttachments) {
    return null;
  }
  return (
    <AnimatePresence>
      <motion.div
        className="w-full mx-auto max-w-3xl px-4 group/message"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role={message.role}
        data-message-id={message.id}
      >
        <div className="flex gap-4 w-full group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-lg group-data-[role=user]/message:w-fit">
          <div className="flex flex-col gap-4 w-full">
            {/* Render file attachment badges for user messages */}
            {role === AgentMessageRole.USER &&
              message.attachments &&
              message.attachments.length > 0 && (
                <div className="flex flex-col gap-2">
                  {message.attachments.map((att, i) => (
                    <ChatFileBadge
                      key={`${att.filename}-${i}`}
                      attachment={att}
                    />
                  ))}
                </div>
              )}

            {agentResponses}

            {role === AgentMessageRole.ASSISTANT &&
              agentState === AgentApiState.TOOL_EXECUTING &&
              isLatestAssistantMessage && (
                <Data2AnalyticsMessage
                  message={toolStatusMessage || "Processing..."}
                />
              )}

            {role === AgentMessageRole.ASSISTANT &&
              relatedQueries.length > 0 && (
                <ChatRelatedQueriesComponent relatedQueries={relatedQueries} />
              )}

            {role === AgentMessageRole.ASSISTANT &&
              citations.length > 0 &&
              agentState === AgentApiState.IDLE &&
              agentApiText && (
                <ChatCitationsComponent
                  agentApiText={agentApiText}
                  citations={citations}
                />
              )}

            {role === AgentMessageRole.ASSISTANT &&
              agentState === AgentApiState.IDLE &&
              authToken &&
              database &&
              schema &&
              agentName && (
                <MessageFeedback
                  messageId={message.requestId}
                  database={database}
                  schema={schema}
                  agentName={agentName}
                  authToken={authToken}
                />
              )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    if (!equal(prevProps.agentState, nextProps.agentState)) return false;
    if (!equal(prevProps.message.content, nextProps.message.content))
      return false;
    if (!equal(prevProps.message.attachments, nextProps.message.attachments))
      return false;
    return true;
  },
);
