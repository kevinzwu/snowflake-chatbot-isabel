import { FileAttachmentMeta } from "../types";

/**
 * Assemble the full agent input by prepending file context blocks
 * before the user's typed text. Each attachment is formatted as a
 * structured block the Cortex Agent can parse.
 */
export function assembleAgentInput(
  userText: string,
  attachments?: FileAttachmentMeta[],
): string {
  if (!attachments || attachments.length === 0) {
    return userText;
  }

  const parts: string[] = [];

  for (const attachment of attachments) {
    const metaParts = [attachment.filename];
    if (attachment.pages !== undefined)
      metaParts.push(`${attachment.pages} pages`);
    if (attachment.rows !== undefined)
      metaParts.push(`${attachment.rows} rows`);
    if (attachment.columns !== undefined)
      metaParts.push(`${attachment.columns} columns`);
    metaParts.push(`${attachment.characters} characters`);

    parts.push(`[Attached File: ${metaParts.join(", ")}]`);
    parts.push("---");
    parts.push(attachment.extractedText);
    parts.push("---");
  }

  if (userText) {
    parts.push(userText);
  }

  return parts.join("\n");
}
