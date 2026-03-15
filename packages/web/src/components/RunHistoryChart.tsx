'use client';

import Link from 'next/link';
import type React from 'react';
import { useMemo } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { AgentRun } from '@/lib/api';
import { formatCost, formatDurationMs } from '@/lib/format-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunHistoryChartProps = {
  runs: AgentRun[];
  /** Optional callback when a run bar is clicked; receives the run ID */
  onRunClick?: (runId: string) => void;
};

type TimelineEntry = {
  id: string;
  status: string;
  trigger: string;
  startedAt: string;
  startedAtLabel: string;
  durationMs: number;
  durationHeightPct: number;
  costUsd: number | null;
  sessionId?: string | null;
};

type TimelineTone = {
  barClassName: string;
  dotClassName: string;
  label: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RUNS = 30;
const MIN_DURATION_HEIGHT = 22;
const MAX_DURATION_HEIGHT = 100;

const STATUS_TONES: Record<string, TimelineTone> = {
  success: {
    barClassName: 'bg-emerald-500/20 border-emerald-500/40',
    dotClassName: 'bg-emerald-500/70',
    label: 'Success',
  },
  failure: {
    barClassName: 'bg-red-500/20 border-red-500/40',
    dotClassName: 'bg-red-500/70',
    label: 'Failure',
  },
  error: {
    barClassName: 'bg-red-500/20 border-red-500/40',
    dotClassName: 'bg-red-500/70',
    label: 'Error',
  },
  timeout: {
    barClassName: 'bg-red-500/20 border-red-500/40',
    dotClassName: 'bg-red-500/70',
    label: 'Timeout',
  },
  running: {
    barClassName: 'bg-emerald-500/20 border-emerald-500/40',
    dotClassName: 'bg-emerald-500/70',
    label: 'Running',
  },
  empty: {
    barClassName: 'bg-neutral-500/20 border-neutral-500/40',
    dotClassName: 'bg-neutral-500/70',
    label: 'Empty',
  },
  cancelled: {
    barClassName: 'bg-neutral-500/20 border-neutral-500/40',
    dotClassName: 'bg-neutral-500/70',
    label: 'Cancelled',
  },
};

const DEFAULT_TONE: TimelineTone = {
  barClassName: 'bg-neutral-500/20 border-neutral-500/40',
  dotClassName: 'bg-neutral-500/70',
  label: 'Unknown',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAxisDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTooltipDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getTone(status: string): TimelineTone {
  return STATUS_TONES[status] ?? DEFAULT_TONE;
}

function formatTrigger(trigger: string): string {
  if (!trigger.trim()) return 'Manual';
  return `${trigger.charAt(0).toUpperCase()}${trigger.slice(1)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RunHistoryChart({
  runs,
  onRunClick,
}: RunHistoryChartProps): React.JSX.Element | null {
  const entries = useMemo<TimelineEntry[]>(() => {
    const recent = runs
      .slice(0, MAX_RUNS)
      .slice()
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

    if (recent.length === 0) {
      return [];
    }

    const maxDurationMs = Math.max(
      ...recent.map((run) => run.durationMs ?? 0),
      MIN_DURATION_HEIGHT,
    );

    return recent.map((run) => {
      const durationMs = run.durationMs ?? 0;
      const proportionalHeight = Math.round((durationMs / maxDurationMs) * MAX_DURATION_HEIGHT);
      const durationHeightPct = Math.min(
        MAX_DURATION_HEIGHT,
        Math.max(proportionalHeight, MIN_DURATION_HEIGHT),
      );

      return {
        id: run.id,
        status: run.status,
        trigger: run.trigger ?? 'manual',
        startedAt: run.startedAt,
        startedAtLabel: formatAxisDate(run.startedAt),
        durationMs,
        durationHeightPct,
        costUsd: run.costUsd ?? null,
        sessionId: run.sessionId,
      };
    });
  }, [runs]);

  if (entries.length === 0) {
    return null;
  }

  const successCount = entries.filter((entry) => entry.status === 'success').length;
  const successRate = Math.round((successCount / entries.length) * 100);
  const firstDate = entries[0]?.startedAtLabel;
  const lastDate = entries[entries.length - 1]?.startedAtLabel;

  return (
    <div className="mb-4" data-testid="run-history-timeline">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">Run Timeline</span>
        <span className="text-[11px] text-muted-foreground">
          {successRate}% success ({entries.length} runs)
        </span>
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
        <div className="relative h-24">
          <div className="absolute inset-x-0 bottom-0 border-t border-border/60" />
          <div className="flex h-full items-end gap-1 overflow-x-auto pb-1">
            {entries.map((entry) => {
              const tone = getTone(entry.status);
              const sessionLink = entry.sessionId ? `/sessions/${entry.sessionId}` : null;
              return (
                <Tooltip key={entry.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Run ${entry.id} (${entry.status})`}
                      onClick={() => onRunClick?.(entry.id)}
                      className={`min-w-3 flex-1 rounded-sm border transition-colors hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${tone.barClassName} ${
                        entry.status === 'running' ? 'animate-pulse' : ''
                      }`}
                      style={{ height: `${entry.durationHeightPct}%` }}
                    />
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    align="center"
                    className="max-w-xs border-border bg-popover text-xs"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${tone.dotClassName}`} />
                        <span className="font-medium text-foreground">{tone.label}</span>
                      </div>
                      <div className="space-y-0.5 text-muted-foreground">
                        <div>
                          <span className="text-foreground/80">Time:</span>{' '}
                          {formatTooltipDate(entry.startedAt)}
                        </div>
                        <div>
                          <span className="text-foreground/80">Duration:</span>{' '}
                          {formatDurationMs(entry.durationMs)}
                        </div>
                        <div>
                          <span className="text-foreground/80">Cost:</span>{' '}
                          {formatCost(entry.costUsd ?? undefined)}
                        </div>
                        <div>
                          <span className="text-foreground/80">Trigger:</span>{' '}
                          {formatTrigger(entry.trigger)}
                        </div>
                        {sessionLink && (
                          <div>
                            <span className="text-foreground/80">Session:</span>{' '}
                            <Link
                              href={sessionLink}
                              className="text-primary underline underline-offset-2"
                            >
                              Open session
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
          <span>{firstDate}</span>
          <span>{lastDate}</span>
        </div>
      </div>
    </div>
  );
}
