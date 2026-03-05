'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type React from 'react';
import { useMemo } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '../components/ErrorBanner';
import { FetchingBar } from '../components/FetchingBar';
import { LastUpdated } from '../components/LastUpdated';
import { LiveTimeAgo } from '../components/LiveTimeAgo';
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
  metricsQuery,
  sessionsQuery,
} from '../lib/queries';

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

  const { status: wsStatus } = useWebSocket();

  const machineList = machines.data ?? [];
  const agentList = agents.data ?? [];
  const discoveredSessions = discovered.data?.sessions ?? [];
  const sessionList = sessions.data ?? [];
  const metricsData = metrics.data ?? {};

  const machinesOnline = machineList.filter((m) => m.status === 'online').length;
  const agentsRegistered = agentList.length;
  const activeRuns = Number(metricsData.agentctl_agents_active ?? 0);
  const totalRuns = Number(metricsData.agentctl_runs_total ?? 0);

  // Active sessions (running or active status)
  const activeSessions = sessionList.filter((s) => s.status === 'running' || s.status === 'active');
  const activeSessionCount = activeSessions.length;

  // Per-agent cost breakdown (top spenders)
  const agentCostBreakdown = useMemo(() => {
    return agentList
      .filter((a) => a.totalCostUsd > 0)
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
      .slice(0, 5);
  }, [agentList]);

  // Recent activity: combine sessions sorted by most recent activity
  const recentActivity = useMemo(() => {
    return [...sessionList]
      .sort((a, b) => {
        const dateA = a.endedAt ?? a.lastHeartbeat ?? a.startedAt;
        const dateB = b.endedAt ?? b.lastHeartbeat ?? b.startedAt;
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      })
      .slice(0, 8);
  }, [sessionList]);

  const refreshAll = useMemo(
    () => (): void => {
      void health.refetch();
      void metrics.refetch();
      void machines.refetch();
      void agents.refetch();
      void discovered.refetch();
      void sessions.refetch();
    },
    [health, metrics, machines, agents, discovered, sessions],
  );

  useHotkeys(useMemo(() => ({ r: refreshAll }), [refreshAll]));

  const anyFetching =
    health.isFetching ||
    metrics.isFetching ||
    machines.isFetching ||
    agents.isFetching ||
    discovered.isFetching ||
    sessions.isFetching;
  const anyError =
    health.error ?? metrics.error ?? machines.error ?? agents.error ?? discovered.error;

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

  return (
    <div className="relative p-4 md:p-6 max-w-[1100px] animate-fade-in">
      <FetchingBar isFetching={anyFetching} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <h1 className="text-[22px] font-bold">Command Center</h1>
        <div className="flex items-center gap-3">
          <Link
            href="/sessions"
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium no-underline hover:bg-primary/90 transition-colors"
          >
            New Session
          </Link>
          <Link
            href="/agents"
            className="px-3 py-1.5 bg-transparent text-primary border border-primary rounded text-xs font-medium no-underline hover:bg-primary/10 transition-colors"
          >
            View Agents
          </Link>
          <LastUpdated dataUpdatedAt={health.dataUpdatedAt} />
          <WsStatusIndicator status={wsStatus} />
          <RefreshButton onClick={refreshAll} isFetching={anyFetching} />
        </div>
      </div>

      {/* Error banner */}
      {anyError && <ErrorBanner message={anyError.message} onRetry={refreshAll} />}

      {/* Health status card */}
      <div
        className={cn(
          'px-5 py-4 bg-card border rounded-lg mb-5 flex items-center justify-between',
          healthStatus === 'ok'
            ? 'border-green-500/20 shadow-[0_0_20px_rgba(34,197,94,0.04)]'
            : 'border-border',
        )}
      >
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'w-3 h-3 rounded-full shrink-0',
              healthBgClass,
              healthStatus === 'ok' && 'shadow-[0_0_8px_rgba(34,197,94,0.5)]',
            )}
          />
          <div>
            <div className="text-[15px] font-semibold text-foreground">
              Control Plane: <span className={cn('uppercase', healthTextClass)}>{healthLabel}</span>
            </div>
            {health.data?.timestamp && (
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Last checked: <LiveTimeAgo date={health.data.timestamp} />
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <ActionButton label="Discover Sessions" onClick={() => void discovered.refetch()} />
          <ActionButton label="Refresh All" onClick={refreshAll} />
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 mb-6">
        <StatCard
          label="Machines Online"
          value={`${machinesOnline} / ${machineList.length}`}
          sublabel={
            machineList.length > 0
              ? `${machineList.filter((m) => m.status === 'offline').length} offline`
              : undefined
          }
        />
        <StatCard
          label="Sessions Discovered"
          value={formatNumber(discovered.data?.count ?? 0)}
          sublabel={
            discovered.data
              ? `${discovered.data.machinesQueried} queried, ${discovered.data.machinesFailed} failed`
              : undefined
          }
        />
        <StatCard
          label="Agents Registered"
          value={String(agentsRegistered)}
          sublabel={
            agentList.filter((a) => a.status === 'error').length > 0
              ? `${agentList.filter((a) => a.status === 'error').length} in error`
              : undefined
          }
        />
        <StatCard
          label="Active Runs"
          value={formatNumber(activeRuns)}
          sublabel={`${formatNumber(totalRuns)} total`}
        />
        <StatCard
          label="Active Sessions"
          value={String(activeSessionCount)}
          sublabel={`${sessionList.length} total`}
        />
      </div>

      {/* Two-column layout: Recent Sessions Activity + Machine Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Recent Sessions Activity */}
        <div>
          <SectionHeader title="Recent Sessions" href="/sessions" />
          <div className="border border-border rounded-lg overflow-hidden">
            {recentActivity.length === 0 ? (
              <DashboardEmptyPanel
                loading={sessions.isLoading}
                message="No sessions yet. Create a session to get started."
              />
            ) : (
              recentActivity.map((session, idx) => (
                <Link
                  key={session.id}
                  href={`/sessions/${session.id}`}
                  className={cn(
                    'block px-4 py-3 bg-card no-underline transition-colors duration-100 hover:bg-accent/10',
                    idx > 0 && 'border-t border-border',
                  )}
                >
                  <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <ActivityIcon status={session.status} />
                      <span className="text-[13px] font-medium text-foreground truncate">
                        {truncate(
                          session.claudeSessionId
                            ? `Session ${session.claudeSessionId.slice(0, 8)}`
                            : `Session ${session.id.slice(0, 8)}`,
                          40,
                        )}
                      </span>
                    </div>
                    <StatusBadge status={session.status} />
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
                    {session.model && (
                      <span className="font-mono bg-muted px-1.5 py-px rounded text-[10px]">
                        {session.model}
                      </span>
                    )}
                    {session.projectPath && (
                      <PathBadge path={session.projectPath} className="text-[11px]" />
                    )}
                    <span className="ml-auto shrink-0">
                      {session.endedAt ? (
                        <SimpleTooltip
                          content={`Duration: ${formatDuration(session.startedAt, session.endedAt)}`}
                        >
                          <span>
                            ended <LiveTimeAgo date={session.endedAt} />
                          </span>
                        </SimpleTooltip>
                      ) : (
                        <span>
                          started <LiveTimeAgo date={session.startedAt} />
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
            <SectionHeader title="Fleet Status" href="/machines" />
            <div className="border border-border rounded-lg overflow-hidden">
              {machineList.length === 0 ? (
                <DashboardEmptyPanel
                  loading={machines.isLoading}
                  message="No machines registered. Run setup-machine.sh on a host to register it."
                />
              ) : (
                machineList.map((machine, idx) => (
                  <Link
                    key={machine.id}
                    href={`/machines/${machine.id}`}
                    className={cn(
                      'flex items-center justify-between px-4 py-2.5 bg-card no-underline transition-colors duration-100 hover:bg-accent/10',
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
                        {machine.os}/{machine.arch}
                      </span>
                      {machine.capabilities?.gpu && (
                        <span className="bg-muted px-1.5 py-px rounded text-[10px] font-semibold uppercase">
                          GPU
                        </span>
                      )}
                      {machine.lastHeartbeat && <LiveTimeAgo date={machine.lastHeartbeat} />}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* Discovered Sessions (compact) */}
          {discoveredSessions.length > 0 && (
            <div>
              <SectionHeader title="Discovered Sessions" href="/discover" />
              <div className="border border-border rounded-lg overflow-hidden">
                {discoveredSessions.slice(0, 4).map((session, idx) => (
                  <Link
                    key={session.sessionId}
                    href="/discover"
                    className={cn(
                      'block px-4 py-2.5 bg-card no-underline transition-colors duration-100 hover:bg-accent/10',
                      idx > 0 && 'border-t border-border',
                    )}
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-[12px] font-medium text-foreground truncate">
                        {truncate(session.summary || 'Untitled session', 40)}
                      </span>
                      <span className="text-[11px] text-muted-foreground shrink-0 ml-2">
                        <LiveTimeAgo date={session.lastActivity} />
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                      <span className="font-mono bg-muted px-1.5 py-px rounded text-[10px]">
                        {session.hostname}
                      </span>
                      {session.branch && (
                        <span className="font-mono text-green-500 text-[10px]">
                          {session.branch}
                        </span>
                      )}
                      <span>{session.messageCount} msgs</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Platform summary bar */}
      <div className="mt-5 bg-card border border-border rounded-lg overflow-hidden">
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
        {agentCostBreakdown.length > 0 && (
          <div className="border-t border-border px-4 py-2.5">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Cost by Agent
            </div>
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
          </div>
        )}
      </div>

      {/* Dependencies */}
      {health.data?.dependencies && (
        <div className="mt-6">
          <SectionHeader title="Dependencies" />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">
            {Object.entries(health.data.dependencies).map(([name, dep]) => {
              const isOk = dep.status === 'ok';
              const isError = dep.status === 'error';
              const latencyMs = dep.latencyMs ?? 0;
              const isHighLatency = isOk && latencyMs > 500;

              const dotClass = isError
                ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]'
                : isHighLatency
                  ? 'bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.4)]'
                  : 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]';

              const borderClass = isError
                ? 'border-red-500/20'
                : isHighLatency
                  ? 'border-yellow-500/20'
                  : 'border-border';

              return (
                <div
                  key={name}
                  className={cn(
                    'px-3.5 py-2.5 bg-card border rounded-lg flex justify-between items-center',
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
            <div className="mt-2 px-3 py-2 bg-red-500/5 border border-red-500/20 rounded text-[12px] text-red-400">
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

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function SectionHeader({ title, href }: { title: string; href?: string }): React.JSX.Element {
  return (
    <div className="flex justify-between items-center mb-2.5">
      <h2 className="text-[15px] font-semibold text-muted-foreground">{title}</h2>
      {href && (
        <Link
          href={href}
          className="text-[11px] text-primary font-medium no-underline hover:underline"
        >
          View All &rarr;
        </Link>
      )}
    </div>
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
      className="px-3 py-1.5 bg-transparent text-primary border border-primary rounded text-xs font-medium cursor-pointer"
    >
      {label}
    </button>
  );
}

function ActivityIcon({ status }: { status: string }): React.JSX.Element {
  const colorClass =
    status === 'running' || status === 'active'
      ? 'bg-green-500'
      : status === 'error' || status === 'timeout'
        ? 'bg-red-500'
        : status === 'starting'
          ? 'bg-yellow-500'
          : 'bg-muted-foreground';

  const shouldPulse = status === 'running' || status === 'active';

  return (
    <span
      className={cn('w-2 h-2 rounded-full shrink-0', colorClass, shouldPulse && 'animate-pulse')}
    />
  );
}

function DashboardEmptyPanel({
  loading,
  message,
}: {
  loading: boolean;
  message: string;
}): React.JSX.Element {
  if (loading) {
    return (
      <div className="p-4 bg-card space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={`sk-${String(i)}`} className="flex items-center gap-3">
            <Skeleton className="h-3 w-3 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
            <Skeleton className="h-3 w-12 shrink-0" />
          </div>
        ))}
      </div>
    );
  }
  return <div className="p-8 text-center text-muted-foreground bg-card text-[13px]">{message}</div>;
}
