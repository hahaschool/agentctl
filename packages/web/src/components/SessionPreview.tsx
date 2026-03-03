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
  const panelRef = useRef<HTMLDivElement>(null);

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

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

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
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Session Preview</div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              marginTop: 2,
            }}
          >
            {sessionId.slice(0, 32)}...
          </div>
        </div>
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
          }}
        >
          Close (Esc)
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
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

        {data && data.messages.length === 0 && (
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

        {data?.messages.map((msg, i) => (
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
            Showing {data.messages.length} of {data.totalMessages} messages
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
  human: { label: 'You', color: 'var(--accent)', bg: 'rgba(99, 102, 241, 0.08)' },
  assistant: { label: 'Assistant', color: 'var(--green)', bg: 'rgba(34, 197, 94, 0.06)' },
  tool_use: { label: 'Tool', color: 'var(--yellow)', bg: 'rgba(234, 179, 8, 0.06)' },
  tool_result: { label: 'Result', color: 'var(--text-muted)', bg: 'var(--bg-secondary)' },
};

function MessageBubble({ message }: { message: SessionContentMessage }): React.JSX.Element {
  const style = TYPE_STYLES[message.type] ?? {
    label: message.type,
    color: 'var(--text-muted)',
    bg: 'var(--bg-secondary)',
  };

  const [expanded, setExpanded] = useState(message.type !== 'tool_result');
  const isLong = message.content.length > 500;
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
        {message.timestamp && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.5,
          color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily:
            message.type === 'tool_use' || message.type === 'tool_result'
              ? 'var(--font-mono)'
              : undefined,
        }}
      >
        {displayContent}
      </div>
      {isLong && (
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
