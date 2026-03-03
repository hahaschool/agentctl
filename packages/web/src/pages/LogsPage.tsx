import type React from 'react';
import { useCallback, useMemo } from 'react';

import { StatusBadge } from '../components/StatusBadge.tsx';
import { usePolling } from '../hooks/use-polling.ts';
import type { HealthResponse, Machine } from '../lib/api.ts';
import { api } from '../lib/api.ts';

type MetricsData = Record<string, unknown>;

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}

export function LogsPage(): React.JSX.Element {
  const healthFetcher = useCallback(() => api.health(), []);
  const metricsFetcher = useCallback(() => api.metrics(), []);
  const machinesFetcher = useCallback(() => api.listMachines(), []);

  const health = usePolling<HealthResponse>({
    fetcher: healthFetcher,
    intervalMs: 10_000,
  });

  const metrics = usePolling<MetricsData>({
    fetcher: metricsFetcher,
    intervalMs: 10_000,
  });

  const machines = usePolling<Machine[]>({
    fetcher: machinesFetcher,
    intervalMs: 10_000,
  });

  const deps = health.data?.dependencies;
  const machineList = machines.data ?? [];
  const onlineMachines = machineList.filter((m) => m.status === 'online').length;
  const hasError = health.error || metrics.error || machines.error;

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
            health.refresh();
            metrics.refresh();
            machines.refresh();
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
          label="Uptime"
          value={
            typeof metrics.data?.uptimeSeconds === 'number'
              ? formatUptime(metrics.data.uptimeSeconds as number)
              : '-'
          }
        />
        <MetricCard
          label="Memory (RSS)"
          value={
            typeof metrics.data?.memoryRssBytes === 'number'
              ? formatBytes(metrics.data.memoryRssBytes as number)
              : '-'
          }
        />
        <MetricCard
          label="Active Sessions"
          value={
            typeof metrics.data?.activeSessions === 'number'
              ? String(metrics.data.activeSessions)
              : '-'
          }
        />
        <MetricCard
          label="Total Requests"
          value={
            typeof metrics.data?.totalRequests === 'number'
              ? String(metrics.data.totalRequests)
              : '-'
          }
        />
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
            {JSON.stringify(metrics.data, null, 2)}
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
