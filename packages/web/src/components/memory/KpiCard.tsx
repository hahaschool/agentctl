import type React from 'react';

import { cn } from '@/lib/utils';

type KpiCardAccent = 'blue' | 'green' | 'amber' | 'purple' | 'red';

const ACCENT_BAR: Record<KpiCardAccent, string> = {
  blue: 'bg-blue-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  purple: 'bg-purple-500',
  red: 'bg-red-500',
};

const ACCENT_TEXT: Record<KpiCardAccent, string> = {
  blue: 'text-blue-600 dark:text-blue-400',
  green: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  purple: 'text-purple-600 dark:text-purple-400',
  red: 'text-red-600 dark:text-red-400',
};

type Props = {
  label: string;
  value: string;
  sublabel?: string;
  accent?: KpiCardAccent;
  isLoading?: boolean;
  className?: string;
};

export function KpiCard({
  label,
  value,
  sublabel,
  accent = 'blue',
  isLoading = false,
  className,
}: Props): React.JSX.Element {
  return (
    <div
      data-testid={`kpi-card-${label}`}
      className={cn(
        'relative overflow-hidden rounded-lg border border-border/50 bg-card p-5 transition-colors hover:border-border',
        className,
      )}
    >
      {/* Accent bar */}
      <div
        aria-hidden="true"
        className={cn('absolute top-0 left-0 h-1 w-full', ACCENT_BAR[accent])}
      />

      <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>

      {isLoading ? (
        // biome-ignore lint/a11y/useSemanticElements: animated skeleton uses div intentionally
        <div
          data-testid="kpi-loading"
          className="mt-2 h-8 w-24 animate-pulse rounded bg-muted"
          role="status"
          aria-busy="true"
        />
      ) : (
        <p
          data-testid={`kpi-value-${label}`}
          className={cn('mt-2 text-3xl font-bold tabular-nums tracking-tight', ACCENT_TEXT[accent])}
        >
          {value}
        </p>
      )}

      {sublabel && !isLoading && (
        <p data-testid={`kpi-sublabel-${label}`} className="mt-1 text-[11px] text-muted-foreground">
          {sublabel}
        </p>
      )}
    </div>
  );
}
