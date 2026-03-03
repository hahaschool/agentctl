import type React from 'react';
import { useCallback, useState } from 'react';

import { StatusBadge } from '../components/StatusBadge.tsx';
import { usePolling } from '../hooks/use-polling.ts';
import type { Agent } from '../lib/api.ts';
import { api } from '../lib/api.ts';

export function AgentsPage(): React.JSX.Element {
  const agents = usePolling<Agent[]>({
    fetcher: api.listAgents,
    intervalMs: 10_000,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');

  const agentList = agents.data ?? [];
  const selected = agentList.find((a) => a.id === selectedId) ?? null;

  const handleStart = useCallback(async () => {
    if (!selected || !prompt.trim()) return;
    setActionError(null);
    try {
      await api.startAgent(selected.id, prompt.trim());
      setPrompt('');
      agents.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [selected, prompt, agents]);

  const handleStop = useCallback(async () => {
    if (!selected) return;
    setActionError(null);
    try {
      await api.stopAgent(selected.id);
      agents.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [selected, agents]);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Agent list */}
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
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Agents</h2>
          <button
            type="button"
            onClick={agents.refresh}
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
          {agentList.length === 0 ? (
            <div
              style={{
                padding: 32,
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
              }}
            >
              {agents.isLoading ? 'Loading...' : 'No agents registered'}
            </div>
          ) : (
            agentList.map((agent) => (
              <button
                type="button"
                key={agent.id}
                onClick={() => setSelectedId(agent.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 16px',
                  backgroundColor: selectedId === agent.id ? 'var(--bg-hover)' : 'transparent',
                  borderBottom: '1px solid var(--border)',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => {
                  if (selectedId !== agent.id)
                    e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  if (selectedId !== agent.id)
                    e.currentTarget.style.backgroundColor = 'transparent';
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
                  <span style={{ fontWeight: 500, fontSize: 13 }}>{agent.name}</span>
                  <StatusBadge status={agent.status} />
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {agent.id}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    marginTop: 2,
                  }}
                >
                  {agent.type} &middot; {agent.machineId}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Agent detail */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {selected ? (
          <>
            {/* Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                    {selected.name}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {selected.id}
                  </div>
                </div>
                <StatusBadge status={selected.status} />
              </div>
            </div>

            {/* Details */}
            <div style={{ padding: '16px 20px', fontSize: 13 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                }}
              >
                <Info label="Type" value={selected.type} />
                <Info label="Machine" value={selected.machineId} mono />
                <Info label="Project" value={selected.projectPath ?? '-'} mono />
                <Info label="Schedule" value={selected.schedule ?? 'none'} mono />
                <Info label="Session" value={selected.currentSessionId ?? '-'} mono />
                <Info label="Branch" value={selected.worktreeBranch ?? '-'} mono />
                <Info label="Total Cost" value={`$${selected.totalCostUsd.toFixed(4)}`} />
                <Info
                  label="Last Run"
                  value={
                    selected.lastRunAt ? new Date(selected.lastRunAt).toLocaleString() : 'never'
                  }
                />
              </div>

              {/* Config */}
              <div style={{ marginTop: 16 }}>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Config
                </span>
                <pre
                  style={{
                    marginTop: 6,
                    padding: 12,
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    fontSize: 12,
                    fontFamily: 'var(--font-mono)',
                    overflow: 'auto',
                    maxHeight: 200,
                  }}
                >
                  {JSON.stringify(selected.config, null, 2)}
                </pre>
              </div>
            </div>

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

            {/* Actions */}
            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                gap: 8,
              }}
            >
              {selected.status === 'running' ? (
                <button
                  type="button"
                  onClick={() => void handleStop()}
                  style={{
                    padding: '8px 18px',
                    backgroundColor: '#7f1d1d',
                    color: '#fca5a5',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  Stop Agent
                </button>
              ) : (
                <>
                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleStart();
                    }}
                    placeholder="Enter prompt to start agent..."
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
                    onClick={() => void handleStart()}
                    disabled={!prompt.trim()}
                    style={{
                      padding: '8px 18px',
                      backgroundColor: 'var(--accent)',
                      color: '#fff',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 13,
                      fontWeight: 500,
                      opacity: prompt.trim() ? 1 : 0.5,
                    }}
                  >
                    Start
                  </button>
                </>
              )}
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
            Select an agent to view details
          </div>
        )}
      </div>
    </div>
  );
}

function Info({
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
      <span
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
        }}
      >
        {label}
      </span>
      <div
        style={{
          marginTop: 2,
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          fontSize: 13,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </div>
    </div>
  );
}
