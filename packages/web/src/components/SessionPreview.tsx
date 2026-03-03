'use client';

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { SessionContentMessage, SessionContentResponse } from '../lib/api';
import { api } from '../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionPreviewProps = {
  sessionId: string;
  machineId: string;
  projectPath?: string;
  onClose: () => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionPreview({
  sessionId,
  machineId,
  projectPath,
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

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Filter messages based on toggle
  const visibleMessages = data
    ? showTools
      ? data.messages
      : data.messages.filter((m) => m.type === 'human' || m.type === 'assistant')
    : [];

  return (
    <div
      ref={panelRef}
      className="fixed top-0 right-0 bottom-0 w-1/2 min-w-[400px] max-w-[800px] bg-background border-l border-border flex flex-col z-[100] shadow-[-4px_0_24px_rgba(0,0,0,0.3)]"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex justify-between items-center shrink-0">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Session Preview</div>
          <div className="text-[11px] text-muted-foreground font-mono mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
            {sessionId.slice(0, 32)}...
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <button
            type="button"
            onClick={() => setShowTools(!showTools)}
            className={cn(
              'px-2.5 py-1 border border-border rounded-sm text-[11px] cursor-pointer',
              showTools ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
            )}
          >
            {showTools ? 'Hide Tools' : 'Show Tools'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 bg-muted text-muted-foreground border border-border rounded-sm text-xs cursor-pointer"
          >
            Close (Esc)
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {data && (
        <div className="px-4 py-1.5 border-b border-border flex gap-4 text-[11px] text-muted-foreground bg-card shrink-0">
          <span>{data.totalMessages} total messages</span>
          <span>
            {visibleMessages.length} shown
            {!showTools && ' (conversations only)'}
          </span>
        </div>
      )}

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-3">
        {loading && (
          <div className="p-8 text-center text-muted-foreground text-[13px]">
            Loading session content...
          </div>
        )}

        {error && (
          <div className="px-4 py-2.5 bg-red-900 text-red-300 rounded-lg text-[13px]">{error}</div>
        )}

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
            Showing last {data.messages.length} of {data.totalMessages} messages
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

const TYPE_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  human: {
    label: 'You',
    color: '#818cf8',
    bg: 'rgba(99, 102, 241, 0.08)',
  },
  assistant: {
    label: 'Claude',
    color: '#4ade80',
    bg: 'rgba(34, 197, 94, 0.06)',
  },
  tool_use: {
    label: 'Tool Call',
    color: '#facc15',
    bg: 'rgba(234, 179, 8, 0.04)',
  },
  tool_result: {
    label: 'Tool Result',
    color: '#94a3b8',
    bg: 'rgba(148, 163, 184, 0.04)',
  },
};

function MessageBubble({ message }: { message: SessionContentMessage }): React.JSX.Element {
  const style = TYPE_STYLES[message.type] ?? {
    label: message.type,
    color: 'var(--text-muted)',
    bg: 'var(--bg-secondary)',
  };

  const isTool = message.type === 'tool_use' || message.type === 'tool_result';
  const [expanded, setExpanded] = useState(!isTool);
  const isLong = message.content.length > 500;

  // For tool messages, show compact by default
  if (isTool && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-full flex items-center gap-2 mb-1 px-3 py-1 rounded-sm border-none cursor-pointer text-left text-foreground font-[inherit]"
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
    !expanded && isLong ? `${message.content.slice(0, 500)}...` : message.content;

  return (
    <div
      className="mb-2 px-3 py-2 rounded-lg"
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
