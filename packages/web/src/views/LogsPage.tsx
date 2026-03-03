import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useMemo } from 'react';

import { StatusBadge } from '../components/StatusBadge';
import { healthQuery, machinesQuery, metricsQuery } from '../lib/queries';

export function LogsPage(): React.JSX.Element {
  const health = useQuery(healthQuery());
  const metrics = useQuery(metricsQuery());
  const machines = useQuery(machinesQuery());

  const deps = health.data?.dependencies;
  const machineList = machines.data ?? [];
  const onlineMachines = machineList.filter((m) => m.status === 'online').length;
  const hasError = health.error || metrics.error || machines.error;

  const metricsVal = (key: string): number | string | undefined => metrics.data?.[key];

  const statusColor = useMemo(() => {
    if (!health.data) return 'var(--text-muted)';
    if (health.data.status === 'ok') return 'var(--green)';
    if (health.data.status === 'degraded') return 'var(--yellow)';
    return 'var(--red)';
  }, [health.data]);

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Logs &amp; Metrics</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            System health, dependency status, and runtime metrics.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            health.refetch();
            metrics.refetch();
            machines.refetch();
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

      {/* Error banner */}
      {hasError && (
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
          {health.error?.message ?? metrics.error?.message ?? machines.error?.message}
        </div>
      )}

      {/* Control Plane Status */}
      <SectionHeading>Control Plane</SectionHeading>
      <div
        style={{
          padding: 16,
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            backgroundColor: statusColor,
            flexShrink: 0,
            boxShadow: health.data?.status === 'ok' ? '0 0 6px var(--green)' : undefined,
          }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {health.data?.status === 'ok'
              ? 'All Systems Operational'
              : health.data?.status === 'degraded'
                ? 'Degraded Performance'
                : health.isLoading
                  ? 'Checking...'
                  : 'Unavailable'}
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              marginTop: 2,
            }}
          >
            {health.data?.timestamp
              ? `Last checked: ${new Date(health.data.timestamp).toLocaleString()}`
              : 'Polling every 10s'}
          </div>
        </div>
        <StatusBadge status={health.data?.status ?? 'unknown'} />
      </div>

      {/* Dependencies */}
      {deps && Object.keys(deps).length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <SectionHeading>Dependencies</SectionHeading>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 8,
            }}
          >
            {Object.entries(deps).map(([name, dep]) => (
              <div
                key={name}
                style={{
                  padding: '12px 14px',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 6,
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
                  <StatusBadge status={dep.status} />
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  Latency: {dep.latencyMs.toFixed(0)}ms
                </div>
                {dep.error && (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--red, #ef4444)',
                      marginTop: 4,
                      wordBreak: 'break-all',
                    }}
                  >
                    {dep.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metrics */}
      <SectionHeading>Metrics</SectionHeading>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <MetricCard
          label="Control Plane"
          value={metricsVal('agentctl_control_plane_up') === 1 ? 'UP' : 'DOWN'}
          valueColor={
            metricsVal('agentctl_control_plane_up') === 1 ? 'var(--green)' : 'var(--red, #ef4444)'
          }
        />
        <MetricCard
          label="Agents Total"
          value={String(metricsVal('agentctl_agents_total') ?? '-')}
        />
        <MetricCard
          label="Agents Active"
          value={String(metricsVal('agentctl_agents_active') ?? '-')}
        />
        <MetricCard label="Runs Total" value={String(metricsVal('agentctl_runs_total') ?? '-')} />
        <MetricCard label="Machines Online" value={`${onlineMachines} / ${machineList.length}`} />
        <MetricCard
          label="Health Status"
          value={health.data?.status ?? '-'}
          valueColor={statusColor}
        />
      </div>

      {/* Raw Metrics (collapsible debug view) */}
      {metrics.data && (
        <div style={{ marginBottom: 24 }}>
          <SectionHeading>Raw Metrics</SectionHeading>
          <div
            style={{
              padding: 14,
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              maxHeight: 300,
              overflow: 'auto',
            }}
          >
            {Object.entries(metrics.data)
              .map(([k, v]) => `${k} ${String(v)}`)
              .join('\n')}
          </div>
        </div>
      )}

      {/* Worker Health */}
      <SectionHeading>Worker Health</SectionHeading>
      {machineList.length === 0 ? (
        <div
          style={{
            padding: 48,
            textAlign: 'center',
            color: 'var(--text-muted)',
          }}
        >
          {machines.isLoading ? 'Loading workers...' : 'No workers registered'}
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
                <th style={thStyle}>Hostname</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Tailscale IP</th>
                <th style={thStyle}>OS / Arch</th>
                <th style={thStyle}>Max Agents</th>
                <th style={thStyle}>Last Heartbeat</th>
              </tr>
            </thead>
            <tbody>
              {machineList.map((m) => (
                <tr
                  key={m.id}
                  style={{
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 500 }}>{m.hostname}</span>
                    <br />
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {m.id}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <StatusBadge status={m.status} />
                  </td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12,
                      }}
                    >
                      {m.tailscaleIp}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {m.os} / {m.arch}
                  </td>
                  <td style={tdStyle}>{m.capabilities?.maxConcurrentAgents ?? '-'}</td>
                  <td style={tdStyle}>
                    {m.lastHeartbeat ? new Date(m.lastHeartbeat).toLocaleString() : 'never'}
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <h2
      style={{
        fontSize: 15,
        fontWeight: 600,
        color: 'var(--text-secondary)',
        marginBottom: 10,
      }}
    >
      {children}
    </h2>
  );
}

function MetricCard({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
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
          color: valueColor ?? 'var(--text-primary)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table styles
// ---------------------------------------------------------------------------

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
