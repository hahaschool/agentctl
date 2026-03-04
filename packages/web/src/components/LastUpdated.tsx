'use client';

import { useEffect, useState } from 'react';

type Props = {
  /** Epoch timestamp from query.dataUpdatedAt */
  dataUpdatedAt: number;
  /** Refetch interval in ms (used to show next refresh countdown) */
  refetchInterval?: number;
};

export function LastUpdated({ dataUpdatedAt }: Props): React.JSX.Element | null {
  const [, setTick] = useState(0);

  // Re-render every 5s to keep the "X seconds ago" fresh
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 5_000);
    return () => clearInterval(timer);
  }, []);

  if (!dataUpdatedAt) return null;

  const secondsAgo = Math.floor((Date.now() - dataUpdatedAt) / 1000);

  let label: string;
  if (secondsAgo < 5) {
    label = 'just now';
  } else if (secondsAgo < 60) {
    label = `${secondsAgo}s ago`;
  } else {
    label = `${Math.floor(secondsAgo / 60)}m ago`;
  }

  return (
    <span className="text-[10px] text-muted-foreground/70 tabular-nums" title="Last data refresh">
      Updated {label}
    </span>
  );
}
