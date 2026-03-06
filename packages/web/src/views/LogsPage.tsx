'use client';

import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { FetchingBar } from '../components/FetchingBar';
import { LastUpdated } from '../components/LastUpdated';
import { LiveTimeAgo } from '../components/LiveTimeAgo';
import { RefreshButton } from '../components/RefreshButton';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { useHotkeys } from '../hooks/use-hotkeys';
import type { AuditAction } from '../lib/api';
import { formatDateTime, formatDurationMs, formatNumber, formatTime } from '../lib/format-utils';
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
type ActionTypeFilter = 'all' | 'tool_use' | 'tool_result' | 'text' | 'error';

const ACTION_TYPE_TABS: { key: ActionTypeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'tool_use', label: 'Tool Use' },
  { key: 'tool_result', label: 'Tool Result' },
  { key: 'text', label: 'Text' },
  { key: 'error', label: 'Error' },
];

const AUDIT_PAGE_SIZE = 50;

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
  const audit = useQuery({ ...auditQuery(auditParams), refetchInterval: autoRefresh ? 10_000 : false });
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
    <div className="relative p-4 md:p-6 max-w-[1100px] animate-fade-in">
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
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium border transition-colors',
              autoRefresh
                ? 'bg-green-500/10 text-green-500 border-green-500/30'
                : 'bg-muted text-muted-foreground border-border',
            )}
            title={autoRefresh ? 'Auto-refresh ON (click to pause)' : 'Auto-refresh OFF (click to resume)'}
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
          <SectionHeading>Control Plane</SectionHeading>
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
              <SectionHeading>Dependencies</SectionHeading>
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
              <SectionHeading>Dependencies</SectionHeading>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
                {Object.entries(deps).map(([name, dep]) => (
                  <DependencyCard key={name} name={name} dep={dep} />
                ))}
              </div>
            </div>
          ) : null}

          {/* Metrics */}
          <SectionHeading>Metrics</SectionHeading>
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
              <MetricCard
                label="Control Plane"
                value={metricsVal('agentctl_control_plane_up') === 1 ? 'UP' : 'DOWN'}
                valueVariant={metricsVal('agentctl_control_plane_up') === 1 ? 'green' : 'red'}
                accent="green"
              />
              <MetricCard
                label="Agents Total"
                value={formatNumber(metricsVal('agentctl_agents_total') ?? '-')}
                accent="blue"
              />
              <MetricCard
                label="Agents Active"
                value={formatNumber(metricsVal('agentctl_agents_active') ?? '-')}
                accent="purple"
              />
              <MetricCard
                label="Runs Total"
                value={formatNumber(metricsVal('agentctl_runs_total') ?? '-')}
                accent="yellow"
              />
              <MetricCard
                label="Machines Online"
                value={machines.data ? `${onlineMachines} / ${machineList.length}` : '-'}
                accent="blue"
              />
              <MetricCard
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
          <SectionHeading>Worker Health</SectionHeading>
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
              icon={'\u2302'}
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
                        <span className="text-[11px] text-muted-foreground font-mono">
                          {m.id.slice(0, 12)}...
                        </span>
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

          {/* Filters row */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-[360px]">
              <input
                type="text"
                placeholder="Search actions, tools, agents..."
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                className="w-full px-3 py-1.5 pl-8 text-[13px] bg-card border border-border/50 rounded-md placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
              />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-[13px]">
                &#x2315;
              </span>
            </div>

            {/* Agent filter */}
            <select
              value={auditAgentFilter}
              onChange={(e) => {
                setAuditAgentFilter(e.target.value);
                setAuditOffset(0);
              }}
              className="px-2.5 py-1.5 text-[13px] bg-card border border-border/50 rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            >
              <option value="">All Agents</option>
              {agentList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            {/* Tool filter */}
            <select
              value={auditToolFilter}
              onChange={(e) => {
                setAuditToolFilter(e.target.value);
                setAuditOffset(0);
              }}
              className="px-2.5 py-1.5 text-[13px] bg-card border border-border/50 rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            >
              <option value="">All Tools</option>
              {toolNames.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Action type filter tabs */}
          <div className="flex gap-1 mb-4 flex-wrap">
            {ACTION_TYPE_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setActionTypeFilter(tab.key);
                }}
                className={cn(
                  'px-3 py-1 rounded text-[12px] font-medium transition-colors border',
                  actionTypeFilter === tab.key
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-card text-muted-foreground border-border hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

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
            ) : filteredActions.length === 0 ? (
              <EmptyState
                icon={'\u2699'}
                title="No audit actions found"
                description={
                  auditSearch || auditAgentFilter || auditToolFilter || actionTypeFilter !== 'all'
                    ? 'Try adjusting your filters or search query.'
                    : 'Agent actions will appear here once agents start running.'
                }
              />
            ) : (
              <div className="border border-border/50 rounded overflow-hidden transition-colors hover:border-border">
                {filteredActions.map((action, idx) => (
                  <AuditActionRow
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
                Showing {auditOffset + 1}–{Math.min(auditOffset + AUDIT_PAGE_SIZE, audit.data.total)}{' '}
                of {formatNumber(audit.data.total)}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={auditOffset === 0}
                  onClick={() => {
                    setAuditOffset(Math.max(0, auditOffset - AUDIT_PAGE_SIZE));
                    auditScrollRef.current?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="px-3 py-1 text-[12px] rounded border border-border bg-card text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted transition-colors"
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
                  className="px-3 py-1 text-[12px] rounded border border-border bg-card text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Tool Breakdown (collapsible) */}
          {auditSummary.data &&
            Object.keys(auditSummary.data.toolBreakdown ?? {}).length > 0 && (
              <div className="mt-6">
                <SectionHeading>Tool Usage Breakdown</SectionHeading>
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
                          'px-3 py-2 bg-card border rounded text-left transition-colors',
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h2 className="text-[15px] font-semibold text-muted-foreground mb-2.5">{children}</h2>;
}

function CollapsibleSection({
  title,
  badge,
  open,
  onToggle,
  children,
}: {
  title: string;
  badge?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-2 mb-2.5 bg-transparent border-none p-0 cursor-pointer text-left"
      >
        <span
          className={cn(
            'text-xs transition-transform duration-150 text-muted-foreground',
            open ? 'rotate-0' : '-rotate-90',
          )}
        >
          &#x25BC;
        </span>
        <span className="text-[15px] font-semibold text-muted-foreground">{title}</span>
        {badge && (
          <span className="text-[11px] text-muted-foreground font-normal">({badge})</span>
        )}
      </button>
      {open && children}
    </>
  );
}

const VALUE_VARIANT_CLASSES = {
  green: 'text-green-500',
  red: 'text-red-500',
  yellow: 'text-yellow-500',
  default: 'text-foreground',
} as const;

const METRIC_ACCENT_CLASSES: Record<string, string> = {
  green: 'border-l-green-500/60',
  yellow: 'border-l-yellow-500/60',
  red: 'border-l-red-500/60',
  blue: 'border-l-blue-500/60',
  purple: 'border-l-purple-500/60',
};

function MetricCard({
  label,
  value,
  valueVariant,
  valueClassName,
  accent,
}: {
  label: string;
  value: string;
  valueVariant?: 'green' | 'red' | 'yellow';
  valueClassName?: string;
  accent?: 'green' | 'yellow' | 'red' | 'blue' | 'purple';
}): React.JSX.Element {
  return (
    <div className={cn(
      'px-[18px] py-4 bg-card border border-border/50 rounded transition-colors hover:border-border',
      accent && 'border-l-[3px]',
      accent && METRIC_ACCENT_CLASSES[accent],
    )}>
      <div className="text-[11px] text-muted-foreground mb-1.5">
        {label}
      </div>
      <div
        className={cn(
          'text-2xl font-semibold',
          valueClassName ?? VALUE_VARIANT_CLASSES[valueVariant ?? 'default'],
        )}
      >
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dependency card with level-based coloring and expandable error details
// ---------------------------------------------------------------------------

function DependencyCard({
  name,
  dep,
}: {
  name: string;
  dep: { status: 'ok' | 'error'; latencyMs: number; error?: string };
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const latencyWarning = dep.latencyMs > 500;
  const latencyCritical = dep.latencyMs > 2000;

  return (
    <div
      className={cn(
        'px-3.5 py-3 bg-card border rounded transition-colors',
        'hover:border-border',
        dep.status === 'error'
          ? 'border-red-500/40'
          : latencyCritical
            ? 'border-yellow-500/40'
            : 'border-border/50',
      )}
    >
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-[13px] font-medium capitalize">{name}</span>
        <StatusBadge status={dep.status} />
      </div>
      <div
        className={cn(
          'text-[11px] font-mono',
          latencyCritical
            ? 'text-red-500'
            : latencyWarning
              ? 'text-yellow-500'
              : 'text-muted-foreground',
        )}
      >
        Latency: {dep.latencyMs?.toFixed(0) ?? '-'}ms
        {latencyWarning && !latencyCritical && ' (slow)'}
        {latencyCritical && ' (critical)'}
      </div>
      {dep.error && (
        <>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[11px] text-red-500 mt-1 cursor-pointer hover:underline bg-transparent border-none p-0 text-left"
          >
            {expanded ? 'Hide error' : 'Show error'}
          </button>
          {expanded && (
            <div className="text-[11px] text-red-500 mt-1 break-all bg-red-500/5 rounded px-2 py-1.5 font-mono">
              {dep.error}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit action row
// ---------------------------------------------------------------------------

const ACTION_TYPE_COLORS: Record<string, string> = {
  tool_use: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  tool_result: 'bg-green-500/15 text-green-500 border-green-500/30',
  text: 'bg-muted text-muted-foreground border-border',
  error: 'bg-red-500/15 text-red-500 border-red-500/30',
};

function AuditActionRow({
  action,
  isFirst,
  isExpanded,
  onToggle,
  searchQuery,
}: {
  action: AuditAction;
  isFirst: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  searchQuery: string;
}): React.JSX.Element {
  const colorClass =
    ACTION_TYPE_COLORS[action.actionType] ?? 'bg-muted text-muted-foreground border-border';

  return (
    <div className={cn(!isFirst && 'border-t border-border')}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-3.5 py-2.5 flex items-center gap-3 text-left bg-transparent hover:bg-muted/50 transition-colors cursor-pointer border-none"
      >
        {/* Action type badge */}
        <span
          className={cn(
            'inline-flex px-2 py-0.5 rounded text-[11px] font-medium border shrink-0',
            colorClass,
          )}
        >
          {action.actionType}
        </span>

        {/* Tool name */}
        {action.toolName && (
          <span className="text-[12px] font-mono font-medium text-foreground truncate max-w-[160px]">
            {highlightMatch(action.toolName, searchQuery)}
          </span>
        )}

        {/* Agent ID (short) */}
        {action.agentId && (
          <span className="text-[11px] text-muted-foreground font-mono hidden sm:inline truncate max-w-[100px]">
            {action.agentId.slice(0, 8)}
          </span>
        )}

        {/* Duration */}
        {action.durationMs != null && action.durationMs > 0 && (
          <span
            className={cn(
              'text-[11px] font-mono hidden md:inline',
              action.durationMs > 5000
                ? 'text-yellow-500'
                : 'text-muted-foreground',
            )}
          >
            {formatDurationMs(action.durationMs)}
          </span>
        )}

        {/* Timestamp */}
        <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
          {formatTime(action.timestamp)}
        </span>

        {/* Expand indicator */}
        <span
          className={cn(
            'text-[10px] text-muted-foreground transition-transform duration-150 shrink-0',
            isExpanded ? 'rotate-0' : '-rotate-90',
          )}
        >
          &#x25BC;
        </span>
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-3.5 pb-3 pt-0">
          <div className="bg-muted/30 rounded p-3 space-y-2 text-[12px]">
            <DetailRow label="ID" value={action.id} mono />
            <DetailRow label="Run ID" value={action.runId} mono />
            <DetailRow label="Timestamp" value={formatDateTime(action.timestamp)} />
            <DetailRow label="Action Type" value={action.actionType} />
            {action.toolName && <DetailRow label="Tool" value={action.toolName} mono />}
            {action.durationMs != null && (
              <DetailRow label="Duration" value={`${action.durationMs}ms`} />
            )}
            {action.approvedBy && <DetailRow label="Approved By" value={action.approvedBy} />}
            {action.toolOutputHash && (
              <DetailRow label="Output Hash" value={action.toolOutputHash} mono />
            )}
            {action.toolInput && Object.keys(action.toolInput).length > 0 && (
              <div>
                <span className="text-[11px] text-muted-foreground font-medium">Tool Input:</span>
                <pre className="mt-1 p-2 bg-card border border-border/50 rounded font-mono text-[11px] text-muted-foreground whitespace-pre-wrap break-all max-h-[200px] overflow-auto">
                  {JSON.stringify(action.toolInput, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex gap-3">
      <span className="text-[11px] text-muted-foreground font-medium w-[90px] shrink-0">
        {label}:
      </span>
      <span className={cn('text-[12px] text-foreground break-all', mono && 'font-mono')}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Highlight search matches
// ---------------------------------------------------------------------------

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-500/30 text-inherit rounded-sm px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ---------------------------------------------------------------------------
// Table class strings
// ---------------------------------------------------------------------------

const TH_CLASSES =
  'px-3.5 py-2.5 text-[11px] font-semibold text-muted-foreground';

const TD_CLASSES = 'px-3.5 py-2.5';
