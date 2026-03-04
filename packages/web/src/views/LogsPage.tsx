'use client';

import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useMemo, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '../components/ErrorBanner';

import { LastUpdated } from '../components/LastUpdated';
import { LiveTimeAgo } from '../components/LiveTimeAgo';
import { StatusBadge } from '../components/StatusBadge';
import { useHotkeys } from '../hooks/use-hotkeys';
import { formatDateTime, formatNumber } from '../lib/format-utils';
import { healthQuery, machinesQuery, metricsQuery } from '../lib/queries';

export function LogsPage(): React.JSX.Element {
  const [rawMetricsOpen, setRawMetricsOpen] = useState(false);
  const health = useQuery(healthQuery());
  const metrics = useQuery(metricsQuery());
  const machines = useQuery(machinesQuery());

  useHotkeys(
    useMemo(
      () => ({
        r: () => {
          void health.refetch();
          void metrics.refetch();
          void machines.refetch();
        },
      }),
      [health, metrics, machines],
    ),
  );

  const deps = health.data?.dependencies;
  const machineList = machines.data ?? [];
  const onlineMachines = machineList.filter((m) => m.status === 'online').length;
  const hasError = health.error || metrics.error || machines.error;

  const metricsVal = (key: string): number | string | undefined => metrics.data?.[key];

  const statusClasses = useMemo(() => {
    if (!health.data) return 'bg-muted-foreground';
    if (health.data.status === 'ok') return 'bg-green-500';
    if (health.data.status === 'degraded') return 'bg-yellow-500';
    return 'bg-red-500';
  }, [health.data]);

  const statusTextClasses = useMemo(() => {
    if (!health.data) return 'text-muted-foreground';
    if (health.data.status === 'ok') return 'text-green-500';
    if (health.data.status === 'degraded') return 'text-yellow-500';
    return 'text-red-500';
  }, [health.data]);

  return (
    <div className="p-6 max-w-[1100px] animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div>
          <h1 className="text-[22px] font-bold">Logs &amp; Metrics</h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            System health, dependency status, and runtime metrics.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LastUpdated dataUpdatedAt={health.dataUpdatedAt} />
          <button
            type="button"
            onClick={() => {
              void health.refetch();
              void metrics.refetch();
              void machines.refetch();
            }}
            className="px-3.5 py-1.5 bg-muted text-muted-foreground border border-border rounded-sm text-[13px] cursor-pointer"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Error banner */}
      {hasError && (
        <ErrorBanner
          message={
            health.error?.message ??
            metrics.error?.message ??
            machines.error?.message ??
            'An error occurred'
          }
          onRetry={() => {
            void health.refetch();
            void metrics.refetch();
            void machines.refetch();
          }}
        />
      )}

      {/* Control Plane Status */}
      <SectionHeading>Control Plane</SectionHeading>
      <div className="p-4 bg-card border border-border rounded mb-6 flex items-center gap-4">
        <span
          className={cn(
            'w-3 h-3 rounded-full shrink-0',
            statusClasses,
            health.data?.status === 'ok' && 'shadow-[0_0_6px] shadow-green-500',
          )}
        />
        <div className="flex-1">
          <div className="font-semibold text-[15px]">
            {health.data?.status === 'ok'
              ? 'All Systems Operational'
              : health.data?.status === 'degraded'
                ? 'Degraded Performance'
                : health.isLoading
                  ? 'Checking...'
                  : 'Unavailable'}
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-0.5">
            {health.data?.timestamp
              ? `Last checked: ${formatDateTime(health.data.timestamp)}`
              : 'Polling every 10s'}
          </div>
        </div>
        <StatusBadge status={health.data?.status ?? 'unknown'} />
      </div>

      {/* Dependencies */}
      {deps && Object.keys(deps).length > 0 && (
        <div className="mb-6">
          <SectionHeading>Dependencies</SectionHeading>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
            {Object.entries(deps).map(([name, dep]) => (
              <div key={name} className="px-3.5 py-3 bg-card border border-border rounded">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-[13px] font-medium capitalize">{name}</span>
                  <StatusBadge status={dep.status} />
                </div>
                <div className="text-[11px] text-muted-foreground font-mono">
                  Latency: {dep.latencyMs.toFixed(0)}ms
                </div>
                {dep.error && (
                  <div className="text-[11px] text-red-500 mt-1 break-all">{dep.error}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metrics */}
      <SectionHeading>Metrics</SectionHeading>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 mb-6">
        <MetricCard
          label="Control Plane"
          value={metricsVal('agentctl_control_plane_up') === 1 ? 'UP' : 'DOWN'}
          valueVariant={metricsVal('agentctl_control_plane_up') === 1 ? 'green' : 'red'}
        />
        <MetricCard
          label="Agents Total"
          value={formatNumber(metricsVal('agentctl_agents_total') ?? '-')}
        />
        <MetricCard
          label="Agents Active"
          value={formatNumber(metricsVal('agentctl_agents_active') ?? '-')}
        />
        <MetricCard
          label="Runs Total"
          value={formatNumber(metricsVal('agentctl_runs_total') ?? '-')}
        />
        <MetricCard label="Machines Online" value={`${onlineMachines} / ${machineList.length}`} />
        <MetricCard
          label="Health Status"
          value={health.data?.status ?? '-'}
          valueClassName={statusTextClasses}
        />
      </div>

      {/* Raw Metrics (collapsible debug view) */}
      {metrics.data && (
        <div className="mb-6">
          <button
            type="button"
            onClick={() => setRawMetricsOpen(!rawMetricsOpen)}
            aria-expanded={rawMetricsOpen}
            aria-label="Toggle raw metrics"
            className="flex items-center gap-2 mb-2.5 bg-transparent border-none p-0 cursor-pointer text-left"
          >
            <span
              className={cn(
                'text-xs transition-transform duration-150 text-muted-foreground',
                rawMetricsOpen ? 'rotate-0' : '-rotate-90',
              )}
            >
              &#x25BC;
            </span>
            <span className="text-[15px] font-semibold text-muted-foreground">Raw Metrics</span>
            <span className="text-[11px] text-muted-foreground font-normal">
              ({Object.keys(metrics.data).length} keys)
            </span>
          </button>
          {rawMetricsOpen && (
            <div className="p-3.5 bg-card border border-border rounded font-mono text-xs text-muted-foreground whitespace-pre-wrap break-all max-h-[300px] overflow-auto">
              {Object.entries(metrics.data)
                .map(([k, v]) => `${k} ${String(v)}`)
                .join('\n')}
            </div>
          )}
        </div>
      )}

      {/* Worker Health */}
      <SectionHeading>Worker Health</SectionHeading>
      {machines.isLoading ? (
        <div className="border border-border rounded overflow-hidden">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={`wsk-${String(i)}`}
              className={cn(
                'px-3.5 py-3 flex items-center gap-4',
                i > 0 && 'border-t border-border',
              )}
            >
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-24 hidden sm:block" />
              <Skeleton className="h-4 w-20 ml-auto" />
            </div>
          ))}
        </div>
      ) : machineList.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">No workers registered</div>
      ) : (
        <div className="border border-border rounded overflow-x-auto">
          <table className="w-full border-collapse text-[13px]" aria-label="Worker machines">
            <thead>
              <tr className="bg-muted text-left">
                <th scope="col" className={TH_CLASSES}>
                  Hostname
                </th>
                <th scope="col" className={TH_CLASSES}>
                  Status
                </th>
                <th scope="col" className={cn(TH_CLASSES, 'hidden sm:table-cell')}>
                  Tailscale IP
                </th>
                <th scope="col" className={cn(TH_CLASSES, 'hidden md:table-cell')}>
                  OS / Arch
                </th>
                <th scope="col" className={cn(TH_CLASSES, 'hidden md:table-cell')}>
                  Max Agents
                </th>
                <th scope="col" className={TH_CLASSES}>
                  Last Heartbeat
                </th>
              </tr>
            </thead>
            <tbody>
              {machineList.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className={TD_CLASSES}>
                    <span className="font-medium">{m.hostname}</span>
                    <br />
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {m.id.slice(0, 12)}...
                    </span>
                  </td>
                  <td className={TD_CLASSES}>
                    <StatusBadge status={m.status} />
                  </td>
                  <td className={cn(TD_CLASSES, 'hidden sm:table-cell')}>
                    <span className="font-mono text-xs">{m.tailscaleIp}</span>
                  </td>
                  <td className={cn(TD_CLASSES, 'hidden md:table-cell')}>
                    {m.os} / {m.arch}
                  </td>
                  <td className={cn(TD_CLASSES, 'hidden md:table-cell')}>
                    {m.capabilities?.maxConcurrentAgents ?? '-'}
                  </td>
                  <td className={TD_CLASSES}>
                    {m.lastHeartbeat ? <LiveTimeAgo date={m.lastHeartbeat} /> : 'never'}
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
  return <h2 className="text-[15px] font-semibold text-muted-foreground mb-2.5">{children}</h2>;
}

const VALUE_VARIANT_CLASSES = {
  green: 'text-green-500',
  red: 'text-red-500',
  yellow: 'text-yellow-500',
  default: 'text-foreground',
} as const;

function MetricCard({
  label,
  value,
  valueVariant,
  valueClassName,
}: {
  label: string;
  value: string;
  valueVariant?: 'green' | 'red' | 'yellow';
  valueClassName?: string;
}): React.JSX.Element {
  return (
    <div className="px-[18px] py-4 bg-card border border-border rounded">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1.5">
        {label}
      </div>
      <div
        className={cn(
          'text-2xl font-bold',
          valueClassName ?? VALUE_VARIANT_CLASSES[valueVariant ?? 'default'],
        )}
      >
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table class strings
// ---------------------------------------------------------------------------

const TH_CLASSES =
  'px-3.5 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.04em]';

const TD_CLASSES = 'px-3.5 py-2.5';
