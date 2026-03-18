'use client';

import type React from 'react';

import { cn } from '@/lib/utils';

type Props = {
  /** Whether data is currently being fetched in the background */
  isFetching: boolean;
};

/**
 * A thin indeterminate progress bar shown at the top of a page during background data refresh.
 * Smoothly transitions in/out so it's noticeable but not distracting.
 */
export function FetchingBar({ isFetching }: Props): React.JSX.Element {
  return (
    <div
      className={cn(
        'absolute top-0 left-0 right-0 h-[2px] overflow-hidden transition-opacity duration-300',
        isFetching ? 'opacity-100' : 'opacity-0',
      )}
      role="progressbar"
      aria-live="polite"
      aria-atomic="true"
      aria-label={isFetching ? 'Loading updates' : undefined}
      aria-hidden={!isFetching}
    >
      <div className="h-full bg-primary animate-fetching-bar" />
      <span className="sr-only">{isFetching ? 'Loading updates' : ''}</span>
    </div>
  );
}
