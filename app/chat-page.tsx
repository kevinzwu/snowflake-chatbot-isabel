"use client";

import type { ActiveProfileInfo } from "@/lib/agent-api";
import {
  AgentApiState,
  AgentRequestBuildParams,
  CORTEX_ANALYST_TOOL,
  CORTEX_SEARCH_TOOL,
  getAgentName,
  getAvailableModels,
  useAgentAPIQuery,
} from "@/lib/agent-api";
import type { ModelChoice } from "@/lib/agent-api/models";
import type { AgentMessage } from "@/lib/agent-api/types";
import { useAccessToken, useUserSession } from "@/lib/auth";
import type { ProfileHistoryEntry } from "@/lib/dynamodb/types";
import { Loader2, PanelLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import { useAppConfig } from "./components/app-config-provider";
import { AuthButton } from "./components/auth-button";
import { ProfileBadge } from "./components/chat/profile-badge";
import { ProfileSelector } from "./components/chat/profile-selector";
import { ChatInput } from "./components/input";
import { Messages } from "./components/messages";
import { ProfileManagerDialog } from "./components/profile-manager/profile-manager-dialog";
import { ChatSidebar } from "./components/sidebar";
import { SuggestedFollowUps } from "./components/suggested-follow-ups";
import { Button } from "./components/ui/button";
import { useConversation, useConversations } from "./hooks/use-conversations";
import { useProfiles } from "./hooks/use-profiles";

// Wrapper component to handle Suspense for useSearchParams
export function ChatPage() {
  return (
    <Suspense fallback={<HomeLoading />}>
      <Home />
    </Suspense>
  );
}

function HomeLoading() {
  return (
    <div className="flex flex-col min-w-0 h-dvh bg-background">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="animate-pulse h-8 w-32 bg-muted rounded-lg"></div>
        <div className="animate-pulse h-8 w-24 bg-muted rounded-lg"></div>
      </div>
      <div className="flex items-center justify-center flex-1">
        <div className="text-center">
          <div className="h-12 w-12 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground text-sm">Loading Isabel...</p>
        </div>
      </div>
    </div>
  );
}

function Home() {
  const router = useRouter();
  const config = useAppConfig();
  const searchParams = useSearchParams();
  const conversationIdParam = searchParams.get("c");

  const { isAuthenticated, isLoading: sessionLoading } = useUserSession();
  const {
    token: jwtToken,
    isLoading: tokenLoading,
    userContext,
  } = useAccessToken();

  // Conversation management
  const { createConversation, updateConversation } = useConversations();
  const { conversation: loadedConversation } =
    useConversation(conversationIdParam);

  // Track current conversation ID and whether we've loaded it
  const [currentConversationId, setCurrentConversationId] = React.useState<
    string | null
  >(null);
  const [pendingQuery, setPendingQuery] = React.useState<string | null>(null);
  const [initialMessages, setInitialMessages] = React.useState<AgentMessage[]>(
    [],
  );
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const hasLoadedConversation = React.useRef(false);
  // Track user-set custom title (from rename) — if set, auto-save won't overwrite it
  const [customTitle, setCustomTitle] = React.useState<string | null>(null);
  // Model selector state
  const [selectedModel, setSelectedModel] =
    React.useState<ModelChoice>("sonnet");

  const activeAgentName = getAgentName(selectedModel, config.agentNames);
  const availableModels = getAvailableModels(config.agentNames);
  const {
    profiles,
    defaultProfile,
    createProfile,
    updateProfile: updateProfileApi,
    deleteProfile: deleteProfileApi,
  } = useProfiles();
  const [activeProfileId, setActiveProfileId] = React.useState<string | null>(
    null,
  );
  const lastInjectedProfileIdRef = React.useRef<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [profileHistory, setProfileHistory] = React.useState<
    ProfileHistoryEntry[]
  >([]);
  const [profileManagerOpen, setProfileManagerOpen] = React.useState(false);

  const tools: AgentRequestBuildParams["tools"] = [
    CORTEX_SEARCH_TOOL,
    CORTEX_ANALYST_TOOL,
  ];

  const {
    agentState,
    messages,
    setMessages,
    latestAssistantMessageId,
    handleNewMessage,
    stopGeneration,
    resetSession,
    toolStatusMessage,
    suggestedQueries,
  } = useAgentAPIQuery({
    authToken: jwtToken,
    snowflakeUrl: config.snowflakeUrl,
    database: config.database,
    schema: config.schema,
    agentName: activeAgentName,
    experimental: {
      EnableRelatedQueries: true,
    },
    tools,
    toolResources: {
      analyst1: {
        semantic_model_file: config.semanticModelPath,
        execution_environment: {
          type: "warehouse",
          warehouse: config.warehouse,
          query_timeout: 60,
        },
      },
      search1: {
        name: config.searchServicePath,
        max_results: 10,
      },
    },
    initialMessages,
  });

  const agentConfig = {
    database: config.database,
    schema: config.schema,
    agentName: activeAgentName,
  };

  // Load conversation from URL param
  React.useEffect(() => {
    if (
      conversationIdParam &&
      loadedConversation &&
      !hasLoadedConversation.current
    ) {
      // Set messages directly for instant rendering (avoids initialMessages round-trip)
      setMessages(loadedConversation.messages);
      setCurrentConversationId(conversationIdParam);

      // Restore model selection from conversation
      const restoredModel: ModelChoice =
        loadedConversation.model ??
        (loadedConversation.deepThinking ? "opus" : "sonnet");
      setSelectedModel(restoredModel);

      // Detect if the conversation has a user-set custom title
      // by comparing against auto-generated title from first message
      const firstUserMessage = loadedConversation.messages.find(
        (m) => m.role === "user",
      );
      const firstContent = firstUserMessage?.content?.[0];
      const autoTitle =
        firstContent && "text" in firstContent && firstContent.text
          ? firstContent.text.slice(0, 100)
          : "New Conversation";
      if (loadedConversation.title !== autoTitle) {
        setCustomTitle(loadedConversation.title);
      } else {
        setCustomTitle(null);
      }

      hasLoadedConversation.current = true;
    }
  }, [conversationIdParam, loadedConversation, setMessages]);

  // Auto-save conversation on agent idle transitions
  const saveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const prevAgentStateRef = React.useRef<AgentApiState>(AgentApiState.IDLE);
  const lastSavedMessagesRef = React.useRef<AgentMessage[] | null>(null);
  React.useEffect(() => {
    const prevState = prevAgentStateRef.current;
    prevAgentStateRef.current = agentState;

    // Don't save if no messages or agent is still active
    if (messages.length === 0 || agentState !== AgentApiState.IDLE) {
      return;
    }

    // Only save on: (1) transition from active→idle, or (2) messages changed while idle
    const justBecameIdle = prevState !== AgentApiState.IDLE;
    const messagesChanged = messages !== lastSavedMessagesRef.current;

    if (!justBecameIdle && !messagesChanged) {
      return;
    }

    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce save (2 seconds after transition)
    saveTimeoutRef.current = setTimeout(async () => {
      // Double-check messages haven't already been saved (guard against race)
      if (messages === lastSavedMessagesRef.current) return;

      const firstUserMessage = messages.find((m) => m.role === "user");
      const firstContent = firstUserMessage?.content?.[0];
      const titleText =
        firstContent && "text" in firstContent ? firstContent.text : null;
      // Preserve user-set custom title; fall back to auto-generated title
      const title =
        customTitle || titleText?.slice(0, 100) || "New Conversation";

      if (currentConversationId) {
        // Update existing conversation — only pass title if it's auto-generated
        // (custom titles are managed by the rename feature)
        await updateConversation(
          currentConversationId,
          messages,
          customTitle ? undefined : title,
          undefined,
          selectedModel,
        );
      } else {
        // Create new conversation
        const newConv = await createConversation(
          title,
          messages,
          undefined,
          selectedModel,
        );
        if (newConv) {
          setCurrentConversationId(newConv.conversationId);
          // Update URL without navigation
          window.history.replaceState(null, "", `?c=${newConv.conversationId}`);
        }
      }

      lastSavedMessagesRef.current = messages;
    }, 2000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    messages,
    agentState,
    currentConversationId,
    customTitle,
    selectedModel,
    createConversation,
    updateConversation,
  ]);

  // Handle selecting a conversation from sidebar
  const handleSelectConversation = React.useCallback(
    (conversationId: string) => {
      // Ignore clicks on the already-active conversation
      if (conversationId === currentConversationId) return;

      hasLoadedConversation.current = false;
      // Reset session to abort any streaming from previous conversation
      resetSession();
      setCurrentConversationId(conversationId);
      setCustomTitle(null);
      router.push(`?c=${conversationId}`);
    },
    [router, resetSession, currentConversationId],
  );

  // Handle starting a new chat
  const handleNewChat = React.useCallback(() => {
    hasLoadedConversation.current = false;
    setCurrentConversationId(null);
    setInitialMessages([]);
    setCustomTitle(null);
    setSelectedModel("sonnet");
    // Reset profile state for new conversation
    setActiveProfileId(defaultProfile?.profileId ?? null);
    lastInjectedProfileIdRef.current = null;
    setProfileHistory([]);
    // Reset session to abort streaming and clear state
    resetSession();
    router.push("/");
  }, [router, resetSession, defaultProfile]);

  // Handle selecting a saved query
  const handleSelectQuery = React.useCallback((queryText: string) => {
    setPendingQuery(queryText);
  }, []);

  // Wrap handleNewMessage to inject profile context
  const activeProfile: ActiveProfileInfo | null = React.useMemo(() => {
    if (!activeProfileId) return null;
    const p = profiles.find((pr) => pr.profileId === activeProfileId);
    if (!p) return null;
    return { profileId: p.profileId, name: p.name, content: p.content };
  }, [activeProfileId, profiles]);

  const handleNewMessageWithProfile = React.useCallback(
    (input: string, attachments?: unknown[]) => {
      handleNewMessage(input, attachments as never, {
        activeProfile,
        lastInjectedProfileId: lastInjectedProfileIdRef.current,
        onProfileInjected: (profileId: string | null) => {
          lastInjectedProfileIdRef.current = profileId;
          setProfileHistory((prev) => [
            ...prev,
            {
              profileId,
              profileName: activeProfile?.name ?? null,
              appliedAtMessageIndex: messages.length,
            },
          ]);
        },
      });
    },
    [handleNewMessage, activeProfile, messages.length],
  );

  // Handle when a conversation is deleted
  const handleDeleteConversation = React.useCallback(
    (conversationId: string) => {
      // If deleting the active conversation, start a new chat
      if (conversationId === currentConversationId) {
        handleNewChat();
      }
    },
    [currentConversationId, handleNewChat],
  );

  // Submit pending query
  React.useEffect(() => {
    if (pendingQuery && agentState === AgentApiState.IDLE) {
      handleNewMessageWithProfile(pendingQuery);
      setPendingQuery(null);
    }
  }, [pendingQuery, agentState, handleNewMessageWithProfile]);

  // Show loading state while session or token is being fetched
  if (sessionLoading || tokenLoading) {
    return (
      <div className="flex flex-col min-w-0 h-dvh bg-background">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="animate-pulse h-8 w-32 bg-muted rounded-lg"></div>
          <AuthButton />
        </div>
        <div className="flex items-center justify-center flex-1">
          <div className="text-center">
            <div className="h-12 w-12 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-muted-foreground text-sm">Loading Isabel...</p>
          </div>
        </div>
      </div>
    );
  }

  // Show sign-in message if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="flex flex-col min-w-0 h-dvh bg-background">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h1 className="text-lg font-semibold">Isabel</h1>
          <AuthButton />
        </div>
        <div className="flex items-center justify-center flex-1">
          <div className="text-center max-w-md px-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mx-auto mb-6">
              <svg
                className="h-8 w-8 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-2">Authentication Required</h2>
            <p className="text-muted-foreground mb-6">
              Sign in to access the Isabel Security Vulnerability Management
              System.
            </p>
            {userContext && (
              <p className="text-xs text-muted-foreground/60">
                Session: {userContext.sessionId?.slice(0, 8) || "N/A"}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Main application UI for authenticated users
  return (
    <div className="flex h-dvh bg-background">
      {/* Sidebar */}
      <ChatSidebar
        activeConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onSelectQuery={handleSelectQuery}
        onNewChat={handleNewChat}
        onDeleteConversation={handleDeleteConversation}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Main content */}
      <div className="flex flex-col min-w-0 flex-1">
        {/* Minimal header */}
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            {/* Show expand button when sidebar is collapsed */}
            {sidebarCollapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="hidden md:flex h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setSidebarCollapsed(false)}
                title="Show sidebar"
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="flex-1 text-center text-sm text-muted-foreground hidden md:block">
            {config.supportUrl && (
              <a
                href={config.supportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 font-medium underline"
              >
                Questions? Get support
              </a>
            )}
          </div>
          <AuthButton />
        </header>
        {currentConversationId &&
        messages.length === 0 &&
        agentState === AgentApiState.IDLE ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
            <p className="text-sm text-muted-foreground">
              Loading conversation...
            </p>
          </div>
        ) : (
          <Messages
            agentState={agentState}
            messages={messages}
            latestAssistantMessageId={latestAssistantMessageId}
            authToken={jwtToken}
            database={agentConfig.database}
            schema={agentConfig.schema}
            agentName={agentConfig.agentName}
            toolStatusMessage={toolStatusMessage}
            isAdmin={userContext?.isAdmin}
          />
        )}

        {/* Input area */}
        <div className="bg-background">
          <div className="mx-auto px-4 py-4 md:py-6 w-full md:max-w-3xl">
            {/* Profile badge — shows when profile will be applied */}
            {activeProfile &&
              activeProfileId !== lastInjectedProfileIdRef.current && (
                <div className="mb-2">
                  <ProfileBadge
                    profileName={activeProfile.name}
                    alreadyInjected={
                      activeProfileId === lastInjectedProfileIdRef.current
                    }
                  />
                </div>
              )}
            <ChatInput
              isLoading={agentState !== AgentApiState.IDLE}
              messagesLength={messages.length}
              handleSubmit={handleNewMessageWithProfile}
              handleStop={stopGeneration}
              authToken={jwtToken}
              snowflakeUrl={config.snowflakeUrl}
              selectedModel={selectedModel}
              onSelectModel={
                availableModels.length > 1 ? setSelectedModel : undefined
              }
              availableModels={availableModels}
              suggestedQueries={config.suggestedQueries}
              profileSelector={
                <ProfileSelector
                  profiles={profiles}
                  activeProfileId={activeProfileId}
                  onSelectProfile={setActiveProfileId}
                  onManageProfiles={() => setProfileManagerOpen(true)}
                />
              }
            />
          </div>
        </div>
      </div>

      {/* Suggested follow-up queries - floating on the right side */}
      {agentState === AgentApiState.IDLE && suggestedQueries.length > 0 && (
        <SuggestedFollowUps
          queries={suggestedQueries}
          onSelect={handleNewMessageWithProfile}
          disabled={agentState !== AgentApiState.IDLE}
        />
      )}

      {/* Profile manager dialog */}
      <ProfileManagerDialog
        open={profileManagerOpen}
        onOpenChange={setProfileManagerOpen}
        profiles={profiles}
        onCreateProfile={createProfile}
        onUpdateProfile={updateProfileApi}
        onDeleteProfile={deleteProfileApi}
      />
    </div>
  );
}
