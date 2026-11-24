import { cx } from "class-variance-authority";
import { motion } from "framer-motion";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { useState } from "react";

interface ThinkingMessageProps {
  content?: string;
  isComplete?: boolean;
}

export const ThinkingMessage = ({
  content,
  isComplete = false,
}: ThinkingMessageProps = {}) => {
  const [isExpanded, setIsExpanded] = useState(!isComplete);

  if (!content) {
    // Show elegant loading indicator when no content yet
    return (
      <motion.div
        className="w-full mx-auto max-w-3xl px-4"
        data-pdf-exclude="true"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1, transition: { delay: 0.3 } }}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10">
            <Sparkles className="h-4 w-4 text-accent animate-pulse" />
          </div>
          <div className="flex items-center gap-2 py-2">
            <div className="flex gap-1">
              <span
                className="h-2 w-2 rounded-full bg-accent/60 animate-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="h-2 w-2 rounded-full bg-accent/60 animate-bounce"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="h-2 w-2 rounded-full bg-accent/60 animate-bounce"
                style={{ animationDelay: "300ms" }}
              />
            </div>
            <span className="text-sm text-muted-foreground ml-1">Thinking</span>
          </div>
        </div>
      </motion.div>
    );
  }

  // Show expandable thinking content
  return (
    <motion.div
      className="w-full mx-auto max-w-3xl px-4 mb-4"
      initial={{ y: 5, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      data-pdf-exclude="true"
    >
      <div className="flex items-start gap-3">
        <div
          className={cx(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            isComplete ? "bg-muted" : "bg-accent/10",
          )}
        >
          <Sparkles
            className={cx(
              "h-4 w-4",
              isComplete
                ? "text-muted-foreground"
                : "text-accent animate-pulse",
            )}
          />
        </div>

        <div className="flex-1 min-w-0">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-1.5 rounded-md"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span>{isComplete ? "Thought process" : "Thinking..."}</span>
          </button>

          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="text-muted-foreground whitespace-pre-wrap bg-muted/30 rounded-lg p-3 mt-1 border border-border/30 font-mono text-xs leading-relaxed"
            >
              {content}
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
};
