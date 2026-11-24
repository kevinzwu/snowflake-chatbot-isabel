"use client";

import { Button } from "@/app/components/ui/button";
import {
  useSavedQueries,
  type SavedQuery,
} from "@/app/hooks/use-saved-queries";
import { cn } from "@/lib/utils";
import { Bookmark, MoreHorizontal, Play, Trash2 } from "lucide-react";
import * as React from "react";

interface SavedQueriesListProps {
  onSelectQuery: (queryText: string) => void;
}

export function SavedQueriesList({ onSelectQuery }: SavedQueriesListProps) {
  const { queries, isLoading, deleteQuery } = useSavedQueries();
  const [menuOpen, setMenuOpen] = React.useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-2">
        {[...Array(2)].map((_, i) => (
          <div
            key={i}
            className="h-10 animate-pulse rounded-md bg-sidebar-accent"
          />
        ))}
      </div>
    );
  }

  if (queries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sidebar-accent mb-3">
          <Bookmark className="h-5 w-5 text-sidebar-muted" />
        </div>
        <p className="text-sm font-medium text-sidebar-foreground">
          No saved queries
        </p>
        <p className="text-xs text-sidebar-muted mt-1">
          Save prompts to reuse them
        </p>
      </div>
    );
  }

  const handleDelete = async (e: React.MouseEvent, queryId: string) => {
    e.stopPropagation();
    setMenuOpen(null);
    await deleteQuery(queryId);
  };

  const handleRun = (e: React.MouseEvent, queryText: string) => {
    e.stopPropagation();
    setMenuOpen(null);
    onSelectQuery(queryText);
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      {queries.map((query) => (
        <SavedQueryItem
          key={query.queryId}
          query={query}
          menuOpen={menuOpen === query.queryId}
          onSelect={() => onSelectQuery(query.queryText)}
          onMenuToggle={() =>
            setMenuOpen(menuOpen === query.queryId ? null : query.queryId)
          }
          onRun={(e) => handleRun(e, query.queryText)}
          onDelete={(e) => handleDelete(e, query.queryId)}
        />
      ))}
    </div>
  );
}

interface SavedQueryItemProps {
  query: SavedQuery;
  menuOpen: boolean;
  onSelect: () => void;
  onMenuToggle: () => void;
  onRun: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}

function SavedQueryItem({
  query,
  menuOpen,
  onSelect,
  onMenuToggle,
  onRun,
  onDelete,
}: SavedQueryItemProps) {
  return (
    <div
      className={cn(
        "group relative flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent/50",
        menuOpen && "z-20",
      )}
      onClick={onSelect}
    >
      <Bookmark className="h-4 w-4 shrink-0 opacity-70" />
      <div className="flex-1 truncate">
        <div className="truncate font-medium">{query.name}</div>
        {query.description && (
          <div className="truncate text-xs text-muted-foreground">
            {query.description}
          </div>
        )}
      </div>

      {/* Action menu */}
      <div
        className={cn(
          "absolute right-1 top-1/2 -translate-y-1/2 transition-opacity",
          menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            onMenuToggle();
          }}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>

        {menuOpen && (
          <div className="absolute right-0 top-full z-10 mt-1 min-w-[120px] rounded-md border bg-popover p-1 shadow-md">
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              onClick={onRun}
            >
              <Play className="h-4 w-4" />
              Run
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
