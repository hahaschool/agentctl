'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CopyableText } from '@/components/CopyableText';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { cn } from '@/lib/utils';
import type { Session, SessionContentMessage } from '../lib/api';
import { formatDuration, shortenPath, timeAgo } from '../lib/format-utils';
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

  // We need machineId to fetch content — wait for session to load
  const content = useQuery({
    ...sessionContentQuery(sessionId, {
      machineId: s?.machineId ?? '',
      projectPath: s?.projectPath ?? undefined,
      limit: 500,
    }),
    refetchInterval: s?.status === 'active' ? 3_000 : false,
    refetchOnWindowFocus: true,
  });

  if (session.isLoading) {
    return <LoadingState />;
  }

  if (session.error || !s) {
    return <ErrorState error={session.error?.message ?? 'Session not found'} />;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <SessionHeader session={s} />

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

function SessionHeader({ session }: { session: Session }): React.JSX.Element {
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
        <Link
          href="/sessions"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          &larr; Sessions
        </Link>
        <span className="text-muted-foreground/40">|</span>
        <StatusBadge status={session.status} />
        {session.status === 'active' && (
          <span className="text-[11px] text-green-500 animate-pulse">Live</span>
        )}
        <div className="ml-auto flex gap-2">
          {(session.status === 'active' || session.status === 'starting') && (
            <button
              type="button"
              onClick={handleEnd}
              className="px-3 py-1 bg-red-900/50 text-red-300 border border-red-800/50 rounded-sm text-xs cursor-pointer hover:bg-red-900"
            >
              End Session
            </button>
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
        {session.projectPath && (
          <span className="font-mono" title={session.projectPath}>
            {shortenPath(session.projectPath)}
          </span>
        )}
        <span>Started {timeAgo(session.startedAt)}</span>
        {session.endedAt && (
          <span>Duration: {formatDuration(session.startedAt, session.endedAt)}</span>
        )}
        {!session.endedAt && session.status === 'active' && (
          <span>Running for {formatDuration(session.startedAt)}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message list
// ---------------------------------------------------------------------------

const MSG_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  human: { label: 'You', color: '#818cf8', bg: 'rgba(99, 102, 241, 0.08)' },
  assistant: { label: 'Claude', color: '#4ade80', bg: 'rgba(34, 197, 94, 0.06)' },
  tool_use: { label: 'Tool Call', color: '#facc15', bg: 'rgba(234, 179, 8, 0.04)' },
  tool_result: { label: 'Tool Result', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.04)' },
};

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
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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
        <span>{totalMessages} total messages</span>
        <span>{visibleMessages.length} shown</span>
        <button
          type="button"
          onClick={() => setShowTools(!showTools)}
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
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              }
            }}
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
          <div className="p-8 text-center text-muted-foreground text-[13px]">
            Loading conversation...
          </div>
        )}

        {error && (
          <div className="px-4 py-2.5 bg-red-900/50 text-red-300 rounded-lg text-[13px]">
            {error}
          </div>
        )}

        {!isLoading && visibleMessages.length === 0 && (
          <div className="p-8 text-center text-muted-foreground text-[13px]">No messages yet</div>
        )}

        {totalMessages > messages.length && (
          <div className="py-2 text-center text-muted-foreground text-xs">
            Showing last {messages.length} of {totalMessages} messages
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
  const style = MSG_STYLES[message.type] ?? {
    label: message.type,
    color: 'var(--text-muted)',
    bg: 'transparent',
  };

  const isTool = message.type === 'tool_use' || message.type === 'tool_result';
  const [expanded, setExpanded] = useState(!isTool);
  const isLong = message.content.length > 600;

  if (isTool && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-full flex items-center gap-2 px-3 py-1 rounded-sm cursor-pointer text-left text-foreground font-[inherit] border-none"
        style={{ backgroundColor: style.bg, borderLeft: `2px solid ${style.color}` }}
      >
        <span className="text-[10px] font-semibold shrink-0" style={{ color: style.color }}>
          {style.label}
        </span>
        {message.toolName && (
          <span className="text-[11px] font-mono text-muted-foreground">{message.toolName}</span>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto">click to expand</span>
      </button>
    );
  }

  const displayContent =
    !expanded && isLong ? `${message.content.slice(0, 600)}...` : message.content;

  return (
    <div
      className="px-3 py-2 rounded-lg"
      style={{ backgroundColor: style.bg, borderLeft: `3px solid ${style.color}` }}
    >
      <div className="flex justify-between items-center mb-1">
        <span className="text-[11px] font-semibold" style={{ color: style.color }}>
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
              {new Date(message.timestamp).toLocaleTimeString()}
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
  const canResume = session.status === 'ended' || session.status === 'paused';
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
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <div className="text-[15px] text-muted-foreground mb-2">Loading session...</div>
        <div className="text-xs text-muted-foreground">Fetching session details</div>
      </div>
    </div>
  );
}

function ErrorState({ error }: { error: string }): React.JSX.Element {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="text-[15px] text-red-400 mb-2">Error</div>
        <div className="text-[13px] text-muted-foreground mb-4">{error}</div>
        <Link href="/sessions" className="text-xs text-primary hover:underline">
          &larr; Back to Sessions
        </Link>
      </div>
    </div>
  );
}
