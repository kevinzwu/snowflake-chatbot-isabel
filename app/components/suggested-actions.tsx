"use client";

import { sanitizeInput } from "@/lib/security/input-sanitizer";
import { motion } from "framer-motion";
import { Lightbulb } from "lucide-react";

const DEFAULT_SUGGESTED_QUERIES = [
  "How many open host vulnerabilities are there by severity?",
  "Which teams have the most overdue critical host vulnerabilities?",
  "Which critical applications have actively exploited vulnerabilities that are still open?",
  "What is Log4Shell and how do we fix it?",
];

interface SuggestedActionsProps {
  handleSubmit: (input: string) => void;
  queries?: string[];
}

export const SuggestedActions = ({
  handleSubmit,
  queries,
}: SuggestedActionsProps) => {
  const suggestedActions =
    queries && queries.length > 0 ? queries : DEFAULT_SUGGESTED_QUERIES;

  const handleSuggestedActionClick = (action: string) => {
    // Sanitize even predefined queries for defense in depth
    const sanitizedAction = sanitizeInput(action);
    if (sanitizedAction) {
      handleSubmit(sanitizedAction);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Lightbulb className="h-3.5 w-3.5" />
        <span>Try asking</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {suggestedActions.map((suggestedAction, index) => (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ delay: 0.05 * index, duration: 0.2 }}
            key={`suggested-action-${suggestedAction}-${index}`}
            className={`
                            group relative text-left px-4 py-3 rounded-xl 
                            border border-border bg-background
                            hover:border-accent/50 hover:shadow-sm
                            transition-all duration-200
                            ${index > 1 ? "hidden sm:block" : "block"}
                        `}
            onClick={(e) => {
              e.preventDefault();
              handleSuggestedActionClick(suggestedAction);
            }}
          >
            <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors line-clamp-2">
              {suggestedAction}
            </span>
            <div className="absolute inset-0 rounded-xl bg-accent/5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.button>
        ))}
      </div>
    </div>
  );
};
