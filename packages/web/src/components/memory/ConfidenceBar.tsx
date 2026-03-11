import type React from 'react';

import { cn } from '@/lib/utils';

function barClasses(confidence: number): string {
  if (confidence >= 0.8) {
    return 'bg-emerald-500';
  }
  if (confidence >= 0.5) {
    return 'bg-amber-500';
  }
  return 'bg-red-500';
}

export function ConfidenceBar({
  confidence,
  className,
}: {
  confidence: number;
  className?: string;
}): React.JSX.Element {
  const clamped = Math.max(0, Math.min(1, confidence));
  const percentage = Math.round(clamped * 100);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Confidence"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
      >
        <div
          className={cn('h-full rounded-full transition-[width]', barClasses(clamped))}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{percentage}%</span>
    </div>
  );
}
