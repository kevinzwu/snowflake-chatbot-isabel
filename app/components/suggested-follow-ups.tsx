"use client";

import { SuggestedQuery } from "@/lib/agent-api/types";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import { useState } from "react";

interface SuggestedFollowUpsProps {
  queries: SuggestedQuery[];
  onSelect: (query: string) => void;
  disabled?: boolean;
}

/**
 * Displays AI-suggested follow-up queries after a response.
 * These come from the Snowflake Cortex Agent's `response.suggested_queries` event.
 *
 * Overlap calculation (sidebar 256px open, chat max-w-3xl = 768px centered, panel w-80 + right-4):
 *   Right gap to chat edge = (viewport - 256 - 768) / 2
 *   Panel consumes 336px from right (320 + 16)
 *   No-overlap with 32px margin: (viewport - 1024) / 2 >= 368 → viewport >= 1760px
 *
 * Behavior:
 * - ≥1760px: Shows full panel (no overlap with chat even with sidebar open)
 * - lg (1024–1759px): Collapses to sparkle icon; expands on click to overlay chat
 * - Below lg: Hidden
 */
export function SuggestedFollowUps({
  queries,
  onSelect,
  disabled = false,
}: SuggestedFollowUpsProps) {
  const [expanded, setExpanded] = useState(false);

  if (queries.length === 0) {
    return null;
  }

  return (
    <AnimatePresence>
      {/* Full panel — visible only at ≥1760px where there's no overlap */}
      <motion.div
        key="suggested-full-panel"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.3 }}
        className="fixed right-4 bottom-24 z-30 hidden min-[1760px]:block w-80"
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-0.5">
            <Sparkles className="h-3 w-3" />
            <span>Suggested follow-ups</span>
          </div>
          {queries.slice(0, 3).map((suggestion, index) => (
            <motion.button
              key={`suggestion-${index}-${suggestion.query.slice(0, 20)}`}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 * index, duration: 0.2 }}
              disabled={disabled}
              onClick={() => onSelect(suggestion.query)}
              className={`
                group relative text-left px-3 py-2 rounded-lg text-sm
                border border-border bg-background/80 backdrop-blur-sm
                hover:border-accent/50 hover:bg-background
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all duration-200
              `}
            >
              <span className="text-muted-foreground group-hover:text-foreground transition-colors line-clamp-2">
                {suggestion.query}
              </span>
            </motion.button>
          ))}
        </div>
      </motion.div>

      {/* Collapsed icon — visible at lg up to 1760px */}
      <div
        key="suggested-icon"
        className="fixed right-4 bottom-24 z-40 hidden lg:block min-[1760px]:hidden"
      >
        {!expanded ? (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => setExpanded(true)}
            className="flex items-center justify-center w-10 h-10 rounded-full border border-border bg-background/90 backdrop-blur-sm hover:border-accent/50 hover:bg-background shadow-sm transition-all duration-200"
            title="Show suggested follow-ups"
          >
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </motion.button>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="w-80"
          >
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-background/95 backdrop-blur-md p-3 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  <span>Suggested follow-ups</span>
                </div>
                <button
                  onClick={() => setExpanded(false)}
                  className="p-0.5 rounded hover:bg-muted transition-colors"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
              {queries.slice(0, 3).map((suggestion, index) => (
                <button
                  key={`suggestion-collapsed-${index}-${suggestion.query.slice(0, 20)}`}
                  disabled={disabled}
                  onClick={() => {
                    onSelect(suggestion.query);
                    setExpanded(false);
                  }}
                  className={`
                    group relative text-left px-3 py-2 rounded-lg text-sm
                    border border-border bg-background/80
                    hover:border-accent/50 hover:bg-background
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-all duration-200
                  `}
                >
                  <span className="text-muted-foreground group-hover:text-foreground transition-colors line-clamp-2">
                    {suggestion.query}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </AnimatePresence>
  );
}
