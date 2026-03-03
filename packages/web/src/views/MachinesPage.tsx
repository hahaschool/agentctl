import type React from 'react';
import { useMemo, useState } from 'react';

import { CopyableText } from '../components/CopyableText';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { usePolling } from '../hooks/use-polling';
import type { Machine } from '../lib/api';
import { api } from '../lib/api';
import { formatDate, timeAgo } from '../lib/format-utils';

type MachineStatusFilter = 'all' | 'online' | 'offline' | 'degraded';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MachinesPage(): React.JSX.Element {
  const machines = usePolling<Machine[]>({
    fetcher: api.listMachines,
    intervalMs: 15_000,
  });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<MachineStatusFilter>('all');

  const list = machines.data ?? [];
  const online = list.filter((m) => m.status === 'online').length;
  const offline = list.filter((m) => m.status === 'offline').length;
  const degraded = list.filter((m) => m.status === 'degraded').length;

  const filteredList = useMemo(() => {
    let result = list;
    if (statusFilter !== 'all') {
      result = result.filter((m) => m.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (m) =>
          m.hostname.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.tailscaleIp.includes(q) ||
          m.os.toLowerCase().includes(q),
      );
    }
    return result;
  }, [list, statusFilter, search]);

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>Fleet Machines</h1>
            {list.length > 0 && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  backgroundColor: 'var(--bg-tertiary)',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {list.length}
              </span>
            )}
          </div>
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              marginTop: 4,
            }}
          >
            Machines connected via Tailscale mesh. Auto-refreshes every 15s.
          </p>
        </div>
        <button
          type="button"
          onClick={machines.refresh}
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

      {/* Error banner */}
      {machines.error && (
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
          {machines.error.message}
        </div>
      )}

      {/* Filter controls */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <input
          type="text"
          placeholder="Search machines..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '6px 10px',
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            outline: 'none',
            minWidth: 180,
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as MachineStatusFilter)}
          style={{
            padding: '6px 10px',
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
          }}
        >
          <option value="all">All statuses</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="degraded">Degraded</option>
        </select>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {filteredList.length}/{list.length} machines
        </span>
      </div>

      {/* Summary stats */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <StatCard label="Total Machines" value={String(list.length)} color="var(--text-primary)" />
        <StatCard
          label="Online"
          value={String(online)}
          color={online > 0 ? 'var(--green)' : 'var(--text-muted)'}
        />
        <StatCard
          label="Offline"
          value={String(offline)}
          color={offline > 0 ? 'var(--text-muted)' : 'var(--green)'}
          sublabel={offline > 0 ? 'Needs attention' : 'All clear'}
        />
        <StatCard
          label="Degraded"
          value={String(degraded)}
          color={degraded > 0 ? 'var(--yellow)' : 'var(--text-muted)'}
          sublabel={degraded > 0 ? 'Partial issues' : 'Healthy'}
        />
      </div>

      {/* Machine cards or empty state */}
      {filteredList.length === 0 ? (
        <EmptyState
          loading={machines.isLoading}
          hasFilters={list.length > 0 && filteredList.length === 0}
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))',
            gap: 16,
          }}
        >
          {filteredList.map((m) => (
            <MachineCard key={m.id} machine={m} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Machine card
// ---------------------------------------------------------------------------

function MachineCard({ machine }: { machine: Machine }): React.JSX.Element {
  const m = machine;

  return (
    <div
      style={{
        padding: 20,
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {/* Top row: hostname + status */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginBottom: 3,
            }}
          >
            {m.hostname}
          </div>
          <CopyableText value={m.id} maxDisplay={12} fontSize={11} />
        </div>
        <StatusBadge status={m.status} />
      </div>

      {/* Details grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          paddingTop: 10,
          borderTop: '1px solid var(--border)',
        }}
      >
        <DetailField label="Tailscale IP" value={m.tailscaleIp} mono />
        <DetailField label="OS / Architecture" value={`${m.os} / ${m.arch}`} />
        <DetailField
          label="Last Heartbeat"
          value={m.lastHeartbeat ? timeAgo(m.lastHeartbeat) : 'Never'}
          highlight={
            m.lastHeartbeat ? (isStaleHeartbeat(m.lastHeartbeat) ? 'warn' : 'ok') : 'muted'
          }
        />
        <DetailField label="Registered" value={formatDate(m.createdAt)} />
      </div>

      {/* Capabilities row */}
      {m.capabilities && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            paddingTop: 10,
            borderTop: '1px solid var(--border)',
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginRight: 4,
            }}
          >
            Capabilities
          </span>
          <CapBadge
            label="GPU"
            enabled={m.capabilities.gpu}
            activeColor="#14532d"
            activeBorder="#166534"
            activeText="#86efac"
          />
          <CapBadge
            label="Docker"
            enabled={m.capabilities.docker}
            activeColor="#1e3a5f"
            activeBorder="#1d4ed8"
            activeText="#93c5fd"
          />
          <span
            style={{
              padding: '3px 10px',
              fontSize: 11,
              fontWeight: 500,
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {m.capabilities.maxConcurrentAgents} max agents
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers: is a heartbeat stale (> 60s)?
// ---------------------------------------------------------------------------

function isStaleHeartbeat(dateStr: string): boolean {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  return diffMs > 60_000;
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function DetailField({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: 'ok' | 'warn' | 'muted';
}): React.JSX.Element {
  const valueColor =
    highlight === 'ok'
      ? 'var(--green)'
      : highlight === 'warn'
        ? 'var(--yellow)'
        : 'var(--text-secondary)';

  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          color: valueColor,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function CapBadge({
  label,
  enabled,
  activeColor,
  activeBorder,
  activeText,
}: {
  label: string;
  enabled: boolean;
  activeColor: string;
  activeBorder: string;
  activeText: string;
}): React.JSX.Element {
  return (
    <span
      style={{
        padding: '3px 10px',
        fontSize: 11,
        fontWeight: 600,
        borderRadius: 'var(--radius-sm)',
        backgroundColor: enabled ? activeColor : 'var(--bg-tertiary)',
        color: enabled ? activeText : 'var(--text-muted)',
        border: `1px solid ${enabled ? activeBorder : 'var(--border)'}`,
        textTransform: 'uppercase',
        letterSpacing: '0.03em',
      }}
    >
      {label}
    </span>
  );
}

function EmptyState({
  loading,
  hasFilters,
}: {
  loading: boolean;
  hasFilters?: boolean;
}): React.JSX.Element {
  return (
    <div
      style={{
        padding: 64,
        textAlign: 'center',
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          marginBottom: 8,
        }}
      >
        {loading
          ? 'Loading machines...'
          : hasFilters
            ? 'No machines match the current filters'
            : 'No machines registered'}
      </div>
      {!loading && !hasFilters && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Register a machine by running{' '}
          <code
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              backgroundColor: 'var(--bg-tertiary)',
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            ./scripts/setup-machine.sh
          </code>{' '}
          on the target host.
        </div>
      )}
    </div>
  );
}
