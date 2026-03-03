import type React from 'react';

import { useQuery } from '@tanstack/react-query';

import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import type { WsConnectionStatus } from '../hooks/use-websocket';
import { useWebSocket } from '../hooks/use-websocket';
import { timeAgo, truncate } from '../lib/format-utils';
import { agentsQuery, discoverQuery, healthQuery, machinesQuery, metricsQuery } from '../lib/queries';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DashboardPage(): React.JSX.Element {
  const health = useQuery(healthQuery());
  const metrics = useQuery(metricsQuery());
  const machines = useQuery(machinesQuery());
  const agents = useQuery(agentsQuery());
  const discovered = useQuery(discoverQuery());

  const { status: wsStatus } = useWebSocket();

  const machineList = machines.data ?? [];
  const agentList = agents.data ?? [];
  const discoveredSessions = discovered.data?.sessions ?? [];
  const metricsData = metrics.data ?? {};

  const machinesOnline = machineList.filter((m) => m.status === 'online').length;
  const agentsRegistered = agentList.length;
  const activeRuns = Number(metricsData.agentctl_agents_active ?? 0);
  const totalRuns = Number(metricsData.agentctl_runs_total ?? 0);

  const refreshAll = (): void => {
    void health.refetch();
    void metrics.refetch();
    void machines.refetch();
    void agents.refetch();
    void discovered.refetch();
  };

  const anyError =
    health.error ?? metrics.error ?? machines.error ?? agents.error ?? discovered.error;

  // Health status color
  const healthStatus = health.data?.status;
  const healthColor =
    healthStatus === 'ok'
      ? 'var(--green)'
      : healthStatus === 'degraded'
        ? 'var(--yellow)'
        : 'var(--text-muted)';
  const healthLabel = healthStatus ?? 'unknown';

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
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Command Center</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <WsStatusIndicator status={wsStatus} />
          <button
            type="button"
            onClick={refreshAll}
            style={{
              padding: '6px 14px',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Error banner */}
      {anyError && (
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
          {anyError.message}
        </div>
      )}

      {/* Health status card */}
      <div
        style={{
          padding: '16px 20px',
          backgroundColor: 'var(--bg-secondary)',
          border: `1px solid ${healthStatus === 'ok' ? 'var(--green-subtle)' : 'var(--border)'}`,
          borderRadius: 'var(--radius)',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: healthStatus === 'ok' ? '0 0 20px rgba(34, 197, 94, 0.04)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              backgroundColor: healthColor,
              flexShrink: 0,
              boxShadow: healthStatus === 'ok' ? `0 0 8px ${healthColor}` : 'none',
            }}
          />
          <div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--text-primary)',
              }}
            >
              Control Plane:{' '}
              <span style={{ color: healthColor, textTransform: 'uppercase' }}>{healthLabel}</span>
            </div>
            {health.data?.timestamp && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  marginTop: 2,
                }}
              >
                Last checked: {timeAgo(health.data.timestamp)}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ActionButton label="Discover Sessions" onClick={() => void discovered.refetch()} />
          <ActionButton label="Refresh All" onClick={refreshAll} />
        </div>
      </div>

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
          label="Machines Online"
          value={`${machinesOnline} / ${machineList.length}`}
          color={machinesOnline > 0 ? 'var(--green)' : 'var(--text-muted)'}
          sublabel={
            machineList.length > 0
              ? `${machineList.filter((m) => m.status === 'offline').length} offline`
              : undefined
          }
        />
        <StatCard
          label="Sessions Discovered"
          value={String(discovered.data?.count ?? 0)}
          color="var(--accent)"
          sublabel={
            discovered.data
              ? `${discovered.data.machinesQueried} queried, ${discovered.data.machinesFailed} failed`
              : undefined
          }
        />
        <StatCard
          label="Agents Registered"
          value={String(agentsRegistered)}
          color="var(--text-primary)"
          sublabel={
            agentList.filter((a) => a.status === 'error').length > 0
              ? `${agentList.filter((a) => a.status === 'error').length} in error`
              : undefined
          }
        />
        <StatCard
          label="Active Runs"
          value={String(activeRuns)}
          color={activeRuns > 0 ? 'var(--green)' : 'var(--text-muted)'}
          sublabel={`${totalRuns} total`}
        />
      </div>

      {/* Two-column layout: Recent Activity + Machine Status */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 20,
        }}
      >
        {/* Recent Activity */}
        <div>
          <SectionHeader title="Recent Activity" />
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
            }}
          >
            {discoveredSessions.length === 0 ? (
              <EmptyState loading={discovered.isLoading} message="No sessions discovered" />
            ) : (
              discoveredSessions.slice(0, 5).map((session, idx) => (
                <div
                  key={session.sessionId}
                  style={{
                    padding: '12px 16px',
                    backgroundColor: 'var(--bg-secondary)',
                    borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                      }}
                    >
                      {truncate(session.summary || 'Untitled session', 50)}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        flexShrink: 0,
                        marginLeft: 8,
                      }}
                    >
                      {timeAgo(session.lastActivity)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 11,
                      color: 'var(--text-muted)',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        backgroundColor: 'var(--bg-tertiary)',
                        padding: '1px 6px',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      {session.hostname}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {truncate(session.projectPath.split('/').pop() ?? session.projectPath, 30)}
                    </span>
                    {session.branch && (
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{session.branch}</span>
                    )}
                    <span>{session.messageCount} msgs</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Machine Status */}
        <div>
          <SectionHeader title="Fleet Status" />
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
            }}
          >
            {machineList.length === 0 ? (
              <EmptyState loading={machines.isLoading} message="No machines registered" />
            ) : (
              machineList.map((machine, idx) => (
                <div
                  key={machine.id}
                  style={{
                    padding: '10px 16px',
                    backgroundColor: 'var(--bg-secondary)',
                    borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <StatusBadge status={machine.status} />
                    <div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {machine.hostname}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {machine.tailscaleIp}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 11,
                      color: 'var(--text-muted)',
                    }}
                  >
                    <span>
                      {machine.os}/{machine.arch}
                    </span>
                    {machine.capabilities.gpu && (
                      <span
                        style={{
                          backgroundColor: 'var(--bg-tertiary)',
                          padding: '1px 5px',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 10,
                          fontWeight: 600,
                          textTransform: 'uppercase',
                        }}
                      >
                        GPU
                      </span>
                    )}
                    {machine.lastHeartbeat && <span>{timeAgo(machine.lastHeartbeat)}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Quick Stats Summary */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          marginTop: 4,
          padding: '10px 16px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          marginBottom: 20,
          fontSize: 12,
          color: 'var(--text-muted)',
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>Platform</span>
        <span>
          Uptime:{' '}
          <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            {metricsData.agentctl_control_plane_up === 1 ? 'Healthy' : 'Down'}
          </span>
        </span>
        <span>
          Total Cost:{' '}
          <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            $
            {typeof metricsData.agentctl_total_cost_usd === 'number'
              ? metricsData.agentctl_total_cost_usd.toFixed(2)
              : '0.00'}
          </span>
        </span>
        <span>
          Total Runs:{' '}
          <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            {totalRuns}
          </span>
        </span>
      </div>

      {/* Dependencies */}
      {health.data?.dependencies && (
        <div style={{ marginTop: 24 }}>
          <SectionHeader title="Dependencies" />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 8,
            }}
          >
            {Object.entries(health.data.dependencies).map(([name, dep]) => (
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
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function SectionHeader({ title }: { title: string }): React.JSX.Element {
  return (
    <h2
      style={{
        fontSize: 15,
        fontWeight: 600,
        color: 'var(--text-secondary)',
        marginBottom: 10,
      }}
    >
      {title}
    </h2>
  );
}

function ActionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 12px',
        backgroundColor: 'transparent',
        color: 'var(--accent)',
        border: '1px solid var(--accent)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function EmptyState({
  loading,
  message,
}: {
  loading: boolean;
  message: string;
}): React.JSX.Element {
  return (
    <div
      style={{
        padding: 32,
        textAlign: 'center',
        color: 'var(--text-muted)',
        backgroundColor: 'var(--bg-secondary)',
        fontSize: 13,
      }}
    >
      {loading ? 'Loading...' : message}
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
