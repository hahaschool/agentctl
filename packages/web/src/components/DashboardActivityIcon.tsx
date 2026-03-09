import type React from 'react';

import { cn } from '@/lib/utils';

export type DashboardActivityIconProps = {
  status: string;
};

export function DashboardActivityIcon({ status }: DashboardActivityIconProps): React.JSX.Element {
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
