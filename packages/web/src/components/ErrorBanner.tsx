'use client';

import type React from 'react';

import { cn } from '@/lib/utils';

type Props = {
  message: string;
  hint?: string;
  onRetry?: () => void;
  className?: string;
};

/**
 * Standardized error banner used across all pages.
 * Shows an error message with an optional hint and retry button.
 */
export function ErrorBanner({ message, hint, onRetry, className }: Props): React.JSX.Element {
  return (
    <div
      className={cn(
        'px-4 py-2.5 bg-red-900 text-red-300 rounded-sm mb-4 flex items-start justify-between gap-3',
        className,
      )}
      role="alert"
    >
      <div>
        <div className="text-[13px]">{message}</div>
        {hint && <div className="text-[12px] text-red-400 mt-1">{hint}</div>}
      </div>
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
