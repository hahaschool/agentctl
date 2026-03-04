'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Breadcrumb } from '@/components/Breadcrumb';
import { CopyableText } from '@/components/CopyableText';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ConfirmButton } from '../components/ConfirmButton';
import { ErrorBanner } from '../components/ErrorBanner';
import { FetchingBar } from '../components/FetchingBar';
import { LastUpdated } from '../components/LastUpdated';
import { LiveTimeAgo } from '../components/LiveTimeAgo';
import { PathBadge } from '../components/PathBadge';
import { RefreshButton } from '../components/RefreshButton';
import { useHotkeys } from '../hooks/use-hotkeys';
import type { Session, SessionContentMessage } from '../lib/api';
import { formatDuration, formatNumber, formatTime } from '../lib/format-utils';
import { getMessageStyle } from '../lib/message-styles';
import {
  queryKeys,
  sessionContentQuery,
  sessionQuery,
  useDeleteSession,
  useResumeSession,
  useSendMessage,
} from '../lib/queries';

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
  const content = useQuery({
    ...sessionContentQuery(claudeSessionId, {
      machineId: s?.machineId ?? '',
      projectPath: s?.projectPath ?? undefined,
      limit: 500,
    }),
    enabled: !!claudeSessionId && !!s?.machineId,
    refetchInterval: s?.status === 'active' ? 3_000 : false,
    refetchOnWindowFocus: true,
  });

  const refetchAll = useCallback(() => {
    void session.refetch();
    void content.refetch();
  }, [session, content]);

  useHotkeys(useMemo(() => ({ r: refetchAll }), [refetchAll]));

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
        dataUpdatedAt={content.dataUpdatedAt || session.dataUpdatedAt}
        isFetching={(content.isFetching || session.isFetching) && !content.isLoading}
        onRefresh={refetchAll}
      />

      {/* Content area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <MessageList
          messages={content.data?.messages ?? []}
          totalMessages={content.data?.totalMessages ?? 0}
          isLoading={content.isLoading}
          error={content.error?.message}
          isActive={s.status === 'active'}
        />

        {/* Input area */}
        <MessageInput session={s} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function SessionHeader({
  session,
  dataUpdatedAt,
  isFetching,
  onRefresh,
}: {
  session: Session;
  dataUpdatedAt: number;
  isFetching: boolean;
  onRefresh: () => void;
}): React.JSX.Element {
  const toast = useToast();
  const deleteSession = useDeleteSession();
  const queryClient = useQueryClient();

  const handleEnd = useCallback(() => {
    deleteSession.mutate(session.id, {
      onSuccess: () => {
        toast.success('Session ended');
        void queryClient.invalidateQueries({ queryKey: queryKeys.session(session.id) });
      },
      onError: (err) => toast.error(err.message),
    });
  }, [session.id, deleteSession, toast, queryClient]);

  return (
    <div className="px-5 py-3 border-b border-border shrink-0 bg-card">
      <div className="flex items-center gap-3 mb-2">
        <Breadcrumb
          items={[{ label: 'Sessions', href: '/sessions' }, { label: session.id.slice(0, 12) }]}
        />
        <StatusBadge status={session.status} />
        {session.status === 'active' && (
          <span className="text-[11px] text-green-500 animate-pulse">Live</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <LastUpdated dataUpdatedAt={dataUpdatedAt} />
          <RefreshButton onClick={onRefresh} isFetching={isFetching} />
          {(session.status === 'active' || session.status === 'starting') && (
            <ConfirmButton
              label="End Session"
              confirmLabel="Confirm End?"
              onConfirm={handleEnd}
              className="px-3 py-1 bg-red-900/50 text-red-300 border border-red-800/50 rounded-sm text-xs cursor-pointer hover:bg-red-900"
              confirmClassName="px-3 py-1 bg-red-700 text-white border border-red-600 rounded-sm text-xs cursor-pointer animate-pulse"
            />
          )}
        </div>
      </div>

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
        {session.projectPath && <PathBadge path={session.projectPath} />}
        {session.accountId && (
          <span className="flex items-center gap-1">
            Account: <CopyableText value={session.accountId} maxDisplay={12} />
          </span>
        )}
        {session.model && (
          <span className="font-mono bg-muted px-1.5 py-0.5 rounded-sm border border-border">
            {session.model}
          </span>
        )}
        <span>
          Started <LiveTimeAgo date={session.startedAt} />
        </span>
        {session.endedAt && (
          <span>Duration: {formatDuration(session.startedAt, session.endedAt)}</span>
        )}
        {!session.endedAt && session.status === 'active' && (
          <span>Running for {formatDuration(session.startedAt)}</span>
        )}
      </div>

      {/* Error details */}
      {session.status === 'error' && (
        <div className="mt-2 px-3 py-2 rounded-sm bg-red-950/50 border border-red-900/50 text-[12px] text-red-300">
          <span className="font-semibold text-red-400">Error: </span>
          {typeof session.metadata?.errorMessage === 'string'
            ? session.metadata.errorMessage
            : 'Session ended with an error (no details available)'}
        </div>
      )}

      {/* Starting indicator */}
      {session.status === 'starting' && (
        <div className="mt-2 px-3 py-2 rounded-sm bg-yellow-950/40 border border-yellow-900/40 text-[12px] text-yellow-300 animate-pulse">
          Waiting for worker to start session...
        </div>
      )}

      {/* Cost / Model metadata (when available) */}
      <SessionMetadataBadges metadata={session.metadata} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message list
// ---------------------------------------------------------------------------

function MessageList({
  messages,
  totalMessages,
  isLoading,
  error,
  isActive,
}: {
  messages: SessionContentMessage[];
  totalMessages: number;
  isLoading: boolean;
  error?: string;
  isActive: boolean;
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showTools, setShowTools] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const visibleMessages = showTools
    ? messages
    : messages.filter((m) => m.type === 'human' || m.type === 'assistant');

  // Auto-scroll to bottom when new messages arrive
  const prevCountRef = useRef(0);
  useEffect(() => {
    const count = visibleMessages.length;
    if (count !== prevCountRef.current) {
      prevCountRef.current = count;
      if (autoScroll && scrollRef.current) {
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      }
    }
  });

  // Detect user scrolling up to pause auto-scroll
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="px-5 py-1.5 border-b border-border flex items-center gap-3 text-[11px] text-muted-foreground shrink-0 bg-background">
        <span>{formatNumber(totalMessages)} total messages</span>
        <span>{formatNumber(visibleMessages.length)} shown</span>
        <button
          type="button"
          onClick={() => setShowTools(!showTools)}
          aria-label={showTools ? 'Hide tool messages' : 'Show tool messages'}
          aria-pressed={showTools}
          className={cn(
            'px-2 py-0.5 rounded-sm border border-border text-[10px] cursor-pointer transition-colors',
            showTools ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          {showTools ? 'Hide Tools' : 'Show Tools'}
        </button>
        {!autoScroll && isActive && (
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true);
              if (scrollRef.current) {
                scrollRef.current.scrollTo({
                  top: scrollRef.current.scrollHeight,
                  behavior: 'smooth',
                });
              }
            }}
            aria-label="Jump to bottom of conversation"
            className="ml-auto px-2 py-0.5 bg-primary text-primary-foreground rounded-sm text-[10px] cursor-pointer"
          >
            Jump to bottom
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

        {!isLoading && visibleMessages.length === 0 && (
          <div className="p-8 text-center text-muted-foreground text-[13px]">No messages yet</div>
        )}

        {totalMessages > messages.length && (
          <div className="py-2 text-center text-muted-foreground text-xs">
            Showing last {formatNumber(messages.length)} of {formatNumber(totalMessages)} messages
          </div>
        )}

        {visibleMessages.map((msg, i) => (
          <MessageBubble key={`${msg.type}-${String(i)}`} message={msg} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: SessionContentMessage }): React.JSX.Element {
  const style = getMessageStyle(message.type);

  const isTool = message.type === 'tool_use' || message.type === 'tool_result';
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
          'leading-relaxed text-foreground whitespace-pre-wrap break-words',
          isTool ? 'text-[11px] font-mono max-h-[400px] overflow-auto' : 'text-[13px]',
        )}
      >
        {displayContent}
      </div>
      {isLong && !isTool && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[11px] text-primary bg-transparent border-none p-0 cursor-pointer"
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

function MessageInput({ session }: { session: Session }): React.JSX.Element {
  const [message, setMessage] = useState('');
  const toast = useToast();
  const queryClient = useQueryClient();
  const sendMessage = useSendMessage();
  const resumeSession = useResumeSession();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isActive = session.status === 'active' || session.status === 'starting';
  const canResume =
    session.status === 'ended' || session.status === 'paused' || session.status === 'error';
  const canSend = isActive || canResume;
  const isSending = sendMessage.isPending || resumeSession.isPending;

  const handleSubmit = useCallback(() => {
    const text = message.trim();
    if (!text || isSending) return;

    if (isActive) {
      sendMessage.mutate(
        { id: session.id, message: text },
        {
          onSuccess: () => {
            setMessage('');
            void queryClient.invalidateQueries({
              queryKey: queryKeys.session(session.id),
            });
            // Refetch content after a short delay to allow processing
            setTimeout(() => {
              void queryClient.invalidateQueries({
                queryKey: ['session-content'],
              });
            }, 1000);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    } else if (canResume) {
      resumeSession.mutate(
        { id: session.id, prompt: text },
        {
          onSuccess: () => {
            setMessage('');
            toast.success('Session resumed');
            void queryClient.invalidateQueries({
              queryKey: queryKeys.session(session.id),
            });
          },
          onError: (err) => toast.error(err.message),
        },
      );
    }
  }, [
    message,
    isSending,
    isActive,
    canResume,
    session.id,
    sendMessage,
    resumeSession,
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

  if (!canSend) {
    return (
      <div className="px-5 py-3 border-t border-border text-center text-xs text-muted-foreground bg-card">
        Session is {session.status}. Cannot send messages.
      </div>
    );
  }

  return (
    <div className="px-5 py-3 border-t border-border bg-card shrink-0">
      <div className="flex gap-2 items-end">
        <textarea
          ref={inputRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isActive ? 'Send a message...' : 'Resume session with a prompt...'}
          rows={1}
          className="flex-1 px-3 py-2 bg-muted text-foreground border border-border rounded-sm text-[13px] outline-none resize-none min-h-[36px] max-h-[120px]"
          disabled={isSending}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!message.trim() || isSending}
          className={cn(
            'px-4 py-2 rounded-sm text-xs font-medium transition-colors',
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
}: {
  metadata: Record<string, unknown>;
}): React.JSX.Element | null {
  const model = typeof metadata.model === 'string' ? metadata.model : null;
  const costUsd = typeof metadata.costUsd === 'number' ? metadata.costUsd : null;
  const inputTokens = typeof metadata.inputTokens === 'number' ? metadata.inputTokens : null;
  const outputTokens = typeof metadata.outputTokens === 'number' ? metadata.outputTokens : null;

  if (!model && costUsd === null && inputTokens === null) return null;

  return (
    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
      {model && (
        <span className="text-[10px] font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded-sm border border-border">
          {model}
        </span>
      )}
      {costUsd !== null && (
        <span className="text-[10px] font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded-sm border border-border">
          ${costUsd.toFixed(4)}
        </span>
      )}
      {inputTokens !== null && (
        <span className="text-[10px] font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded-sm border border-border">
          {formatNumber(inputTokens)} in
        </span>
      )}
      {outputTokens !== null && (
        <span className="text-[10px] font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded-sm border border-border">
          {formatNumber(outputTokens)} out
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
