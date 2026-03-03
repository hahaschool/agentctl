'use client';

import { useQuery } from '@tanstack/react-query';
import type React from 'react';

import { cn } from '@/lib/utils';
import { ErrorBanner } from '../components/ErrorBanner';
import { LastUpdated } from '../components/LastUpdated';
import { LiveTimeAgo } from '../components/LiveTimeAgo';
import { SimpleTooltip } from '../components/SimpleTooltip';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { WsStatusIndicator } from '../components/WsStatusIndicator';
import { useWebSocket } from '../hooks/use-websocket';
import { formatNumber, truncate } from '../lib/format-utils';
import {
  agentsQuery,
  discoverQuery,
  healthQuery,
  machinesQuery,
  metricsQuery,
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
    <div className="p-6 max-w-[1100px] animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <h1 className="text-[22px] font-bold">Command Center</h1>
        <div className="flex items-center gap-3">
          <LastUpdated dataUpdatedAt={health.dataUpdatedAt} />
          <WsStatusIndicator status={wsStatus} />
          <button
            type="button"
            onClick={refreshAll}
            className="px-3.5 py-1.5 bg-muted text-muted-foreground border border-border rounded-sm text-[13px] cursor-pointer"
          >
            Refresh
          </button>
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
      </div>

      {/* Two-column layout: Recent Activity + Machine Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Recent Activity */}
        <div>
          <SectionHeader title="Recent Activity" />
          <div className="border border-border rounded-lg overflow-hidden">
            {discoveredSessions.length === 0 ? (
              <DashboardEmptyPanel
                loading={discovered.isLoading}
                message="No sessions discovered"
              />
            ) : (
              discoveredSessions.slice(0, 5).map((session, idx) => (
                <div
                  key={session.sessionId}
                  className={cn('px-4 py-3 bg-card', idx > 0 && 'border-t border-border')}
                >
                  <div className="flex justify-between items-start mb-1">
                    <SimpleTooltip content={session.summary || 'Untitled session'}>
                      <span className="text-[13px] font-medium text-foreground">
                        {truncate(session.summary || 'Untitled session', 50)}
                      </span>
                    </SimpleTooltip>
                    <span className="text-[11px] text-muted-foreground shrink-0 ml-2">
                      <LiveTimeAgo date={session.lastActivity} />
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-mono bg-muted px-1.5 py-px rounded">
                      {session.hostname}
                    </span>
                    <SimpleTooltip content={session.projectPath}>
                      <span className="font-mono">
                        {truncate(session.projectPath.split('/').pop() ?? session.projectPath, 30)}
                      </span>
                    </SimpleTooltip>
                    {session.branch && <span className="font-mono">{session.branch}</span>}
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
          <div className="border border-border rounded-lg overflow-hidden">
            {machineList.length === 0 ? (
              <DashboardEmptyPanel loading={machines.isLoading} message="No machines registered" />
            ) : (
              machineList.map((machine, idx) => (
                <div
                  key={machine.id}
                  className={cn(
                    'px-4 py-2.5 bg-card flex items-center justify-between',
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
                    {machine.capabilities.gpu && (
                      <span className="bg-muted px-1.5 py-px rounded text-[10px] font-semibold uppercase">
                        GPU
                      </span>
                    )}
                    {machine.lastHeartbeat && <LiveTimeAgo date={machine.lastHeartbeat} />}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Platform summary bar */}
      <div className="flex gap-4 mt-5 px-4 py-2.5 bg-card border border-border rounded-lg text-xs text-muted-foreground items-center flex-wrap">
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
        <span>
          Cost:{' '}
          <span className="text-foreground font-mono">
            $
            {typeof metricsData.agentctl_total_cost_usd === 'number'
              ? metricsData.agentctl_total_cost_usd.toFixed(2)
              : '0.00'}
          </span>
        </span>
        <span>
          Runs: <span className="text-foreground font-mono">{formatNumber(totalRuns)}</span>
        </span>
      </div>

      {/* Dependencies */}
      {health.data?.dependencies && (
        <div className="mt-6">
          <SectionHeader title="Dependencies" />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">
            {Object.entries(health.data.dependencies).map(([name, dep]) => (
              <div
                key={name}
                className="px-3.5 py-2.5 bg-card border border-border rounded-lg flex justify-between items-center"
              >
                <span className="text-[13px] font-medium capitalize">{name}</span>
                <span className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground font-mono">
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
  return <h2 className="text-[15px] font-semibold text-muted-foreground mb-2.5">{title}</h2>;
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

function DashboardEmptyPanel({
  loading,
  message,
}: {
  loading: boolean;
  message: string;
}): React.JSX.Element {
  return (
    <div className="p-8 text-center text-muted-foreground bg-card text-[13px]">
      {loading ? 'Loading...' : message}
    </div>
  );
}
