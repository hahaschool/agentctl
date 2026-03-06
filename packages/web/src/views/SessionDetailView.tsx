'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Breadcrumb } from '@/components/Breadcrumb';
import { CopyableText } from '@/components/CopyableText';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AnsiSpan, AnsiText } from '../components/AnsiText';
import { ConfirmButton } from '../components/ConfirmButton';
import { MarkdownContent } from '../components/MarkdownContent';
import { ErrorBanner } from '../components/ErrorBanner';
import { FetchingBar } from '../components/FetchingBar';
import { FileBrowser } from '../components/FileBrowser';
import { GitStatusBadge } from '../components/GitStatusBadge';
import { LastUpdated } from '../components/LastUpdated';
import { LiveTimeAgo } from '../components/LiveTimeAgo';
import { PathBadge } from '../components/PathBadge';
import { ProgressIndicator } from '../components/ProgressIndicator';
import { RefreshButton } from '../components/RefreshButton';
import { SubagentBlock } from '../components/SubagentBlock';
import { TerminalView } from '../components/TerminalView';
import { ThinkingBlock } from '../components/ThinkingBlock';
import { TodoBlock } from '../components/TodoBlock';
import { useHotkeys } from '../hooks/use-hotkeys';
import type { SessionStreamEvent } from '../hooks/use-session-stream';
import { useSessionStream } from '../hooks/use-session-stream';
import type { Session, SessionContentMessage, SessionMetadata } from '../lib/api';
import { formatDuration, formatNumber, formatTime } from '../lib/format-utils';
import { getMessageStyle } from '../lib/message-styles';
import {
  accountsQuery,
  queryKeys,
  sessionContentQuery,
  sessionQuery,
  useDeleteSession,
  useForkSession,
  useResumeSession,
  useSendMessage,
} from '../lib/queries';

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportSessionAsJson(session: Session, messages: SessionContentMessage[]): void {
  const data = {
    session: {
      id: session.id,
      agentId: session.agentId,
      machineId: session.machineId,
      claudeSessionId: session.claudeSessionId,
      status: session.status,
      projectPath: session.projectPath,
      model: session.model,
      accountId: session.accountId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      metadata: session.metadata,
    },
    messages: messages.map((m) => ({
      type: m.type,
      content: m.content,
      timestamp: m.timestamp ?? null,
      toolName: m.toolName ?? null,
    })),
    exportedAt: new Date().toISOString(),
  };
  const json = JSON.stringify(data, null, 2);
  const filename = `session-${session.id.slice(0, 12)}-${Date.now()}.json`;
  downloadFile(json, filename, 'application/json');
}

function formatMessageLabel(type: string): string {
  switch (type) {
    case 'human':
      return 'Human';
    case 'assistant':
      return 'Assistant';
    case 'tool_use':
      return 'Tool Call';
    case 'tool_result':
      return 'Tool Result';
    case 'thinking':
      return 'Thinking';
    case 'progress':
      return 'Progress';
    case 'subagent':
      return 'Subagent';
    case 'todo':
      return 'Tasks';
    default:
      return type;
  }
}

function exportSessionAsMarkdown(session: Session, messages: SessionContentMessage[]): void {
  const lines: string[] = [];

  lines.push(`# Session ${session.id}`);
  lines.push('');

  const metaParts: string[] = [];
  metaParts.push(`**Status:** ${session.status}`);
  metaParts.push(`**Model:** ${session.model ?? '(default)'}`);
  metaParts.push(`**Started:** ${session.startedAt}`);
  if (session.endedAt) metaParts.push(`**Ended:** ${session.endedAt}`);
  metaParts.push(`**Machine:** ${session.machineId}`);
  if (session.projectPath) metaParts.push(`**Project:** ${session.projectPath}`);
  lines.push(metaParts.join(' | '));
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Messages');
  lines.push('');

  for (const msg of messages) {
    const label = formatMessageLabel(msg.type);
    const timestamp = msg.timestamp ? ` _(${msg.timestamp})_` : '';
    const toolSuffix = msg.toolName ? ` \`${msg.toolName}\`` : '';

    lines.push(`### ${label}${toolSuffix}${timestamp}`);
    lines.push('');

    const content = msg.content ?? '';
    if (msg.type === 'tool_use' || msg.type === 'tool_result') {
      lines.push('```');
      lines.push(content);
      lines.push('```');
    } else {
      lines.push(content);
    }
    lines.push('');
  }

  const md = lines.join('\n');
  const filename = `session-${session.id.slice(0, 12)}-${Date.now()}.md`;
  downloadFile(md, filename, 'text/markdown');
}

// ---------------------------------------------------------------------------
// Session detail view
// ---------------------------------------------------------------------------

export function SessionDetailView(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const session = useQuery(sessionQuery(sessionId));
  const s = session.data;

  // We need the Claude session ID (not the RC session ID) to fetch content
  const claudeSessionId = s?.claudeSessionId ?? '';
  const [contentLimit, setContentLimit] = useState(2000);
  const content = useQuery({
    ...sessionContentQuery(claudeSessionId, {
      machineId: s?.machineId ?? '',
      projectPath: s?.projectPath ?? undefined,
      limit: contentLimit,
    }),
    enabled: !!claudeSessionId && !!s?.machineId,
    refetchInterval: s?.status === 'active' || s?.status === 'starting' ? 2_000 : false,
    refetchOnWindowFocus: true,
  });

  const refetchAll = useCallback(() => {
    void session.refetch();
    void content.refetch();
  }, [session.refetch, content.refetch]);

  // SSE streaming — connect when session is active for real-time updates
  const isActive = s?.status === 'active' || s?.status === 'starting';
  const clearStreamRef = useRef<() => void>(() => {});
  const stream = useSessionStream({
    sessionId,
    enabled: isActive,
    onEvent: useCallback(
      (event: SessionStreamEvent) => {
        if (event.event === 'status' || event.event === 'loop_complete') {
          void session.refetch();
          void content.refetch();
          // Clear stream output so polled messages replace it without duplication
          clearStreamRef.current();
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [content.refetch, session.refetch],
    ),
  });
  clearStreamRef.current = stream.clearStreamOutput;

  // Invalidate session query when SSE status changes (instead of waiting for poll interval)
  const queryClient = useQueryClient();
  useEffect(() => {
    if (stream.latestStatus) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
      // Also refetch content when status changes
      void queryClient.invalidateQueries({ queryKey: ['session-content'] });
    }
  }, [stream.latestStatus, sessionId, queryClient]);

  // Clear pending user messages once JSONL content includes matching human messages
  const contentMessages = content.data?.messages ?? [];
  useEffect(() => {
    if (stream.pendingUserMessages.length === 0) return;
    const humanMessages = contentMessages
      .filter((m) => m.type === 'human')
      .map((m) => m.content?.trim());
    const allFound = stream.pendingUserMessages.every((text) =>
      humanMessages.includes(text.trim()),
    );
    if (allFound) {
      stream.clearPendingMessages();
    }
  }, [contentMessages, stream.pendingUserMessages, stream.clearPendingMessages]);

  // Optimistic messages — shown immediately when user sends, cleared when JSONL catches up
  const [optimisticMessages, setOptimisticMessages] = useState<string[]>([]);
  const addOptimisticMessage = useCallback((text: string) => {
    setOptimisticMessages((prev) => [...prev, text]);
  }, []);

  // Clear optimistic messages when they appear in JSONL content
  useEffect(() => {
    if (optimisticMessages.length === 0) return;
    const humanTexts = contentMessages
      .filter((m) => m.type === 'human')
      .map((m) => m.content?.trim());
    setOptimisticMessages((prev) =>
      prev.filter((text) => !humanTexts.includes(text.trim())),
    );
  }, [contentMessages, optimisticMessages.length]);

  // View mode toggle (messages vs terminal)
  const [viewMode, setViewMode] = useState<'messages' | 'terminal'>('messages');

  // File browser panel toggle
  const [showFiles, setShowFiles] = useState(false);
  const toggleFiles = useCallback(() => setShowFiles((prev) => !prev), []);

  useHotkeys(useMemo(() => ({ r: refetchAll, f: toggleFiles }), [refetchAll, toggleFiles]));

  if (session.isLoading) {
    return <LoadingState />;
  }

  if (session.error || !s) {
    return <ErrorState error={session.error?.message ?? 'Session not found'} />;
  }

  return (
    <div className="relative h-full flex flex-col">
      <FetchingBar isFetching={content.isFetching && !content.isLoading} />
      {/* Top bar */}
      <SessionHeader
        session={s}
        messages={content.data?.messages ?? []}
        dataUpdatedAt={content.dataUpdatedAt || session.dataUpdatedAt}
        isFetching={(content.isFetching || session.isFetching) && !content.isLoading}
        onRefresh={refetchAll}
        streamConnected={stream.connected}
        streamCost={stream.latestCost}
        showFiles={showFiles}
        onToggleFiles={toggleFiles}
      />

      {/* Content area */}
      <div className="flex-1 overflow-hidden flex">
        {/* Messages / Terminal panel */}
        <div className={cn('flex-1 overflow-hidden flex flex-col', showFiles && 'w-1/2')}>
          {viewMode === 'messages' ? (
            <MessageList
              messages={content.data?.messages ?? []}
              totalMessages={content.data?.totalMessages ?? 0}
              isLoading={content.isLoading}
              error={content.error?.message}
              isActive={s.status === 'active'}
              streamOutput={stream.streamOutput}
              streamConnected={stream.connected}
              pendingUserMessages={stream.pendingUserMessages}
              optimisticMessages={optimisticMessages}
              onLoadMore={() => setContentLimit((prev) => prev * 2)}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            />
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Terminal toolbar */}
              <div className="px-5 py-1.5 border-b border-border flex items-center gap-3 text-[11px] text-muted-foreground shrink-0 bg-background">
                <ViewModeToggle viewMode={viewMode} onViewModeChange={setViewMode} />
              </div>
              <TerminalView rawOutput={stream.rawOutput} isActive={isActive} className="flex-1 min-h-0" />
            </div>
          )}

          {/* Input area */}
          <MessageInput session={s} onOptimisticSend={addOptimisticMessage} />
        </div>

        {/* File browser panel */}
        {showFiles && (
          <div className="w-1/2 overflow-hidden">
            <FileBrowser
              machineId={s.machineId}
              initialPath={s.projectPath ?? undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function SessionHeader({
  session,
  messages,
  dataUpdatedAt,
  isFetching,
  onRefresh,
  streamConnected,
  streamCost,
  showFiles,
  onToggleFiles,
}: {
  session: Session;
  messages: SessionContentMessage[];
  dataUpdatedAt: number;
  isFetching: boolean;
  onRefresh: () => void;
  streamConnected?: boolean;
  streamCost?: { totalCostUsd: number; inputTokens: number; outputTokens: number } | null;
  showFiles?: boolean;
  onToggleFiles?: () => void;
}): React.JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const deleteSession = useDeleteSession();
  const forkSession = useForkSession();
  const queryClient = useQueryClient();
  const accounts = useQuery(accountsQuery());
  const [forkPrompt, setForkPrompt] = useState('');
  const [showFork, setShowFork] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const accountName = useMemo(() => {
    if (!session.accountId || !accounts.data) return null;
    const found = accounts.data.find((a) => a.id === session.accountId);
    return found?.name ?? null;
  }, [session.accountId, accounts.data]);

  // Close export menu when clicking outside
  useEffect(() => {
    if (!showExportMenu) return;
    function handleClickOutside(e: MouseEvent): void {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showExportMenu]);

  const handleEnd = useCallback(() => {
    deleteSession.mutate(session.id, {
      onSuccess: () => {
        toast.success('Session ended');
        void queryClient.invalidateQueries({ queryKey: queryKeys.session(session.id) });
      },
      onError: (err) => toast.error(err.message),
    });
  }, [session.id, deleteSession, toast, queryClient]);

  const handleFork = useCallback(() => {
    if (!forkPrompt.trim()) return;
    forkSession.mutate(
      { id: session.id, prompt: forkPrompt.trim() },
      {
        onSuccess: (data) => {
          toast.success(`Forked! New session: ${data.sessionId.slice(0, 12)}...`);
          setShowFork(false);
          setForkPrompt('');
          // Navigate to the new session after a brief delay to let the toast appear
          setTimeout(() => {
            router.push(`/sessions/${data.sessionId}`);
          }, 500);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }, [session.id, forkPrompt, forkSession, toast, router]);

  const canFork =
    !!session.claudeSessionId && (session.status === 'ended' || session.status === 'error' || session.status === 'paused');

  return (
    <div className="px-5 py-3 border-b border-border shrink-0 bg-card">
      <div className="flex items-center gap-3 mb-2">
        <Breadcrumb
          items={[{ label: 'Sessions', href: '/sessions' }, { label: session.id.slice(0, 12) }]}
        />
        <StatusBadge status={session.status} />
        {session.status === 'active' && (
          <output
            className={cn(
              'text-[11px] animate-pulse',
              streamConnected ? 'text-green-500' : 'text-yellow-500',
            )}
            aria-live="polite"
          >
            {streamConnected ? 'Streaming' : 'Live'}
          </output>
        )}
        <div className="ml-auto flex items-center gap-2">
          <LastUpdated dataUpdatedAt={dataUpdatedAt} />
          <RefreshButton onClick={onRefresh} isFetching={isFetching} />
          {onToggleFiles && (
            <button
              type="button"
              onClick={onToggleFiles}
              className={cn(
                'px-3 py-1 border rounded-md text-xs cursor-pointer',
                showFiles
                  ? 'bg-primary text-primary-foreground border-primary hover:opacity-90'
                  : 'bg-muted text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground',
              )}
              title="Toggle file browser (F)"
            >
              Files
            </button>
          )}
          <div className="relative" ref={exportMenuRef}>
            <button
              type="button"
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="px-3 py-1 bg-muted text-muted-foreground border border-border rounded-md text-xs cursor-pointer hover:bg-accent hover:text-accent-foreground"
            >
              Export
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-lg min-w-[160px]">
                <button
                  type="button"
                  onClick={() => {
                    exportSessionAsJson(session, messages);
                    setShowExportMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs text-popover-foreground hover:bg-accent cursor-pointer border-none bg-transparent"
                >
                  Export as JSON
                </button>
                <button
                  type="button"
                  onClick={() => {
                    exportSessionAsMarkdown(session, messages);
                    setShowExportMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs text-popover-foreground hover:bg-accent cursor-pointer border-none bg-transparent border-t border-t-border"
                >
                  Export as Markdown
                </button>
              </div>
            )}
          </div>
          {canFork && (
            <button
              type="button"
              onClick={() => setShowFork(!showFork)}
              className="px-3 py-1 bg-blue-900/50 text-blue-300 border border-blue-800/50 rounded-md text-xs cursor-pointer hover:bg-blue-900"
            >
              Fork
            </button>
          )}
          {(session.status === 'active' || session.status === 'starting') && (
            <ConfirmButton
              label="End Session"
              confirmLabel="Confirm End?"
              onConfirm={handleEnd}
              className="px-3 py-1 bg-red-900/50 text-red-300 border border-red-800/50 rounded-md text-xs cursor-pointer hover:bg-red-900"
              confirmClassName="px-3 py-1 bg-red-700 text-white border border-red-600 rounded-md text-xs cursor-pointer animate-pulse"
            />
          )}
        </div>
      </div>

      {/* Fork input */}
      {showFork && (
        <div className="mb-2 space-y-2">
          <div className="flex gap-2 items-end">
            <input
              type="text"
              value={forkPrompt}
              onChange={(e) => setForkPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFork();
                if (e.key === 'Escape') {
                  setShowFork(false);
                  setForkPrompt('');
                }
              }}
              placeholder="Prompt for the forked session..."
              className="flex-1 px-3 py-1.5 bg-muted text-foreground border border-border rounded-md text-[12px] outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            />
            <button
              type="button"
              onClick={handleFork}
              disabled={!forkPrompt.trim() || forkSession.isPending}
              className="px-3 py-1.5 bg-blue-700 text-white rounded-md text-xs cursor-pointer disabled:opacity-50"
            >
              {forkSession.isPending ? 'Forking...' : 'Fork Session'}
            </button>
          </div>
          {session.status === 'error' && (() => {
            const errMsg = (session.metadata?.errorMessage ?? '').toLowerCase();
            const isQuotaOrAuth = /quota|rate.?limit|authentication|unauthorized|key\b/.test(errMsg);
            return isQuotaOrAuth ? (
              <div className="px-3 py-2 bg-red-900/30 border border-red-700/50 rounded-md text-[11px] text-red-300">
                This session failed due to quota or authentication issues. Resolve the underlying issue before forking.
              </div>
            ) : (
              <div className="px-3 py-2 bg-yellow-900/30 border border-yellow-700/50 rounded-md text-[11px] text-yellow-300">
                This session ended with an error. The forked session may also fail if the error is unresolved.
              </div>
            );
          })()}
        </div>
      )}

      {/* Metadata row */}
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1">
          ID: <CopyableText value={session.id} maxDisplay={12} />
        </span>
        {session.claudeSessionId && (
          <span className="flex items-center gap-1">
            Claude: <CopyableText value={session.claudeSessionId} maxDisplay={12} />
          </span>
        )}
        <span>
          Machine: <CopyableText value={session.machineId} maxDisplay={12} />
        </span>
        {session.pid && (
          <span className="font-mono bg-muted px-1.5 py-0.5 rounded-sm border border-border">
            PID {session.pid}
          </span>
        )}
        {session.projectPath && <PathBadge path={session.projectPath} />}
        <span className="flex items-center gap-1">
          Account:{' '}
          {session.accountId ? (
            accountName ? (
              <span title={session.accountId}>{accountName}</span>
            ) : (
              <CopyableText value={session.accountId} maxDisplay={12} />
            )
          ) : (
            <span className="italic text-muted-foreground/60">(default account)</span>
          )}
        </span>
        <span className="font-mono bg-purple-500/10 text-purple-400 px-1.5 py-0.5 rounded-sm border border-purple-500/30">
          {session.model ?? '(default)'}
        </span>
        <span>
          Started <LiveTimeAgo date={session.startedAt} />
        </span>
        {session.endedAt && (
          <span>Duration: {formatDuration(session.startedAt, session.endedAt)}</span>
        )}
        {!session.endedAt && session.status === 'active' && (
          <span>Running for {formatDuration(session.startedAt)}</span>
        )}
        {streamCost && (
          <span className="font-mono bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded-sm border border-amber-500/30">
            ${streamCost.totalCostUsd.toFixed(4)}
          </span>
        )}
      </div>

      {/* Git status */}
      {session.projectPath && session.machineId && (
        <div className="mt-2">
          <GitStatusBadge machineId={session.machineId} projectPath={session.projectPath} />
        </div>
      )}

      {/* Error details */}
      {session.status === 'error' && (
        <div className="mt-2 px-3 py-2 rounded-md bg-red-950/50 border border-red-900/50 text-[12px] text-red-300 space-y-1">
          <div>
            <span className="font-semibold text-red-400">Error: </span>
            {session.metadata?.errorMessage ?? 'Session ended with an error (no details available)'}
          </div>
          {session.metadata?.errorHint && (
            <div className="text-yellow-300/90">
              <span className="font-semibold text-yellow-400">Hint: </span>
              {session.metadata.errorHint}
            </div>
          )}
        </div>
      )}

      {/* Starting indicator */}
      {session.status === 'starting' && (
        <div className="mt-2 px-3 py-2 rounded-md bg-yellow-950/40 border border-yellow-900/40 text-[12px] text-yellow-300 animate-pulse">
          Waiting for worker to start session...
        </div>
      )}

      {/* Cost / Model metadata (when available) */}
      <SessionMetadataBadges metadata={session.metadata} streamCost={streamCost} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message list
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// View mode toggle (Messages / Terminal)
// ---------------------------------------------------------------------------

function ViewModeToggle({
  viewMode,
  onViewModeChange,
}: {
  viewMode: 'messages' | 'terminal';
  onViewModeChange: (mode: 'messages' | 'terminal') => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center rounded-md border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => onViewModeChange('messages')}
        className={cn(
          'px-2 py-0.5 text-[10px] cursor-pointer transition-colors border-none',
          viewMode === 'messages'
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        Messages
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange('terminal')}
        className={cn(
          'px-2 py-0.5 text-[10px] cursor-pointer transition-colors border-none',
          viewMode === 'terminal'
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        Terminal
      </button>
    </div>
  );
}

function MessageList({
  messages,
  totalMessages,
  isLoading,
  error,
  isActive,
  streamOutput,
  streamConnected,
  pendingUserMessages,
  optimisticMessages,
  onLoadMore,
  viewMode,
  onViewModeChange,
}: {
  messages: SessionContentMessage[];
  totalMessages: number;
  isLoading: boolean;
  error?: string;
  isActive: boolean;
  streamOutput?: string[];
  streamConnected?: boolean;
  pendingUserMessages?: string[];
  optimisticMessages?: string[];
  onLoadMore?: () => void;
  viewMode: 'messages' | 'terminal';
  onViewModeChange: (mode: 'messages' | 'terminal') => void;
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [showTools, setShowTools] = useState(false);
  const [showThinking, setShowThinking] = useState(true);
  const [showProgress, setShowProgress] = useState(isActive);
  const [renderMarkdown, setRenderMarkdown] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [search, setSearch] = useState('');

  // Always show: human, assistant, subagent, todo
  // Toggle: tool_use/tool_result (showTools), thinking (showThinking), progress (showProgress)
  const visibleMessages = messages.filter((m) => {
    if (m.type === 'human' || m.type === 'assistant' || m.type === 'subagent' || m.type === 'todo') return true;
    if (m.type === 'tool_use' || m.type === 'tool_result') return showTools;
    if (m.type === 'thinking') return showThinking;
    if (m.type === 'progress') return showProgress;
    return false;
  });

  // Apply text search filter
  const searchFiltered = search
    ? visibleMessages.filter((m) => (m.content ?? '').toLowerCase().includes(search.toLowerCase()))
    : visibleMessages;

  // --- Lightweight windowing for large message lists ---
  const WINDOW_SIZE = 50;
  const OVERSCAN = 10;
  const EST_MSG_HEIGHT = 60; // estimated px per message
  const WINDOWING_THRESHOLD = 200;
  const shouldWindow = searchFiltered.length > WINDOWING_THRESHOLD;
  const [windowEnd, setWindowEnd] = useState(searchFiltered.length);
  const windowDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep windowEnd pinned to end when autoScroll is on or messages change
  useEffect(() => {
    if (autoScroll || !shouldWindow) {
      setWindowEnd(searchFiltered.length);
    }
  }, [autoScroll, searchFiltered.length, shouldWindow]);

  const handleWindowScroll = useCallback(() => {
    if (!shouldWindow || !scrollRef.current) return;
    if (windowDebounceRef.current) clearTimeout(windowDebounceRef.current);
    windowDebounceRef.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      const scrollRatio = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
      const centerIndex = Math.floor(scrollRatio * searchFiltered.length);
      const newEnd = Math.min(searchFiltered.length, centerIndex + Math.floor(WINDOW_SIZE / 2) + OVERSCAN);
      setWindowEnd(newEnd);
    }, 200);
  }, [shouldWindow, searchFiltered.length]);

  const winStart = shouldWindow ? Math.max(0, windowEnd - WINDOW_SIZE - OVERSCAN * 2) : 0;
  const winEnd = shouldWindow ? windowEnd : searchFiltered.length;
  const windowedMessages = searchFiltered.slice(winStart, winEnd);
  const topSpacerHeight = shouldWindow ? winStart * EST_MSG_HEIGHT : 0;
  const bottomSpacerHeight = shouldWindow ? (searchFiltered.length - winEnd) * EST_MSG_HEIGHT : 0;

  // Auto-scroll to bottom when new messages or stream output arrive
  const prevCountRef = useRef(0);
  const prevStreamLenRef = useRef(0);
  const prevPendingRef = useRef(0);
  const prevOptimisticRef = useRef(0);
  useEffect(() => {
    const count = visibleMessages.length;
    const streamLen = streamOutput?.length ?? 0;
    const pendingLen = pendingUserMessages?.length ?? 0;
    const optimisticLen = optimisticMessages?.length ?? 0;
    const prevStreamLen = prevStreamLenRef.current;
    const changed = count !== prevCountRef.current || streamLen !== prevStreamLen || pendingLen !== prevPendingRef.current || optimisticLen !== prevOptimisticRef.current;
    prevCountRef.current = count;
    prevStreamLenRef.current = streamLen;
    prevPendingRef.current = pendingLen;
    prevOptimisticRef.current = optimisticLen;
    if (changed && autoScroll && scrollRef.current) {
      // Use instant for stream output (frequent updates), smooth for new messages
      const behavior = streamLen !== prevStreamLen ? 'instant' as const : 'smooth' as const;
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior });
      });
    }
  }, [visibleMessages.length, streamOutput?.length, pendingUserMessages?.length, optimisticMessages?.length, autoScroll]);

  // Detect user scrolling up to pause auto-scroll
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    setAutoScroll(isAtBottom);
    setUserScrolledUp(!isAtBottom);
    handleWindowScroll();
  }, [handleWindowScroll]);

  // Cmd+F / Ctrl+F to focus search input
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="px-5 py-1.5 border-b border-border flex items-center gap-3 text-[11px] text-muted-foreground shrink-0 bg-background">
        <ViewModeToggle viewMode={viewMode} onViewModeChange={onViewModeChange} />
        <span>{formatNumber(messages.length)}{messages.length < totalMessages ? ` / ${formatNumber(totalMessages)}` : ''} messages</span>
        {searchFiltered.length !== messages.length && (
          <span>{formatNumber(searchFiltered.length)} shown</span>
        )}
        <button
          type="button"
          onClick={() => setShowThinking(!showThinking)}
          aria-label={showThinking ? 'Hide thinking' : 'Show thinking'}
          aria-pressed={showThinking}
          className={cn(
            'px-2 py-0.5 rounded-md border border-border text-[10px] cursor-pointer transition-colors',
            showThinking ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' : 'bg-muted text-muted-foreground',
          )}
        >
          Thinking
        </button>
        <button
          type="button"
          onClick={() => setShowTools(!showTools)}
          aria-label={showTools ? 'Hide tool messages' : 'Show tool messages'}
          aria-pressed={showTools}
          className={cn(
            'px-2 py-0.5 rounded-md border border-border text-[10px] cursor-pointer transition-colors',
            showTools ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' : 'bg-muted text-muted-foreground',
          )}
        >
          Tools
        </button>
        <button
          type="button"
          onClick={() => setShowProgress(!showProgress)}
          aria-label={showProgress ? 'Hide progress' : 'Show progress'}
          aria-pressed={showProgress}
          className={cn(
            'px-2 py-0.5 rounded-md border border-border text-[10px] cursor-pointer transition-colors',
            showProgress ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' : 'bg-muted text-muted-foreground',
          )}
        >
          Progress
        </button>
        <button
          type="button"
          onClick={() => setRenderMarkdown(!renderMarkdown)}
          aria-label={renderMarkdown ? 'Show raw text' : 'Render markdown'}
          aria-pressed={renderMarkdown}
          className={cn(
            'px-2 py-0.5 rounded-md border border-border text-[10px] cursor-pointer transition-colors',
            renderMarkdown ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' : 'bg-muted text-muted-foreground',
          )}
        >
          Markdown
        </button>
        <div className="flex items-center gap-1.5 ml-1">
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearch('');
                searchRef.current?.blur();
              }
            }}
            placeholder="Search messages..."
            className="px-2 py-0.5 bg-muted text-foreground border border-border rounded-md text-[11px] outline-none w-[140px] placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          />
          {search && (
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {searchFiltered.length} {searchFiltered.length === 1 ? 'match' : 'matches'}
            </span>
          )}
        </div>
        {userScrolledUp && (
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true);
              setUserScrolledUp(false);
              if (scrollRef.current) {
                scrollRef.current.scrollTo({
                  top: scrollRef.current.scrollHeight,
                  behavior: 'smooth',
                });
              }
            }}
            aria-label="Jump to bottom of conversation"
            className="ml-auto px-2 py-0.5 bg-primary text-primary-foreground rounded-md text-[10px] cursor-pointer"
          >
            {isActive ? 'Follow output' : 'Jump to bottom'}
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto px-5 py-3 space-y-2"
      >
        {isLoading && (
          <div className="p-4 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={`msg-sk-${String(i)}`}
                className={cn('rounded-lg p-3', i % 2 === 0 ? 'ml-0 mr-8' : 'ml-8 mr-0')}
              >
                <Skeleton className="h-3 w-16 mb-2" />
                <Skeleton className="h-3 w-full mb-1" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            ))}
          </div>
        )}

        {error && <ErrorBanner message={error} />}

        {!isLoading && searchFiltered.length === 0 && !search && (
          <div className="p-8 text-center text-muted-foreground text-[13px]">No messages yet</div>
        )}

        {!isLoading && search && searchFiltered.length === 0 && (
          <div className="p-8 text-center text-muted-foreground text-[13px]">No messages match &ldquo;{search}&rdquo;</div>
        )}

        {totalMessages > messages.length && (
          <div className="py-2 text-center text-xs">
            <button
              type="button"
              className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer"
              onClick={onLoadMore}
            >
              Load older messages ({formatNumber(totalMessages - messages.length)} more)
            </button>
            <span className="text-muted-foreground ml-2">
              — showing last {formatNumber(messages.length)} of {formatNumber(totalMessages)}
            </span>
          </div>
        )}

        {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} aria-hidden />}
        {groupToolPairs(windowedMessages, winStart).map((item) =>
          item.kind === 'tool_pair' ? (
            <ToolPairBlock key={item.key} toolUse={item.toolUse} toolResult={item.toolResult} />
          ) : (
            <MessageBlock key={item.key} message={item.message} renderMarkdown={renderMarkdown} />
          ),
        )}
        {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} aria-hidden />}

        {/* Optimistic user messages (shown instantly on send, before any SSE/JSONL) */}
        {optimisticMessages && optimisticMessages.length > 0 &&
          optimisticMessages.map((text, i) => (
            <div key={`optimistic-${String(i)}`} className="relative">
              <div className="px-3 py-2 rounded-lg border-l-[3px] bg-blue-500/[0.06] border-l-blue-400 opacity-80">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[11px] font-semibold text-blue-400">You</span>
                  <span className="text-[9px] text-muted-foreground/60 animate-pulse">sending...</span>
                </div>
                <div className="text-[13px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
                  {text}
                </div>
              </div>
            </div>
          ))}

        {/* Pending user messages from SSE (shown before JSONL poll catches up) */}
        {pendingUserMessages && pendingUserMessages.length > 0 &&
          pendingUserMessages
            .filter((text) => !(optimisticMessages ?? []).includes(text))
            .map((text, i) => (
              <MessageBubble
                key={`pending-user-${String(i)}`}
                message={{ type: 'human', content: text, timestamp: new Date().toISOString() }}
                renderMarkdown={renderMarkdown}
              />
            ))}

        {/* Live streaming output */}
        {streamConnected && streamOutput && streamOutput.length > 0 && (
          <div className="rounded-lg border border-green-500/20 bg-green-950/20 p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[10px] font-semibold text-green-500">Streaming</span>
            </div>
            <AnsiText className="text-[12px] text-foreground/90 whitespace-pre-wrap font-mono leading-relaxed max-h-[400px] overflow-auto m-0">
              {streamOutput.join('')}
            </AnsiText>
          </div>
        )}
      </div>

      {/* Floating scroll-to-bottom button */}
      {userScrolledUp && (
        <button
          type="button"
          onClick={() => {
            setAutoScroll(true);
            setUserScrolledUp(false);
            if (scrollRef.current) {
              scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
            }
          }}
          className="absolute bottom-4 right-6 z-10 px-3 py-2 bg-primary text-primary-foreground rounded-full shadow-lg text-xs font-medium cursor-pointer hover:bg-primary/90 transition-opacity"
          aria-label="Scroll to bottom"
        >
          {isActive ? 'Follow output' : 'Scroll to bottom'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool pair grouping — pairs tool_use + tool_result by toolId
// ---------------------------------------------------------------------------

type RenderedItem =
  | { kind: 'message'; message: SessionContentMessage; key: string }
  | { kind: 'tool_pair'; toolUse: SessionContentMessage; toolResult: SessionContentMessage; key: string };

function groupToolPairs(messages: SessionContentMessage[], startIndex: number): RenderedItem[] {
  // Build a map of toolId -> tool_result for quick lookup
  const resultsByToolId = new Map<string, SessionContentMessage>();
  for (const m of messages) {
    if (m.type === 'tool_result' && m.toolId) {
      resultsByToolId.set(m.toolId, m);
    }
  }

  // Track which tool_result messages were consumed by a pair
  const consumedToolResults = new Set<string>();
  const items: RenderedItem[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as SessionContentMessage;

    // If this is a tool_use with a toolId, try to pair it
    if (msg.type === 'tool_use' && msg.toolId) {
      const result = resultsByToolId.get(msg.toolId);
      if (result) {
        consumedToolResults.add(msg.toolId);
        items.push({
          kind: 'tool_pair',
          toolUse: msg,
          toolResult: result,
          key: `tool-pair-${msg.toolId}`,
        });
        continue;
      }
    }

    // If this is a tool_result that was already consumed by a pair, skip it
    if (msg.type === 'tool_result' && msg.toolId && consumedToolResults.has(msg.toolId)) {
      continue;
    }

    // Otherwise render as individual message
    items.push({
      kind: 'message',
      message: msg,
      key: `${msg.type}-${msg.timestamp ?? ''}-${msg.toolName ?? ''}-${String(startIndex + i)}`,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// ToolPairBlock — renders tool_use + tool_result as a single collapsible block
// ---------------------------------------------------------------------------

function ToolPairBlock({
  toolUse,
  toolResult,
}: {
  toolUse: SessionContentMessage;
  toolResult: SessionContentMessage;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const toolName = toolUse.toolName ?? 'Tool';
  const inputContent = toolUse.content ?? '';
  const outputContent = toolResult.content ?? '';
  const summary = inputContent.replace(/\n/g, ' ').slice(0, 80) + (inputContent.length > 80 ? '...' : '');

  const handleCopyOutput = useCallback(() => {
    void navigator.clipboard.writeText(outputContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [outputContent]);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-1.5 rounded-sm cursor-pointer text-left text-foreground font-[inherit] border-none border-l-2',
          'bg-yellow-500/[0.04] border-l-yellow-400',
        )}
      >
        <span className="text-[10px] font-semibold shrink-0 text-yellow-400">Tool</span>
        <span className="text-[11px] font-mono text-muted-foreground shrink-0">{toolName}</span>
        <span className="text-[10px] text-muted-foreground/60 truncate">{summary}</span>
        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">click to expand</span>
      </button>
    );
  }

  return (
    <div className={cn('px-3 py-2 rounded-lg border-l-[3px]', 'bg-yellow-500/[0.04] border-l-yellow-400')}>
      {/* Header */}
      <div className="flex justify-between items-center mb-1">
        <span className="text-[11px] font-semibold text-yellow-400">
          Tool
          <span className="ml-1.5 font-normal font-mono text-muted-foreground">{toolName}</span>
        </span>
        <div className="flex gap-2 items-center">
          {toolUse.timestamp && (
            <span className="text-[10px] text-muted-foreground">{formatTime(toolUse.timestamp)}</span>
          )}
          {toolResult.timestamp && toolResult.timestamp !== toolUse.timestamp && (
            <>
              <span className="text-[10px] text-muted-foreground/40">-</span>
              <span className="text-[10px] text-muted-foreground">{formatTime(toolResult.timestamp)}</span>
            </>
          )}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-[10px] text-primary bg-transparent border-none p-0 cursor-pointer"
          >
            collapse
          </button>
        </div>
      </div>

      {/* Input section */}
      <div className="mb-2">
        <div className="text-[10px] font-semibold text-muted-foreground mb-0.5">Input</div>
        <div className="text-[11px] font-mono text-foreground whitespace-pre-wrap break-words max-h-[300px] overflow-auto">
          <AnsiSpan>{inputContent}</AnsiSpan>
        </div>
      </div>

      {/* Output section */}
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[10px] font-semibold text-muted-foreground">Output</span>
          <button
            type="button"
            onClick={handleCopyOutput}
            className="text-[10px] text-primary bg-transparent border-none p-0 cursor-pointer"
          >
            {copied ? 'copied!' : 'copy'}
          </button>
        </div>
        <div className="text-[11px] font-mono text-foreground whitespace-pre-wrap break-words max-h-[400px] overflow-auto">
          <AnsiSpan>{outputContent}</AnsiSpan>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message block — routes to specialized component per type
// ---------------------------------------------------------------------------

function MessageBlock({ message, renderMarkdown }: { message: SessionContentMessage; renderMarkdown?: boolean }): React.JSX.Element {
  switch (message.type) {
    case 'thinking':
      return <ThinkingBlock content={message.content} timestamp={message.timestamp} />;
    case 'progress':
      return <ProgressIndicator content={message.content} toolName={message.toolName} timestamp={message.timestamp} />;
    case 'subagent':
      return <SubagentBlock content={message.content} toolName={message.toolName} subagentId={(message as Record<string, unknown>).subagentId as string | undefined} timestamp={message.timestamp} />;
    case 'todo':
      return <TodoBlock content={message.content} timestamp={message.timestamp} />;
    default:
      return <MessageBubble message={message} renderMarkdown={renderMarkdown} />;
  }
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function MessageBubble({ message, renderMarkdown }: { message: SessionContentMessage; renderMarkdown?: boolean }): React.JSX.Element {
  const style = getMessageStyle(message.type);

  const isTool = message.type === 'tool_use' || message.type === 'tool_result';
  const isRenderable = renderMarkdown && (message.type === 'assistant' || message.type === 'human');
  const [expanded, setExpanded] = useState(!isTool);
  const isLong = (message.content?.length ?? 0) > 600;

  if (isTool && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-1 rounded-sm cursor-pointer text-left text-foreground font-[inherit] border-none border-l-2',
          style.bubbleClass,
        )}
      >
        <span className={cn('text-[10px] font-semibold shrink-0', style.textClass)}>
          {style.label}
        </span>
        {message.toolName && (
          <span className="text-[11px] font-mono text-muted-foreground">{message.toolName}</span>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto">click to expand</span>
      </button>
    );
  }

  const content = message.content ?? '';
  const displayContent = !expanded && isLong ? `${content.slice(0, 600)}...` : content;

  return (
    <div className={cn('px-3 py-2 rounded-lg border-l-[3px]', style.bubbleClass)}>
      <div className="flex justify-between items-center mb-1">
        <span className={cn('text-[11px] font-semibold', style.textClass)}>
          {style.label}
          {message.toolName && (
            <span className="ml-1.5 font-normal font-mono text-muted-foreground">
              {message.toolName}
            </span>
          )}
        </span>
        <div className="flex gap-2 items-center">
          {message.timestamp && (
            <span className="text-[10px] text-muted-foreground">
              {formatTime(message.timestamp)}
            </span>
          )}
          {isTool && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-[10px] text-primary bg-transparent border-none p-0 cursor-pointer"
            >
              collapse
            </button>
          )}
        </div>
      </div>
      <div
        className={cn(
          'leading-relaxed text-foreground break-words',
          isTool ? 'text-[11px] font-mono whitespace-pre-wrap max-h-[400px] overflow-auto' : 'text-[13px]',
          !isTool && !isRenderable ? 'whitespace-pre-wrap' : '',
        )}
      >
        {isRenderable ? (
          <MarkdownContent className="text-[13px] leading-relaxed">{displayContent}</MarkdownContent>
        ) : (
          <AnsiSpan>{displayContent}</AnsiSpan>
        )}
      </div>
      {isLong && !isTool && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[11px] text-primary bg-transparent border-none p-0 cursor-pointer"
          aria-label={expanded ? 'Collapse message' : 'Expand message'}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message input
// ---------------------------------------------------------------------------

const RESUME_MODEL_OPTIONS = [
  { value: '', label: 'Keep current model' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

function MessageInput({ session, onOptimisticSend }: { session: Session; onOptimisticSend?: (text: string) => void }): React.JSX.Element {
  const [message, setMessage] = useState('');
  const [resumeModel, setResumeModel] = useState('');
  const lostKey = `lost:${session.id}`;
  const [sessionLost, setSessionLost] = useState(() => sessionStorage.getItem(lostKey) === '1');
  const toast = useToast();
  const queryClient = useQueryClient();
  const sendMessage = useSendMessage();
  const resumeSession = useResumeSession();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Draft persistence — survive page refreshes
  const storageKey = `draft:${session.id}`;

  // Load draft from sessionStorage on mount (or when session changes)
  useEffect(() => {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) setMessage(saved);
  }, [storageKey]);

  // Save draft to sessionStorage on change (debounced 300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (message) {
        sessionStorage.setItem(storageKey, message);
      } else {
        sessionStorage.removeItem(storageKey);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [message, storageKey]);

  const isActive = session.status === 'active';
  const isStarting = session.status === 'starting';
  const canResume =
    !sessionLost &&
    (session.status === 'ended' || session.status === 'paused' || session.status === 'error');
  const canSend = isActive || canResume;
  const isSending = sendMessage.isPending || resumeSession.isPending;

  /** Detect SESSION_LOST errors and persist the state. */
  const markSessionLost = useCallback(() => {
    setSessionLost(true);
    sessionStorage.setItem(lostKey, '1');
  }, [lostKey]);

  const isSessionLostError = useCallback((err: Error): boolean => {
    return err.message.includes('session was lost') || err.message.includes('SESSION_LOST');
  }, []);

  const handleSubmit = useCallback(() => {
    const text = message.trim();
    if (!text || isSending) return;

    // Show optimistic message immediately
    onOptimisticSend?.(text);

    if (isActive) {
      sendMessage.mutate(
        { id: session.id, message: text },
        {
          onSuccess: () => {
            setMessage('');
            sessionStorage.removeItem(storageKey);
            void queryClient.invalidateQueries({
              queryKey: queryKeys.session(session.id),
            });
            // Delay content invalidation to allow CLI time to write JSONL file to disk
            setTimeout(() => {
              void queryClient.invalidateQueries({
                queryKey: ['session-content'],
                exact: false,
              });
            }, 500);
          },
          onError: (err) => {
            if (isSessionLostError(err)) {
              markSessionLost();
            }
            toast.error(err.message);
            // Refresh session data so the UI reflects any status change
            // (e.g. session marked as ended after worker restart)
            void queryClient.invalidateQueries({
              queryKey: queryKeys.session(session.id),
            });
          },
        },
      );
    } else if (canResume) {
      resumeSession.mutate(
        { id: session.id, prompt: text, model: resumeModel || undefined },
        {
          onSuccess: () => {
            setMessage('');
            sessionStorage.removeItem(storageKey);
            toast.success('Session resumed');
            void queryClient.invalidateQueries({
              queryKey: queryKeys.session(session.id),
            });
            // Delay content invalidation to allow CLI time to write JSONL file to disk
            setTimeout(() => {
              void queryClient.invalidateQueries({
                queryKey: ['session-content'],
                exact: false,
              });
            }, 500);
          },
          onError: (err) => {
            if (isSessionLostError(err)) {
              markSessionLost();
            }
            toast.error(err.message);
            // Refresh session data so the UI reflects any status change
            // (e.g. session marked as ended after worker restart)
            void queryClient.invalidateQueries({
              queryKey: queryKeys.session(session.id),
            });
          },
        },
      );
    }
  }, [
    message,
    isSending,
    isActive,
    canResume,
    session.id,
    storageKey,
    sendMessage,
    resumeSession,
    onOptimisticSend,
    isSessionLostError,
    markSessionLost,
    toast,
    queryClient,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  if (sessionLost) {
    return (
      <div className="px-5 py-3 border-t border-border bg-card shrink-0">
        <div className="flex items-center gap-3 px-3 py-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
          <span className="text-yellow-500 text-sm font-medium">!</span>
          <div className="flex-1 text-xs text-muted-foreground">
            This session was lost due to a worker restart. You can fork this session or create a new
            one to continue.
          </div>
        </div>
      </div>
    );
  }

  if (isStarting) {
    return (
      <div className="px-5 py-3 border-t border-border text-center text-xs text-muted-foreground bg-card animate-pulse">
        Session is starting. Please wait...
      </div>
    );
  }

  if (!canSend) {
    return (
      <div className="px-5 py-3 border-t border-border text-center text-xs text-muted-foreground bg-card">
        Session is {session.status}. Cannot send messages.
      </div>
    );
  }

  return (
    <div className="px-5 py-3 border-t border-border bg-card shrink-0">
      {canResume && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] text-muted-foreground">Model:</span>
          <select
            value={resumeModel}
            onChange={(e) => setResumeModel(e.target.value)}
            className="px-2 py-1 bg-muted text-foreground border border-border rounded-md text-[11px] outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          >
            {RESUME_MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-muted-foreground/60">
            Current: {session.model ?? 'default'}
          </span>
        </div>
      )}
      <div className="flex gap-2 items-end">
        <textarea
          ref={inputRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isActive ? 'Send a message...' : 'Resume session with a prompt...'}
          rows={1}
          className="flex-1 px-3 py-2 bg-muted text-foreground border border-border rounded-md text-[13px] outline-none resize-none min-h-[36px] max-h-[120px] focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          disabled={isSending}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!message.trim() || isSending}
          className={cn(
            'px-4 py-2 rounded-md text-xs font-medium transition-colors',
            message.trim() && !isSending
              ? 'bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed',
          )}
        >
          {isSending ? 'Sending...' : canResume ? 'Resume' : 'Send'}
        </button>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        Press Enter to send, Shift+Enter for newline
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading / Error states
// ---------------------------------------------------------------------------

function LoadingState(): React.JSX.Element {
  return (
    <div className="p-4 md:p-6 max-w-[900px]">
      <Skeleton className="h-4 w-28 mb-4" />
      <div className="flex items-center gap-3 mb-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={`sk-${String(i)}`} className="flex gap-3">
            <Skeleton className="h-4 w-12 shrink-0" />
            <Skeleton className="h-16 flex-1 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionMetadataBadges({
  metadata,
  streamCost,
}: {
  metadata: SessionMetadata;
  streamCost?: { totalCostUsd: number; inputTokens: number; outputTokens: number } | null;
}): React.JSX.Element | null {
  const model = metadata.model ?? null;
  const costUsd = metadata.costUsd ?? null;
  const inputTokens = metadata.inputTokens ?? null;
  const outputTokens = metadata.outputTokens ?? null;

  // Use streaming cost if available, otherwise fall back to metadata
  const displayCostUsd = streamCost?.totalCostUsd ?? costUsd;
  const displayInputTokens = streamCost?.inputTokens ?? inputTokens;
  const displayOutputTokens = streamCost?.outputTokens ?? outputTokens;

  if (!model && displayCostUsd === null && displayInputTokens === null) return null;

  return (
    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
      <span className="text-[10px] font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded-sm border border-border">
        {model ?? '(default)'}
      </span>
      {displayCostUsd !== null && (
        <span className={cn(
          'text-[10px] font-mono px-1.5 py-0.5 rounded-sm border',
          streamCost?.totalCostUsd !== undefined
            ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
            : 'bg-muted text-muted-foreground border-border'
        )}>
          ${typeof displayCostUsd === 'number' ? displayCostUsd.toFixed(4) : '0.0000'}
        </span>
      )}
      {displayInputTokens !== null && (
        <span className={cn(
          'text-[10px] font-mono px-1.5 py-0.5 rounded-sm border',
          streamCost?.inputTokens !== undefined
            ? 'bg-blue-500/10 text-blue-600 border-blue-500/30'
            : 'bg-muted text-muted-foreground border-border'
        )}>
          {formatNumber(displayInputTokens)} in
        </span>
      )}
      {displayOutputTokens !== null && (
        <span className={cn(
          'text-[10px] font-mono px-1.5 py-0.5 rounded-sm border',
          streamCost?.outputTokens !== undefined
            ? 'bg-green-500/10 text-green-600 border-green-500/30'
            : 'bg-muted text-muted-foreground border-border'
        )}>
          {formatNumber(displayOutputTokens)} out
        </span>
      )}
    </div>
  );
}

function ErrorState({ error }: { error: string }): React.JSX.Element {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="text-[15px] text-red-400 mb-2">Error</div>
        <div className="text-[13px] text-muted-foreground mb-4">{error}</div>
        <Breadcrumb items={[{ label: 'Sessions', href: '/sessions' }, { label: 'Error' }]} />
      </div>
    </div>
  );
}
