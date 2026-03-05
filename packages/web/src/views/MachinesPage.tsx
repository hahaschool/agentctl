'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type React from 'react';
import { useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CopyableText } from '../components/CopyableText';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { FetchingBar } from '../components/FetchingBar';
import { LastUpdated } from '../components/LastUpdated';
import { LiveTimeAgo } from '../components/LiveTimeAgo';
import { RefreshButton } from '../components/RefreshButton';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { useHotkeys } from '../hooks/use-hotkeys';
import type { Machine } from '../lib/api';
import { formatDate } from '../lib/format-utils';
import { machinesQuery } from '../lib/queries';

type MachineStatusFilter = 'all' | 'online' | 'offline' | 'degraded';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MachinesPage(): React.JSX.Element {
  const machines = useQuery(machinesQuery());

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<MachineStatusFilter>('all');

  useHotkeys(useMemo(() => ({ r: () => void machines.refetch() }), [machines]));

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
          (m.tailscaleIp ?? '').includes(q) ||
          m.os.toLowerCase().includes(q),
      );
    }
    return result;
  }, [list, statusFilter, search]);

  return (
    <div className="relative p-4 md:p-6 max-w-[1100px] animate-fade-in">
      <FetchingBar isFetching={machines.isFetching && !machines.isLoading} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[22px] font-bold">Fleet Machines</h1>
            {list.length > 0 && (
              <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-sm">
                {list.length}
              </span>
            )}
          </div>
          <p className="text-[13px] text-muted-foreground mt-1">
            Machines connected via Tailscale mesh. Auto-refreshes every 15s.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LastUpdated dataUpdatedAt={machines.dataUpdatedAt} />
          <RefreshButton
            onClick={() => void machines.refetch()}
            isFetching={machines.isFetching && !machines.isLoading}
          />
        </div>
      </div>

      {/* Error banner */}
      {machines.error && (
        <ErrorBanner message={machines.error.message} onRetry={() => void machines.refetch()} />
      )}

      {/* Filter controls */}
      <div className="flex gap-2.5 items-center mb-4 flex-wrap">
        <input
          type="text"
          placeholder="Search machines..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search machines"
          className="px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs outline-none min-w-[120px] flex-1 sm:flex-none sm:min-w-[180px]"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as MachineStatusFilter)}
          aria-label="Filter by status"
          className="px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs"
        >
          <option value="all">All statuses</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="degraded">Degraded</option>
        </select>
        <span className="text-[11px] text-muted-foreground ml-auto">
          {filteredList.length}/{list.length} machines
        </span>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 mb-6">
        <StatCard label="Total Machines" value={String(list.length)} />
        <StatCard label="Online" value={String(online)} />
        <StatCard
          label="Offline"
          value={String(offline)}
          sublabel={offline > 0 ? 'Needs attention' : 'All clear'}
        />
        <StatCard
          label="Degraded"
          value={String(degraded)}
          sublabel={degraded > 0 ? 'Partial issues' : 'Healthy'}
        />
      </div>

      {/* Machine cards or empty state */}
      {machines.isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={`sk-${String(i)}`}
              className="p-5 bg-card border border-border rounded-lg space-y-3"
            >
              <div className="flex justify-between items-center">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredList.length === 0 ? (
        list.length > 0 ? (
          <EmptyState icon={'\u2315'} title="No machines match the current filters" />
        ) : (
          <EmptyState
            icon={'\u2302'}
            title="No machines registered"
            description="Register a machine by running ./scripts/setup-machine.sh on the target host."
          />
        )
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
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
    <div className="p-5 bg-card border border-border rounded-lg flex flex-col gap-3.5">
      {/* Top row: hostname + status */}
      <div className="flex justify-between items-start">
        <div>
          <Link
            href={`/machines/${m.id}`}
            className="text-[17px] font-bold text-foreground hover:text-primary transition-colors no-underline"
          >
            {m.hostname}
          </Link>
          <CopyableText value={m.id} maxDisplay={12} />
        </div>
        <StatusBadge status={m.status} />
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2.5 border-t border-border">
        <DetailField label="Tailscale IP" value={m.tailscaleIp ?? '-'} mono />
        <DetailField label="OS / Architecture" value={`${m.os} / ${m.arch}`} />
        <DetailField
          label="Last Heartbeat"
          value={m.lastHeartbeat ? <LiveTimeAgo date={m.lastHeartbeat} /> : 'Never'}
          highlight={
            m.lastHeartbeat ? (isStaleHeartbeat(m.lastHeartbeat) ? 'warn' : 'ok') : 'muted'
          }
        />
        <DetailField label="Registered" value={formatDate(m.createdAt)} />
      </div>

      {/* Capabilities row */}
      {m.capabilities && (
        <div className="flex items-center gap-2 flex-wrap pt-2.5 border-t border-border">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide mr-1">
            Capabilities
          </span>
          <CapBadge label="GPU" enabled={m.capabilities.gpu} variant="green" />
          <CapBadge label="Docker" enabled={m.capabilities.docker} variant="blue" />
          <span className="px-2.5 py-0.5 text-[11px] font-medium rounded-sm bg-muted text-muted-foreground border border-border font-mono">
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
  value: React.ReactNode;
  mono?: boolean;
  highlight?: 'ok' | 'warn' | 'muted';
}): React.JSX.Element {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-[0.04em] mb-0.5">
        {label}
      </div>
      <div
        className={cn(
          'text-[13px] break-all',
          mono && 'font-mono',
          highlight === 'ok' && 'text-green-500',
          highlight === 'warn' && 'text-yellow-500',
          !highlight && 'text-muted-foreground',
          highlight === 'muted' && 'text-muted-foreground',
        )}
      >
        {value}
      </div>
    </div>
  );
}

const CAP_VARIANT_CLASSES = {
  green: 'bg-green-950 text-green-300 border-green-800',
  blue: 'bg-blue-950 text-blue-300 border-blue-800',
} as const;

function CapBadge({
  label,
  enabled,
  variant,
}: {
  label: string;
  enabled: boolean;
  variant: keyof typeof CAP_VARIANT_CLASSES;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'px-2.5 py-0.5 text-[11px] font-semibold rounded-sm uppercase tracking-[0.03em] border',
        enabled ? CAP_VARIANT_CLASSES[variant] : 'bg-muted text-muted-foreground border-border',
      )}
    >
      {label}
    </span>
  );
}
