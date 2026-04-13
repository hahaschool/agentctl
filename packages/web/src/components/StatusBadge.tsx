import React from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_VARIANTS: Record<string, string> = {
  online: 'bg-green-500/10 text-green-500 border-green-500/20',
  running: 'bg-green-500/10 text-green-500 border-green-500/20',
  active: 'bg-green-500/10 text-green-500 border-green-500/20',
  ok: 'bg-green-500/10 text-green-500 border-green-500/20',
  success: 'bg-green-500/10 text-green-500 border-green-500/20',
  completed: 'bg-green-500/10 text-green-500 border-green-500/20',
  registered: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  restarting: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  handing_off: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  pending: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  starting: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  stopping: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  degraded: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  paused: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  offline: 'bg-muted text-muted-foreground border-transparent',
  stopped: 'bg-muted text-muted-foreground border-transparent',
  idle: 'bg-muted text-muted-foreground border-transparent',
  ended: 'bg-muted text-muted-foreground border-transparent',
  cancelled: 'bg-muted text-muted-foreground border-transparent',
  error: 'bg-red-500/10 text-red-500 border-red-500/20',
  failed: 'bg-red-500/10 text-red-500 border-red-500/20',
  failure: 'bg-red-500/10 text-red-500 border-red-500/20',
  timeout: 'bg-red-500/10 text-red-500 border-red-500/20',
};

const PULSE_STATUSES = new Set(['online', 'running', 'active', 'ok', 'success', 'completed']);

/**
 * Human-readable descriptions for each status. Surfaced via the badge's
 * native tooltip (`title`) and accessible label so users — and screen
 * readers — can understand non-obvious values like `handing_off` or
 * `degraded` without having to look them up in docs.
 */
const STATUS_DESCRIPTIONS: Record<string, string> = {
  online: 'Online and reachable',
  running: 'Currently executing',
  active: 'Active and accepting work',
  ok: 'Healthy — all checks passing',
  success: 'Completed successfully',
  completed: 'Finished successfully',
  registered: 'Registered with control plane',
  restarting: 'Restarting — will be available shortly',
  handing_off: 'Transferring control to another agent',
  pending: 'Queued — waiting to start',
  starting: 'Starting up — not yet ready',
  stopping: 'Shutting down',
  degraded: 'Reachable but reporting reduced health',
  paused: 'Paused — will resume on signal',
  offline: 'Not reachable',
  stopped: 'Stopped — no longer running',
  idle: 'Idle — no active work',
  ended: 'Session ended',
  cancelled: 'Cancelled before completion',
  error: 'Error — needs attention',
  failed: 'Failed — see logs for details',
  failure: 'Failure — see logs for details',
  timeout: 'Timed out before completing',
};

function describeStatus(status: string): string {
  return STATUS_DESCRIPTIONS[status] ?? `Status: ${status}`;
}

function StatusBadgeBase({ status }: { status: string }): React.JSX.Element {
  const variant = STATUS_VARIANTS[status] ?? 'bg-muted text-muted-foreground';
  const shouldPulse = PULSE_STATUSES.has(status);
  const description = describeStatus(status);

  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5 capitalize cursor-default', variant)}
      title={description}
      aria-label={`${status}: ${description}`}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full bg-current shrink-0',
          shouldPulse && 'animate-status-dot',
        )}
        aria-hidden="true"
      />
      {status}
    </Badge>
  );
}

export const StatusBadge = React.memo(StatusBadgeBase);
export { STATUS_DESCRIPTIONS, describeStatus };
