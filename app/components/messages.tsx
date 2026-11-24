import { AgentApiState, AgentMessage } from "@/lib/agent-api";
import equal from "fast-deep-equal";
import { memo } from "react";
import { useScrollToBottom } from "../hooks/use-scroll-to-bottom";
import { ThinkingMessage } from "./chat-thinking-message";
import { PreviewMessage } from "./message";
import { Overview } from "./overview";
import { ScrollToBottomButton } from "./scroll-to-bottom-button";

interface MessagesProps {
  agentState: AgentApiState;
  isAdmin?: boolean;
  messages: AgentMessage[];
  latestAssistantMessageId: string | null;
  authToken?: string | null;
  database?: string;
  schema?: string;
  agentName?: string;
  toolStatusMessage?: string | null;
}

function PureMessages({
  agentState,
  isAdmin,
  messages,
  latestAssistantMessageId,
  authToken,
  database,
  schema,
  agentName,
  toolStatusMessage,
}: MessagesProps) {
  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    showScrollButton,
    scrollToBottom,
  } = useScrollToBottom<HTMLDivElement>();

  return (
    <div className="relative flex-1 min-w-0 min-h-0">
      <div
        ref={messagesContainerRef}
        tabIndex={0}
        role="region"
        aria-label="Conversation"
        className="flex flex-col min-w-0 gap-8 h-full overflow-y-auto pt-4 pb-4 scroll-smooth"
      >
        {messages.length === 0 && <Overview />}

        {messages.map((message, index) => (
          <PreviewMessage
            key={message.id + index}
            message={message}
            agentState={agentState}
            isLatestAssistantMessage={latestAssistantMessageId === message.id}
            authToken={authToken}
            database={database}
            schema={schema}
            agentName={agentName}
            toolStatusMessage={toolStatusMessage}
            isAdmin={isAdmin}
          />
        ))}

        {(agentState === AgentApiState.LOADING ||
          agentState === AgentApiState.THINKING) && <ThinkingMessage />}

        <div
          ref={messagesEndRef}
          className="shrink-0 min-w-[24px] min-h-[24px]"
        />
      </div>
      <ScrollToBottomButton
        visible={showScrollButton}
        onClick={scrollToBottom}
      />
    </div>
  );
}

export const Messages = memo(PureMessages, (prevProps, nextProps) => {
  if (prevProps.agentState !== nextProps.agentState) return false;
  if (prevProps.toolStatusMessage !== nextProps.toolStatusMessage) return false;
  if (prevProps.messages.length !== nextProps.messages.length) return false;
  if (!equal(prevProps.messages, nextProps.messages)) return false;
  return true;
});
