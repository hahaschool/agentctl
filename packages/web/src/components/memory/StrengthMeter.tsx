import type React from 'react';

import { cn } from '@/lib/utils';

function barClasses(strength: number): string {
  if (strength >= 0.7) {
    return 'bg-emerald-500';
  }
  if (strength >= 0.4) {
    return 'bg-amber-500';
  }
  return 'bg-red-500';
}

export type StrengthMeterProps = {
  strength: number;
  showLabel?: boolean;
  className?: string;
};

export function StrengthMeter({
  strength,
  showLabel = true,
  className,
}: StrengthMeterProps): React.JSX.Element {
  const clamped = Math.max(0, Math.min(1, strength));
  const percentage = Math.round(clamped * 100);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Strength"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
      >
        <div
          className={cn('h-full rounded-full transition-[width]', barClasses(clamped))}
          style={{ width: `${String(percentage)}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs tabular-nums text-muted-foreground">{percentage}%</span>
      )}
    </div>
  );
}
