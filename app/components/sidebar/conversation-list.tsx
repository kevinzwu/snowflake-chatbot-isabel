"use client";

import { Button } from "@/app/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/app/components/ui/tooltip";
import {
  useConversations,
  type ConversationSummary,
} from "@/app/hooks/use-conversations";
import { CONVERSATION_RETENTION } from "@/lib/dynamodb/types";
import { cn, formatDistanceToNow } from "@/lib/utils";
import {
  Archive,
  Check,
  Clock,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  X,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation?: (conversationId: string) => void;
}

export function ConversationList({
  activeConversationId,
  onSelectConversation,
  onDeleteConversation,
}: ConversationListProps) {
  const {
    pinnedConversations,
    recentConversations,
    pinnedCount,
    isLoading,
    deleteConversation,
    archiveConversation,
    pinConversation,
    renameConversation,
  } = useConversations();

  const [menuOpen, setMenuOpen] = React.useState<string | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  React.useEffect(() => {
    if (!menuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-2">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-md bg-sidebar-accent"
          />
        ))}
      </div>
    );
  }

  if (pinnedConversations.length === 0 && recentConversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sidebar-accent mb-3">
          <MessageSquare className="h-5 w-5 text-sidebar-muted" />
        </div>
        <p className="text-sm font-medium text-sidebar-foreground">
          No conversations
        </p>
        <p className="text-xs text-sidebar-muted mt-1">
          Start chatting to see history
        </p>
      </div>
    );
  }

  const handleDelete = async (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation();
    setMenuOpen(null);
    const success = await deleteConversation(conversationId);
    if (success) {
      onDeleteConversation?.(conversationId);
    }
  };

  const handleArchive = async (
    e: React.MouseEvent,
    conversationId: string,
    archived: boolean,
  ) => {
    e.stopPropagation();
    setMenuOpen(null);
    await archiveConversation(conversationId, !archived);
  };

  const handlePin = async (
    e: React.MouseEvent,
    conversationId: string,
    pinned: boolean,
  ) => {
    e.stopPropagation();
    setMenuOpen(null);
    await pinConversation(conversationId, !pinned);
  };

  const handleRename = async (
    conversationId: string,
    newTitle: string,
  ): Promise<boolean> => {
    return renameConversation(conversationId, newTitle);
  };

  const handleShare = async (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation();
    setMenuOpen(null);
    try {
      const response = await fetch(
        `/api/conversations/${conversationId}/share`,
        { method: "POST" },
      );
      if (!response.ok) {
        const data = await response.json();
        toast.error(data.message || "Failed to create share link");
        return;
      }
      const data = await response.json();
      const shareUrl = `${window.location.origin}/shared/${data.shareToken}`;
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Share link copied to clipboard");
    } catch {
      toast.error("Failed to create share link");
    }
  };

  const renderConversationItem = (conversation: ConversationSummary) => (
    <ConversationItem
      key={conversation.conversationId}
      conversation={conversation}
      isActive={activeConversationId === conversation.conversationId}
      menuOpen={menuOpen === conversation.conversationId}
      menuRef={menuRef}
      pinnedCount={pinnedCount}
      onSelect={() => onSelectConversation(conversation.conversationId)}
      onMenuToggle={() =>
        setMenuOpen(
          menuOpen === conversation.conversationId
            ? null
            : conversation.conversationId,
        )
      }
      onDelete={(e) => handleDelete(e, conversation.conversationId)}
      onArchive={(e) =>
        handleArchive(e, conversation.conversationId, conversation.archived)
      }
      onPin={(e) =>
        handlePin(e, conversation.conversationId, conversation.pinned)
      }
      onShare={(e) => handleShare(e, conversation.conversationId)}
      onRename={(newTitle) =>
        handleRename(conversation.conversationId, newTitle)
      }
    />
  );

  return (
    <div className="flex flex-col gap-1 p-2">
      {pinnedConversations.length > 0 && (
        <>
          <div className="px-3 py-1.5 text-xs font-medium text-sidebar-muted uppercase tracking-wider">
            Pinned
          </div>
          {pinnedConversations.map(renderConversationItem)}
          <div className="px-3 py-1.5 text-xs font-medium text-sidebar-muted uppercase tracking-wider mt-2">
            Recent
          </div>
        </>
      )}
      {recentConversations.map(renderConversationItem)}
    </div>
  );
}

interface ConversationItemProps {
  conversation: ConversationSummary;
  isActive: boolean;
  menuOpen: boolean;
  menuRef: React.RefObject<HTMLDivElement | null>;
  pinnedCount: number;
  onSelect: () => void;
  onMenuToggle: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onArchive: (e: React.MouseEvent) => void;
  onPin: (e: React.MouseEvent) => void;
  onShare: (e: React.MouseEvent) => void;
  onRename: (newTitle: string) => Promise<boolean>;
}

function ConversationItem({
  conversation,
  isActive,
  menuOpen,
  menuRef,
  pinnedCount,
  onSelect,
  onMenuToggle,
  onDelete,
  onArchive,
  onPin,
  onShare,
  onRename,
}: ConversationItemProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editTitle, setEditTitle] = React.useState(conversation.title);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Focus and select input when entering edit mode
  React.useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    onMenuToggle(); // Close menu
    setEditTitle(conversation.title);
    setIsEditing(true);
  };

  const handleConfirmRename = async () => {
    const trimmed = editTitle.trim();
    if (trimmed.length === 0 || trimmed === conversation.title) {
      setIsEditing(false);
      return;
    }
    const success = await onRename(trimmed.slice(0, 100));
    if (success) {
      setIsEditing(false);
    } else {
      // Revert on failure
      setEditTitle(conversation.title);
      setIsEditing(false);
    }
  };

  const handleCancelRename = () => {
    setEditTitle(conversation.title);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConfirmRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelRename();
    }
  };

  return (
    <div
      className={cn(
        "group relative flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-all duration-200",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
          : "hover:bg-sidebar-accent/60",
        menuOpen && "z-20",
      )}
      onClick={isEditing ? undefined : onSelect}
    >
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
          isActive
            ? "bg-accent/10 text-accent"
            : "bg-sidebar-accent text-sidebar-muted",
        )}
      >
        <MessageSquare className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleConfirmRename}
              maxLength={100}
              className="w-full rounded border border-accent/50 bg-background px-1.5 py-0.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              onClick={(e) => e.stopPropagation()}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 text-green-500 hover:text-green-600"
              onClick={(e) => {
                e.stopPropagation();
                handleConfirmRename();
              }}
            >
              <Check className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                handleCancelRename();
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5 truncate">
              <span
                className={cn(
                  "truncate text-sm",
                  isActive ? "font-medium" : "font-normal",
                )}
              >
                {conversation.title}
              </span>
              {conversation.archived && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Archived
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Won&apos;t auto-delete</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <div className="flex items-center gap-1 text-xs text-sidebar-muted mt-0.5">
              <Clock className="h-3 w-3" />
              <span>{formatDistanceToNow(conversation.updatedAt)}</span>
            </div>
          </>
        )}
      </div>

      {/* Action menu - hidden during editing */}
      {!isEditing && (
        <div
          ref={menuOpen ? menuRef : undefined}
          className={cn(
            "absolute right-2 top-1/2 -translate-y-1/2 transition-all duration-200",
            menuOpen || isActive
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100",
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md hover:bg-sidebar-accent"
            onClick={(e) => {
              e.stopPropagation();
              onMenuToggle();
            }}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 min-w-[140px] rounded-lg border border-sidebar-border bg-sidebar p-1 shadow-lg">
              <button
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                onClick={handleStartRename}
              >
                <Pencil className="h-3.5 w-3.5" />
                Rename
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                onClick={onShare}
              >
                <Link2 className="h-3.5 w-3.5" />
                Share
              </button>
              {conversation.pinned ? (
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                  onClick={onPin}
                >
                  <PinOff className="h-3.5 w-3.5" />
                  Unpin
                </button>
              ) : (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                          pinnedCount >=
                            CONVERSATION_RETENTION.MAX_PINNED_CONVERSATIONS
                            ? "text-sidebar-muted cursor-not-allowed"
                            : "text-sidebar-foreground hover:bg-sidebar-accent",
                        )}
                        onClick={
                          pinnedCount >=
                          CONVERSATION_RETENTION.MAX_PINNED_CONVERSATIONS
                            ? undefined
                            : onPin
                        }
                        disabled={
                          pinnedCount >=
                          CONVERSATION_RETENTION.MAX_PINNED_CONVERSATIONS
                        }
                      >
                        <Pin className="h-3.5 w-3.5" />
                        Pin
                      </button>
                    </TooltipTrigger>
                    {pinnedCount >=
                      CONVERSATION_RETENTION.MAX_PINNED_CONVERSATIONS && (
                      <TooltipContent>
                        Maximum{" "}
                        {CONVERSATION_RETENTION.MAX_PINNED_CONVERSATIONS} pins
                        reached. Unpin one first.
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              )}
              <button
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                onClick={onArchive}
              >
                <Archive className="h-3.5 w-3.5" />
                {conversation.archived ? "Unarchive" : "Archive"}
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                onClick={onDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
