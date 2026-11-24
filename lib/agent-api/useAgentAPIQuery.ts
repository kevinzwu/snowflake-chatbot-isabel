"use client";

import { events } from "fetch-event-stream";
import React from "react";
import shortUUID from "short-uuid";
import { toast } from "sonner";
import { assembleAgentInput } from "./functions/assembleAgentInput";
import { appendAssistantMessageToMessagesList } from "./functions/assistant/appendAssistantMessageToMessagesList";
import { appendChartToAssistantMessage } from "./functions/assistant/appendChartToAssistantMessage";
import { appendFetchedTableToAssistantMessage } from "./functions/assistant/appendFetchedTableToAssistantMessage";
import { appendTableToAssistantMessage } from "./functions/assistant/appendTableToAssistantMessage";
import { appendTextToAssistantMessage } from "./functions/assistant/appendTextToAssistantMessage";
import { appendThinkingToAssistantMessage } from "./functions/assistant/appendThinkingToAssistantMessage";
import { appendToolResponseToAssistantMessage } from "./functions/assistant/appendToolResponseToAssistantMessage";
import { getEmptyAssistantMessage } from "./functions/assistant/getEmptyAssistantMessage";
import {
  AgentRequestBuildParams,
  buildStandardRequestParams,
} from "./functions/buildStandardRequestParams";
import { removeFetchedTableFromMessages } from "./functions/chat/removeFetchedTableFromMessages";
import {
  injectProfileCleared,
  injectProfileContent,
} from "./functions/injectProfileContent";
import {
  AgentMessage,
  AgentMessageRole,
  AgentMessageTextContent,
  AgentMessageToolUseContent,
  FileAttachmentMeta,
  SuggestedQuery,
} from "./types";

export interface AgentApiQueryParams extends Omit<
  AgentRequestBuildParams,
  "messages" | "input"
> {
  snowflakeUrl: string;
  database: string;
  schema: string;
  agentName: string;
  /** Initial messages to load (e.g., from a saved conversation) */
  initialMessages?: AgentMessage[];
}

/**
 * Minimal profile info needed for injection into API payloads.
 */
export interface ActiveProfileInfo {
  profileId: string;
  name: string;
  content: string;
}

export enum AgentApiState {
  IDLE = "idle",
  LOADING = "loading",
  THINKING = "thinking",
  STREAMING = "streaming",
  TOOL_EXECUTING = "tool_executing",
  // Legacy aliases — kept for backward compatibility with UI components
  // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
  EXECUTING_SQL = "tool_executing",
  // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
  RUNNING_ANALYTICS = "tool_executing",
}

export function useAgentAPIQuery(params: AgentApiQueryParams) {
  const {
    authToken,
    snowflakeUrl,
    database,
    schema,
    agentName,
    initialMessages,
    ...agentRequestParams
  } = params;

  const [agentState, setAgentState] = React.useState<AgentApiState>(
    AgentApiState.IDLE,
  );
  const [messages, setMessages] = React.useState<AgentMessage[]>(
    initialMessages || [],
  );
  const [latestAssistantMessageId, setLatestAssistantMessageId] =
    React.useState<string | null>(null);
  const [toolStatusMessage, setToolStatusMessage] = React.useState<
    string | null
  >(null);
  const [suggestedQueries, setSuggestedQueries] = React.useState<
    SuggestedQuery[]
  >([]);

  // AbortController for cancelling in-flight requests
  const abortControllerRef = React.useRef<AbortController | null>(null);
  // Snapshot of messages before the current request, used for rollback on stop
  const messagesBeforeRequestRef = React.useRef<AgentMessage[] | null>(null);
  // Session counter to track and invalidate stale streaming updates
  const sessionIdRef = React.useRef<number>(0);
  const activeSessionIdRef = React.useRef<number>(0);

  // Update messages when initialMessages changes (e.g., loading a conversation)
  React.useEffect(() => {
    if (initialMessages && initialMessages.length > 0) {
      setMessages(initialMessages);
    }
  }, [initialMessages]);

  const handleNewMessage = React.useCallback(
    async (
      input: string,
      attachments?: FileAttachmentMeta[],
      profileContext?: {
        activeProfile: ActiveProfileInfo | null;
        lastInjectedProfileId: string | null;
        onProfileInjected: (profileId: string | null) => void;
      },
    ) => {
      if (!authToken) {
        toast.error("Authorization failed: Token is not defined");
        return;
      }

      // Increment session ID for this new request
      sessionIdRef.current += 1;
      const currentSessionId = sessionIdRef.current;
      activeSessionIdRef.current = currentSessionId;

      // Helper to safely update messages only if session is still active
      const safeSetMessages = (
        updater: (prev: AgentMessage[]) => AgentMessage[],
      ) => {
        if (activeSessionIdRef.current === currentSessionId) {
          setMessages(updater);
        }
      };

      // Helper to safely update state only if session is still active
      const safeSetState = (state: AgentApiState) => {
        if (activeSessionIdRef.current === currentSessionId) {
          setAgentState(state);
        }
      };

      const safeSetToolStatus = (status: string | null) => {
        if (activeSessionIdRef.current === currentSessionId) {
          setToolStatusMessage(status);
        }
      };

      const safeSetSuggestedQueries = (queries: SuggestedQuery[]) => {
        if (activeSessionIdRef.current === currentSessionId) {
          setSuggestedQueries(queries);
        }
      };

      // Clear suggested queries from previous response
      safeSetSuggestedQueries([]);

      const newMessages = structuredClone(messages);

      const latestUserMessageId = shortUUID.generate();

      const userMessage: AgentMessage = {
        id: latestUserMessageId,
        role: AgentMessageRole.USER,
        content: [{ type: "text", text: input }],
      };
      if (attachments && attachments.length > 0) {
        userMessage.attachments = attachments;
      }

      newMessages.push(userMessage);

      // Snapshot current messages before adding the new user message,
      // so we can roll back to this state if the user stops generation.
      messagesBeforeRequestRef.current = structuredClone(messages);

      safeSetMessages(() => newMessages);
      safeSetToolStatus(null);

      // Assemble the agent input: prepend file context blocks before user text
      const agentInput = assembleAgentInput(input, attachments);

      // Remove UI-only content (fetched_table, thinking) before sending to agent
      const apiMessages = removeFetchedTableFromMessages(newMessages);

      // Inject assembled file context into the last user message for the API payload.
      // Display messages keep the clean typed text + badges; API messages get the full text.
      if (agentInput !== input && apiMessages.length > 0) {
        const lastMsg = apiMessages[apiMessages.length - 1];
        if (
          lastMsg.role === AgentMessageRole.USER &&
          lastMsg.content[0]?.type === "text"
        ) {
          (lastMsg.content[0] as AgentMessageTextContent).text = agentInput;
        }
      }

      // Profile injection: prepend profile content to API payload on first message
      // or when the active profile changes (mid-conversation switch).
      if (profileContext && apiMessages.length > 0) {
        const { activeProfile, lastInjectedProfileId, onProfileInjected } =
          profileContext;
        const activeProfileId = activeProfile?.profileId ?? null;
        const shouldInject = activeProfileId !== lastInjectedProfileId;

        if (shouldInject) {
          const lastMsg = apiMessages[apiMessages.length - 1];
          if (
            lastMsg.role === AgentMessageRole.USER &&
            lastMsg.content[0]?.type === "text"
          ) {
            const currentText = (lastMsg.content[0] as AgentMessageTextContent)
              .text;
            if (activeProfile) {
              (lastMsg.content[0] as AgentMessageTextContent).text =
                injectProfileContent(
                  currentText,
                  activeProfile.name,
                  activeProfile.content,
                );
            } else {
              // Switched from a profile to no profile
              (lastMsg.content[0] as AgentMessageTextContent).text =
                injectProfileCleared(currentText);
            }
            onProfileInjected(activeProfileId);
          }
        }
      }

      const { headers, body } = buildStandardRequestParams({
        authToken,
        messages: apiMessages,
        ...agentRequestParams,
      });

      safeSetState(AgentApiState.LOADING);

      // Create a new AbortController for this request
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await fetch(
          `${snowflakeUrl}/api/v2/databases/${database}/schemas/${schema}/agents/${agentName}:run`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );

        const latestAssistantMessageId = shortUUID.generate();
        setLatestAssistantMessageId(latestAssistantMessageId);
        const newAssistantMessage = getEmptyAssistantMessage(
          latestAssistantMessageId,
        );

        const streamEvents = events(response);
        for await (const event of streamEvents) {
          // Check if session is still active; if not, exit early
          if (activeSessionIdRef.current !== currentSessionId) {
            return;
          }

          if (event.data === "[DONE]" || event.event === "done") {
            safeSetState(AgentApiState.IDLE);
            safeSetToolStatus(null);
            messagesBeforeRequestRef.current = null;
            return;
          }

          // Check for error responses
          const parsedData = JSON.parse(event.data!);
          if (parsedData.code) {
            toast.error(parsedData.message);
            safeSetState(AgentApiState.IDLE);
            safeSetToolStatus(null);
            return;
          }

          // Handle new agent API event types
          if (event.event) {
            let handled = false;
            switch (event.event) {
              case "response.thinking.delta": {
                handled = true;
                const { text, content_index } = parsedData;
                safeSetState(AgentApiState.THINKING);
                appendThinkingToAssistantMessage(
                  newAssistantMessage,
                  text,
                  content_index,
                );
                safeSetMessages(
                  appendAssistantMessageToMessagesList(newAssistantMessage),
                );
                break;
              }
              case "response.thinking": {
                handled = true;
                // Thinking complete — transition state, text was already accumulated via deltas
                safeSetState(AgentApiState.STREAMING);
                break;
              }
              case "response.text.delta": {
                handled = true;
                const { text } = parsedData;
                safeSetState(AgentApiState.STREAMING);
                safeSetToolStatus(null);
                appendTextToAssistantMessage(newAssistantMessage, text);
                safeSetMessages(
                  appendAssistantMessageToMessagesList(newAssistantMessage),
                );
                break;
              }
              case "response.tool_use": {
                handled = true;
                // Tool use event — add to message content
                safeSetState(AgentApiState.TOOL_EXECUTING);
                appendToolResponseToAssistantMessage(newAssistantMessage, {
                  type: "tool_use",
                  tool_use: parsedData,
                });
                safeSetMessages(
                  appendAssistantMessageToMessagesList(newAssistantMessage),
                );
                break;
              }
              case "response.tool_result": {
                handled = true;
                // Tool result event — add to message content
                appendToolResponseToAssistantMessage(newAssistantMessage, {
                  type: "tool_results",
                  tool_results: parsedData,
                });
                safeSetMessages(
                  appendAssistantMessageToMessagesList(newAssistantMessage),
                );

                // If analyst tool result contains inline result_set (server-side SQL execution),
                // render it as a fetched_table for markdown display
                const resultSet = parsedData.content?.[0]?.json?.result_set;

                // DEBUG: Log tool_result to understand truncation behavior
                if (resultSet) {
                  console.log(
                    "[tool_result] has result_set | truncated:",
                    resultSet.result_set_truncated,
                    "| row count:",
                    resultSet.data?.length,
                    "| sql in json:",
                    !!parsedData.content?.[0]?.json?.sql,
                  );
                }

                if (resultSet) {
                  appendFetchedTableToAssistantMessage(
                    newAssistantMessage,
                    resultSet,
                    true,
                  );
                  safeSetMessages(
                    appendAssistantMessageToMessagesList(newAssistantMessage),
                  );
                }

                safeSetState(AgentApiState.STREAMING);
                safeSetToolStatus(null);
                break;
              }
              case "response.tool_result.status": {
                handled = true;
                // Real-time tool execution status from server
                safeSetState(AgentApiState.TOOL_EXECUTING);
                safeSetToolStatus(
                  parsedData.message ||
                    parsedData.status ||
                    "Executing tool...",
                );
                break;
              }
              case "response.tool_result.analyst.delta": {
                handled = true;
                // Cortex Analyst streaming delta — may contain sql, result_set, text, etc.
                safeSetState(AgentApiState.TOOL_EXECUTING);

                // DEBUG: Log full analyst delta to understand truncation behavior
                console.log(
                  "[analyst.delta] keys:",
                  Object.keys(parsedData.delta || {}),
                  "| has sql:",
                  !!parsedData.delta?.sql,
                  "| has result_set:",
                  !!parsedData.delta?.result_set,
                  "| truncated:",
                  parsedData.delta?.result_set?.result_set_truncated,
                  "| row count:",
                  parsedData.delta?.result_set?.data?.length,
                );

                // If result_set is present, render it as a fetched_table
                if (parsedData.delta?.result_set) {
                  appendFetchedTableToAssistantMessage(
                    newAssistantMessage,
                    parsedData.delta.result_set,
                    true,
                  );
                  safeSetMessages(
                    appendAssistantMessageToMessagesList(newAssistantMessage),
                  );
                }

                // If SQL is present, update status message
                if (parsedData.delta?.sql) {
                  safeSetToolStatus("Executing SQL...");
                }
                break;
              }
              case "response.chart": {
                handled = true;
                // Chart event — chart_spec is expected to be a stringified Vega-Lite spec
                let chartData = parsedData;
                if (
                  parsedData.chart_spec &&
                  typeof parsedData.chart_spec === "string"
                ) {
                  try {
                    chartData = {
                      ...parsedData,
                      chart: JSON.parse(parsedData.chart_spec),
                    };
                  } catch (error) {
                    // If chart_spec is invalid JSON, log and fall back to raw data
                    console.error(
                      "Failed to parse chart_spec:",
                      error,
                      parsedData.chart_spec,
                    );
                    toast.error?.(
                      "Unable to render chart due to invalid data.",
                    );
                  }
                }
                appendChartToAssistantMessage(newAssistantMessage, chartData);
                safeSetMessages(
                  appendAssistantMessageToMessagesList(newAssistantMessage),
                );
                break;
              }
              case "response.table": {
                handled = true;
                // Table event — now contains inline result_set data
                appendTableToAssistantMessage(newAssistantMessage, parsedData);
                safeSetMessages(
                  appendAssistantMessageToMessagesList(newAssistantMessage),
                );

                // If result_set is present, render it as a fetched_table for markdown display
                if (parsedData.result_set) {
                  appendFetchedTableToAssistantMessage(
                    newAssistantMessage,
                    parsedData.result_set,
                    false,
                  );
                  safeSetMessages(
                    appendAssistantMessageToMessagesList(newAssistantMessage),
                  );
                }
                break;
              }
              case "response.status": {
                handled = true;
                // Agent-level status update (planning, reasoning, etc.)
                if (parsedData.status === "planning") {
                  safeSetState(AgentApiState.THINKING);
                }
                safeSetToolStatus(parsedData.message || null);
                break;
              }
              case "response.suggested_queries": {
                handled = true;
                // Suggested follow-up queries from the agent
                // Store them for UI display
                const queries: SuggestedQuery[] = (
                  parsedData.suggested_queries || []
                ).map((sq: { query: string }) => ({
                  query: sq.query,
                }));
                safeSetSuggestedQueries(queries);
                console.debug("Received suggested queries:", queries);
                break;
              }
              case "response": {
                handled = true;
                // Final aggregated response event containing all content
                // All content was already processed via streaming delta events,
                // so we just acknowledge this event and wait for done
                console.debug(
                  "Received final aggregated response (seq:",
                  parsedData.sequence_number,
                  ")",
                );
                break;
              }
              case "done": {
                handled = true;
                // Explicit done event - transition to IDLE
                safeSetState(AgentApiState.IDLE);
                safeSetToolStatus(null);
                messagesBeforeRequestRef.current = null;
                return;
              }
              case "error": {
                handled = true;
                toast.error(
                  parsedData.message || "An error occurred during processing",
                );
                safeSetState(AgentApiState.IDLE);
                safeSetToolStatus(null);
                return;
              }
              default:
                // Unrecognized event — fall through to legacy handling
                break;
            }

            // Only skip legacy handling if the switch actually processed this event
            if (handled) {
              continue;
            }
          }

          const eventData = parsedData;

          // Legacy event handling (for backward compatibility with older API format)
          // Safety check for delta and content
          if (!eventData.delta || !eventData.delta.content) {
            console.warn("Missing delta or content in event data:", eventData);
            continue;
          }

          const [textOrToolUseResponse, toolResultsResponse] =
            eventData.delta.content;

          // Additional safety check for textOrToolUseResponse
          if (!textOrToolUseResponse) {
            console.warn(
              "Missing textOrToolUseResponse in content:",
              eventData,
            );
            continue;
          }

          const { type, text } = textOrToolUseResponse;

          // normal text response
          if (type === "text" && text !== undefined) {
            appendTextToAssistantMessage(newAssistantMessage, text);
            safeSetMessages(
              appendAssistantMessageToMessagesList(newAssistantMessage),
            );
          } else if (type === "suggested_queries") {
            // Handle suggested queries from cortex search
            console.log(
              "Received suggested queries:",
              textOrToolUseResponse.suggested_queries,
            );
          } else if (type === "tool_use") {
            appendToolResponseToAssistantMessage(
              newAssistantMessage,
              textOrToolUseResponse,
            );
            safeSetMessages(
              appendAssistantMessageToMessagesList(newAssistantMessage),
            );

            // a tool result (analyst / search)
            if (toolResultsResponse?.tool_results) {
              if (textOrToolUseResponse.tool_use?.name === "search1") {
                console.log("Search1 tool results:", toolResultsResponse);
              }

              appendToolResponseToAssistantMessage(
                newAssistantMessage,
                toolResultsResponse,
              );
              safeSetMessages(
                appendAssistantMessageToMessagesList(newAssistantMessage),
              );

              // If analyst returns inline result_set, render it as a fetched_table
              const resultSet =
                toolResultsResponse.tool_results.content[0]?.json?.result_set;
              if (resultSet) {
                appendFetchedTableToAssistantMessage(
                  newAssistantMessage,
                  resultSet,
                  true,
                );
                safeSetMessages(
                  appendAssistantMessageToMessagesList(newAssistantMessage),
                );
              }
            }
          } else {
            console.warn("Unexpected response from agent API: ", event.data);
            toast.error("Unexpected response from agent API");
          }

          // search returns citations first then text after. A bit of buffer time in between
          // making sure the state transitions smoothly
          if (
            (textOrToolUseResponse as AgentMessageToolUseContent).tool_use
              ?.name !== "search1"
          ) {
            safeSetState(AgentApiState.STREAMING);
          }
        }
      } catch (error: unknown) {
        // If the request was aborted via stopGeneration, silently transition to IDLE
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        // Re-throw unexpected errors
        console.error("Agent API error:", error);
        toast.error("An unexpected error occurred");
        safeSetState(AgentApiState.IDLE);
        safeSetToolStatus(null);
      } finally {
        abortControllerRef.current = null;
      }
    },
    [
      agentRequestParams,
      authToken,
      messages,
      snowflakeUrl,
      database,
      schema,
      agentName,
    ],
  );

  const stopGeneration = React.useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Roll back messages to the state before the aborted request,
    // removing the user message and any partial assistant response.
    if (messagesBeforeRequestRef.current) {
      setMessages(messagesBeforeRequestRef.current);
      messagesBeforeRequestRef.current = null;
    }
    setAgentState(AgentApiState.IDLE);
    setToolStatusMessage(null);
  }, []);

  /**
   * Reset the session for a new chat. This aborts any in-flight request,
   * invalidates stale session updates, and clears all state.
   */
  const resetSession = React.useCallback(() => {
    // Abort any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Invalidate the current session so stale updates are ignored
    activeSessionIdRef.current = -1;
    // Clear all state
    messagesBeforeRequestRef.current = null;
    setMessages([]);
    setAgentState(AgentApiState.IDLE);
    setToolStatusMessage(null);
    setLatestAssistantMessageId(null);
    setSuggestedQueries([]);
  }, []);

  return {
    agentState,
    messages,
    setMessages,
    handleNewMessage,
    stopGeneration,
    resetSession,
    latestAssistantMessageId,
    toolStatusMessage,
    suggestedQueries,
  };
}
