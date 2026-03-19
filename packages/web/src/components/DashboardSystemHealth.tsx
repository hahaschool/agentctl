'use client';

import type React from 'react';

import type { HealthResponse } from '@/lib/api';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ServiceStatus = 'ok' | 'degraded' | 'error' | 'unknown';

type ServicePillProps = {
  label: string;
  status: ServiceStatus;
  detail?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusDotClass(status: ServiceStatus): string {
  switch (status) {
    case 'ok':
      return 'bg-green-500 shadow-sm shadow-green-500/50';
    case 'degraded':
      return 'bg-yellow-500 shadow-sm shadow-yellow-500/40';
    case 'error':
      return 'bg-red-500 shadow-sm shadow-red-500/40';
    default:
      return 'bg-muted-foreground';
  }
}

function statusTextClass(status: ServiceStatus): string {
  switch (status) {
    case 'ok':
      return 'text-green-500';
    case 'degraded':
      return 'text-yellow-500';
    case 'error':
      return 'text-red-500';
    default:
      return 'text-muted-foreground';
  }
}

function statusLabel(status: ServiceStatus): string {
  switch (status) {
    case 'ok':
      return 'UP';
    case 'degraded':
      return 'DEGRADED';
    case 'error':
      return 'DOWN';
    default:
      return 'UNKNOWN';
  }
}

// ---------------------------------------------------------------------------
// ServicePill
// ---------------------------------------------------------------------------

function ServicePill({ label, status, detail }: ServicePillProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-background/40 border border-border/50 rounded text-[11px]">
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusDotClass(status))} />
      <span className="text-muted-foreground font-medium">{label}</span>
      <span className={cn('font-semibold font-mono', statusTextClass(status))}>
        {detail ?? statusLabel(status)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DashboardSystemHealth
// ---------------------------------------------------------------------------

type DashboardSystemHealthProps = {
  health: HealthResponse | undefined;
  wsStatus: 'connected' | 'disconnected' | 'connecting' | 'error';
  isLoading: boolean;
};

export function DashboardSystemHealth({
  health,
  wsStatus,
  isLoading,
}: DashboardSystemHealthProps): React.JSX.Element {
  const cpStatus: ServiceStatus =
    health?.status === 'ok' ? 'ok' : health?.status === 'degraded' ? 'degraded' : 'unknown';

  const wsServiceStatus: ServiceStatus =
    wsStatus === 'connected'
      ? 'ok'
      : wsStatus === 'connecting'
        ? 'degraded'
        : wsStatus === 'error'
          ? 'error'
          : 'degraded';

  // Worker health derived from CP dependencies if available
  const workerDep = health?.dependencies?.worker ?? health?.dependencies?.['agent-worker'];
  const workerStatus: ServiceStatus = (() => {
    if (!workerDep) return 'unknown';
    if (workerDep.status === 'ok') return 'ok';
    if (workerDep.status === 'error') return 'error';
    return 'degraded';
  })();

  const workerDetail =
    workerDep && workerDep.latencyMs > 0 ? `${workerDep.latencyMs.toFixed(0)}ms` : undefined;

  if (isLoading) {
    return (
      <div className="flex flex-wrap gap-2" data-testid="system-health-loading">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={`ph-${String(i)}`} className="h-7 w-20 rounded bg-muted/50 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="dashboard-system-health-pills">
      <ServicePill label="Control Plane" status={cpStatus} />
      <ServicePill label="WebSocket" status={wsServiceStatus} />
      {workerDep ? (
        <ServicePill label="Worker" status={workerStatus} detail={workerDetail} />
      ) : (
        <ServicePill label="Worker" status="unknown" />
      )}
    </div>
  );
}
