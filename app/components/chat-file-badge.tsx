"use client";

import { FileAttachmentMeta } from "@/lib/agent-api/types";
import { cn } from "@/lib/utils";
import { ChevronRight, FileText, ImageIcon } from "lucide-react";
import { useState } from "react";

interface ChatFileBadgeProps {
  attachment: FileAttachmentMeta;
}

function formatMetadata(attachment: FileAttachmentMeta): string {
  const parts: string[] = [];
  if (attachment.pages !== undefined) parts.push(`${attachment.pages} pages`);
  if (attachment.rows !== undefined) parts.push(`${attachment.rows} rows`);
  if (attachment.columns !== undefined)
    parts.push(`${attachment.columns} cols`);
  parts.push(`${attachment.characters.toLocaleString()} chars`);
  return parts.join(" · ");
}

export function ChatFileBadge({ attachment }: ChatFileBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const isImage = attachment.format === "image";
  const Icon = isImage ? ImageIcon : FileText;

  return (
    <div
      className="rounded-lg border border-border/60 bg-muted/30 text-xs overflow-hidden"
      data-testid="file-badge"
    >
      <button
        type="button"
        className="flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        data-testid="file-badge-toggle"
      >
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="font-medium truncate">{attachment.filename}</span>
        <span className="text-muted-foreground ml-auto shrink-0">
          {formatMetadata(attachment)}
        </span>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200",
            expanded && "rotate-90",
          )}
        />
      </button>

      {expanded && (
        <div className="border-t border-border/40">
          <pre
            className="max-h-64 overflow-y-auto px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono leading-relaxed"
            data-testid="file-badge-content"
          >
            {attachment.extractedText}
          </pre>
        </div>
      )}
    </div>
  );
}
