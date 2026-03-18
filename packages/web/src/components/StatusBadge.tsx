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

function StatusBadgeBase({ status }: { status: string }): React.JSX.Element {
  const variant = STATUS_VARIANTS[status] ?? 'bg-muted text-muted-foreground';
  const shouldPulse = PULSE_STATUSES.has(status);

  return (
    <Badge variant="outline" className={cn('gap-1.5 capitalize', variant)}>
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full bg-current shrink-0',
          shouldPulse && 'animate-status-dot',
        )}
      />
      {status}
    </Badge>
  );
}

export const StatusBadge = React.memo(StatusBadgeBase);
