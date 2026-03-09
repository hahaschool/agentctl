'use client';

import { useEffect, useState } from 'react';

import { formatDuration } from '../lib/format-utils';

type Props = {
  /** ISO date string for the start time */
  startedAt: string;
  /** ISO date string for the end time (if session has ended) */
  endedAt?: string | null;
  className?: string;
};

/**
 * Renders a live-updating duration counter (e.g. "12m 34s") that ticks every second
 * while the session is active. For ended sessions, shows the final duration.
 */
export function LiveDuration({ startedAt, endedAt, className }: Props): React.JSX.Element {
  const [, setTick] = useState(0);

  useEffect(() => {
    // Only tick when there's no endedAt (session is still active)
    if (endedAt) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(timer);
  }, [endedAt]);

  return <span className={className}>{formatDuration(startedAt, endedAt)}</span>;
}
