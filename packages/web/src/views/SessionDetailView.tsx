'use client';

import type { ExecutionSummary } from '@agentctl/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Breadcrumb } from '@/components/Breadcrumb';
import { StatusBadge } from '@/components/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { SessionMemoryTab } from '@/components/memory/SessionMemoryTab';
import { FetchingBar } from '../components/FetchingBar';
import { FileBrowser } from '../components/FileBrowser';
import { MessageInput } from '../components/MessageInput';
import { SessionHeader } from '../components/SessionHeader';
import { MessageList, ViewModeToggle } from '../components/SessionMessageList';
import { SteerInput } from '../components/SteerInput';
import { TerminalView } from '../components/TerminalView';
import { useHotkeys } from '../hooks/use-hotkeys';
import type { SessionStreamEvent } from '../hooks/use-session-stream';
import { useSessionStream } from '../hooks/use-session-stream';
import { formatCost, formatDurationMs } from '../lib/format-utils';
import { queryKeys, sessionContentQuery, sessionQuery } from '../lib/queries';
import { exportSessionAsJson, exportSessionAsMarkdown } from '../lib/session-export';

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
  const [autoRefresh, setAutoRefresh] = useState(true);
  const content = useQuery({
    ...sessionContentQuery(claudeSessionId, {
      machineId: s?.machineId ?? '',
      projectPath: s?.projectPath ?? undefined,
      limit: contentLimit,
    }),
    enabled: !!claudeSessionId && !!s?.machineId,
    refetchInterval:
      (s?.status === 'active' || s?.status === 'starting') && autoRefresh ? 2_000 : false,
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
    agentId: s?.agentId ?? undefined,
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
  // Uses count-based clearing: record how many human messages exist at send time,
  // and clear once the real count exceeds that baseline.
  const [optimisticMessages, setOptimisticMessages] = useState<
    { text: string; expectedHumanCount: number; timestamp: number }[]
  >([]);
  const addOptimisticMessage = useCallback(
    (text: string) => {
      const currentHumanCount = contentMessages.filter((m) => m.type === 'human').length;
      setOptimisticMessages((prev) => [
        ...prev,
        { text, expectedHumanCount: currentHumanCount, timestamp: Date.now() },
      ]);
    },
    [contentMessages],
  );

  // Clear optimistic messages when human count exceeds baseline
  useEffect(() => {
    if (optimisticMessages.length === 0) return;
    const humanCount = contentMessages.filter((m) => m.type === 'human').length;
    setOptimisticMessages((prev) => prev.filter((om) => humanCount <= om.expectedHumanCount));
  }, [contentMessages, optimisticMessages.length]);

  // Safety net: 30-second absolute timeout for stuck optimistic messages
  useEffect(() => {
    if (optimisticMessages.length === 0) return;
    const timer = setTimeout(() => {
      setOptimisticMessages((prev) => {
        const cutoff = Date.now() - 30_000;
        return prev.filter((om) => om.timestamp > cutoff);
      });
    }, 30_000);
    return () => clearTimeout(timer);
  }, [optimisticMessages]);

  // Terminal replay — reconstruct pseudo-terminal output from JSONL content
  // for ended/paused sessions that have no live rawOutput.
  const replayOutput = useMemo(() => {
    if (stream.rawOutput.length > 0 || isActive) return [];

    return contentMessages
      .map((msg) => {
        switch (msg.type) {
          case 'assistant':
            return `${msg.content}\n`;
          case 'tool_use':
            return `\x1b[36m⚡ ${msg.toolName ?? 'tool'}\x1b[0m\n${msg.content}\n`;
          case 'tool_result':
            return `\x1b[32m✓ Result:\x1b[0m\n${(msg.content ?? '').slice(0, 500)}\n`;
          case 'thinking':
            return `\x1b[35m💭 Thinking...\x1b[0m\n${(msg.content ?? '').slice(0, 200)}\n`;
          case 'human':
            return `\x1b[33m> ${msg.content}\x1b[0m\n`;
          case 'progress':
            return `\x1b[2m${msg.content}\x1b[0m\n`;
          default:
            return '';
        }
      })
      .filter(Boolean);
  }, [contentMessages, stream.rawOutput.length, isActive]);

  // View mode toggle (messages vs terminal)
  const [viewMode, setViewMode] = useState<'messages' | 'terminal'>('messages');

  // File browser panel toggle
  const [showFiles, setShowFiles] = useState(false);
  const toggleFiles = useCallback(() => setShowFiles((prev) => !prev), []);

  // Primary tab — session content vs memory facts
  const [primaryTab, setPrimaryTab] = useState<'session' | 'memory'>('session');

  // Escape handler ref — SessionHeader populates this to close its menus
  const escapeRef = useRef<() => void>(() => {});

  const handleExportJson = useCallback(() => {
    if (s && contentMessages.length > 0) exportSessionAsJson(s, contentMessages);
  }, [s, contentMessages]);

  const handleExportMarkdown = useCallback(() => {
    if (s && contentMessages.length > 0) exportSessionAsMarkdown(s, contentMessages);
  }, [s, contentMessages]);

  useHotkeys(
    useMemo(
      () => ({
        r: refetchAll,
        e: handleExportJson,
        m: handleExportMarkdown,
        Escape: () => escapeRef.current(),
      }),
      [refetchAll, handleExportJson, handleExportMarkdown],
    ),
  );

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
        totalMessages={content.data?.totalMessages}
        dataUpdatedAt={content.dataUpdatedAt || session.dataUpdatedAt}
        isFetching={(content.isFetching || session.isFetching) && !content.isLoading}
        onRefresh={refetchAll}
        streamConnected={stream.connected}
        streamCost={stream.latestCost}
        showFiles={showFiles}
        onToggleFiles={toggleFiles}
        escapeRef={escapeRef}
      />

      {/* Primary tab bar — Session | Memory */}
      <div className="flex gap-1 px-5 pt-3 pb-0 shrink-0 border-b border-border">
        {(['session', 'memory'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setPrimaryTab(tab)}
            className={cn(
              'px-3 py-1.5 text-[12px] font-medium rounded-t-md transition-colors border-b-2 -mb-px',
              primaryTab === tab
                ? 'border-primary text-foreground bg-accent/10'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab === 'session' ? 'Session' : 'Memory'}
          </button>
        ))}
      </div>

      {primaryTab === 'memory' && (
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <SessionMemoryTab sessionId={sessionId} />
        </div>
      )}

      {primaryTab === 'session' && stream.latestExecutionSummary && (
        <div className="px-5 pt-4 shrink-0">
          <ExecutionSummaryCard summary={stream.latestExecutionSummary} />
        </div>
      )}

      {/* Content area — session tab only */}
      {primaryTab === 'session' && (
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
              isActiveOrStarting={isActive}
              autoRefresh={autoRefresh}
              onAutoRefreshChange={setAutoRefresh}
              streamOutput={stream.streamOutput}
              streamConnected={stream.connected}
              pendingUserMessages={stream.pendingUserMessages}
              optimisticMessages={optimisticMessages.map((om) => om.text)}
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
              <TerminalView
                rawOutput={stream.rawOutput.length > 0 ? stream.rawOutput : replayOutput}
                isActive={isActive}
                className="flex-1 min-h-0"
              />
            </div>
          )}

          {/* Input area — steer (agent) or message (session) */}
          {isActive && s.agentId ? (
            <SteerInput agentId={s.agentId} isRunning={isActive} />
          ) : (
            <MessageInput session={s} onOptimisticSend={addOptimisticMessage} />
          )}
        </div>

        {/* File browser panel */}
        {showFiles && (
          <div className="w-1/2 overflow-hidden">
            <FileBrowser machineId={s.machineId} initialPath={s.projectPath ?? undefined} />
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading / Error states
// ---------------------------------------------------------------------------

function LoadingState(): React.JSX.Element {
  // Alternating widths to simulate realistic user/assistant conversation
  const messageBubbles: Array<{ role: 'user' | 'assistant'; lines: number }> = [
    { role: 'user', lines: 1 },
    { role: 'assistant', lines: 4 },
    { role: 'user', lines: 1 },
    { role: 'assistant', lines: 6 },
    { role: 'assistant', lines: 2 },
    { role: 'user', lines: 1 },
    { role: 'assistant', lines: 3 },
  ];

  return (
    <div className="relative h-full flex flex-col">
      {/* Header bar skeleton */}
      <div className="px-5 py-3 border-b border-border shrink-0 bg-card">
        {/* Breadcrumb + status + buttons */}
        <div className="flex items-center gap-3 mb-2">
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-4 w-16" />
            <span className="text-muted-foreground/30">/</span>
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-5 w-14 rounded-full" />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-7 w-7 rounded-md" />
            <Skeleton className="h-7 w-14 rounded-md" />
            <Skeleton className="h-7 w-16 rounded-md" />
          </div>
        </div>
        {/* Metadata row */}
        <div className="flex items-center gap-4 flex-wrap">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-4 w-16 rounded-sm" />
          <Skeleton className="h-3.5 w-28" />
        </div>
      </div>

      {/* Toolbar skeleton */}
      <div className="px-5 py-1.5 border-b border-border flex items-center gap-3 shrink-0 bg-background">
        <Skeleton className="h-5 w-[120px] rounded-md" />
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-5 w-16 rounded-md" />
        <Skeleton className="h-5 w-12 rounded-md" />
        <Skeleton className="h-5 w-16 rounded-md" />
        <Skeleton className="h-5 w-[100px] rounded-md ml-auto" />
      </div>

      {/* Messages area skeleton */}
      <div className="flex-1 overflow-hidden px-5 py-4 space-y-4">
        {messageBubbles.map((bubble, i) => (
          <div
            key={`sk-msg-${String(i)}`}
            className={cn(
              'rounded-lg border-l-[3px] px-3 py-2',
              bubble.role === 'user'
                ? 'border-l-blue-500/40 bg-blue-500/5'
                : 'border-l-emerald-500/40 bg-emerald-500/5',
            )}
          >
            {/* Label + timestamp */}
            <div className="flex justify-between items-center mb-1.5">
              <Skeleton
                className={cn(
                  'h-3 w-14',
                  bubble.role === 'user' ? 'bg-blue-500/15' : 'bg-emerald-500/15',
                )}
              />
              <Skeleton className="h-2.5 w-12 bg-muted" />
            </div>
            {/* Content lines */}
            <div className="space-y-1.5">
              {Array.from({ length: bubble.lines }, (_, j) => (
                <Skeleton
                  key={`sk-line-${String(i)}-${String(j)}`}
                  className="h-3"
                  style={{
                    width:
                      j === bubble.lines - 1
                        ? `${40 + ((i * 17 + j * 23) % 35)}%`
                        : `${75 + ((i * 13 + j * 7) % 20)}%`,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Input area skeleton */}
      <div className="px-5 py-3 border-t border-border bg-card shrink-0">
        <Skeleton className="h-[60px] w-full rounded-md" />
      </div>
    </div>
  );
}

function ErrorState({ error }: { error: string }): React.JSX.Element {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="text-[15px] text-red-600 dark:text-red-400 mb-2">Error</div>
        <div className="text-[13px] text-muted-foreground mb-4">{error}</div>
        <Breadcrumb items={[{ label: 'Sessions', href: '/sessions' }, { label: 'Error' }]} />
      </div>
    </div>
  );
}

function ExecutionSummaryCard({ summary }: { summary: ExecutionSummary }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">Latest Run Summary</div>
          <div className="text-xs text-muted-foreground">
            {summary.commandsRun} tool call{summary.commandsRun === 1 ? '' : 's'} ·{' '}
            {formatCost(summary.costUsd)} · {formatDurationMs(summary.durationMs)}
          </div>
        </div>
        <StatusBadge status={summary.status} />
      </div>
      <div className="text-sm text-foreground leading-6">{summary.executiveSummary}</div>
      {summary.keyFindings.length > 0 && (
        <div className="space-y-1">
          {summary.keyFindings.map((finding) => (
            <div key={finding} className="text-xs text-muted-foreground">
              • {finding}
            </div>
          ))}
        </div>
      )}
      {summary.followUps.length > 0 && (
        <div className="space-y-1">
          {summary.followUps.map((item) => (
            <div key={item} className="text-xs text-muted-foreground">
              Next: {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
