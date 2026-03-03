import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { SessionContentMessage, SessionContentResponse } from '../lib/api.ts';
import { api } from '../lib/api.ts';

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
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: '50%',
        minWidth: 400,
        maxWidth: 800,
        backgroundColor: 'var(--bg-primary)',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.3)',
      }}
      ref={panelRef}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Session Preview</div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {sessionId.slice(0, 32)}...
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setShowTools(!showTools)}
            style={{
              padding: '4px 10px',
              backgroundColor: showTools ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: showTools ? '#fff' : 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {showTools ? 'Hide Tools' : 'Show Tools'}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '4px 10px',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Close (Esc)
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {data && (
        <div
          style={{
            padding: '6px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            gap: 16,
            fontSize: 11,
            color: 'var(--text-muted)',
            backgroundColor: 'var(--bg-secondary)',
            flexShrink: 0,
          }}
        >
          <span>{data.totalMessages} total messages</span>
          <span>
            {visibleMessages.length} shown
            {!showTools && ' (conversations only)'}
          </span>
        </div>
      )}

      {/* Content */}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
        {loading && (
          <div
            style={{
              padding: 32,
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
            }}
          >
            Loading session content...
          </div>
        )}

        {error && (
          <div
            style={{
              padding: '10px 16px',
              backgroundColor: '#7f1d1d',
              color: '#fca5a5',
              borderRadius: 'var(--radius)',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {data && visibleMessages.length === 0 && (
          <div
            style={{
              padding: 32,
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
            }}
          >
            No messages found in this session
          </div>
        )}

        {visibleMessages.map((msg, i) => (
          <MessageBubble key={`${msg.type}-${String(i)}`} message={msg} />
        ))}

        {data && data.totalMessages > data.messages.length && (
          <div
            style={{
              padding: '8px 0',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 12,
            }}
          >
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
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 4,
          padding: '4px 12px',
          backgroundColor: style.bg,
          borderRadius: 'var(--radius-sm)',
          borderLeft: `2px solid ${style.color}`,
          border: 'none',
          borderLeftWidth: 2,
          borderLeftStyle: 'solid',
          borderLeftColor: style.color,
          cursor: 'pointer',
          textAlign: 'left',
          color: 'var(--text-primary)',
          font: 'inherit',
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: style.color,
            flexShrink: 0,
          }}
        >
          {style.label}
        </span>
        {message.toolName && (
          <span
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)',
            }}
          >
            {message.toolName}
          </span>
        )}
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            marginLeft: 'auto',
          }}
        >
          click to expand
        </span>
      </button>
    );
  }

  const displayContent =
    !expanded && isLong ? `${message.content.slice(0, 500)}...` : message.content;

  return (
    <div
      style={{
        marginBottom: 8,
        padding: '8px 12px',
        backgroundColor: style.bg,
        borderRadius: 'var(--radius)',
        borderLeft: `3px solid ${style.color}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: style.color }}>
          {style.label}
          {message.toolName && (
            <span
              style={{
                marginLeft: 6,
                fontWeight: 400,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
              }}
            >
              {message.toolName}
            </span>
          )}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {message.timestamp && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {new Date(message.timestamp).toLocaleTimeString()}
            </span>
          )}
          {isTool && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              style={{
                fontSize: 10,
                color: 'var(--accent)',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
              }}
            >
              collapse
            </button>
          )}
        </div>
      </div>
      <div
        style={{
          fontSize: isTool ? 11 : 13,
          lineHeight: 1.6,
          color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: isTool ? 'var(--font-mono)' : undefined,
          maxHeight: isTool ? 300 : undefined,
          overflow: isTool ? 'auto' : undefined,
        }}
      >
        {displayContent}
      </div>
      {isLong && !isTool && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          style={{
            marginTop: 4,
            fontSize: 11,
            color: 'var(--accent)',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
          }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
