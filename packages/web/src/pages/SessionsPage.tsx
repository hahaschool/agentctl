import type React from 'react';
import { useCallback, useState } from 'react';

import { StatusBadge } from '../components/StatusBadge.tsx';
import { usePolling } from '../hooks/use-polling.ts';
import type { Session } from '../lib/api.ts';
import { api } from '../lib/api.ts';

export function SessionsPage(): React.JSX.Element {
  const sessions = usePolling<Session[]>({
    fetcher: api.listSessions,
    intervalMs: 5_000,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const sessionList = sessions.data ?? [];
  const selected = sessionList.find((s) => s.id === selectedId) ?? null;

  const handleSend = useCallback(async () => {
    if (!selected || !prompt.trim()) return;
    setSending(true);
    setActionError(null);
    try {
      if (selected.status === 'active') {
        await api.sendMessage(selected.id, prompt.trim());
      } else {
        await api.resumeSession(selected.id, prompt.trim());
      }
      setPrompt('');
      sessions.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [selected, prompt, sessions]);

  const handleStop = useCallback(async () => {
    if (!selected) return;
    setActionError(null);
    try {
      await api.deleteSession(selected.id);
      sessions.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [selected, sessions]);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Session list panel */}
      <div
        style={{
          width: 340,
          minWidth: 340,
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '16px 16px 12px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Sessions</h2>
          <button
            type="button"
            onClick={sessions.refresh}
            style={{
              padding: '4px 10px',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
            }}
          >
            Refresh
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {sessionList.length === 0 ? (
            <div
              style={{
                padding: 32,
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
              }}
            >
              {sessions.isLoading ? 'Loading...' : 'No sessions found'}
            </div>
          ) : (
            sessionList.map((s) => (
              <button
                type="button"
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 16px',
                  backgroundColor: selectedId === s.id ? 'var(--bg-hover)' : 'transparent',
                  borderBottom: '1px solid var(--border)',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => {
                  if (selectedId !== s.id)
                    e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  if (selectedId !== s.id) e.currentTarget.style.backgroundColor = 'transparent';
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
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    {s.id.slice(0, 16)}...
                  </span>
                  <StatusBadge status={s.status} />
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    display: 'flex',
                    gap: 8,
                  }}
                >
                  <span>{s.agentId}</span>
                  <span>{s.machineId}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {new Date(s.startedAt).toLocaleString()}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Session detail panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {selected ? (
          <>
            {/* Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                  Session: {selected.id.slice(0, 20)}...
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    display: 'flex',
                    gap: 12,
                  }}
                >
                  <span>Agent: {selected.agentId}</span>
                  <span>Machine: {selected.machineId}</span>
                  <StatusBadge status={selected.status} />
                </div>
              </div>
              <button
                type="button"
                onClick={handleStop}
                style={{
                  padding: '6px 14px',
                  backgroundColor: '#7f1d1d',
                  color: '#fca5a5',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                End Session
              </button>
            </div>

            {/* Session metadata */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
                fontSize: 13,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 8,
                }}
              >
                <DetailRow label="ID" value={selected.id} mono />
                <DetailRow label="Status" value={selected.status} />
                <DetailRow label="Agent" value={selected.agentId} mono />
                <DetailRow label="Machine" value={selected.machineId} mono />
                <DetailRow label="Project" value={selected.projectPath ?? '-'} mono />
                <DetailRow label="Claude Session" value={selected.claudeSessionId ?? '-'} mono />
                <DetailRow label="PID" value={selected.pid ? String(selected.pid) : '-'} mono />
                <DetailRow label="Started" value={new Date(selected.startedAt).toLocaleString()} />
              </div>
            </div>

            {/* Action area */}
            <div style={{ flex: 1 }} />

            {actionError && (
              <div
                style={{
                  padding: '8px 20px',
                  backgroundColor: '#7f1d1d',
                  color: '#fca5a5',
                  fontSize: 12,
                }}
              >
                {actionError}
              </div>
            )}

            {/* Prompt input */}
            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                gap: 8,
              }}
            >
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={
                  selected.status === 'active' ? 'Send message...' : 'Resume session with prompt...'
                }
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={sending || !prompt.trim()}
                style={{
                  padding: '8px 18px',
                  backgroundColor: 'var(--accent)',
                  color: '#fff',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  fontWeight: 500,
                  opacity: sending || !prompt.trim() ? 0.5 : 1,
                }}
              >
                {sending ? '...' : selected.status === 'active' ? 'Send' : 'Resume'}
              </button>
            </div>
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: 14,
            }}
          >
            Select a session to view details
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div>
      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{label}</span>
      <div
        style={{
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          fontSize: 12,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </div>
    </div>
  );
}
