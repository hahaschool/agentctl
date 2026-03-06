'use client';

import { useQuery } from '@tanstack/react-query';
import { ScrollText, Server } from 'lucide-react';
import type React from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { CopyableText } from '../components/CopyableText';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { FetchingBar } from '../components/FetchingBar';
import { LastUpdated } from '../components/LastUpdated';
import { LiveTimeAgo } from '../components/LiveTimeAgo';
import { LogsAuditActionRow } from '../components/LogsAuditActionRow';
import { LogsDependencyCard } from '../components/LogsDependencyCard';
import type { ActionTypeFilter, AuditSortBy } from '../components/LogsFilterBar';
import { LogsFilterBar } from '../components/LogsFilterBar';
import { LogsMetricCard } from '../components/LogsMetricCard';
import { LogsSectionHeading } from '../components/LogsSectionHeading';
import { RefreshButton } from '../components/RefreshButton';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { useHotkeys } from '../hooks/use-hotkeys';
import { formatDateTime, formatDurationMs, formatNumber } from '../lib/format-utils';
import {
  agentsQuery,
  auditQuery,
  auditSummaryQuery,
  healthQuery,
  machinesQuery,
  metricsQuery,
} from '../lib/queries';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActiveTab = 'overview' | 'audit';

const AUDIT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Table class strings
// ---------------------------------------------------------------------------

const TH_CLASSES = 'px-3.5 py-2.5 text-[11px] font-semibold text-muted-foreground';

const TD_CLASSES = 'px-3.5 py-2.5';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LogsPage(): React.JSX.Element {
  // Tab state
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');

  // Overview state
  const [rawMetricsOpen, setRawMetricsOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Audit state
  const [auditSearch, setAuditSearch] = useState('');
  const [actionTypeFilter, setActionTypeFilter] = useState<ActionTypeFilter>('all');
  const [auditAgentFilter, setAuditAgentFilter] = useState('');
  const [auditToolFilter, setAuditToolFilter] = useState('');
  const [auditOffset, setAuditOffset] = useState(0);
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const [auditSortBy, setAuditSortBy] = useState<AuditSortBy>('newest');
  const auditScrollRef = useRef<HTMLDivElement>(null);

  // Queries — overview
  const health = useQuery({ ...healthQuery(), refetchInterval: autoRefresh ? 10_000 : false });
  const metrics = useQuery({ ...metricsQuery(), refetchInterval: autoRefresh ? 10_000 : false });
  const machines = useQuery({ ...machinesQuery(), refetchInterval: autoRefresh ? 10_000 : false });
  const agents = useQuery({ ...agentsQuery(), refetchInterval: autoRefresh ? 10_000 : false });

  // Queries — audit
  const auditParams = useMemo(
    () => ({
      agentId: auditAgentFilter || undefined,
      tool: auditToolFilter || undefined,
      limit: AUDIT_PAGE_SIZE,
      offset: auditOffset,
    }),
    [auditAgentFilter, auditToolFilter, auditOffset],
  );
  const audit = useQuery({
    ...auditQuery(auditParams),
    refetchInterval: autoRefresh ? 10_000 : false,
  });
  const auditSummary = useQuery({
    ...auditSummaryQuery({ agentId: auditAgentFilter || undefined }),
    refetchInterval: autoRefresh ? 30_000 : false,
  });

  // Derived
  const deps = health.data?.dependencies;
  const machineList = machines.data ?? [];
  const agentList = agents.data ?? [];
  const onlineMachines = machineList.filter((m) => m.status === 'online').length;
  const hasError = health.error || metrics.error || machines.error;

  const metricsVal = (key: string): number | string | undefined => metrics.data?.[key];

  // Filter audit actions locally by search + action type
  const filteredActions = useMemo(() => {
    const actions = audit.data?.actions ?? [];
    return actions.filter((a) => {
      if (actionTypeFilter !== 'all' && a.actionType !== actionTypeFilter) return false;
      if (auditSearch) {
        const q = auditSearch.toLowerCase();
        const searchable = [
          a.actionType,
          a.toolName ?? '',
          a.agentId ?? '',
          a.runId,
          a.approvedBy ?? '',
          JSON.stringify(a.toolInput ?? {}),
        ]
          .join(' ')
          .toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    });
  }, [audit.data?.actions, actionTypeFilter, auditSearch]);

  const sortedActions = useMemo(() => {
    const arr = [...filteredActions];
    switch (auditSortBy) {
      case 'oldest':
        return arr.sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
      case 'agent':
        return arr.sort((a, b) => (a.agentId ?? '').localeCompare(b.agentId ?? ''));
      case 'tool':
        return arr.sort((a, b) => (a.toolName ?? '').localeCompare(b.toolName ?? ''));
      default:
        return arr.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
    }
  }, [filteredActions, auditSortBy]);

  // Unique tool names from summary for filter dropdown
  const toolNames = useMemo(() => {
    const breakdown = auditSummary.data?.toolBreakdown ?? {};
    return Object.keys(breakdown).sort();
  }, [auditSummary.data?.toolBreakdown]);

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

  const refetchAll = useCallback(() => {
    void health.refetch();
    void metrics.refetch();
    void machines.refetch();
    void audit.refetch();
    void auditSummary.refetch();
  }, [health, metrics, machines, audit, auditSummary]);

  useHotkeys(
    useMemo(
      () => ({
        r: refetchAll,
        '1': () => setActiveTab('overview'),
        '2': () => setActiveTab('audit'),
      }),
      [refetchAll],
    ),
  );

  const isFetching =
    health.isFetching || metrics.isFetching || machines.isFetching || audit.isFetching;

  return (
    <div className="relative p-4 md:p-6 max-w-[1100px] animate-page-enter">
      <FetchingBar isFetching={isFetching && !health.isLoading} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Logs &amp; Metrics</h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            System health, audit trail, and runtime metrics.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Auto-refresh toggle */}
          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition-colors',
              autoRefresh
                ? 'bg-green-500/10 text-green-500 border-green-500/30'
                : 'bg-muted text-muted-foreground border-border',
            )}
            title={
              autoRefresh
                ? 'Auto-refresh ON (click to pause)'
                : 'Auto-refresh OFF (click to resume)'
            }
          >
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full',
                autoRefresh ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground',
              )}
            />
            {autoRefresh ? 'Live' : 'Paused'}
          </button>
          <LastUpdated dataUpdatedAt={health.dataUpdatedAt} />
          <RefreshButton onClick={refetchAll} isFetching={isFetching} />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-border mb-6">
        {(
          [
            { key: 'overview', label: 'Overview' },
            { key: 'audit', label: 'Audit Trail' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab.key
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            {tab.key === 'audit' && audit.data && (
              <span className="ml-1.5 text-[11px] text-muted-foreground">
                ({formatNumber(audit.data.total)})
              </span>
            )}
          </button>
        ))}
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
          onRetry={refetchAll}
        />
      )}

      {/* ================================================================= */}
      {/* OVERVIEW TAB                                                       */}
      {/* ================================================================= */}
      {activeTab === 'overview' && (
        <>
          {/* Control Plane Status */}
          <LogsSectionHeading>Control Plane</LogsSectionHeading>
          {health.isLoading ? (
            <div className="p-4 bg-card border border-border/50 rounded mb-6 flex items-center gap-4">
              <Skeleton className="w-3 h-3 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ) : (
            <output
              className="p-4 bg-card border border-border/50 rounded mb-6 flex items-center gap-4 transition-colors hover:border-border"
              aria-live="polite"
            >
              <span
                className={cn(
                  'w-3 h-3 rounded-full shrink-0',
                  statusClasses,
                  health.data?.status === 'ok' && 'shadow-[0_0_6px] shadow-green-500',
                )}
                aria-hidden="true"
              />
              <div className="flex-1">
                <div className="font-semibold text-[15px]">
                  {health.data?.status === 'ok'
                    ? 'All Systems Operational'
                    : health.data?.status === 'degraded'
                      ? 'Degraded Performance'
                      : 'Unavailable'}
                </div>
                <div className="text-xs text-muted-foreground font-mono mt-0.5">
                  {health.data?.timestamp
                    ? `Last checked: ${formatDateTime(health.data.timestamp)}`
                    : 'Polling every 10s'}
                </div>
              </div>
              <StatusBadge status={health.data?.status ?? 'unknown'} />
            </output>
          )}

          {/* Dependencies */}
          {health.isLoading ? (
            <div className="mb-6">
              <LogsSectionHeading>Dependencies</LogsSectionHeading>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
                {Array.from({ length: 3 }, (_, i) => (
                  <div
                    key={`dsk-${String(i)}`}
                    className="px-3.5 py-3 bg-card border border-border/50 rounded"
                  >
                    <div className="flex justify-between items-center mb-1.5">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-5 w-12 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-24" />
                  </div>
                ))}
              </div>
            </div>
          ) : deps && Object.keys(deps).length > 0 ? (
            <div className="mb-6">
              <LogsSectionHeading>Dependencies</LogsSectionHeading>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
                {Object.entries(deps).map(([name, dep]) => (
                  <LogsDependencyCard key={name} name={name} dep={dep} />
                ))}
              </div>
            </div>
          ) : null}

          {/* Metrics */}
          <LogsSectionHeading>Metrics</LogsSectionHeading>
          {metrics.isLoading ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 mb-6">
              {Array.from({ length: 6 }, (_, i) => (
                <div
                  key={`msk-${String(i)}`}
                  className="px-[18px] py-4 bg-card border border-border/50 rounded"
                >
                  <Skeleton className="h-3 w-20 mb-2.5" />
                  <Skeleton className="h-7 w-16" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 mb-6">
              <LogsMetricCard
                label="Control Plane"
                value={metricsVal('agentctl_control_plane_up') === 1 ? 'UP' : 'DOWN'}
                valueVariant={metricsVal('agentctl_control_plane_up') === 1 ? 'green' : 'red'}
                accent="green"
                tooltip="Health status of the central orchestration server"
              />
              <LogsMetricCard
                label="Agents Total"
                value={formatNumber(metricsVal('agentctl_agents_total') ?? '-')}
                accent="blue"
              />
              <LogsMetricCard
                label="Agents Active"
                value={formatNumber(metricsVal('agentctl_agents_active') ?? '-')}
                accent="purple"
              />
              <LogsMetricCard
                label="Runs Total"
                value={formatNumber(metricsVal('agentctl_runs_total') ?? '-')}
                accent="yellow"
              />
              <LogsMetricCard
                label="Machines Online"
                value={machines.data ? `${onlineMachines} / ${machineList.length}` : '-'}
                accent="blue"
              />
              <LogsMetricCard
                label="Health Status"
                value={health.data?.status ?? '-'}
                valueClassName={statusTextClasses}
                accent="red"
              />
            </div>
          )}

          {/* Raw Metrics (collapsible debug view) */}
          {metrics.data && (
            <div className="mb-6">
              <CollapsibleSection
                title="Raw Metrics"
                badge={`${Object.keys(metrics.data).length} keys`}
                open={rawMetricsOpen}
                onToggle={() => setRawMetricsOpen(!rawMetricsOpen)}
              >
                <div className="p-3.5 bg-card border border-border/50 rounded font-mono text-xs text-muted-foreground whitespace-pre-wrap break-all max-h-[300px] overflow-auto">
                  {Object.entries(metrics.data)
                    .map(([k, v]) => `${k} ${String(v)}`)
                    .join('\n')}
                </div>
              </CollapsibleSection>
            </div>
          )}

          {/* Worker Health */}
          <LogsSectionHeading>Worker Health</LogsSectionHeading>
          {machines.isLoading ? (
            <div className="border border-border/50 rounded overflow-hidden">
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
            <EmptyState
              icon={Server}
              title="No workers registered"
              description="Run setup-machine.sh on a host to register it as a worker."
            />
          ) : (
            <div className="border border-border/50 rounded overflow-x-auto transition-colors hover:border-border">
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
                        <CopyableText
                          value={m.id}
                          maxDisplay={12}
                          className="text-[11px] text-muted-foreground font-mono"
                        />
                      </td>
                      <td className={TD_CLASSES}>
                        <StatusBadge status={m.status} />
                      </td>
                      <td className={cn(TD_CLASSES, 'hidden sm:table-cell')}>
                        <span className="font-mono text-xs">{m.tailscaleIp ?? '-'}</span>
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
        </>
      )}

      {/* ================================================================= */}
      {/* AUDIT TRAIL TAB                                                    */}
      {/* ================================================================= */}
      {activeTab === 'audit' && (
        <>
          {/* Audit summary cards */}
          {auditSummary.data && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3 mb-5">
              <StatCard
                label="Total Actions"
                value={formatNumber(auditSummary.data.totalActions)}
                accent="blue"
              />
              <StatCard
                label="Unique Tools"
                value={String(Object.keys(auditSummary.data.toolBreakdown ?? {}).length)}
                accent="purple"
              />
              <StatCard
                label="Avg Duration"
                value={formatDurationMs(auditSummary.data.avgDurationMs)}
                accent="yellow"
              />
              <StatCard
                label="Action Types"
                value={String(Object.keys(auditSummary.data.actionTypeBreakdown ?? {}).length)}
                accent="green"
              />
            </div>
          )}

          <LogsFilterBar
            search={auditSearch}
            actionTypeFilter={actionTypeFilter}
            agentFilter={auditAgentFilter}
            toolFilter={auditToolFilter}
            sortBy={auditSortBy}
            agents={agentList}
            toolNames={toolNames}
            sortedActions={sortedActions}
            onSearchChange={setAuditSearch}
            onActionTypeFilterChange={setActionTypeFilter}
            onAgentFilterChange={(v) => {
              setAuditAgentFilter(v);
              setAuditOffset(0);
            }}
            onToolFilterChange={(v) => {
              setAuditToolFilter(v);
              setAuditOffset(0);
            }}
            onSortByChange={setAuditSortBy}
          />

          {/* Audit log entries */}
          <div ref={auditScrollRef}>
            {audit.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }, (_, i) => (
                  <div
                    key={`ask-${String(i)}`}
                    className="px-3.5 py-3 bg-card border border-border/50 rounded flex items-center gap-3"
                  >
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-32 hidden sm:block" />
                    <Skeleton className="h-4 w-20 ml-auto" />
                  </div>
                ))}
              </div>
            ) : audit.error ? (
              <ErrorBanner
                message={audit.error?.message ?? 'Failed to load audit trail'}
                onRetry={() => void audit.refetch()}
              />
            ) : sortedActions.length === 0 ? (
              <EmptyState
                icon={ScrollText}
                title="No audit actions found"
                description={
                  auditSearch || auditAgentFilter || auditToolFilter || actionTypeFilter !== 'all'
                    ? 'Try adjusting your filters or search query.'
                    : 'Agent actions will appear here once agents start running.'
                }
              />
            ) : (
              <div className="border border-border/50 rounded overflow-hidden transition-colors hover:border-border">
                {sortedActions.map((action, idx) => (
                  <LogsAuditActionRow
                    key={action.id}
                    action={action}
                    isFirst={idx === 0}
                    isExpanded={expandedActionId === action.id}
                    onToggle={() =>
                      setExpandedActionId(expandedActionId === action.id ? null : action.id)
                    }
                    searchQuery={auditSearch}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {audit.data && audit.data.total > AUDIT_PAGE_SIZE && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-[11px] text-muted-foreground">
                Showing {auditOffset + 1}–
                {Math.min(auditOffset + AUDIT_PAGE_SIZE, audit.data.total)} of{' '}
                {formatNumber(audit.data.total)}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={auditOffset === 0}
                  onClick={() => {
                    setAuditOffset(Math.max(0, auditOffset - AUDIT_PAGE_SIZE));
                    auditScrollRef.current?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="px-3 py-1 text-[12px] rounded-md border border-border bg-card text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 transition-colors"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={!audit.data.hasMore}
                  onClick={() => {
                    setAuditOffset(auditOffset + AUDIT_PAGE_SIZE);
                    auditScrollRef.current?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="px-3 py-1 text-[12px] rounded-md border border-border bg-card text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Tool Breakdown (collapsible) */}
          {auditSummary.data && Object.keys(auditSummary.data.toolBreakdown ?? {}).length > 0 && (
            <div className="mt-6">
              <LogsSectionHeading>Tool Usage Breakdown</LogsSectionHeading>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2">
                {Object.entries(auditSummary.data.toolBreakdown)
                  .sort(([, a], [, b]) => (b as number) - (a as number))
                  .map(([tool, count]) => (
                    <button
                      key={tool}
                      type="button"
                      onClick={() => {
                        setAuditToolFilter(auditToolFilter === tool ? '' : tool);
                        setAuditOffset(0);
                      }}
                      className={cn(
                        'px-3 py-2 bg-card border rounded-md text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20',
                        auditToolFilter === tool
                          ? 'border-foreground'
                          : 'border-border/50 hover:border-border',
                      )}
                    >
                      <div className="text-[12px] font-medium font-mono truncate">{tool}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatNumber(count)} calls
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
