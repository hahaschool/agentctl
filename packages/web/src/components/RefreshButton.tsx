'use client';

import type React from 'react';

import { cn } from '@/lib/utils';

type Props = {
  onClick: () => void;
  isFetching?: boolean;
  label?: string;
  className?: string;
};

/**
 * A refresh button that shows a spinning animation while data is being fetched.
 * Use with TanStack Query's `isFetching` state for visual feedback.
 */
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
      aria-label={label}
      disabled={isFetching}
      className={cn(
        'px-3.5 py-1.5 bg-muted text-muted-foreground border border-border rounded-sm text-[13px] cursor-pointer inline-flex items-center gap-1.5',
        isFetching && 'opacity-70 cursor-wait',
        className,
      )}
    >
      <span
        className={cn(
          'inline-block text-[11px] transition-transform duration-300',
          isFetching && 'animate-spin',
        )}
      >
        {'\u21BB'}
      </span>
      {label}
    </button>
  );
}
