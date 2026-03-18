'use client';

import { RefreshCw } from 'lucide-react';
import type React from 'react';

import { cn } from '@/lib/utils';

type Props = {
  onClick: () => void;
  isFetching?: boolean;
  label?: string;
  className?: string;
};

export function RefreshButton({
  onClick,
  isFetching,
  label = 'Refresh',
  className,
}: Props): React.JSX.Element {
  const accessibleLabel = label.trim() ? label : 'Refresh';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={accessibleLabel}
      data-testid="refresh-button"
      disabled={isFetching}
      className={cn(
        'px-3.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-[13px] cursor-pointer inline-flex items-center gap-1.5 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isFetching && 'opacity-70 cursor-wait',
        className,
      )}
    >
      <RefreshCw
        size={12}
        className={cn('transition-transform duration-300', isFetching && 'animate-spin')}
        aria-hidden="true"
      />
      {label}
    </button>
  );
}
