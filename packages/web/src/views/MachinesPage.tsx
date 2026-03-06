'use client';

import { useQuery } from '@tanstack/react-query';
import { Filter, Server } from 'lucide-react';
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
import { SimpleTooltip } from '../components/SimpleTooltip';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { useHotkeys } from '../hooks/use-hotkeys';
import type { Machine } from '../lib/api';
import { downloadCsv, formatDate, isStaleHeartbeat } from '../lib/format-utils';
import { machinesQuery } from '../lib/queries';

type MachineStatusFilter = 'all' | 'online' | 'offline' | 'degraded';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MachinesPage(): React.JSX.Element {
  const machines = useQuery(machinesQuery());

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<MachineStatusFilter>('all');
  const [sortOrder, setSortOrder] = useState<'name' | 'status' | 'lastHeartbeat' | 'os'>('name');
  const [compact, setCompact] = useState(false);

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
    result = [...result].sort((a, b) => {
      switch (sortOrder) {
        case 'name':
          return a.hostname.localeCompare(b.hostname);
        case 'status':
          return a.status.localeCompare(b.status);
        case 'lastHeartbeat': {
          const ta = a.lastHeartbeat ? new Date(a.lastHeartbeat).getTime() : 0;
          const tb = b.lastHeartbeat ? new Date(b.lastHeartbeat).getTime() : 0;
          return tb - ta; // newest first
        }
        case 'os':
          return a.os.localeCompare(b.os);
        default:
          return 0;
      }
    });
    return result;
  }, [list, statusFilter, search, sortOrder]);

  return (
    <div className="relative p-4 md:p-6 max-w-[1100px] animate-page-enter">
      <FetchingBar isFetching={machines.isFetching && !machines.isLoading} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[22px] font-semibold tracking-tight">Fleet Machines</h1>
            {list.length > 0 && (
              <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
                {list.length}
              </span>
            )}
          </div>
          <p className="text-[13px] text-muted-foreground mt-1">
            Machines connected via Tailscale mesh. Auto-refreshes every 10s.
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
          type="search"
          placeholder="Search machines..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search machines"
          className="px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs outline-none min-w-[120px] flex-1 sm:flex-none sm:min-w-[180px] transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as MachineStatusFilter)}
          aria-label="Filter by status"
          className="px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        >
          <option value="all">All statuses</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="degraded">Degraded</option>
        </select>
        <select
          value={sortOrder}
          onChange={(e) =>
            setSortOrder(e.target.value as 'name' | 'status' | 'lastHeartbeat' | 'os')
          }
          aria-label="Sort by"
          className="px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        >
          <option value="name">Name (A-Z)</option>
          <option value="status">Status</option>
          <option value="lastHeartbeat">Last Heartbeat</option>
          <option value="os">OS</option>
        </select>
        <button
          type="button"
          onClick={() => setCompact((v) => !v)}
          aria-label={compact ? 'Switch to detailed view' : 'Switch to compact view'}
          className={cn(
            'px-2.5 py-1.5 text-[12px] font-medium border rounded-md transition-colors whitespace-nowrap',
            compact
              ? 'bg-primary/10 text-primary border-primary/30'
              : 'bg-muted text-muted-foreground border-border hover:text-foreground hover:bg-accent',
          )}
        >
          {compact ? 'Detailed' : 'Compact'}
        </button>
        <span className="text-[11px] text-muted-foreground ml-auto">
          {filteredList.length}/{list.length} machines
        </span>
        <button
          type="button"
          onClick={() => {
            if (filteredList.length === 0) return;
            downloadCsv(
              ['hostname', 'id', 'status', 'os', 'arch', 'tailscaleIp', 'lastHeartbeat'],
              filteredList.map((m) => [
                m.hostname,
                m.id,
                m.status,
                m.os,
                m.arch,
                m.tailscaleIp,
                m.lastHeartbeat,
              ]),
              `machines-${new Date().toISOString().slice(0, 10)}.csv`,
            );
          }}
          disabled={filteredList.length === 0}
          className="px-2.5 py-1.5 text-[12px] font-medium bg-muted text-muted-foreground border border-border rounded-md hover:text-foreground hover:bg-accent disabled:opacity-40 transition-colors whitespace-nowrap"
        >
          Export CSV
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 mb-6">
        <StatCard label="Total Machines" value={String(list.length)} accent="blue" />
        <StatCard label="Online" value={String(online)} accent={online > 0 ? 'green' : undefined} />
        <StatCard
          label="Offline"
          value={String(offline)}
          accent={offline > 0 ? 'red' : undefined}
          sublabel={offline > 0 ? 'Needs attention' : 'All clear'}
        />
        <StatCard
          label="Degraded"
          value={String(degraded)}
          accent={degraded > 0 ? 'yellow' : undefined}
          sublabel={degraded > 0 ? 'Partial issues' : 'Healthy'}
        />
      </div>

      {/* Machine cards or empty state */}
      {machines.isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={`sk-${String(i)}`}
              className="p-5 bg-card border border-border/50 rounded-lg space-y-3"
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
          <EmptyState icon={Filter} title="No machines match the current filters" />
        ) : (
          <EmptyState
            icon={Server}
            title="No machines registered"
            description="Register a machine by running ./scripts/setup-machine.sh on the target host."
          />
        )
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {filteredList.map((m) => (
            <MachineCard key={m.id} machine={m} compact={compact} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Machine card
// ---------------------------------------------------------------------------

function MachineCard({
  machine,
  compact,
}: {
  machine: Machine;
  compact?: boolean;
}): React.JSX.Element {
  const m = machine;

  if (compact) {
    return (
      <div
        className={cn(
          'group p-3 bg-card border border-border/50 rounded-lg flex items-center gap-3 transition-all duration-200 hover:border-border/80 hover:shadow-sm',
          m.status === 'online' && 'border-l-2 border-l-green-500',
        )}
      >
        <Link
          href={`/machines/${m.id}`}
          className="text-[14px] font-semibold text-foreground hover:text-primary transition-colors no-underline truncate"
        >
          {m.hostname}
        </Link>
        <span className="text-[11px] text-muted-foreground font-mono truncate">{m.os}</span>
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          <StatusBadge status={m.status} />
          {m.lastHeartbeat && isStaleHeartbeat(m.lastHeartbeat) && (
            <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-800">
              Offline
            </span>
          )}
          {m.lastHeartbeat && !isStaleHeartbeat(m.lastHeartbeat) && (
            <span className="text-[10px] text-muted-foreground">
              <LiveTimeAgo date={m.lastHeartbeat} />
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group p-5 bg-card border border-border/50 rounded-lg flex flex-col gap-3.5 transition-all duration-200 hover:border-border/80 hover:shadow-sm',
        m.status === 'online' && 'border-l-2 border-l-green-500',
      )}
    >
      {/* Top row: hostname + status */}
      <div className="flex justify-between items-start">
        <div>
          <Link
            href={`/machines/${m.id}`}
            className="text-[17px] font-semibold text-foreground hover:text-primary transition-colors no-underline"
          >
            {m.hostname}
          </Link>
          <CopyableText value={m.id} maxDisplay={12} />
        </div>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={m.status} />
          {m.lastHeartbeat && isStaleHeartbeat(m.lastHeartbeat) && (
            <span
              className="px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-800"
              title="Last heartbeat was more than 60 seconds ago"
            >
              Offline
            </span>
          )}
        </div>
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
          <span className="text-[10px] text-muted-foreground mr-1">Capabilities</span>
          <SimpleTooltip content="GPU acceleration available for model inference">
            <span>
              <CapBadge label="GPU" enabled={m.capabilities?.gpu ?? false} variant="green" />
            </span>
          </SimpleTooltip>
          <SimpleTooltip content="Docker container support for sandboxed agent execution">
            <span>
              <CapBadge label="Docker" enabled={m.capabilities?.docker ?? false} variant="blue" />
            </span>
          </SimpleTooltip>
          <SimpleTooltip content="Maximum number of agents that can run concurrently on this machine">
            <span className="px-2.5 py-0.5 text-[11px] font-medium rounded-md bg-muted text-muted-foreground border border-border font-mono">
              {m.capabilities?.maxConcurrentAgents ?? 0} max agents
            </span>
          </SimpleTooltip>
        </div>
      )}
    </div>
  );
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
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
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
  green:
    'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-300 dark:border-green-800',
  blue: 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-800',
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
        'px-2.5 py-0.5 text-[11px] font-semibold rounded-md border',
        enabled ? CAP_VARIANT_CLASSES[variant] : 'bg-muted text-muted-foreground border-border',
      )}
    >
      {label}
    </span>
  );
}
