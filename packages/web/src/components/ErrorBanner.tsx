'use client';

import type React from 'react';

import { cn } from '@/lib/utils';

type Props = {
  message: string;
  onRetry?: () => void;
  className?: string;
};

/**
 * Standardized error banner used across all pages.
 * Shows an error message with an optional retry button.
 */
export function ErrorBanner({ message, onRetry, className }: Props): React.JSX.Element {
  return (
    <div
      className={cn(
        'px-4 py-2.5 bg-red-900 text-red-300 rounded-sm mb-4 text-[13px] flex items-center justify-between gap-3',
        className,
      )}
      role="alert"
    >
      <span>{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 px-2.5 py-1 bg-red-800 text-red-200 rounded-sm text-xs font-medium cursor-pointer hover:bg-red-700 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}
