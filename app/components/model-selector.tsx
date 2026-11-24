"use client";

import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ModelChoice } from "@/lib/agent-api/models";

const MODEL_OPTIONS: {
  value: ModelChoice;
  label: string;
  description: string;
}[] = [
  { value: "sonnet", label: "Sonnet", description: "Balanced" },
  { value: "haiku", label: "Haiku", description: "Fast" },
  { value: "opus", label: "Opus", description: "Deep" },
];

interface ModelSelectorProps {
  selectedModel: ModelChoice;
  onSelectModel: (model: ModelChoice) => void;
  /** Models with a configured agent. Defaults to all models. */
  models?: ModelChoice[];
}

export function ModelSelector({
  selectedModel,
  onSelectModel,
  models,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const options = models
    ? MODEL_OPTIONS.filter((o) => models.includes(o.value))
    : MODEL_OPTIONS;
  const selectedOption =
    options.find((o) => o.value === selectedModel) ?? options[0];

  const handleSelect = useCallback(
    (model: ModelChoice) => {
      onSelectModel(model);
      setOpen(false);
    },
    [onSelectModel],
  );

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select AI model"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200",
          "border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <span>{selectedOption.label}</span>
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="AI model options"
          className="absolute bottom-full left-0 mb-1 w-40 rounded-lg border border-border bg-popover shadow-md z-50"
        >
          {options.map((option) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === selectedModel}
              onClick={() => handleSelect(option.value)}
              className={cn(
                "flex items-center justify-between px-3 py-2 text-xs cursor-pointer transition-colors",
                "hover:bg-muted",
                option.value === selectedModel && "text-foreground font-medium",
                option.value !== selectedModel && "text-muted-foreground",
              )}
            >
              <span>{option.label}</span>
              <span className="text-muted-foreground/60">
                {option.description}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
