'use client';

import { useQueries } from '@tanstack/react-query';
import Link from 'next/link';
import type React from 'react';
import { useMemo } from 'react';

import { LiveTimeAgo } from '@/components/LiveTimeAgo';
import { Skeleton } from '@/components/ui/skeleton';
import type { Agent, AgentRun } from '@/lib/api';
import { formatCost } from '@/lib/format-utils';
import { agentRunsQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RunWithAgent = AgentRun & { agentName: string; agentId: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAILURE_STATUSES = new Set(['failure', 'error', 'timeout']);

function getRunStatusStyle(status: string): { label: string; className: string } {
  if (status === 'success') {
    return {
      label: 'Success',
      className: 'bg-green-500/10 text-green-500 border border-green-500/20',
    };
  }
  if (FAILURE_STATUSES.has(status)) {
    return {
      label: 'Failed',
      className: 'bg-red-500/10 text-red-500 border border-red-500/20',
    };
  }
  if (status === 'running') {
    return {
      label: 'Running',
      className: 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20',
    };
  }
  if (status === 'empty') {
    return {
      label: 'Empty',
      className: 'bg-muted text-muted-foreground border border-border/50',
    };
  }
  if (status === 'cancelled') {
    return {
      label: 'Cancelled',
      className: 'bg-muted text-muted-foreground border border-border/50',
    };
  }
  return {
    label: status,
    className: 'bg-muted text-muted-foreground border border-border/50',
  };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type DashboardRecentRunsProps = {
  /** Agent list — already fetched by the dashboard parent. */
  agents: Agent[];
  isAgentsLoading: boolean;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const MAX_AGENTS_TO_QUERY = 5;
const MAX_RUNS_TO_SHOW = 5;

export function DashboardRecentRuns({
  agents,
  isAgentsLoading,
}: DashboardRecentRunsProps): React.JSX.Element {
  // Pick the most recently active agents to limit parallel requests
  const activeAgents = useMemo(() => {
    return [...agents]
      .sort((a, b) => {
        const tA = a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0;
        const tB = b.lastRunAt ? new Date(b.lastRunAt).getTime() : 0;
        return tB - tA;
      })
      .slice(0, MAX_AGENTS_TO_QUERY);
  }, [agents]);

  const runQueries = useQueries({
    queries: activeAgents.map((agent) => ({
      ...agentRunsQuery(agent.id),
      select: (runs: AgentRun[]): RunWithAgent[] =>
        runs.map((r) => ({ ...r, agentName: agent.name, agentId: agent.id })),
    })),
  });

  const isLoading = isAgentsLoading || runQueries.some((q) => q.isLoading);

  const recentRuns = useMemo((): RunWithAgent[] => {
    const all: RunWithAgent[] = [];
    for (const q of runQueries) {
      if (q.data) {
        all.push(...q.data);
      }
    }
    return all
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, MAX_RUNS_TO_SHOW);
  }, [runQueries]);

  if (isLoading) {
    return (
      <div className="p-4 bg-card space-y-2" data-testid="recent-runs-skeleton">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={`sk-run-${String(i)}`} className="h-10 rounded-md" />
        ))}
      </div>
    );
  }

  if (recentRuns.length === 0) {
    return (
      <div className="p-6 text-center bg-card">
        <div className="text-[13px] text-muted-foreground">No agent runs yet.</div>
        <Link
          href="/agents"
          className="text-[12px] text-primary font-medium no-underline hover:underline mt-1 block"
        >
          Configure an agent &rarr;
        </Link>
      </div>
    );
  }

  return (
    <>
      {recentRuns.map((run, idx) => {
        const style = getRunStatusStyle(run.status);
        return (
          <Link
            key={run.id}
            href={`/agents/${run.agentId}`}
            className={cn(
              'flex items-center justify-between px-4 py-2.5 bg-card no-underline transition-all duration-200 hover:bg-accent/10 hover:pl-5',
              idx > 0 && 'border-t border-border',
            )}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded', style.className)}
              >
                {style.label}
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-foreground truncate">
                  {run.agentName}
                </div>
                {run.prompt && (
                  <div className="text-[11px] text-muted-foreground truncate max-w-[180px]">
                    {run.prompt}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 text-[11px] text-muted-foreground">
              {typeof run.costUsd === 'number' && run.costUsd > 0 && (
                <span className="font-mono text-foreground">{formatCost(run.costUsd)}</span>
              )}
              <LiveTimeAgo date={run.startedAt} />
            </div>
          </Link>
        );
      })}
    </>
  );
}
