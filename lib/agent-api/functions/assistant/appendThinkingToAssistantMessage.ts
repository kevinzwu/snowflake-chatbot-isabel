import { AgentMessage, AgentMessageThinkingContent } from "../../types";

/**
 * Appends thinking text to the last thinking message in the assistant message.
 * If the last message is not thinking, it creates a new thinking message.
 */
export function appendThinkingToAssistantMessage(
  assistantMessage: AgentMessage,
  text: string,
  contentIndex?: number,
): void {
  // Safety check: don't create empty thinking content
  if (!text || text.trim().length === 0) {
    return;
  }

  // Find the last thinking message in the content array
  const lastThinkingIndex = findLastThinkingContentIndex(
    assistantMessage.content,
  );

  // If there's a thinking message, append to it, otherwise create a new one
  if (lastThinkingIndex !== -1) {
    const lastThinkingContent = assistantMessage.content[
      lastThinkingIndex
    ] as AgentMessageThinkingContent;
    lastThinkingContent.text += text;
    if (contentIndex !== undefined) {
      lastThinkingContent.content_index = contentIndex;
    }
  } else {
    // No thinking content found, add a new one
    assistantMessage.content.push({
      type: "thinking",
      text: text,
      content_index: contentIndex,
    });
  }
}

// Helper function to find the last thinking content index
function findLastThinkingContentIndex(
  content: AgentMessage["content"],
): number {
  for (let i = content.length - 1; i >= 0; i--) {
    if (content[i].type === "thinking") {
      return i;
    }
  }
  return -1;
}
