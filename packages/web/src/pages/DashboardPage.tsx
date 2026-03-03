import type React from 'react';

import { StatusBadge } from '../components/StatusBadge.tsx';
import { usePolling } from '../hooks/use-polling.ts';
import type { WsConnectionStatus } from '../hooks/use-websocket.ts';
import { useWebSocket } from '../hooks/use-websocket.ts';
import type { Agent, HealthResponse } from '../lib/api.ts';
import { api } from '../lib/api.ts';

export function DashboardPage(): React.JSX.Element {
  const health = usePolling<HealthResponse>({
    fetcher: api.health,
    intervalMs: 10_000,
  });

  const agents = usePolling<Agent[]>({
    fetcher: api.listAgents,
    intervalMs: 15_000,
  });

  const { status: wsStatus } = useWebSocket();

  const agentList = agents.data ?? [];
  const running = agentList.filter((a) => a.status === 'running').length;
  const errorCount = agentList.filter((a) => a.status === 'error').length;
  const deps = health.data?.dependencies;

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Dashboard</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <WsStatusIndicator status={wsStatus} />
          <button
            type="button"
            onClick={() => {
              health.refresh();
              agents.refresh();
            }}
            style={{
              padding: '6px 14px',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 13,
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Error banner */}
      {(health.error || agents.error) && (
        <div
          style={{
            padding: '10px 16px',
            backgroundColor: '#7f1d1d',
            color: '#fca5a5',
            borderRadius: 'var(--radius)',
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {health.error?.message ?? agents.error?.message}
        </div>
      )}

      {/* Stats grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <StatCard
          label="Control Plane"
          value={health.data?.status ?? '...'}
          color={
            health.data?.status === 'ok'
              ? 'var(--green)'
              : health.data?.status === 'degraded'
                ? 'var(--yellow)'
                : 'var(--text-muted)'
          }
        />
        <StatCard
          label="Total Agents"
          value={String(agentList.length)}
          color="var(--text-primary)"
        />
        <StatCard label="Running" value={String(running)} color="var(--green)" />
        <StatCard
          label="Errors"
          value={String(errorCount)}
          color={errorCount > 0 ? 'var(--red)' : 'var(--text-muted)'}
        />
      </div>

      {/* Dependencies */}
      {deps && (
        <div style={{ marginBottom: 24 }}>
          <h2
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: 10,
            }}
          >
            Dependencies
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 8,
            }}
          >
            {Object.entries(deps).map(([name, dep]) => (
              <div
                key={name}
                style={{
                  padding: '10px 14px',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    textTransform: 'capitalize',
                  }}
                >
                  {name}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {dep.latencyMs.toFixed(0)}ms
                  </span>
                  <StatusBadge status={dep.status} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent table */}
      <h2
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          marginBottom: 10,
        }}
      >
        Agents
      </h2>

      {agentList.length === 0 ? (
        <div
          style={{
            padding: 32,
            textAlign: 'center',
            color: 'var(--text-muted)',
          }}
        >
          {agents.isLoading ? 'Loading...' : 'No agents registered'}
        </div>
      ) : (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
            }}
          >
            <thead>
              <tr
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  textAlign: 'left',
                }}
              >
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Machine</th>
                <th style={thStyle}>Cost</th>
                <th style={thStyle}>Last Run</th>
              </tr>
            </thead>
            <tbody>
              {agentList.map((agent) => (
                <tr
                  key={agent.id}
                  style={{
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 500 }}>{agent.name}</span>
                    <br />
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {agent.id}
                    </span>
                  </td>
                  <td style={tdStyle}>{agent.type}</td>
                  <td style={tdStyle}>
                    <StatusBadge status={agent.status} />
                  </td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12,
                      }}
                    >
                      {agent.machineId}
                    </span>
                  </td>
                  <td style={tdStyle}>${agent.totalCostUsd.toFixed(4)}</td>
                  <td style={tdStyle}>
                    {agent.lastRunAt ? new Date(agent.lastRunAt).toLocaleString() : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}): React.JSX.Element {
  return (
    <div
      style={{
        padding: '16px 18px',
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color,
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WebSocket status indicator
// ---------------------------------------------------------------------------

const WS_STATUS_CONFIG: Record<WsConnectionStatus, { color: string; label: string }> = {
  connected: { color: 'var(--green)', label: 'WS Connected' },
  connecting: { color: 'var(--yellow)', label: 'WS Connecting' },
  disconnected: { color: 'var(--text-muted)', label: 'WS Disconnected' },
};

function WsStatusIndicator({ status }: { status: WsConnectionStatus }): React.JSX.Element {
  const { color, label } = WS_STATUS_CONFIG[status];

  return (
    <span
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        fontWeight: 500,
        color,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}

const thStyle: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 14px',
};
