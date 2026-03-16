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
  const isActive = !endedAt;

  useEffect(() => {
    // Only tick when there's no endedAt (session is still active)
    if (!isActive) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(timer);
  }, [isActive]);

  const formatted = formatDuration(startedAt, endedAt);
  const text = formatted === '0s' ? (isActive ? 'Running now' : 'instant') : formatted;

  return <span className={className}>{text}</span>;
}
