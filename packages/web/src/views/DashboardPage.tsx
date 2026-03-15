'use client';

import { calculateHandoffAnalyticsRates } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import { Keyboard } from 'lucide-react';
import Link from 'next/link';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { DashboardActionButton } from '../components/DashboardActionButton';
import { DashboardActivityIcon } from '../components/DashboardActivityIcon';
import { DashboardCostOverview } from '../components/DashboardCostOverview';
import { DashboardEmptyPanel } from '../components/DashboardEmptyPanel';
import { DashboardSectionHeader } from '../components/DashboardSectionHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { FetchingBar } from '../components/FetchingBar';
import { KeyboardHelpOverlay } from '../components/KeyboardHelpOverlay';
import { LastUpdated } from '../components/LastUpdated';
import { LiveTimeAgo } from '../components/LiveTimeAgo';
import { DashboardMemoryCard } from '../components/memory/DashboardMemoryCard';
import { PathBadge } from '../components/PathBadge';
import { RefreshButton } from '../components/RefreshButton';
import { SimpleTooltip } from '../components/SimpleTooltip';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { WsStatusIndicator } from '../components/WsStatusIndicator';
import { useHotkeys } from '../hooks/use-hotkeys';
import { useWebSocket } from '../hooks/use-websocket';
import { formatCost, formatDuration, formatNumber, truncate } from '../lib/format-utils';
import {
  agentsQuery,
  discoverQuery,
  healthQuery,
  machinesQuery,
  memoryStatsQuery,
  metricsQuery,
  runtimeHandoffSummaryQuery,
  runtimeSessionsQuery,
  sessionsQuery,
} from '../lib/queries';

function sanitizeSessionSummary(summary: string | null | undefined): string {
  if (!summary) {
    return '';
  }

  return summary
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DashboardPage(): React.JSX.Element {
  const health = useQuery(healthQuery());
  const metrics = useQuery(metricsQuery());
  const machines = useQuery(machinesQuery());
  const agents = useQuery(agentsQuery());
  const discovered = useQuery(discoverQuery());
  const sessions = useQuery(sessionsQuery());
  const runtimeSessions = useQuery(runtimeSessionsQuery({ limit: 100 }));
  const runtimeHandoffSummary = useQuery(runtimeHandoffSummaryQuery(100));
  const memoryStats = useQuery({ ...memoryStatsQuery(), retry: false });

  const { status: wsStatus } = useWebSocket();
  const [showHelp, setShowHelp] = useState(false);
  const toggleHelp = useCallback(() => setShowHelp((v) => !v), []);

  const machineList = machines.data ?? [];
  const agentList = agents.data ?? [];
  const discoveredSessions = discovered.data?.sessions ?? [];
  const sessionList = sessions.data?.sessions ?? [];
  const managedRuntimeSessions = runtimeSessions.data?.sessions ?? [];
  const runtimeHandoffMetrics = runtimeHandoffSummary.data?.summary ?? {
    total: 0,
    succeeded: 0,
    failed: 0,
    pending: 0,
    nativeImportSuccesses: 0,
    nativeImportFallbacks: 0,
  };
  const runtimeHandoffRates = calculateHandoffAnalyticsRates(runtimeHandoffMetrics);
  const metricsData = metrics.data ?? {};

  const machinesOnline = machineList.filter((m) => m.status === 'online').length;
  const agentsRegistered = agentList.length;
  const activeRuns = Number(metricsData.agentctl_agents_active ?? 0);
  const totalRuns = Number(metricsData.agentctl_runs_total ?? 0);
  const totalAgentCost = useMemo(
    () => agentList.reduce((sum, a) => sum + (a.totalCostUsd ?? 0), 0),
    [agentList],
  );

  // Active sessions (running or active status)
  const activeSessions = sessionList.filter((s) => s.status === 'running' || s.status === 'active');
  const activeSessionCount = activeSessions.length;
  const activeManagedRuntimeCount = managedRuntimeSessions.filter(
    (session) => session.status === 'active',
  ).length;
  const handingOffManagedRuntimeCount = managedRuntimeSessions.filter(
    (session) => session.status === 'handing_off',
  ).length;
  const agentErrorCount = agentList.filter((agent) => agent.status === 'error').length;

  // Per-agent cost breakdown (top spenders)
  const agentCostBreakdown = useMemo(() => {
    return agentList
      .filter((a) => a.totalCostUsd > 0)
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
      .slice(0, 5);
  }, [agentList]);

  // Recent activity: combine sessions sorted by most recent activity
  const recentActivity = useMemo(() => {
    const safeSessionList = sessionList ?? [];
    return [...safeSessionList]
      .sort((a, b) => {
        const dateA = (a?.endedAt ?? a?.lastHeartbeat ?? a?.startedAt) || new Date().toISOString();
        const dateB = (b?.endedAt ?? b?.lastHeartbeat ?? b?.startedAt) || new Date().toISOString();
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      })
      .slice(0, 8);
  }, [sessionList]);

  const visibleDiscoveredSessions = useMemo(() => {
    return discoveredSessions
      .filter((session) => {
        const summary = sanitizeSessionSummary(session.summary);
        const messageCount = session.messageCount ?? 0;
        return !(summary.length === 0 && messageCount === 0);
      })
      .slice(0, 4);
  }, [discoveredSessions]);

  const refreshAll = useMemo(
    () => (): void => {
      void health.refetch();
      void metrics.refetch();
      void machines.refetch();
      void agents.refetch();
      void discovered.refetch();
      void sessions.refetch();
      void runtimeSessions.refetch();
      void runtimeHandoffSummary.refetch();
    },
    [
      health,
      metrics,
      machines,
      agents,
      discovered,
      sessions,
      runtimeSessions,
      runtimeHandoffSummary,
    ],
  );

  useHotkeys(useMemo(() => ({ r: refreshAll, '?': toggleHelp }), [refreshAll, toggleHelp]));

  const anyFetching =
    health.isFetching ||
    metrics.isFetching ||
    machines.isFetching ||
    agents.isFetching ||
    discovered.isFetching ||
    sessions.isFetching ||
    runtimeSessions.isFetching ||
    runtimeHandoffSummary.isFetching;
  const errorMessages = useMemo(() => {
    const msgs: string[] = [];
    if (health.error) msgs.push(`Control plane: ${health.error.message}`);
    if (metrics.error) msgs.push(`Metrics: ${metrics.error.message}`);
    if (machines.error) msgs.push(`Machines: ${machines.error.message}`);
    if (agents.error) msgs.push(`Agents: ${agents.error.message}`);
    if (discovered.error) msgs.push(`Discover: ${discovered.error.message}`);
    if (sessions.error) msgs.push(`Sessions: ${sessions.error.message}`);
    if (runtimeSessions.error) msgs.push(`Runtime sessions: ${runtimeSessions.error.message}`);
    if (runtimeHandoffSummary.error)
      msgs.push(`Runtime handoffs: ${runtimeHandoffSummary.error.message}`);
    return msgs;
  }, [
    health.error,
    metrics.error,
    machines.error,
    agents.error,
    discovered.error,
    sessions.error,
    runtimeSessions.error,
    runtimeHandoffSummary.error,
  ]);
  const anyError = errorMessages.length > 0;

  // Health status — Tailwind class helpers
  const healthStatus = health.data?.status;
  const healthTextClass =
    healthStatus === 'ok'
      ? 'text-green-500'
      : healthStatus === 'degraded'
        ? 'text-yellow-500'
        : 'text-muted-foreground';
  const healthBgClass =
    healthStatus === 'ok'
      ? 'bg-green-500'
      : healthStatus === 'degraded'
        ? 'bg-yellow-500'
        : 'bg-muted-foreground';
  const healthLabel = healthStatus ?? 'unknown';

  // Combined system health: CP status + WS status + machine count
  const systemHealthLabel = useMemo(() => {
    const parts: string[] = [];
    if (healthStatus === 'ok') parts.push('CP up');
    else if (healthStatus === 'degraded') parts.push('CP degraded');
    else parts.push('CP unknown');
    if (wsStatus === 'connected') parts.push('WS connected');
    else parts.push(`WS ${wsStatus}`);
    if (machinesOnline > 0)
      parts.push(`${machinesOnline} machine${machinesOnline > 1 ? 's' : ''} online`);
    else parts.push('no machines');
    return parts.join(' · ');
  }, [healthStatus, wsStatus, machinesOnline]);

  const systemHealthOk = healthStatus === 'ok' && wsStatus === 'connected';

  return (
    <div className="relative p-4 md:p-6 max-w-[1100px] animate-page-enter">
      <KeyboardHelpOverlay open={showHelp} onClose={toggleHelp} />
      <FetchingBar isFetching={anyFetching} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight">Command center</h1>
          <SimpleTooltip content="Keyboard shortcuts (?)">
            <button
              type="button"
              onClick={toggleHelp}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors"
              aria-label="Show keyboard shortcuts"
            >
              <Keyboard className="w-4 h-4" aria-hidden="true" />
            </button>
          </SimpleTooltip>
          <LastUpdated dataUpdatedAt={health.dataUpdatedAt} />
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <Button asChild size="sm">
            <Link href="/sessions">New Session</Link>
          </Button>
          <WsStatusIndicator status={wsStatus} />
          <RefreshButton onClick={refreshAll} isFetching={anyFetching} />
        </div>
      </div>

      {/* Error banner */}
      {anyError && <ErrorBanner message={errorMessages.join(' · ')} onRetry={refreshAll} />}

      {/* Health status card */}
      <div
        className={cn(
          'px-4 sm:px-5 py-4 bg-card border rounded-lg mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3',
          healthStatus === 'ok' ? 'border-green-500/20 shadow-sm' : 'border-border',
        )}
      >
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'w-3 h-3 rounded-full shrink-0',
              healthBgClass,
              healthStatus === 'ok' && 'shadow-sm shadow-green-500/50',
            )}
          />
          <div>
            <div className="text-[15px] font-semibold text-foreground">
              Control Plane: <span className={cn('uppercase', healthTextClass)}>{healthLabel}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={cn(
                  'inline-block w-1.5 h-1.5 rounded-full',
                  systemHealthOk ? 'bg-green-500' : 'bg-yellow-500',
                )}
              />
              <span
                className="text-[11px] text-muted-foreground"
                data-testid="system-health-summary"
              >
                {systemHealthLabel}
              </span>
            </div>
            {health.data?.timestamp && (
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Last checked: <LiveTimeAgo date={health.data.timestamp} />
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <DashboardActionButton
            label="Discover Sessions"
            onClick={() => void discovered.refetch()}
          />
          <DashboardActionButton label="Refresh All" onClick={refreshAll} />
        </div>
      </div>

      {/* Stats grid */}
      {machines.isLoading ||
      agents.isLoading ||
      metrics.isLoading ||
      sessions.isLoading ||
      runtimeSessions.isLoading ||
      runtimeHandoffSummary.isLoading ? (
        <>
          <div
            className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3"
            data-testid="stat-cards-skeleton"
          >
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={`sk-${String(i)}`} className="h-20 rounded-lg" />
            ))}
          </div>
          <div className="mb-6" data-testid="secondary-stats-skeleton">
            <Skeleton className="h-14 rounded-lg" />
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <StatCard
              label="Machines Online"
              value={`${machinesOnline} / ${machineList.length}`}
              accent={machinesOnline > 0 ? 'green' : undefined}
              tooltip="Active machines connected via Tailscale"
              sublabel={
                machineList.length > 0
                  ? `${machineList.filter((m) => m.status === 'offline').length} offline`
                  : undefined
              }
            />
            <StatCard
              label="Active Runs"
              value={formatNumber(activeRuns)}
              accent={activeRuns > 0 ? 'green' : undefined}
              sublabel={`${formatNumber(totalRuns)} total`}
            />
            <StatCard
              label="Active Sessions"
              value={String(activeSessionCount)}
              accent={activeSessionCount > 0 ? 'green' : undefined}
              sublabel={`${sessionList.length} total`}
            />
          </div>
          <Card className="mb-6 border-border/50 bg-card/90 rounded-lg py-0 gap-0 shadow-none">
            <CardContent className="px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                <div
                  className="flex items-center gap-2 min-w-0"
                  data-testid="secondary-stat-Sessions Discovered"
                >
                  <Badge variant="outline" className="border-border/60 bg-background/40">
                    Sessions Discovered
                  </Badge>
                  <span className="font-mono text-foreground">
                    {formatNumber(discovered.data?.count ?? 0)}
                  </span>
                  {discovered.data && (
                    <span className="text-muted-foreground whitespace-nowrap">
                      {discovered.data.machinesQueried} queried · {discovered.data.machinesFailed}{' '}
                      failed
                    </span>
                  )}
                </div>
                <div
                  className="flex items-center gap-2 min-w-0"
                  data-testid="secondary-stat-Agents Registered"
                >
                  <Badge variant="outline" className="border-border/60 bg-background/40">
                    Agents Registered
                  </Badge>
                  <span className="font-mono text-foreground">{String(agentsRegistered)}</span>
                  {agentErrorCount > 0 && (
                    <span className="text-red-500 dark:text-red-400 whitespace-nowrap">
                      {agentErrorCount} in error
                    </span>
                  )}
                </div>
                <div
                  className="flex items-center gap-2 min-w-0"
                  data-testid="secondary-stat-Managed Runtimes"
                >
                  <Badge variant="outline" className="border-border/60 bg-background/40">
                    Managed Runtimes
                  </Badge>
                  <span className="font-mono text-foreground">
                    {String(managedRuntimeSessions.length)}
                  </span>
                  <span className="text-muted-foreground whitespace-nowrap">
                    {activeManagedRuntimeCount} active · {handingOffManagedRuntimeCount} switching
                  </span>
                </div>
                <div
                  className="flex items-center gap-2 min-w-0"
                  data-testid="secondary-stat-Native Import"
                >
                  <Badge variant="outline" className="border-border/60 bg-background/40">
                    Native Import
                  </Badge>
                  <span className="font-mono text-foreground">
                    {String(runtimeHandoffMetrics.nativeImportSuccesses)}
                  </span>
                  <span className="text-muted-foreground whitespace-nowrap">
                    {runtimeHandoffRates.nativeImportSuccessRate}% native ·{' '}
                    {runtimeHandoffRates.fallbackRate}% fallback
                  </span>
                </div>
                <div
                  className="flex items-center gap-2 min-w-0"
                  data-testid="secondary-stat-Total Cost"
                >
                  <Badge variant="outline" className="border-border/60 bg-background/40">
                    Total Cost
                  </Badge>
                  <span className="font-mono text-foreground">{formatCost(totalAgentCost)}</span>
                  {agentCostBreakdown.length > 0 && (
                    <span className="text-muted-foreground truncate max-w-[200px]">
                      top: {agentCostBreakdown[0]?.name ?? 'N/A'}
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Memory health card */}
      {memoryStats.isSuccess && memoryStats.data?.stats && (
        <div className="mb-5">
          <DashboardMemoryCard />
        </div>
      )}

      {/* Two-column layout: Recent Sessions Activity + Machine Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Recent Sessions Activity */}
        <div>
          <DashboardSectionHeader title="Recent Sessions" href="/sessions" />
          <div className="border border-border/50 rounded-lg overflow-hidden">
            {sessions.isLoading ? (
              <div className="p-4 bg-card space-y-2" data-testid="recent-sessions-skeleton">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={`sk-${String(i)}`} className="h-12 rounded-md" />
                ))}
              </div>
            ) : recentActivity.length === 0 ? (
              <DashboardEmptyPanel
                loading={false}
                message="No sessions yet. Create a session to get started."
              />
            ) : (
              recentActivity.map((session, idx) => (
                <Link
                  key={session.id}
                  href={`/sessions/${session.id}`}
                  className={cn(
                    'block px-4 py-3 bg-card no-underline transition-all duration-200 hover:bg-accent/10 hover:pl-5 hover:shadow-sm',
                    idx > 0 && 'border-t border-border',
                  )}
                >
                  <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <DashboardActivityIcon status={session?.status ?? 'unknown'} />
                      <span className="text-[13px] font-medium text-foreground truncate">
                        {truncate(
                          session?.claudeSessionId
                            ? `Session ${session.claudeSessionId.slice(0, 8)}`
                            : `Session ${(session?.id ?? 'unknown').slice(0, 8)}`,
                          40,
                        )}
                      </span>
                    </div>
                    <StatusBadge status={session?.status ?? 'unknown'} />
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
                    {session?.model && (
                      <span className="font-mono bg-purple-500/15 text-purple-600 dark:text-purple-400 px-1.5 py-px rounded text-[10px]">
                        {session.model}
                      </span>
                    )}
                    {session?.projectPath && (
                      <PathBadge
                        path={session.projectPath}
                        className="text-[11px]"
                        copyable={false}
                      />
                    )}
                    <span className="ml-auto shrink-0">
                      {session?.endedAt ? (
                        <SimpleTooltip
                          content={`Duration: ${formatDuration(session.startedAt ?? new Date().toISOString(), session.endedAt)}`}
                        >
                          <span>
                            ended <LiveTimeAgo date={session.endedAt} />
                          </span>
                        </SimpleTooltip>
                      ) : (
                        <span>
                          started{' '}
                          <LiveTimeAgo date={session?.startedAt ?? new Date().toISOString()} />
                        </span>
                      )}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Right column: Machine Status + Discovered Sessions */}
        <div className="space-y-5">
          {/* Machine Status */}
          <div>
            <DashboardSectionHeader title="Fleet Status" href="/machines" />
            <div className="border border-border/50 rounded-lg overflow-hidden">
              {machines.isLoading ? (
                <div className="p-4 bg-card space-y-2" data-testid="fleet-status-skeleton">
                  {Array.from({ length: 3 }, (_, i) => (
                    <Skeleton key={`sk-${String(i)}`} className="h-10 rounded-md" />
                  ))}
                </div>
              ) : machineList.length === 0 ? (
                <DashboardEmptyPanel
                  loading={false}
                  message="No machines registered. Run setup-machine.sh on a host to register it."
                />
              ) : (
                machineList.map((machine, idx) => (
                  <Link
                    key={machine.id}
                    href={`/machines/${machine.id}`}
                    className={cn(
                      'flex items-center justify-between px-4 py-2.5 bg-card no-underline transition-all duration-200 hover:bg-accent/10 hover:pl-5',
                      idx > 0 && 'border-t border-border',
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <StatusBadge status={machine.status} />
                      <div>
                        <div className="text-[13px] font-medium text-foreground">
                          {machine.hostname}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono">
                          {machine.tailscaleIp}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>
                        {machine?.os ?? 'unknown'}/{machine?.arch ?? 'unknown'}
                      </span>
                      {machine?.capabilities?.gpu && (
                        <span className="bg-muted px-1.5 py-px rounded text-[10px] font-semibold uppercase">
                          GPU
                        </span>
                      )}
                      {machine?.lastHeartbeat && <LiveTimeAgo date={machine.lastHeartbeat} />}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* Discovered Sessions (compact) */}
          <div>
            <DashboardSectionHeader title="Discovered Sessions" href="/discover" />
            <div className="border border-border/50 rounded-lg overflow-hidden">
              {visibleDiscoveredSessions.length === 0 ? (
                <div className="p-6 text-center bg-card">
                  <div className="text-[13px] text-muted-foreground mb-2">
                    No sessions discovered yet.
                  </div>
                  <Link
                    href="/discover"
                    className="text-[12px] text-primary font-medium no-underline hover:underline"
                  >
                    Scan fleet for active sessions &rarr;
                  </Link>
                </div>
              ) : (
                visibleDiscoveredSessions.map((session, idx) => (
                  <Link
                    key={session.sessionId}
                    href="/discover"
                    className={cn(
                      'block px-4 py-2.5 bg-card no-underline transition-all duration-200 hover:bg-accent/10 hover:pl-5',
                      idx > 0 && 'border-t border-border',
                    )}
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-[12px] font-medium text-foreground truncate">
                        {truncate(
                          sanitizeSessionSummary(session?.summary) || 'Untitled session',
                          40,
                        )}
                      </span>
                      <span className="text-[11px] text-muted-foreground shrink-0 ml-2">
                        <LiveTimeAgo date={session?.lastActivity ?? new Date().toISOString()} />
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                      <span className="font-mono bg-muted px-1.5 py-px rounded text-[10px]">
                        {session?.hostname ?? 'unknown'}
                      </span>
                      {session?.branch && (
                        <span className="font-mono text-green-500 text-[10px]">
                          {session.branch}
                        </span>
                      )}
                      <span>{session?.messageCount ?? 0} msgs</span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Cost Overview */}
      <DashboardCostOverview
        sessionList={sessionList}
        agentCostBreakdown={agentCostBreakdown}
        isLoading={sessions.isLoading || agents.isLoading}
      />

      {/* Platform summary bar */}
      <div className="mt-5 bg-card border border-border/50 rounded-lg overflow-hidden">
        <div className="flex gap-4 px-4 py-2.5 text-xs text-muted-foreground items-center flex-wrap">
          <span className="font-medium text-muted-foreground">Platform</span>
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full',
                metricsData.agentctl_control_plane_up === 1 ? 'bg-green-500' : 'bg-red-500',
              )}
            />
            {metricsData.agentctl_control_plane_up === 1 ? 'Healthy' : 'Down'}
          </span>
          <span className="h-3 w-px bg-border" />
          <span>
            Total Cost:{' '}
            <span className="text-foreground font-mono">
              {formatCost(
                typeof metricsData.agentctl_total_cost_usd === 'number'
                  ? metricsData.agentctl_total_cost_usd
                  : 0,
              )}
            </span>
          </span>
          <span className="h-3 w-px bg-border" />
          <span>
            Runs: <span className="text-foreground font-mono">{formatNumber(totalRuns)}</span>
          </span>
          <span className="h-3 w-px bg-border" />
          <span>
            Active Sessions: <span className="text-foreground font-mono">{activeSessionCount}</span>
          </span>
        </div>
        {/* Cost breakdown by agent */}
        <div className="border-t border-border px-4 py-2.5">
          <div className="text-[11px] font-medium text-muted-foreground mb-2">Cost by Agent</div>
          {agentCostBreakdown.length > 0 ? (
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              {agentCostBreakdown.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className="flex items-center gap-2 text-xs text-muted-foreground no-underline hover:text-foreground transition-colors"
                >
                  <span className="truncate max-w-[140px]">{agent.name}</span>
                  <span className="font-mono text-foreground">
                    {formatCost(agent.totalCostUsd)}
                  </span>
                  {typeof agent.lastCostUsd === 'number' &&
                    Number.isFinite(agent.lastCostUsd) &&
                    agent.lastCostUsd > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        (last: {formatCost(agent.lastCostUsd)})
                      </span>
                    )}
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-[12px] text-muted-foreground">No cost data recorded yet</div>
          )}
        </div>
      </div>

      {/* Dependencies */}
      {health.isLoading && (
        <div className="mt-6" data-testid="dependencies-skeleton">
          <DashboardSectionHeader title="Dependencies" />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={`sk-${String(i)}`} className="h-12 rounded-lg" />
            ))}
          </div>
        </div>
      )}
      {!health.isLoading && health.data?.dependencies && (
        <div className="mt-6">
          <DashboardSectionHeader title="Dependencies" />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">
            {Object.entries(health.data.dependencies).map(([name, dep]) => {
              const isOk = dep.status === 'ok';
              const isError = dep.status === 'error';
              const latencyMs = dep.latencyMs ?? 0;
              const isHighLatency = isOk && latencyMs > 500;

              const dotClass = isError
                ? 'bg-red-500 shadow-sm shadow-red-500/50'
                : isHighLatency
                  ? 'bg-yellow-500 shadow-sm shadow-yellow-500/40'
                  : 'bg-green-500 shadow-sm shadow-green-500/40';

              const borderClass = isError
                ? 'border-red-500/20'
                : isHighLatency
                  ? 'border-yellow-500/20'
                  : 'border-border';

              return (
                <div
                  key={name}
                  className={cn(
                    'px-3.5 py-2.5 bg-card border rounded-lg flex justify-between items-center transition-all duration-200 hover:shadow-sm',
                    borderClass,
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={cn('w-2 h-2 rounded-full shrink-0', dotClass)} />
                    <span className="text-[13px] font-medium capitalize">{name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'text-[11px] font-mono',
                        isError
                          ? 'text-red-500'
                          : isHighLatency
                            ? 'text-yellow-500'
                            : 'text-muted-foreground',
                      )}
                    >
                      {latencyMs > 0 ? `${latencyMs.toFixed(0)}ms` : '-'}
                    </span>
                    <span
                      className={cn(
                        'text-[10px] font-semibold uppercase',
                        isError
                          ? 'text-red-500'
                          : isHighLatency
                            ? 'text-yellow-500'
                            : 'text-green-500',
                      )}
                    >
                      {isError ? 'ERR' : isHighLatency ? 'SLOW' : 'OK'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          {Object.values(health.data?.dependencies ?? {}).some((d) => d.error) && (
            <div className="mt-2 px-3 py-2 bg-red-500/5 border border-red-500/20 rounded text-[12px] text-red-600 dark:text-red-400">
              {Object.entries(health.data?.dependencies ?? {})
                .filter(([, d]) => d.error)
                .map(([name, d]) => (
                  <div key={name}>
                    <span className="font-medium capitalize">{name}</span>: {d.error}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
