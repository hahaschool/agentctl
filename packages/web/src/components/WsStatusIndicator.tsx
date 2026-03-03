'use client';

import type React from 'react';

import { cn } from '@/lib/utils';
import type { WsConnectionStatus } from '../hooks/use-websocket';

const WS_STATUS_CONFIG: Record<
  WsConnectionStatus,
  { textClass: string; bgClass: string; label: string }
> = {
  connected: { textClass: 'text-green-500', bgClass: 'bg-green-500', label: 'Connected' },
  connecting: { textClass: 'text-yellow-500', bgClass: 'bg-yellow-500', label: 'Connecting' },
  disconnected: {
    textClass: 'text-muted-foreground',
    bgClass: 'bg-muted-foreground',
    label: 'Disconnected',
  },
};

export function WsStatusIndicator({
  status,
  compact,
}: {
  status: WsConnectionStatus;
  compact?: boolean;
}): React.JSX.Element {
  const { textClass, bgClass, label } = WS_STATUS_CONFIG[status];

  return (
    <span
      title={`WebSocket: ${label}`}
      className={cn(
        'inline-flex items-center gap-1.5 font-medium',
        textClass,
        compact ? 'text-[10px]' : 'text-[11px]',
      )}
    >
      <span className={cn('w-[7px] h-[7px] rounded-full shrink-0', bgClass)} />
      {!compact && label}
    </span>
  );
}
