'use client';

import { useEffect, useState } from 'react';

import { formatDateTime, timeAgo } from '../lib/format-utils';

type Props = {
  /** ISO date string or any string parseable by Date constructor */
  date: string;
  /** Re-render interval in ms (default: 30_000 = 30s) */
  interval?: number;
  /** Fallback text when date is falsy */
  fallback?: string;
  className?: string;
};

/**
 * Renders a relative time string ("5m ago") that auto-updates on a timer.
 * Drop-in replacement for static `timeAgo()` calls.
 */
export function LiveTimeAgo({
  date,
  interval = 30_000,
  fallback = '',
  className,
}: Props): React.JSX.Element {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), interval);
    return () => clearInterval(timer);
  }, [interval]);

  if (!date) {
    return <span className={className}>{fallback}</span>;
  }

  return (
    <span className={className} title={formatDateTime(date)}>
      {timeAgo(date)}
    </span>
  );
}
