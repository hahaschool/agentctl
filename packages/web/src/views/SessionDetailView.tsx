'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Breadcrumb } from '@/components/Breadcrumb';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { FetchingBar } from '../components/FetchingBar';
import { FileBrowser } from '../components/FileBrowser';
import { MessageInput } from '../components/MessageInput';
import { SessionHeader } from '../components/SessionHeader';
import { MessageList, ViewModeToggle } from '../components/SessionMessageList';
import { TerminalView } from '../components/TerminalView';
import { useHotkeys } from '../hooks/use-hotkeys';
import type { SessionStreamEvent } from '../hooks/use-session-stream';
import { useSessionStream } from '../hooks/use-session-stream';
import type { Session, SessionContentMessage } from '../lib/api';
import { queryKeys, sessionContentQuery, sessionQuery } from '../lib/queries';

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
    setOptimisticMessages((prev) => prev.filter((text) => !humanTexts.includes(text.trim())));
  }, [contentMessages, optimisticMessages.length]);

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
              isActiveOrStarting={isActive}
              autoRefresh={autoRefresh}
              onAutoRefreshChange={setAutoRefresh}
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
              <TerminalView
                rawOutput={stream.rawOutput.length > 0 ? stream.rawOutput : replayOutput}
                isActive={isActive}
                className="flex-1 min-h-0"
              />
            </div>
          )}

          {/* Input area */}
          <MessageInput session={s} onOptimisticSend={addOptimisticMessage} />
        </div>

        {/* File browser panel */}
        {showFiles && (
          <div className="w-1/2 overflow-hidden">
            <FileBrowser machineId={s.machineId} initialPath={s.projectPath ?? undefined} />
          </div>
        )}
      </div>
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
