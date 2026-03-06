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
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label || 'Refresh'}
      data-testid="refresh-button"
      disabled={isFetching}
      className={cn(
        'px-3.5 py-1.5 bg-muted text-muted-foreground border border-border rounded-md text-[13px] cursor-pointer inline-flex items-center gap-1.5 transition-colors hover:bg-accent hover:text-foreground',
        isFetching && 'opacity-70 cursor-wait',
        className,
      )}
    >
      <RefreshCw
        size={12}
        className={cn(
          'transition-transform duration-300',
          isFetching && 'animate-spin',
        )}
      />
      {label}
    </button>
  );
}
