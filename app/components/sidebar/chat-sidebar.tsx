"use client";

import { Button } from "@/app/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/app/components/ui/sheet";
import { useConversationSearch } from "@/app/hooks/use-conversation-search";
import { useSavedQueries } from "@/app/hooks/use-saved-queries";
import { cn } from "@/lib/utils";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  FileText,
  History,
  Loader2,
  Menu,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import * as React from "react";
import { ConversationList } from "./conversation-list";
import { SavedQueriesList } from "./saved-queries-list";

interface ChatSidebarProps {
  activeConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
  onSelectQuery: (queryText: string) => void;
  onNewChat: () => void;
  onDeleteConversation?: (conversationId: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function ChatSidebar({
  activeConversationId,
  onSelectConversation,
  onSelectQuery,
  onNewChat,
  onDeleteConversation,
  isCollapsed = false,
  onToggleCollapse,
}: ChatSidebarProps) {
  return (
    <>
      {/* Desktop sidebar - collapsible */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex transition-all duration-200",
          isCollapsed ? "w-0 overflow-hidden border-r-0" : "w-64",
        )}
      >
        <SidebarContent
          activeConversationId={activeConversationId}
          onSelectConversation={onSelectConversation}
          onSelectQuery={onSelectQuery}
          onNewChat={onNewChat}
          onDeleteConversation={onDeleteConversation}
          onToggleCollapse={onToggleCollapse}
        />
      </aside>

      {/* Mobile drawer */}
      <div className="md:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg hover:bg-muted"
            >
              <Menu className="h-5 w-5" />
              <span className="sr-only">Open menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 p-0 bg-sidebar">
            <SheetHeader className="border-b border-sidebar-border px-4 py-3">
              <SheetTitle className="text-sm font-semibold text-sidebar-foreground">
                Chat History
              </SheetTitle>
            </SheetHeader>
            <SidebarContent
              activeConversationId={activeConversationId}
              onSelectConversation={onSelectConversation}
              onSelectQuery={onSelectQuery}
              onNewChat={onNewChat}
              onDeleteConversation={onDeleteConversation}
              isMobile
            />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

interface SidebarContentProps {
  activeConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
  onSelectQuery: (queryText: string) => void;
  onNewChat: () => void;
  onDeleteConversation?: (conversationId: string) => void;
  isMobile?: boolean;
  onToggleCollapse?: () => void;
}

function SidebarContent({
  activeConversationId,
  onSelectConversation,
  onSelectQuery,
  onNewChat,
  onDeleteConversation,
  isMobile,
  onToggleCollapse,
}: SidebarContentProps) {
  const [historyOpen, setHistoryOpen] = React.useState(true);
  const [queriesOpen, setQueriesOpen] = React.useState(true);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  // Search state
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    results: searchResults,
    matchedInContent,
    isSearching,
    clearSearch,
    isActive: isSearchActive,
  } = useConversationSearch();

  // Saved queries for client-side filtering
  const { queries: savedQueries } = useSavedQueries();

  // Client-side filter saved queries by name/description
  const filteredSavedQueries = React.useMemo(() => {
    if (!isSearchActive || searchQuery.trim().length < 2) return [];
    const normalized = searchQuery.toLowerCase().trim();
    return savedQueries.filter(
      (q) =>
        q.name.toLowerCase().includes(normalized) ||
        q.description?.toLowerCase().includes(normalized),
    );
  }, [isSearchActive, searchQuery, savedQueries]);

  // Keyboard shortcut: Cmd+K to focus search
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      // Escape clears search when input is focused
      if (
        e.key === "Escape" &&
        document.activeElement === searchInputRef.current
      ) {
        clearSearch();
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearSearch]);

  return (
    <div className="flex h-full flex-col">
      {/* Logo/Brand area */}
      <div className={cn("px-4 py-4", isMobile && "pt-2")}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="font-semibold text-sidebar-foreground">
              Isabel
            </span>
          </div>
          {!isMobile && onToggleCollapse && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-sidebar-muted hover:text-sidebar-foreground"
              onClick={onToggleCollapse}
              title="Hide sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* New chat button - sleek rounded style */}
        <Button
          variant="outline"
          className="w-full justify-start gap-2 rounded-lg border-dashed border-sidebar-border hover:bg-sidebar-accent hover:border-solid transition-all"
          onClick={onNewChat}
        >
          <Plus className="h-4 w-4" />
          <span className="font-medium">New Chat</span>
        </Button>

        {/* Search bar */}
        <div className="relative mt-3">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-muted pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search chats & queries..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              "w-full rounded-lg border border-sidebar-border bg-sidebar py-1.5 pl-8 pr-8 text-sm text-sidebar-foreground placeholder:text-sidebar-muted/60",
              "focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50",
              "transition-all",
            )}
          />
          {isSearchActive && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-sidebar-muted hover:text-sidebar-foreground transition-colors"
              onClick={clearSearch}
              title="Clear search"
            >
              {isSearching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-2">
        {isSearchActive ? (
          /* Search results mode */
          <SearchResults
            searchResults={searchResults}
            matchedInContent={matchedInContent}
            filteredSavedQueries={filteredSavedQueries}
            isSearching={isSearching}
            searchQuery={searchQuery}
            activeConversationId={activeConversationId}
            onSelectConversation={onSelectConversation}
            onSelectQuery={onSelectQuery}
            onDeleteConversation={onDeleteConversation}
          />
        ) : (
          /* Normal browsing mode */
          <>
            {/* Saved queries section */}
            <div className="mb-2">
              <button
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-muted hover:text-sidebar-foreground transition-colors"
                onClick={() => setQueriesOpen(!queriesOpen)}
              >
                {queriesOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <Bookmark className="h-3 w-3" />
                Saved Queries
              </button>
              {queriesOpen && (
                <SavedQueriesList onSelectQuery={onSelectQuery} />
              )}
            </div>

            {/* History section */}
            <div className="mb-2">
              <button
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-muted hover:text-sidebar-foreground transition-colors"
                onClick={() => setHistoryOpen(!historyOpen)}
              >
                {historyOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <History className="h-3 w-3" />
                History
              </button>
              {historyOpen && (
                <ConversationList
                  activeConversationId={activeConversationId}
                  onSelectConversation={onSelectConversation}
                  onDeleteConversation={onDeleteConversation}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Search results view - replaces the normal sections when search is active.
 */
interface SearchResultsProps {
  searchResults: import("@/lib/dynamodb/types").ConversationSummary[];
  matchedInContent: Record<string, boolean>;
  filteredSavedQueries: import("@/lib/dynamodb/types").SavedQuery[];
  isSearching: boolean;
  searchQuery: string;
  activeConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
  onSelectQuery: (queryText: string) => void;
  onDeleteConversation?: (conversationId: string) => void;
}

function SearchResults({
  searchResults,
  matchedInContent,
  filteredSavedQueries,
  isSearching,
  searchQuery,
  activeConversationId,
  onSelectConversation,
  onSelectQuery,
}: SearchResultsProps) {
  const hasResults =
    searchResults.length > 0 || filteredSavedQueries.length > 0;

  if (isSearching && !hasResults) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-sidebar-muted mb-2" />
        <p className="text-xs text-sidebar-muted">Searching...</p>
      </div>
    );
  }

  if (!isSearching && !hasResults && searchQuery.trim().length >= 2) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <Search className="h-5 w-5 text-sidebar-muted mb-2" />
        <p className="text-sm font-medium text-sidebar-foreground">
          No results found
        </p>
        <p className="text-xs text-sidebar-muted mt-1">
          Try a different search term
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Conversation results */}
      {searchResults.length > 0 && (
        <div>
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-muted">
            <MessageSquare className="h-3 w-3" />
            Conversations ({searchResults.length})
          </div>
          <div className="flex flex-col gap-1 p-1">
            {searchResults.map((conversation) => (
              <button
                key={conversation.conversationId}
                className={cn(
                  "flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm text-left transition-colors",
                  activeConversationId === conversation.conversationId
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/60",
                )}
                onClick={() =>
                  onSelectConversation(conversation.conversationId)
                }
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-sidebar-muted" />
                <div className="flex-1 min-w-0">
                  <div className="truncate">{conversation.title}</div>
                  {matchedInContent[conversation.conversationId] && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-accent mt-0.5">
                      <FileText className="h-2.5 w-2.5" />
                      Matched in messages
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Saved query results */}
      {filteredSavedQueries.length > 0 && (
        <div>
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-muted">
            <Bookmark className="h-3 w-3" />
            Saved Queries ({filteredSavedQueries.length})
          </div>
          <div className="flex flex-col gap-1 p-1">
            {filteredSavedQueries.map((query) => (
              <button
                key={query.queryId}
                className="flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm text-left transition-colors hover:bg-sidebar-accent/60"
                onClick={() => onSelectQuery(query.queryText)}
              >
                <Bookmark className="h-3.5 w-3.5 shrink-0 text-sidebar-muted" />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{query.name}</div>
                  {query.description && (
                    <div className="truncate text-xs text-sidebar-muted">
                      {query.description}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Mobile trigger button to be placed in header.
 */
export function SidebarTrigger() {
  return (
    <div className="md:hidden">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg">
            <Menu className="h-5 w-5" />
            <span className="sr-only">Open menu</span>
          </Button>
        </SheetTrigger>
      </Sheet>
    </div>
  );
}
