'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Breadcrumb } from '@/components/Breadcrumb';
import { CopyableText } from '@/components/CopyableText';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { COPY_FEEDBACK_MS } from '@/lib/ui-constants';
import { cn } from '@/lib/utils';
import { useHotkeys } from '../hooks/use-hotkeys';
import type { Session, SessionContentMessage, SessionMetadata } from '../lib/api';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format-utils';
import { accountsQuery, queryKeys, useDeleteSession, useForkSession } from '../lib/queries';
import { exportSessionAsJson, exportSessionAsMarkdown } from '../lib/session-export';
import { ConfirmButton } from './ConfirmButton';
import type { ForkSubmitConfig } from './context-picker';
import { ContextPickerDialog } from './context-picker';
import { GitStatusBadge } from './GitStatusBadge';
import { LastUpdated } from './LastUpdated';
import { LiveDuration } from './LiveDuration';
import { LiveTimeAgo } from './LiveTimeAgo';
import { PathBadge } from './PathBadge';
import { RefreshButton } from './RefreshButton';

// ---------------------------------------------------------------------------
// ErrorDetailPanel (co-located — used only by SessionHeader)
// ---------------------------------------------------------------------------

function ErrorDetailPanel({ metadata }: { metadata?: SessionMetadata }): React.JSX.Element {
  const toast = useToast();
  const errorMessage =
    metadata?.errorMessage ?? 'Session ended with an error (no details available)';
  const errorCode = metadata?.errorCode as string | undefined;
  const exitReason = metadata?.exitReason as string | undefined;
  const errorHint = metadata?.errorHint;

  // Show exitReason only if it differs from the error message
  const showExitReason = exitReason && exitReason !== errorMessage;

  // Build full copyable text
  const fullErrorText = [
    errorCode ? `[${errorCode}] ` : '',
    errorMessage,
    showExitReason ? `\nExit reason: ${exitReason}` : '',
    errorHint ? `\nHint: ${errorHint}` : '',
  ].join('');

  const isLong = errorMessage.length > 200;
  const [expanded, setExpanded] = useState(!isLong);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard
      .writeText(fullErrorText)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
      })
      .catch(() => toast.error('Failed to copy'));
  }, [fullErrorText, toast]);

  return (
    <div className="mt-2 bg-red-500/5 border border-red-500/20 rounded-md px-3 py-2 text-[12px] text-red-700 dark:text-red-300">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 space-y-1 min-w-0">
          {/* Error code + message */}
          <div className="flex items-start gap-2">
            {errorCode && (
              <span className="shrink-0 font-mono text-[11px] bg-red-500/10 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded border border-red-500/20">
                {errorCode}
              </span>
            )}
            <span>{isLong && !expanded ? `${errorMessage.slice(0, 200)}...` : errorMessage}</span>
          </div>

          {/* Exit reason (if different from error) */}
          {showExitReason && expanded && (
            <div className="text-red-600/80 dark:text-red-400/80">
              <span className="font-semibold">Exit reason:</span> {exitReason}
            </div>
          )}

          {/* Hint */}
          {errorHint && expanded && (
            <div className="text-yellow-700/90 dark:text-yellow-300/90">
              <span className="font-semibold text-yellow-600 dark:text-yellow-400">Hint:</span>{' '}
              {errorHint}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="px-2 py-0.5 text-[10px] text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded cursor-pointer hover:bg-red-500/20"
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="px-2 py-0.5 text-[10px] text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded cursor-pointer hover:bg-red-500/20"
          >
            {copied ? 'Copied!' : 'Copy error'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionMetadataBadges (co-located — used only by SessionHeader)
// ---------------------------------------------------------------------------

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
        <span
          className={cn(
            'text-[10px] font-mono px-1.5 py-0.5 rounded-sm border',
            streamCost?.totalCostUsd !== undefined
              ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
              : 'bg-muted text-muted-foreground border-border',
          )}
        >
          ${typeof displayCostUsd === 'number' ? displayCostUsd.toFixed(4) : '0.0000'}
        </span>
      )}
      {displayInputTokens !== null && (
        <span
          className={cn(
            'text-[10px] font-mono px-1.5 py-0.5 rounded-sm border',
            streamCost?.inputTokens !== undefined
              ? 'bg-blue-500/10 text-blue-600 border-blue-500/30'
              : 'bg-muted text-muted-foreground border-border',
          )}
        >
          {formatNumber(displayInputTokens)} in
        </span>
      )}
      {displayOutputTokens !== null && (
        <span
          className={cn(
            'text-[10px] font-mono px-1.5 py-0.5 rounded-sm border',
            streamCost?.outputTokens !== undefined
              ? 'bg-green-500/10 text-green-600 border-green-500/30'
              : 'bg-muted text-muted-foreground border-border',
          )}
        >
          {formatNumber(displayOutputTokens)} out
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type SessionHeaderProps = {
  session: Session;
  messages: SessionContentMessage[];
  totalMessages?: number;
  dataUpdatedAt: number;
  isFetching: boolean;
  onRefresh: () => void;
  streamConnected?: boolean;
  streamCost?: { totalCostUsd: number; inputTokens: number; outputTokens: number } | null;
  showFiles?: boolean;
  onToggleFiles?: () => void;
  escapeRef?: React.MutableRefObject<() => void>;
};

// ---------------------------------------------------------------------------
// SessionHeader
// ---------------------------------------------------------------------------

export function SessionHeader({
  session,
  messages,
  totalMessages,
  dataUpdatedAt,
  isFetching,
  onRefresh,
  streamConnected,
  streamCost,
  showFiles,
  onToggleFiles,
  escapeRef,
}: SessionHeaderProps): React.JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const deleteSession = useDeleteSession();
  const forkSession = useForkSession();
  const queryClient = useQueryClient();
  const accounts = useQuery(accountsQuery());
  const [showContextPicker, setShowContextPicker] = useState(false);
  const [contextPickerMessages, setContextPickerMessages] = useState<SessionContentMessage[]>([]);
  const [contextPickerLoading, setContextPickerLoading] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const accountName = useMemo(() => {
    if (!session.accountId || !accounts.data) return null;
    const found = accounts.data.find((a) => a.id === session.accountId);
    return found?.name ?? null;
  }, [session.accountId, accounts.data]);

  // Wire up escape ref to close menus/dialogs
  useEffect(() => {
    if (!escapeRef) return;
    escapeRef.current = () => {
      if (showExportMenu) setShowExportMenu(false);
      if (showContextPicker) {
        setShowContextPicker(false);
        setContextPickerMessages([]);
      }
    };
  }, [escapeRef, showExportMenu, showContextPicker]);

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

  const handleOpenForkPicker = useCallback(async () => {
    if (!session.claudeSessionId || !session.machineId) return;
    setContextPickerLoading(true);
    try {
      const result = await api.getSessionContent(session.claudeSessionId, {
        machineId: session.machineId,
        projectPath: session.projectPath ?? undefined,
        limit: 10000,
      });
      setContextPickerMessages(result.messages);
      setShowContextPicker(true);
    } catch {
      toast.error('Failed to load session messages');
    } finally {
      setContextPickerLoading(false);
    }
  }, [session, toast]);

  const handleForkSubmit = useCallback(
    (config: ForkSubmitConfig) => {
      forkSession.mutate(
        {
          id: session.id,
          prompt: config.prompt,
          model: config.model,
          strategy: config.strategy,
          forkAtIndex: config.forkAtIndex,
          selectedMessages: config.selectedMessages?.map((m) => ({
            type: m.type,
            content: m.content,
            toolName: m.toolName,
            timestamp: m.timestamp,
          })),
        },
        {
          onSuccess: (data) => {
            toast.success(`Forked! New session: ${data.sessionId.slice(0, 12)}...`);
            setShowContextPicker(false);
            setContextPickerMessages([]);
            setTimeout(() => {
              router.push(`/sessions/${data.sessionId}`);
            }, 500);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    },
    [session.id, forkSession, toast, router],
  );

  const canFork =
    !!session.claudeSessionId &&
    (session.status === 'ended' || session.status === 'error' || session.status === 'paused');

  useHotkeys(
    useMemo(
      () => ({
        f: () => {
          if (canFork) void handleOpenForkPicker();
        },
      }),
      [canFork, handleOpenForkPicker],
    ),
  );

  return (
    <div className="px-5 py-3 border-b border-border shrink-0 bg-card">
      <div className="flex items-center gap-3 mb-2">
        <Breadcrumb
          items={[{ label: 'Sessions', href: '/sessions' }, { label: session.id.slice(0, 12) }]}
        />
        <StatusBadge status={session.status} />
        {session.agentId && (
          <Link
            href={`/agents/${session.agentId}`}
            className="text-xs text-muted-foreground hover:text-foreground bg-muted px-2 py-0.5 rounded-md border border-border transition-colors no-underline"
          >
            {session.agentName ?? session.agentId.slice(0, 12)}
          </Link>
        )}
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
              title="Toggle file browser"
            >
              Files
            </button>
          )}
          <div className="relative" ref={exportMenuRef}>
            <button
              type="button"
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="px-3 py-1 bg-muted text-muted-foreground border border-border rounded-md text-xs cursor-pointer hover:bg-accent hover:text-accent-foreground"
              title="Export session (E: JSON, M: Markdown)"
              aria-haspopup="menu"
              aria-expanded={showExportMenu}
            >
              Export
            </button>
            {showExportMenu && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-lg min-w-[160px]"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    exportSessionAsJson(session, messages);
                    setShowExportMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs text-popover-foreground hover:bg-accent cursor-pointer border-none bg-transparent flex items-center justify-between"
                >
                  Export as JSON
                  <kbd className="ml-2 px-1 py-0.5 text-[9px] font-mono bg-muted border border-border/50 rounded opacity-60">
                    E
                  </kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    exportSessionAsMarkdown(session, messages);
                    setShowExportMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs text-popover-foreground hover:bg-accent cursor-pointer border-none bg-transparent border-t border-t-border flex items-center justify-between"
                >
                  Export as Markdown
                  <kbd className="ml-2 px-1 py-0.5 text-[9px] font-mono bg-muted border border-border/50 rounded opacity-60">
                    M
                  </kbd>
                </button>
              </div>
            )}
          </div>
          {canFork && (
            <button
              type="button"
              onClick={() => void handleOpenForkPicker()}
              disabled={contextPickerLoading}
              title="Fork session (F)"
              className="px-3 py-1 bg-blue-100/50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border border-blue-300/50 dark:border-blue-800/50 rounded-md text-xs cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-900 disabled:opacity-50"
            >
              {contextPickerLoading ? 'Loading...' : 'Fork'}
            </button>
          )}
          {(session.status === 'active' || session.status === 'starting') && (
            <ConfirmButton
              label={deleteSession.isPending ? 'Ending...' : 'End Session'}
              confirmLabel="Confirm End?"
              onConfirm={handleEnd}
              disabled={deleteSession.isPending}
              className="px-3 py-1 bg-red-100/50 dark:bg-red-900/50 text-red-700 dark:text-red-300 border border-red-300/50 dark:border-red-800/50 rounded-md text-xs cursor-pointer hover:bg-red-200 dark:hover:bg-red-900 disabled:opacity-50"
              confirmClassName="px-3 py-1 bg-red-700 text-white border border-red-600 rounded-md text-xs cursor-pointer animate-pulse"
            />
          )}
        </div>
      </div>

      {/* Fork context picker dialog */}
      <ContextPickerDialog
        mode="fork"
        session={session}
        messages={contextPickerMessages}
        open={showContextPicker}
        onClose={() => {
          setShowContextPicker(false);
          setContextPickerMessages([]);
        }}
        onForkSubmit={handleForkSubmit}
        isSubmitting={forkSession.isPending}
      />

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
        <span className="font-mono bg-purple-500/10 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded-sm border border-purple-500/30">
          {session.model ?? '(default)'}
        </span>
        <span>
          Started <LiveTimeAgo date={session.startedAt} />
        </span>
        {session.endedAt && (
          <span>
            Duration: <LiveDuration startedAt={session.startedAt} endedAt={session.endedAt} />
          </span>
        )}
        {!session.endedAt && session.status === 'active' && (
          <span className="flex items-center gap-1">
            <svg
              className="w-3 h-3 text-green-600 dark:text-green-400 animate-pulse"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <LiveDuration startedAt={session.startedAt} />
          </span>
        )}
        {(streamCost || session.metadata?.costUsd) && (
          <span className="font-mono bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded-sm border border-amber-500/30">
            ${(streamCost?.totalCostUsd ?? session.metadata?.costUsd ?? 0).toFixed(4)}
          </span>
        )}
        {totalMessages !== undefined && totalMessages > 0 && (
          <span className="text-[11px] text-muted-foreground">Messages: {totalMessages}</span>
        )}
      </div>

      {/* Git status */}
      {session.projectPath && session.machineId && (
        <div className="mt-2">
          <GitStatusBadge machineId={session.machineId} projectPath={session.projectPath} />
        </div>
      )}

      {/* Error details */}
      {session.status === 'error' && <ErrorDetailPanel metadata={session.metadata} />}

      {/* Starting indicator */}
      {session.status === 'starting' && (
        <div className="mt-2 px-3 py-2 rounded-md bg-yellow-100/40 dark:bg-yellow-950/40 border border-yellow-300/40 dark:border-yellow-900/40 text-[12px] text-yellow-700 dark:text-yellow-300 animate-pulse">
          Waiting for worker to start session...
        </div>
      )}

      {/* Cost / Model metadata (when available) */}
      <SessionMetadataBadges metadata={session.metadata} streamCost={streamCost} />
    </div>
  );
}
