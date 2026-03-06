'use client';

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '../components/ErrorBanner';
import type { SessionContentMessage, SessionContentResponse } from '../lib/api';
import { api } from '../lib/api';
import { formatNumber, formatTime } from '../lib/format-utils';
import { getMessageStyle } from '../lib/message-styles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionStatus = 'active' | 'error' | 'ended' | 'starting';

const statusBorderClass: Record<SessionStatus, string> = {
  active: 'border-l-green-500/60',
  error: 'border-l-red-500/60',
  ended: 'border-l-muted-foreground/30',
  starting: 'border-l-yellow-500/60',
};

type SessionPreviewProps = {
  sessionId: string;
  machineId: string;
  projectPath?: string;
  status?: SessionStatus;
  onClose: () => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionPreview({
  sessionId,
  machineId,
  projectPath,
  status,
  onClose,
}: SessionPreviewProps): React.JSX.Element {
  const [data, setData] = useState<SessionContentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTools, setShowTools] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getSessionContent(sessionId, {
        machineId,
        projectPath,
        limit: 200,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId, machineId, projectPath]);

  useEffect(() => {
    void fetchContent();
  }, [fetchContent]);

  // Auto-scroll to bottom on data load
  useEffect(() => {
    if (data && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [data]);

  // Close on Escape and focus trap
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
      // Focus trap: keep Tab within the panel
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    // Auto-focus the panel on open
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Filter messages based on toggle
  const visibleMessages = data
    ? showTools
      ? data.messages
      : data.messages.filter((m) => m.type === 'human' || m.type === 'assistant')
    : [];

  return (
    <>
      {/* Backdrop for click-outside close */}
      <button
        type="button"
        className="fixed inset-0 z-[99] bg-black/30 border-none cursor-default"
        onClick={onClose}
        aria-label="Close preview"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-preview-title"
        tabIndex={-1}
        className={cn(
          'fixed top-0 right-0 bottom-0 w-full sm:w-3/4 md:w-1/2 md:min-w-[400px] max-w-[800px] bg-background border-l border-border border-l-[3px] flex flex-col z-[100] shadow-[-4px_0_24px_rgba(0,0,0,0.15)] dark:shadow-[-4px_0_24px_rgba(0,0,0,0.4)] outline-none transition-colors hover:border-border',
          status ? statusBorderClass[status] : 'border-l-muted-foreground/30',
        )}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex justify-between items-center shrink-0">
          <div className="min-w-0 flex-1">
            <div id="session-preview-title" className="text-sm font-semibold">
              Session Preview
            </div>
            <div className="text-[11px] text-muted-foreground font-mono mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
              {sessionId.slice(0, 32)}...
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <button
              type="button"
              onClick={() => setShowTools(!showTools)}
              aria-label={showTools ? 'Hide tool messages' : 'Show tool messages'}
              aria-pressed={showTools}
              className={cn(
                'px-2.5 py-1 border border-border rounded-md text-[11px] cursor-pointer',
                showTools ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}
            >
              {showTools ? 'Hide Tools' : 'Show Tools'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1 bg-muted text-muted-foreground border border-border rounded-md text-xs cursor-pointer"
            >
              Close (Esc)
            </button>
          </div>
        </div>

        {/* Stats bar */}
        {data && (
          <div className="px-4 py-1.5 border-b border-border flex gap-4 text-[11px] text-muted-foreground bg-card shrink-0">
            <span>{formatNumber(data.totalMessages)} total messages</span>
            <span>
              {formatNumber(visibleMessages.length)} shown
              {!showTools && ' (conversations only)'}
            </span>
          </div>
        )}

        {/* Content */}
        <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-3">
          {loading && (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={`prev-sk-${String(i)}`}
                  className={cn('rounded-lg p-3', i % 2 === 0 ? 'ml-0 mr-8' : 'ml-8 mr-0')}
                >
                  <Skeleton className="h-3 w-16 mb-2" />
                  <Skeleton className="h-3 w-full mb-1" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ))}
            </div>
          )}

          {error && <ErrorBanner message={error} onRetry={() => void fetchContent()} />}

          {data && visibleMessages.length === 0 && (
            <div className="p-8 text-center text-muted-foreground text-[13px]">
              No messages found in this session
            </div>
          )}

          {visibleMessages.map((msg, i) => (
            <MessageBubble key={`${msg.type}-${String(i)}`} message={msg} />
          ))}

          {data && data.totalMessages > data.messages.length && (
            <div className="py-2 text-center text-muted-foreground text-xs">
              Showing last {formatNumber(data.messages.length)} of{' '}
              {formatNumber(data.totalMessages)} messages
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: SessionContentMessage }): React.JSX.Element {
  const style = getMessageStyle(message.type);

  const isTool = message.type === 'tool_use' || message.type === 'tool_result';
  const [expanded, setExpanded] = useState(!isTool);
  const isLong = (message.content?.length ?? 0) > 500;

  // For tool messages, show compact by default
  if (isTool && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          'w-full flex items-center gap-2 mb-1 px-3 py-1 rounded-md border-none border-l-2 cursor-pointer text-left text-foreground font-[inherit]',
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
  const displayContent = !expanded && isLong ? `${content.slice(0, 500)}...` : content;

  return (
    <div className={cn('mb-2 px-3 py-2 rounded-lg border-l-[3px]', style.bubbleClass)}>
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
          isTool ? 'text-[11px] font-mono max-h-[300px] overflow-auto' : 'text-[13px]',
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
