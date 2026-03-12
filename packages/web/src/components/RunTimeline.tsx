'use client';

import type React from 'react';
import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { AgentRun } from '@/lib/api';
import { formatCost, formatDurationMs } from '@/lib/format-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunTimelineProps = {
  runs: AgentRun[];
};

type TimelineEntry = {
  id: string;
  startTimestamp: number;
  durationMin: number;
  status: string;
  trigger: string;
  costUsd: number | null;
  label: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  success: '#22c55e',
  failure: '#ef4444',
  error: '#ef4444',
  timeout: '#f59e0b',
  cancelled: '#6b7280',
  running: '#3b82f6',
};

const DEFAULT_COLOR = '#6b7280';

const MIN_BAR_DURATION = 0.5;
const CHART_HEIGHT = 200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] ?? DEFAULT_COLOR;
}

function formatDateAxis(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTooltipTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Custom Tooltip
// ---------------------------------------------------------------------------

function renderTimelineTooltip(props: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
}): ReactNode {
  const { active, payload } = props;
  if (!active || !payload || payload.length === 0) return null;

  const entry = payload[0]?.payload as TimelineEntry | undefined;
  if (!entry) return null;

  const durationMs = entry.durationMin * 60_000;

  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: getStatusColor(entry.status) }}
        />
        <span className="font-medium capitalize text-foreground">{entry.status}</span>
      </div>
      <div className="space-y-0.5 text-muted-foreground">
        <div>
          <span className="text-foreground/70">Started:</span>{' '}
          {formatTooltipTime(entry.startTimestamp)}
        </div>
        <div>
          <span className="text-foreground/70">Duration:</span> {formatDurationMs(durationMs)}
        </div>
        <div>
          <span className="text-foreground/70">Cost:</span> {formatCost(entry.costUsd ?? undefined)}
        </div>
        <div>
          <span className="text-foreground/70">Trigger:</span>{' '}
          <span className="capitalize">{entry.trigger}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RunTimeline({ runs }: RunTimelineProps): React.JSX.Element | null {
  const entries: TimelineEntry[] = useMemo(() => {
    return runs
      .map((run) => {
        const startMs = new Date(run.startedAt).getTime();
        const rawDurationMin = (run.durationMs ?? 0) / 60_000;
        const durationMin = Math.max(rawDurationMin, MIN_BAR_DURATION);

        return {
          id: run.id,
          startTimestamp: startMs,
          durationMin,
          status: run.status,
          trigger: run.trigger ?? 'manual',
          costUsd: run.costUsd ?? null,
          label: formatDateAxis(startMs),
        };
      })
      .slice()
      .sort((a, b) => a.startTimestamp - b.startTimestamp);
  }, [runs]);

  const cellRenderer = useCallback(
    (_entry: TimelineEntry, index: number): React.JSX.Element => {
      const item = entries[index];
      const color = getStatusColor(item?.status ?? 'cancelled');
      const isRunning = item?.status === 'running';

      return (
        <Cell
          key={item?.id ?? index}
          fill={color}
          opacity={0.85}
          className={isRunning ? 'animate-pulse' : ''}
        />
      );
    },
    [entries],
  );

  if (entries.length < 2) return null;

  return (
    <div className="w-full" data-testid="run-timeline">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <BarChart data={entries} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={{ stroke: 'hsl(var(--border))' }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            label={{
              value: 'Duration (min)',
              angle: -90,
              position: 'insideLeft',
              offset: 10,
              style: { fontSize: 10, fill: 'hsl(var(--muted-foreground))' },
            }}
          />
          <Tooltip
            content={renderTimelineTooltip}
            cursor={{ fill: 'hsl(var(--accent))', opacity: 0.3 }}
          />
          <Bar dataKey="durationMin" radius={[3, 3, 0, 0]} maxBarSize={40}>
            {entries.map((entry, idx) => cellRenderer(entry, idx))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
