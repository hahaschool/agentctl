import React from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_VARIANTS: Record<string, string> = {
  online:
    'bg-green-500/15 text-green-700 border-green-600/30 dark:text-green-300 dark:border-green-400/30',
  running:
    'bg-green-500/15 text-green-700 border-green-600/30 dark:text-green-300 dark:border-green-400/30',
  active:
    'bg-green-500/15 text-green-700 border-green-600/30 dark:text-green-300 dark:border-green-400/30',
  ok: 'bg-green-500/15 text-green-700 border-green-600/30 dark:text-green-300 dark:border-green-400/30',
  success:
    'bg-green-500/15 text-green-700 border-green-600/30 dark:text-green-300 dark:border-green-400/30',
  completed:
    'bg-green-500/15 text-green-700 border-green-600/30 dark:text-green-300 dark:border-green-400/30',
  registered:
    'bg-blue-500/15 text-blue-700 border-blue-600/30 dark:text-blue-300 dark:border-blue-400/30',
  restarting:
    'bg-blue-500/15 text-blue-700 border-blue-600/30 dark:text-blue-300 dark:border-blue-400/30',
  handing_off:
    'bg-blue-500/15 text-blue-700 border-blue-600/30 dark:text-blue-300 dark:border-blue-400/30',
  pending:
    'bg-blue-500/15 text-blue-700 border-blue-600/30 dark:text-blue-300 dark:border-blue-400/30',
  starting:
    'bg-amber-500/15 text-amber-700 border-amber-600/30 dark:text-amber-300 dark:border-amber-400/30',
  stopping:
    'bg-amber-500/15 text-amber-700 border-amber-600/30 dark:text-amber-300 dark:border-amber-400/30',
  degraded:
    'bg-amber-500/15 text-amber-700 border-amber-600/30 dark:text-amber-300 dark:border-amber-400/30',
  paused:
    'bg-orange-500/15 text-orange-700 border-orange-600/30 dark:text-orange-300 dark:border-orange-400/30',
  offline: 'bg-muted text-muted-foreground border-transparent',
  stopped: 'bg-muted text-muted-foreground border-transparent',
  idle: 'bg-muted text-muted-foreground border-transparent',
  ended: 'bg-muted text-muted-foreground border-transparent',
  cancelled: 'bg-muted text-muted-foreground border-transparent',
  error: 'bg-red-500/15 text-red-700 border-red-600/30 dark:text-red-300 dark:border-red-400/30',
  failed: 'bg-red-500/15 text-red-700 border-red-600/30 dark:text-red-300 dark:border-red-400/30',
  failure: 'bg-red-500/15 text-red-700 border-red-600/30 dark:text-red-300 dark:border-red-400/30',
  timeout: 'bg-red-500/15 text-red-700 border-red-600/30 dark:text-red-300 dark:border-red-400/30',
};

const PULSE_STATUSES = new Set(['running', 'active', 'starting', 'online', 'restarting']);

function StatusBadgeBase({ status }: { status: string }): React.JSX.Element {
  const variant = STATUS_VARIANTS[status] ?? 'bg-muted text-muted-foreground';
  const shouldPulse = PULSE_STATUSES.has(status);
  const spokenStatus = status.replaceAll('_', ' ');

  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5 capitalize', variant)}
      aria-label={`Status: ${spokenStatus}`}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full bg-current shrink-0',
          shouldPulse && 'animate-pulse',
        )}
        aria-hidden="true"
      />
      {status}
    </Badge>
  );
}

export const StatusBadge = React.memo(StatusBadgeBase);
