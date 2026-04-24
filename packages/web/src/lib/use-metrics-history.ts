'use client';

import { useEffect, useState } from 'react';

import { api } from './api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MetricsSample = { ts: number } & Record<string, number>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SAMPLES = 20;
const POLL_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Accumulates a rolling window of metrics snapshots sampled every 30 seconds.
 * Each sample contains a `ts` timestamp plus all numeric metric values from
 * the /metrics endpoint. Returns an array of up to MAX_SAMPLES entries.
 */
export function useMetricsHistory(): MetricsSample[] {
  const [history, setHistory] = useState<MetricsSample[]>([]);

  useEffect(() => {
    const poll = async (): Promise<void> => {
      try {
        const data = await api.metrics();
        setHistory((prev) => {
          const entry: MetricsSample = { ts: Date.now() };
          for (const [key, value] of Object.entries(data)) {
            if (typeof value === 'number') {
              entry[key] = value;
            }
          }
          const next = [...prev, entry];
          return next.length > MAX_SAMPLES ? next.slice(-MAX_SAMPLES) : next;
        });
      } catch {
        // Silently ignore — metrics polling failures should not disrupt the dashboard
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return history;
}
