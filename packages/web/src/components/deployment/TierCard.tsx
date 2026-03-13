'use client';

import type { DeploymentTierStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number | undefined): string {
  if (seconds === undefined) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatMemory(mb: number | undefined): string {
  if (mb === undefined) return '--';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}G`;
  return `${Math.round(mb)}M`;
}

const STATUS_STYLES = {
  running: {
    border: 'border-green-500/50',
    badge: 'bg-green-500/15 text-green-400',
    label: 'RUNNING',
  },
  degraded: {
    border: 'border-yellow-500/50',
    badge: 'bg-yellow-500/15 text-yellow-400',
    label: 'DEGRADED',
  },
  stopped: {
    border: 'border-border',
    badge: 'bg-muted text-muted-foreground',
    label: 'STOPPED',
  },
} as const;

// ---------------------------------------------------------------------------
// TierCard
// ---------------------------------------------------------------------------

type TierCardProps = {
  readonly tier: DeploymentTierStatus;
};

export function TierCard({ tier }: TierCardProps): React.JSX.Element {
  const style = STATUS_STYLES[tier.status];
  const isStopped = tier.status === 'stopped';

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-4 transition-opacity',
        style.border,
        isStopped && 'opacity-50',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">{tier.label}</h3>
          <span className="text-[10px] font-mono text-muted-foreground">{tier.name}</span>
        </div>
        <span
          className={cn(
            'text-[10px] font-semibold tracking-wider px-2 py-0.5 rounded-sm',
            style.badge,
          )}
        >
          {style.label}
        </span>
      </div>

      {/* Services table */}
      <div className="space-y-1">
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 text-[10px] text-muted-foreground/70 uppercase tracking-wider pb-1 border-b border-border/30">
          <span>Service</span>
          <span>Port</span>
          <span>Mem</span>
          <span>Uptime</span>
          <span>Rst</span>
        </div>
        {tier.services.map((svc) => (
          <div
            key={svc.name}
            className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 items-center py-0.5"
          >
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'inline-block w-1.5 h-1.5 rounded-full shrink-0',
                  svc.healthy && !isStopped ? 'bg-green-500' : 'bg-red-500',
                )}
              />
              <span className="text-xs">{svc.name}</span>
            </div>
            <span className="text-xs font-mono text-muted-foreground">{svc.port}</span>
            <span className="text-xs font-mono text-muted-foreground">
              {formatMemory(svc.memoryMb)}
            </span>
            <span className="text-xs font-mono text-muted-foreground">
              {formatUptime(svc.uptimeSeconds)}
            </span>
            <span
              className={cn(
                'text-xs font-mono',
                (svc.restarts ?? 0) > 0 ? 'text-yellow-400' : 'text-muted-foreground',
              )}
            >
              {svc.restarts ?? 0}
            </span>
          </div>
        ))}
      </div>

      {/* Config footer */}
      <div className="mt-3 pt-2 border-t border-border/30 flex flex-wrap gap-x-3 gap-y-0.5">
        <span className="text-[10px] font-mono text-muted-foreground/60">
          db:{tier.config.database}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground/60">
          redis:{tier.config.redisDb}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground/60">
          cp:{tier.config.cpPort}
        </span>
      </div>
    </div>
  );
}
