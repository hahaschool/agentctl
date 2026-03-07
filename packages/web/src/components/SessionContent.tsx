'use client';

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useNotificationContext } from '../contexts/notification-context';
import type { SessionStreamEvent } from '../hooks/use-session-stream';
import { useSessionStream } from '../hooks/use-session-stream';
import type { SessionContentMessage } from '../lib/api';
import { api } from '../lib/api';
import { formatTime } from '../lib/format-utils';
import { getMessageStyle } from '../lib/message-styles';
import { AnsiSpan, AnsiText } from './AnsiText';
import { ErrorBanner } from './ErrorBanner';
import { MarkdownContent } from './MarkdownContent';
import { ProgressIndicator } from './ProgressIndicator';
import { SubagentBlock } from './SubagentBlock';
import { TerminalView } from './TerminalView';
import { ThinkingBlock } from './ThinkingBlock';
import { TodoBlock } from './TodoBlock';

export const CONTENT_POLL_MS = 3_000;

export function SessionContent({
  sessionId,
  rcSessionId,
  machineId,
  projectPath,
  isActive,
  lastSentMessage,
}: {
  sessionId: string;
  rcSessionId: string;
  machineId: string;
  projectPath?: string;
  isActive?: boolean;
  lastSentMessage?: { text: string; ts: number } | null;
}): React.JSX.Element {
  const PAGE_SIZE = 200;
  const { addNotification } = useNotificationContext();
  const addNotificationRef = useRef(addNotification);
  addNotificationRef.current = addNotification;

  const [allMessages, setAllMessages] = useState<SessionContentMessage[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [viewMode, setViewMode] = useState<'messages' | 'terminal'>('messages');
  const [renderMarkdown, setRenderMarkdown] = useState(true);
  const [showTools, setShowTools] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [showProgress, setShowProgress] = useState(isActive ?? false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<
    { id: string; text: string; timestamp: number; expectedHumanCount: number }[]
  >([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);
  // Track how many messages we've loaded from the end
  const loadedOffsetRef = useRef(0);

  // SSE streaming for active sessions
  const stream = useSessionStream({
    sessionId: rcSessionId,
    enabled: isActive ?? false,
    onEvent: useCallback(
      (event: SessionStreamEvent) => {
        // Refetch latest content on status change / loop complete
        if (event.event === 'status' || event.event === 'loop_complete') {
          void fetchLatestRef.current();
        }
        // Fire notifications for session lifecycle events
        if (event.event === 'status') {
          const status = (event.data as { status?: string }).status;
          if (status === 'ended') {
            addNotificationRef.current({
              type: 'success',
              message: `Session ${rcSessionId.slice(0, 8)} completed`,
              sessionId: rcSessionId,
            });
          } else if (status === 'error') {
            addNotificationRef.current({
              type: 'error',
              message: `Session ${rcSessionId.slice(0, 8)} encountered an error`,
              sessionId: rcSessionId,
            });
          }
        }
        if (event.event === 'approval_needed') {
          const toolName = (event.data as { toolName?: string }).toolName ?? 'unknown';
          addNotificationRef.current({
            type: 'warning',
            message: `Session ${rcSessionId.slice(0, 8)} needs approval for ${toolName}`,
            sessionId: rcSessionId,
          });
        }
      },
      [rcSessionId],
    ),
  });

  // Fetch latest messages (offset=0, replaces tail of loaded messages)
  const fetchLatest = useCallback(async () => {
    try {
      const result = await api.getSessionContent(sessionId, {
        machineId,
        projectPath,
        limit: PAGE_SIZE,
      });
      setTotalMessages(result.totalMessages);
      // If we had older messages loaded, keep them and replace the tail
      setAllMessages((prev) => {
        const olderCount = Math.max(0, prev.length - PAGE_SIZE);
        const olderMessages = prev.slice(0, olderCount);
        return [...olderMessages, ...result.messages];
      });
      loadedOffsetRef.current = 0;
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId, machineId, projectPath]);

  const fetchLatestRef = useRef(fetchLatest);
  fetchLatestRef.current = fetchLatest;

  // Fetch older messages (prepend to existing)
  // Track whether we're prepending (to suppress auto-scroll to bottom)
  const prependingRef = useRef(false);

  const fetchOlder = useCallback(async () => {
    if (loadingOlder || allMessages.length >= totalMessages) return;
    setLoadingOlder(true);
    try {
      const offset = allMessages.length;
      const result = await api.getSessionContent(sessionId, {
        machineId,
        projectPath,
        limit: PAGE_SIZE,
        offset,
      });
      setTotalMessages(result.totalMessages);
      if (result.messages.length > 0) {
        const el = scrollRef.current;
        const prevScrollHeight = el?.scrollHeight ?? 0;
        const prevScrollTop = el?.scrollTop ?? 0;
        prependingRef.current = true;
        setAllMessages((prev) => [...result.messages, ...prev]);
        // Use double-RAF to ensure React has committed the DOM
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (el) {
              el.scrollTop = prevScrollTop + (el.scrollHeight - prevScrollHeight);
            }
            prependingRef.current = false;
          });
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingOlder(false);
    }
  }, [sessionId, machineId, projectPath, allMessages.length, totalMessages, loadingOlder]);

  // Initial fetch
  useEffect(() => {
    setLoading(true);
    setAllMessages([]);
    loadedOffsetRef.current = 0;
    void fetchLatest();
  }, [fetchLatest]);

  // Auto-poll when session is active (only refresh latest)
  useEffect(() => {
    if (!isActive) return;

    const timer = setInterval(() => void fetchLatest(), CONTENT_POLL_MS);

    const handleVisibility = (): void => {
      if (!document.hidden) void fetchLatest();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isActive, fetchLatest]);

  // Auto-scroll when new messages arrive at the END (not when prepending older)
  useEffect(() => {
    if (allMessages.length > 0 && scrollRef.current && !prependingRef.current) {
      const newCount = allMessages.length;
      if (newCount > prevMsgCountRef.current && autoScroll) {
        const isInitialLoad = prevMsgCountRef.current === 0;
        // Use instant scroll on initial load so user sees the latest messages immediately
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({
            top: scrollRef.current?.scrollHeight ?? 0,
            behavior: isInitialLoad ? 'instant' : 'smooth',
          });
        });
      }
      prevMsgCountRef.current = newCount;
    }
  }, [allMessages.length, autoScroll]);

  // Clear optimistic messages when the real human message arrives (count-based)
  useEffect(() => {
    if (optimisticMessages.length === 0) return;
    const humanCount = allMessages.filter((m) => m.type === 'human').length;
    setOptimisticMessages((prev) =>
      prev.filter((om) => humanCount <= om.expectedHumanCount),
    );
  }, [allMessages, optimisticMessages.length]);

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

  // Scroll handler for user-scrolled-up detection + infinite scroll top
  const fetchOlderRef = useRef(fetchOlder);
  fetchOlderRef.current = fetchOlder;
  const hasMoreRef = useRef(false);
  hasMoreRef.current = allMessages.length < totalMessages;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setUserScrolledUp(!atBottom);
    setAutoScroll(atBottom);

    // Trigger lazy load when near the top
    if (el.scrollTop < 150 && hasMoreRef.current) {
      void fetchOlderRef.current();
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    setAutoScroll(true);
    setUserScrolledUp(false);
  }, []);

  // React to parent sending a message — add optimistic entry
  const lastSentRef = useRef<number>(0);
  useEffect(() => {
    if (!lastSentMessage || lastSentMessage.ts <= lastSentRef.current) return;
    lastSentRef.current = lastSentMessage.ts;
    const currentHumanCount = allMessages.filter((m) => m.type === 'human').length;
    setOptimisticMessages((prev) => [
      ...prev,
      {
        id: `opt-${lastSentMessage.ts}`,
        text: lastSentMessage.text,
        timestamp: lastSentMessage.ts,
        expectedHumanCount: currentHumanCount,
      },
    ]);
    // Auto-scroll when user sends
    setAutoScroll(true);
    setUserScrolledUp(false);
    setTimeout(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current?.scrollHeight ?? 0,
        behavior: 'smooth',
      });
    }, 50);
  }, [lastSentMessage]);

  const hasMore = allMessages.length < totalMessages;

  // For ended sessions, reconstruct terminal-like output from loaded messages
  // so the Terminal tab has content even when SSE is disabled.
  const terminalOutput = useMemo(() => {
    if (stream.rawOutput.length > 0) return stream.rawOutput;
    if (allMessages.length === 0) return [];

    const lines: string[] = [];
    for (const msg of allMessages) {
      const text = msg.content ?? '';
      if (!text) continue;

      switch (msg.type) {
        case 'human':
          lines.push(`\x1b[1;34m❯ ${text}\x1b[0m\r\n`);
          break;
        case 'assistant':
          lines.push(`${text}\r\n\r\n`);
          break;
        case 'thinking':
          lines.push(`\x1b[2;35m💭 ${text.slice(0, 200)}${text.length > 200 ? '…' : ''}\x1b[0m\r\n`);
          break;
        case 'tool_use':
          lines.push(`\x1b[33m⚡ ${msg.toolName ?? 'tool'}\x1b[0m ${text.slice(0, 300)}${text.length > 300 ? '…' : ''}\r\n`);
          break;
        case 'tool_result':
          lines.push(`\x1b[2m${text.slice(0, 500)}${text.length > 500 ? '…' : ''}\x1b[0m\r\n`);
          break;
        case 'progress':
          lines.push(`\x1b[36m⏳ ${msg.toolName ?? ''} ${text}\x1b[0m\r\n`);
          break;
        default:
          lines.push(`${text}\r\n`);
      }
    }
    return lines;
  }, [allMessages, stream.rawOutput]);

  const filteredMessages = allMessages.filter((m) => {
    // Always show these types
    if (m.type === 'human' || m.type === 'assistant' || m.type === 'subagent' || m.type === 'todo')
      return true;
    // Toggle-controlled types
    if (m.type === 'tool_use' || m.type === 'tool_result') return showTools;
    if (m.type === 'thinking') return showThinking;
    if (m.type === 'progress') return showProgress;
    // Hide unknown types unless tools are shown
    return showTools;
  });

  // Merge optimistic messages into the message list as regular human entries
  // so the transition from "sending..." to real message is seamless (same position,
  // same styling). The _optimistic flag adds a subtle "sending..." indicator.
  const messages = useMemo(() => {
    if (optimisticMessages.length === 0) return filteredMessages;
    const merged: (SessionContentMessage & { _optimistic?: boolean })[] = [...filteredMessages];
    for (const om of optimisticMessages) {
      merged.push({
        type: 'human',
        content: om.text,
        timestamp: new Date(om.timestamp).toISOString(),
        _optimistic: true,
      });
    }
    return merged;
  }, [filteredMessages, optimisticMessages]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Controls */}
      <div className="px-5 py-1.5 border-b border-border flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode('messages')}
              className={cn(
                'px-3 py-0.5 text-[11px] cursor-pointer transition-all duration-200 h-7 border-0',
                viewMode === 'messages'
                  ? 'bg-primary text-white font-medium'
                  : 'bg-muted text-muted-foreground hover:bg-accent',
              )}
            >
              Messages
            </button>
            <button
              type="button"
              onClick={() => setViewMode('terminal')}
              className={cn(
                'px-3 py-0.5 text-[11px] cursor-pointer transition-all duration-200 h-7 border-0 border-l border-border',
                viewMode === 'terminal'
                  ? 'bg-primary text-white font-medium'
                  : 'bg-muted text-muted-foreground hover:bg-accent',
              )}
            >
              Terminal
            </button>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {viewMode === 'messages' && allMessages.length > 0
              ? `${filteredMessages.length}${hasMore ? ` / ${totalMessages}` : ''} messages`
              : ''}
            {isActive && (
              <span
                className={cn(
                  'animate-pulse',
                  stream.connected ? 'text-green-500' : 'text-yellow-500',
                )}
                title={stream.connected ? 'SSE streaming live' : 'Polling every 3s'}
              >
                &#x25CF; {stream.connected ? 'Streaming' : 'Live'}
              </span>
            )}
          </span>
        </div>
        <div className="flex gap-1.5">
          {viewMode === 'messages' && (
            <>
              <button
                type="button"
                onClick={() => setShowThinking(!showThinking)}
                aria-label={showThinking ? 'Hide thinking' : 'Show thinking'}
                aria-pressed={showThinking}
                className={cn(
                  'px-2.5 py-0.5 rounded-md border text-[11px] cursor-pointer transition-all duration-200 h-7',
                  showThinking
                    ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/25 font-medium'
                    : 'bg-muted text-muted-foreground border-border hover:bg-accent',
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
                  'px-2.5 py-0.5 rounded-md border text-[11px] cursor-pointer transition-all duration-200 h-7',
                  showTools
                    ? 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/25 font-medium'
                    : 'bg-muted text-muted-foreground border-border hover:bg-accent',
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
                  'px-2.5 py-0.5 rounded-md border text-[11px] cursor-pointer transition-all duration-200 h-7',
                  showProgress
                    ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/25 font-medium'
                    : 'bg-muted text-muted-foreground border-border hover:bg-accent',
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
                  'px-2.5 py-0.5 rounded-md border text-[11px] cursor-pointer transition-all duration-200 h-7',
                  renderMarkdown
                    ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/25 font-medium'
                    : 'bg-muted text-muted-foreground border-border hover:bg-accent',
                )}
              >
                Markdown
              </button>
              <button
                type="button"
                onClick={() => void fetchLatest()}
                aria-label="Refresh conversation"
                className="px-2.5 py-0.5 bg-muted text-muted-foreground border border-border rounded-md text-[11px] cursor-pointer transition-all duration-200 h-7 hover:bg-accent hover:text-foreground"
              >
                Refresh
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      {viewMode === 'terminal' ? (
        <TerminalView rawOutput={terminalOutput} isActive={isActive} />
      ) : (
        <div className="relative flex-1 min-h-0">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="absolute inset-0 overflow-auto px-5 py-2"
          >
            {loading && (
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
            {error && <ErrorBanner message={error} onRetry={() => void fetchLatest()} />}
            {allMessages.length > 0 && filteredMessages.length === 0 && !loading && (
              <div className="p-5 text-center text-muted-foreground text-xs">
                No messages match current filters
              </div>
            )}
            {allMessages.length === 0 && !loading && !error && (
              <div className="p-5 text-center text-muted-foreground text-xs">No messages yet</div>
            )}
            {/* Load older messages button */}
            {hasMore && !loading && (
              <div className="py-2 text-center">
                <button
                  type="button"
                  onClick={() => void fetchOlder()}
                  disabled={loadingOlder}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 hover:underline cursor-pointer disabled:opacity-50 bg-transparent border-none"
                >
                  {loadingOlder
                    ? 'Loading...'
                    : `Load older messages (${totalMessages - allMessages.length} more)`}
                </button>
              </div>
            )}
            {messages.map((msg, i) => {
              switch (msg.type) {
                case 'thinking':
                  return (
                    <ThinkingBlock
                      key={`${msg.type}-${String(i)}`}
                      content={msg.content}
                      timestamp={msg.timestamp}
                    />
                  );
                case 'progress':
                  return (
                    <ProgressIndicator
                      key={`${msg.type}-${String(i)}`}
                      content={msg.content}
                      toolName={msg.toolName}
                      timestamp={msg.timestamp}
                    />
                  );
                case 'subagent':
                  return (
                    <SubagentBlock
                      key={`${msg.type}-${String(i)}`}
                      content={msg.content}
                      toolName={msg.toolName}
                      subagentId={msg.subagentId}
                      timestamp={msg.timestamp}
                    />
                  );
                case 'todo':
                  return (
                    <TodoBlock
                      key={`${msg.type}-${String(i)}`}
                      content={msg.content}
                      timestamp={msg.timestamp}
                    />
                  );
                default:
                  return (
                    <InlineMessage
                      key={`${msg.type}-${String(i)}`}
                      message={msg}
                      renderMarkdown={renderMarkdown}
                      isOptimistic={'_optimistic' in msg && (msg as { _optimistic?: boolean })._optimistic}
                    />
                  );
              }
            })}

            {/* (optimistic messages are now merged into the messages array above) */}

            {/* Live streaming output */}
            {stream.connected && stream.streamOutput.length > 0 && (
              <div className="rounded-md border border-green-500/20 bg-green-50/20 dark:bg-green-950/20 px-2.5 py-1.5 mb-1.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[9px] font-semibold text-green-500">Streaming</span>
                </div>
                <AnsiText className="text-[11px] text-foreground/90 whitespace-pre-wrap font-mono leading-relaxed max-h-[200px] overflow-auto m-0">
                  {stream.streamOutput.join('')}
                </AnsiText>
              </div>
            )}
          </div>

          {/* Floating scroll-to-bottom button */}
          {userScrolledUp && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-3 right-5 px-4 py-1.5 bg-primary text-white text-[11px] font-medium rounded-full shadow-lg cursor-pointer opacity-90 hover:opacity-100 transition-all duration-200 z-10 hover:shadow-xl"
            >
              Scroll to bottom
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const TRUNCATE_THRESHOLD = 800;

export function InlineMessage({
  message,
  renderMarkdown,
  isOptimistic,
}: {
  message: SessionContentMessage;
  renderMarkdown?: boolean;
  isOptimistic?: boolean;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const msgStyle = getMessageStyle(message.type);
  const isTool = message.type === 'tool_use' || message.type === 'tool_result';
  const isRenderable = renderMarkdown && (message.type === 'assistant' || message.type === 'human');
  const content = message.content ?? '';
  const isLong = content.length > TRUNCATE_THRESHOLD;
  const displayContent =
    isLong && !expanded ? `${content.slice(0, TRUNCATE_THRESHOLD)}...` : content;

  return (
    <div className={cn('mb-2 px-3 py-2 rounded-md border-l-2', msgStyle.bubbleClass, isOptimistic && 'opacity-70')}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className={cn('text-[10px] font-semibold', msgStyle.textClass)}>
          {msgStyle.label}
        </span>
        {isOptimistic && (
          <span className="text-[9px] text-blue-500 animate-pulse">sending...</span>
        )}
        {message.toolName && (
          <span className="text-[10px] font-mono text-muted-foreground">{message.toolName}</span>
        )}
        {!isOptimistic && message.timestamp && (
          <span className="text-[9px] text-muted-foreground ml-auto">
            {formatTime(message.timestamp)}
          </span>
        )}
      </div>
      <div
        className={cn(
          'leading-6 text-foreground break-words',
          isTool ? 'text-[11px] font-mono whitespace-pre-wrap' : 'text-xs',
          isRenderable ? '' : 'whitespace-pre-wrap',
          !expanded && (isTool ? 'max-h-[150px] overflow-auto' : 'max-h-[400px] overflow-auto'),
          expanded && 'max-h-none overflow-visible',
        )}
      >
        {isRenderable ? (
          <MarkdownContent className="text-xs leading-6">{displayContent}</MarkdownContent>
        ) : (
          <AnsiSpan>{displayContent}</AnsiSpan>
        )}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 px-2 py-0.5 text-[10px] text-primary bg-transparent border-0 cursor-pointer font-medium"
        >
          {expanded ? 'Show less' : `Show all (${Math.round(content.length / 1000)}k chars)`}
        </button>
      )}
    </div>
  );
}
