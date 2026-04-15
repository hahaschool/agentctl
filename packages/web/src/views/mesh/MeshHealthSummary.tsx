'use client';

import {
  type MeshHealthSummary as MeshHealthSummaryData,
  summarizeMeshHealth,
} from '@agentctl/shared';
import type React from 'react';

import type { SyncPeer } from '@/lib/api';
import { cn } from '@/lib/utils';

type MeshHealthSummaryProps = {
  peers: readonly SyncPeer[];
  /** Injected for deterministic tests. Defaults to `Date.now()` at render. */
  now?: Date | number;
  className?: string;
};

/**
 * §33.8 — One-line mesh health summary rendered above the `/mesh-peers`
 * peers table.
 *
 *   "N peers · bidirectional · M one-way · K stale (no sync in >10 min)"
 *
 * Counts come from the pure `summarizeMeshHealth()` helper in `@agentctl/shared`
 * so the same classification runs in tests, the web client, and any future
 * backend consumer. Self rows are excluded.
 *
 * Design follows the page's terminal-heritage aesthetic: dark-first, monospace
 * numerics, information density > decoration.
 */
export function MeshHealthSummary({
  peers,
  now,
  className,
}: MeshHealthSummaryProps): React.JSX.Element {
  const summary = summarizeMeshHealth(peers, now ?? Date.now());
  const { total, bidirectional, oneWay, stale } = summary;

  return (
    <section
      aria-label="Mesh health summary"
      data-testid="mesh-health-summary"
      className={cn(
        'mb-4 rounded-md border border-border bg-card/60 px-3 py-2',
        'flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-mono',
        className,
      )}
    >
      <Metric
        testId="mesh-health-total"
        value={total}
        label={total === 1 ? 'peer' : 'peers'}
        tone="default"
      />
      <Separator />
      <Metric
        testId="mesh-health-bidirectional"
        value={bidirectional}
        label="bidirectional"
        tone="good"
      />
      <Separator />
      <Metric
        testId="mesh-health-one-way"
        value={oneWay}
        label="one-way"
        tone={oneWay > 0 ? 'warn' : 'muted'}
      />
      <Separator />
      <Metric
        testId="mesh-health-stale"
        value={stale}
        label="stale (no sync in >10 min)"
        tone={stale > 0 ? 'danger' : 'muted'}
      />
    </section>
  );
}

type Tone = 'default' | 'good' | 'warn' | 'danger' | 'muted';

const TONE_CLASSES: Record<Tone, string> = {
  default: 'text-foreground',
  good: 'text-green-400',
  warn: 'text-yellow-400',
  danger: 'text-red-400',
  muted: 'text-muted-foreground',
};

function Metric({
  testId,
  value,
  label,
  tone,
}: {
  testId: string;
  value: number;
  label: string;
  tone: Tone;
}): React.JSX.Element {
  return (
    <span
      data-testid={testId}
      className={cn('inline-flex items-baseline gap-1', TONE_CLASSES[tone])}
    >
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function Separator(): React.JSX.Element {
  return (
    <span aria-hidden="true" className="text-muted-foreground/40 select-none">
      ·
    </span>
  );
}

export type { MeshHealthSummaryData };
