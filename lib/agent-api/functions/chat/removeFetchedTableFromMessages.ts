import { AgentMessage } from "../../types";

/**
 * Removes UI-only content types that should not be sent back to the agent API.
 * This includes:
 * - fetched_table: Tables fetched from SQL execution (displayed in UI only)
 * - thinking: Agent's thinking process (displayed in UI only, should not be echoed back)
 */
export function removeFetchedTableFromMessages(messages: AgentMessage[]) {
  // new array to avoid mutation
  return structuredClone(messages).map((message) => {
    if (Array.isArray(message.content)) {
      message.content = message.content.filter(
        (item) => item.type !== "fetched_table" && item.type !== "thinking",
      );
    }
    return message;
  });
}
