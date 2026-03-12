'use client';

import type React from 'react';
import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { AgentRun } from '@/lib/api';
import { formatCost, formatDurationMs } from '@/lib/format-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunHistoryChartProps = {
  runs: AgentRun[];
  /** Optional callback when a bar is clicked; receives the run ID */
  onRunClick?: (runId: string) => void;
};

type ChartEntry = {
  id: string;
  index: number;
  durationMin: number;
  status: string;
  costUsd: number | null;
  dateLabel: string;
  startedAt: string;
  sessionId?: string | null;
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
  running: '#eab308',
};

const DEFAULT_COLOR = '#6b7280';
const MIN_BAR_DURATION = 0.3;
const CHART_HEIGHT = 48;
const MAX_RUNS = 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] ?? DEFAULT_COLOR;
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTooltipDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Custom Tooltip
// ---------------------------------------------------------------------------

function renderChartTooltip(props: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
}): ReactNode {
  const { active, payload } = props;
  if (!active || !payload || payload.length === 0) return null;

  const entry = payload[0]?.payload as ChartEntry | undefined;
  if (!entry) return null;

  const durationMs = entry.durationMin * 60_000;

  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg z-50">
      <div className="flex items-center gap-2 mb-1">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: getStatusColor(entry.status) }}
        />
        <span className="font-medium capitalize text-foreground">{entry.status}</span>
      </div>
      <div className="space-y-0.5 text-muted-foreground">
        <div>
          <span className="text-foreground/70">Date:</span> {formatTooltipDate(entry.startedAt)}
        </div>
        <div>
          <span className="text-foreground/70">Duration:</span> {formatDurationMs(durationMs)}
        </div>
        <div>
          <span className="text-foreground/70">Cost:</span> {formatCost(entry.costUsd ?? undefined)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RunHistoryChart({
  runs,
  onRunClick,
}: RunHistoryChartProps): React.JSX.Element | null {
  const entries: ChartEntry[] = useMemo(() => {
    const recent = runs.slice(0, MAX_RUNS);
    return recent
      .map((run, idx) => {
        const rawDurationMin = (run.durationMs ?? 0) / 60_000;
        return {
          id: run.id,
          index: idx,
          durationMin: Math.max(rawDurationMin, MIN_BAR_DURATION),
          status: run.status,
          costUsd: run.costUsd ?? null,
          dateLabel: formatShortDate(run.startedAt),
          startedAt: run.startedAt,
          sessionId: run.sessionId,
        };
      })
      .reverse();
  }, [runs]);

  const handleBarClick = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: recharts BarRectangleItem merges data fields at runtime
    (data: any) => {
      const id = (data as ChartEntry | undefined)?.id;
      if (id) {
        onRunClick?.(id);
      }
    },
    [onRunClick],
  );

  if (entries.length === 0) return null;

  const successCount = entries.filter((e) => e.status === 'success').length;
  const successRate = Math.round((successCount / entries.length) * 100);

  return (
    <div className="mb-4" data-testid="run-history-bar">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Run History</span>
        <span className="text-[11px] text-muted-foreground">
          {successRate}% success ({entries.length} runs)
        </span>
      </div>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <BarChart data={entries} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <XAxis dataKey="dateLabel" hide />
          <YAxis hide />
          <Tooltip
            content={renderChartTooltip}
            cursor={{ fill: 'hsl(var(--accent))', opacity: 0.2 }}
          />
          <Bar
            dataKey="durationMin"
            radius={[2, 2, 0, 0]}
            maxBarSize={16}
            onClick={handleBarClick}
            className="cursor-pointer"
          >
            {entries.map((entry) => (
              <Cell
                key={entry.id}
                fill={getStatusColor(entry.status)}
                opacity={0.85}
                className={entry.status === 'running' ? 'animate-pulse' : ''}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
