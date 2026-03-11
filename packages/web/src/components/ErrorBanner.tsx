'use client';

import { AlertCircle } from 'lucide-react';
import type React from 'react';

import { cn } from '@/lib/utils';

type Props = {
  message: string;
  hint?: string;
  onRetry?: () => void;
  className?: string;
};

export function ErrorBanner({ message, hint, onRetry, className }: Props): React.JSX.Element {
  return (
    <div
      className={cn(
        'px-4 py-2.5 bg-destructive/10 text-destructive border border-destructive/20 rounded-md mb-4 flex items-start justify-between gap-3',
        className,
      )}
      role="alert"
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <div className="text-[13px] font-medium">{message}</div>
          {hint && <div className="text-[12px] opacity-80 mt-0.5">{hint}</div>}
        </div>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 px-2.5 py-1 bg-destructive/15 text-destructive rounded-md text-xs font-medium cursor-pointer hover:bg-destructive/25 transition-colors border border-destructive/20"
        >
          Retry
        </button>
      )}
    </div>
  );
}
