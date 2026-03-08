'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useHotkeys } from '../hooks/use-hotkeys';
import type { SessionContentMessage } from '../lib/api';
import { formatNumber, formatTime } from '../lib/format-utils';
import { getMessageStyle } from '../lib/message-styles';
import { COPY_FEEDBACK_MS, MESSAGE_WINDOWING_THRESHOLD } from '../lib/ui-constants';
import { AnsiSpan, AnsiText } from './AnsiText';
import { ErrorBanner } from './ErrorBanner';
import { MarkdownContent } from './MarkdownContent';
import { ProgressIndicator } from './ProgressIndicator';
import { SubagentBlock } from './SubagentBlock';
import { ThinkingBlock } from './ThinkingBlock';
import { useToast } from './Toast';
import { TodoBlock } from './TodoBlock';

// ---------------------------------------------------------------------------
// View mode toggle (Messages / Terminal)
// ---------------------------------------------------------------------------

export function ViewModeToggle({
  viewMode,
  onViewModeChange,
}: {
  viewMode: 'messages' | 'terminal';
  onViewModeChange: (mode: 'messages' | 'terminal') => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1">
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message list
// ---------------------------------------------------------------------------

export function MessageList({
  messages,
  totalMessages,
  isLoading,
  error,
  isActive,
  isActiveOrStarting,
  autoRefresh,
  onAutoRefreshChange,
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
  isActiveOrStarting?: boolean;
  autoRefresh?: boolean;
  onAutoRefreshChange?: (value: boolean) => void;
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

  useHotkeys(
    useMemo(
      () => ({
        t: () => setShowTools((prev) => !prev),
        k: () => setShowThinking((prev) => !prev),
        p: () => setShowProgress((prev) => !prev),
        d: () => setRenderMarkdown((prev) => !prev),
      }),
      [],
    ),
  );

  // Always show: human, assistant, subagent, todo
  // Toggle: tool_use/tool_result (showTools), thinking (showThinking), progress (showProgress)
  const visibleMessages = useMemo(
    () =>
      messages.filter((m) => {
        if (
          m.type === 'human' ||
          m.type === 'assistant' ||
          m.type === 'subagent' ||
          m.type === 'todo'
        )
          return true;
        if (m.type === 'tool_use' || m.type === 'tool_result') return showTools;
        if (m.type === 'thinking') return showThinking;
        if (m.type === 'progress') return showProgress;
        return false;
      }),
    [messages, showTools, showThinking, showProgress],
  );

  // Apply text search filter
  const searchFiltered = useMemo(
    () =>
      search
        ? visibleMessages.filter((m) =>
            (m.content ?? '').toLowerCase().includes(search.toLowerCase()),
          )
        : visibleMessages,
    [visibleMessages, search],
  );

  // --- Lightweight windowing for large message lists ---
  const WINDOW_SIZE = 50;
  const OVERSCAN = 10;
  const EST_MSG_HEIGHT = 60; // estimated px per message
  const shouldWindow = searchFiltered.length > MESSAGE_WINDOWING_THRESHOLD;
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
      const newEnd = Math.min(
        searchFiltered.length,
        centerIndex + Math.floor(WINDOW_SIZE / 2) + OVERSCAN,
      );
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
    const changed =
      count !== prevCountRef.current ||
      streamLen !== prevStreamLen ||
      pendingLen !== prevPendingRef.current ||
      optimisticLen !== prevOptimisticRef.current;
    prevCountRef.current = count;
    prevStreamLenRef.current = streamLen;
    prevPendingRef.current = pendingLen;
    prevOptimisticRef.current = optimisticLen;
    if (changed && autoScroll && scrollRef.current) {
      // Use instant for stream output (frequent updates), smooth for new messages
      const behavior = streamLen !== prevStreamLen ? ('instant' as const) : ('smooth' as const);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior });
      });
    }
  }, [
    visibleMessages.length,
    streamOutput?.length,
    pendingUserMessages?.length,
    optimisticMessages?.length,
    autoScroll,
  ]);

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
        <span>
          {formatNumber(messages.length)}
          {messages.length < totalMessages ? ` / ${formatNumber(totalMessages)}` : ''} messages
        </span>
        {searchFiltered.length !== messages.length && (
          <span>{formatNumber(searchFiltered.length)} shown</span>
        )}
        <button
          type="button"
          onClick={() => setShowThinking(!showThinking)}
          aria-label={showThinking ? 'Hide thinking' : 'Show thinking'}
          aria-pressed={showThinking}
          title="Toggle thinking (K)"
          className={cn(
            'px-2 py-0.5 rounded-md border border-border text-[10px] cursor-pointer transition-colors',
            showThinking
              ? 'bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-500/30'
              : 'bg-muted text-muted-foreground',
          )}
        >
          Thinking
        </button>
        <button
          type="button"
          onClick={() => setShowTools(!showTools)}
          aria-label={showTools ? 'Hide tool messages' : 'Show tool messages'}
          aria-pressed={showTools}
          title="Toggle tools (T)"
          className={cn(
            'px-2 py-0.5 rounded-md border border-border text-[10px] cursor-pointer transition-colors',
            showTools
              ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 border-yellow-500/30'
              : 'bg-muted text-muted-foreground',
          )}
        >
          Tools
        </button>
        <button
          type="button"
          onClick={() => setShowProgress(!showProgress)}
          aria-label={showProgress ? 'Hide progress' : 'Show progress'}
          aria-pressed={showProgress}
          title="Toggle progress (P)"
          className={cn(
            'px-2 py-0.5 rounded-md border border-border text-[10px] cursor-pointer transition-colors',
            showProgress
              ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/30'
              : 'bg-muted text-muted-foreground',
          )}
        >
          Progress
        </button>
        <button
          type="button"
          onClick={() => setRenderMarkdown(!renderMarkdown)}
          aria-label={renderMarkdown ? 'Show raw text' : 'Render markdown'}
          aria-pressed={renderMarkdown}
          title="Toggle markdown rendering (D)"
          className={cn(
            'px-2 py-0.5 rounded-md border border-border text-[10px] cursor-pointer transition-colors',
            renderMarkdown
              ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/30'
              : 'bg-muted text-muted-foreground',
          )}
        >
          Markdown
        </button>
        {isActiveOrStarting && (
          <button
            type="button"
            onClick={() => onAutoRefreshChange?.(!autoRefresh)}
            aria-label={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
            aria-pressed={autoRefresh}
            className={cn(
              'px-2 py-0.5 rounded-md border border-border text-[10px] cursor-pointer transition-colors inline-flex items-center gap-1',
              autoRefresh
                ? 'bg-green-500/20 text-green-700 dark:text-green-300 border-green-500/30'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <span className="text-[10px]">{autoRefresh ? '\u23F8' : '\u25B6'}</span>
            Auto-refresh
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            const next = !autoScroll;
            setAutoScroll(next);
            setUserScrolledUp(!next);
            if (next && scrollRef.current) {
              scrollRef.current.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: 'smooth',
              });
            }
          }}
          aria-label={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
          aria-pressed={autoScroll}
          className={cn(
            'px-2 py-0.5 rounded-md border border-border text-[10px] cursor-pointer transition-colors inline-flex items-center gap-1',
            autoScroll
              ? 'bg-green-500/20 text-green-700 dark:text-green-300 border-green-500/30'
              : 'bg-muted text-muted-foreground',
          )}
        >
          <span className="text-[10px]">{autoScroll ? '\u23F8' : '\u25B6'}</span>
          Auto-scroll
        </button>
        {isActive && autoScroll && !userScrolledUp && (
          <span
            className="flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400 ml-1"
            title="Auto-scroll active"
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Following
          </span>
        )}
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
            aria-label="Search messages"
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
          <div className="p-8 text-center text-muted-foreground text-[13px]">
            No messages match &ldquo;{search}&rdquo;
          </div>
        )}

        {totalMessages > messages.length && (
          <div className="py-2 text-center text-xs">
            <button
              type="button"
              className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 hover:underline cursor-pointer"
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
        {(() => {
          const items = groupToolPairs(windowedMessages, winStart);
          return items.map((item, idx) => {
            const prevTs = idx > 0 ? getItemTimestamp(items[idx - 1] as RenderedItem) : undefined;
            const curTs = getItemTimestamp(item);
            const separatorLabel = getDateSeparatorLabel(prevTs, curTs);
            return (
              <React.Fragment key={item.key}>
                {separatorLabel && <DateSeparator label={separatorLabel} />}
                {item.kind === 'tool_pair' ? (
                  <ToolPairBlock toolUse={item.toolUse} toolResult={item.toolResult} />
                ) : (
                  <MessageBlock message={item.message} renderMarkdown={renderMarkdown} />
                )}
              </React.Fragment>
            );
          });
        })()}
        {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} aria-hidden />}

        {/* Optimistic user messages (shown instantly on send, before any SSE/JSONL) */}
        {optimisticMessages &&
          optimisticMessages.length > 0 &&
          optimisticMessages.map((text, i) => (
            <div key={`optimistic-${String(i)}`} className="relative">
              <div className="px-3 py-2 rounded-lg border-l-[3px] bg-blue-500/[0.06] border-l-blue-400 opacity-80">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                    You
                  </span>
                  <span className="text-[9px] text-muted-foreground/60 animate-pulse">
                    sending...
                  </span>
                </div>
                <div className="text-[13px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
                  {text}
                </div>
              </div>
            </div>
          ))}

        {/* Pending user messages from SSE (shown before JSONL poll catches up) */}
        {pendingUserMessages &&
          pendingUserMessages.length > 0 &&
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
              scrollRef.current.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: 'smooth',
              });
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
// Date separators — thin divider lines when timestamps cross hour/day boundaries
// ---------------------------------------------------------------------------

const DateSeparator = React.memo(function DateSeparator({
  label,
}: {
  label: string;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-3 py-2 my-1">
      <div className="flex-1 h-px bg-border" />
      <span className="text-[10px] text-muted-foreground font-medium shrink-0">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
});

function getItemTimestamp(item: RenderedItem): string | undefined {
  return item.kind === 'tool_pair' ? item.toolUse.timestamp : item.message.timestamp;
}

/**
 * Returns a separator label when the timestamp boundary crosses a new day or
 * when more than 1 hour has elapsed. Returns null for the first message or
 * when no significant boundary is crossed.
 */
function getDateSeparatorLabel(
  prevTimestamp: string | undefined,
  currentTimestamp: string | undefined,
): string | null {
  if (!prevTimestamp || !currentTimestamp) return null;
  const prev = new Date(prevTimestamp);
  const curr = new Date(currentTimestamp);
  if (Number.isNaN(prev.getTime()) || Number.isNaN(curr.getTime())) return null;

  // Day change — show full date
  if (
    prev.getFullYear() !== curr.getFullYear() ||
    prev.getMonth() !== curr.getMonth() ||
    prev.getDate() !== curr.getDate()
  ) {
    return curr.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }

  // More than 1 hour gap — show time
  const diffMs = curr.getTime() - prev.getTime();
  if (diffMs > 60 * 60 * 1000) {
    return curr.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tool pair grouping — pairs tool_use + tool_result by toolId
// ---------------------------------------------------------------------------

type RenderedItem =
  | { kind: 'message'; message: SessionContentMessage; key: string }
  | {
      kind: 'tool_pair';
      toolUse: SessionContentMessage;
      toolResult: SessionContentMessage;
      key: string;
    };

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
  const toast = useToast();
  const reactId = useId();
  const contentId = toolUse.toolId ? `tool-pair-${toolUse.toolId}` : `tool-pair-${reactId}`;

  const toolName = toolUse.toolName ?? 'Tool';
  const inputContent = toolUse.content ?? '';
  const outputContent = toolResult.content ?? '';
  const summary =
    inputContent.replace(/\n/g, ' ').slice(0, 80) + (inputContent.length > 80 ? '...' : '');

  const handleCopyOutput = useCallback(() => {
    void navigator.clipboard
      .writeText(outputContent)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
      })
      .catch(() => toast.error('Failed to copy'));
  }, [outputContent, toast]);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
        aria-controls={contentId}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-left text-foreground font-[inherit] border-none border-l-2',
          'bg-yellow-500/[0.04] border-l-yellow-400',
        )}
      >
        <span className="text-[10px] font-semibold shrink-0 text-yellow-600 dark:text-yellow-400">
          Tool
        </span>
        <span className="text-[11px] font-mono text-muted-foreground shrink-0">{toolName}</span>
        <span className="text-[10px] text-muted-foreground/60 truncate">{summary}</span>
        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">click to expand</span>
      </button>
    );
  }

  return (
    <div
      id={contentId}
      className={cn(
        'px-3 py-2 rounded-lg border-l-[3px]',
        'bg-yellow-500/[0.04] border-l-yellow-400',
      )}
    >
      {/* Header */}
      <div className="flex justify-between items-center mb-1">
        <span className="text-[11px] font-semibold text-yellow-600 dark:text-yellow-400">
          Tool
          <span className="ml-1.5 font-normal font-mono text-muted-foreground">{toolName}</span>
        </span>
        <div className="flex gap-2 items-center">
          {toolUse.timestamp && (
            <span className="text-[10px] text-muted-foreground">
              {formatTime(toolUse.timestamp)}
            </span>
          )}
          {toolResult.timestamp && toolResult.timestamp !== toolUse.timestamp && (
            <>
              <span className="text-[10px] text-muted-foreground/40">-</span>
              <span className="text-[10px] text-muted-foreground">
                {formatTime(toolResult.timestamp)}
              </span>
            </>
          )}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-expanded={true}
            aria-controls={contentId}
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

const MessageBlock = React.memo(function MessageBlock({
  message,
  renderMarkdown,
}: {
  message: SessionContentMessage;
  renderMarkdown?: boolean;
}): React.JSX.Element {
  switch (message.type) {
    case 'thinking':
      return <ThinkingBlock content={message.content} timestamp={message.timestamp} />;
    case 'progress':
      return (
        <ProgressIndicator
          content={message.content}
          toolName={message.toolName}
          timestamp={message.timestamp}
        />
      );
    case 'subagent':
      return (
        <SubagentBlock
          content={message.content}
          toolName={message.toolName}
          subagentId={message.subagentId}
          timestamp={message.timestamp}
        />
      );
    case 'todo':
      return <TodoBlock content={message.content} timestamp={message.timestamp} />;
    default:
      return <MessageBubble message={message} renderMarkdown={renderMarkdown} />;
  }
});

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function MessageBubble({
  message,
  renderMarkdown,
}: {
  message: SessionContentMessage;
  renderMarkdown?: boolean;
}): React.JSX.Element {
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
          'w-full flex items-center gap-2 px-3 py-1 rounded-md cursor-pointer text-left text-foreground font-[inherit] border-none border-l-2',
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
          isTool
            ? 'text-[11px] font-mono whitespace-pre-wrap max-h-[400px] overflow-auto'
            : 'text-[13px]',
          !isTool && !isRenderable ? 'whitespace-pre-wrap' : '',
        )}
      >
        {isRenderable ? (
          <MarkdownContent className="text-[13px] leading-relaxed">
            {displayContent}
          </MarkdownContent>
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
