import Link from 'next/link';
import type React from 'react';
import { useMemo } from 'react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';

import { Skeleton } from '@/components/ui/skeleton';
import { formatCost, truncate } from '../lib/format-utils';
import { DashboardSectionHeader } from './DashboardSectionHeader';

export type DashboardCostOverviewProps = {
  sessionList: {
    id: string;
    agentName: string | null;
    claudeSessionId: string | null;
    startedAt?: string | null;
    metadata: { costUsd?: number; [key: string]: unknown };
  }[];
  agentCostBreakdown: { id: string; name: string; totalCostUsd: number }[];
  isLoading: boolean;
};

export function DashboardCostOverview({
  sessionList,
  agentCostBreakdown,
  isLoading,
}: DashboardCostOverviewProps): React.ReactNode {
  const totalCost = useMemo(
    () => sessionList.reduce((sum, s) => sum + (s.metadata?.costUsd ?? 0), 0),
    [sessionList],
  );

  const topSessions = useMemo(
    () =>
      [...sessionList]
        .filter((s) => (s.metadata?.costUsd ?? 0) > 0)
        .sort((a, b) => (b.metadata?.costUsd ?? 0) - (a.metadata?.costUsd ?? 0))
        .slice(0, 5),
    [sessionList],
  );

  const maxAgentCost =
    agentCostBreakdown.length > 0 ? (agentCostBreakdown[0]?.totalCostUsd ?? 0) : 0;

  const dailyCostTrend = useMemo(() => {
    const days: Array<{ key: string; label: string; costUsd: number }> = [];
    const now = new Date();

    for (let offset = 6; offset >= 0; offset--) {
      const day = new Date(now);
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - offset);
      const key = day.toISOString().slice(0, 10);
      const label = day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      days.push({ key, label, costUsd: 0 });
    }

    const byDay = new Map(days.map((d) => [d.key, d]));
    for (const session of sessionList) {
      if (!session.startedAt) continue;
      const costUsd = session.metadata?.costUsd ?? 0;
      if (costUsd <= 0) continue;

      const dayKey = new Date(session.startedAt).toISOString().slice(0, 10);
      const bucket = byDay.get(dayKey);
      if (bucket) {
        bucket.costUsd += costUsd;
      }
    }

    return days;
  }, [sessionList]);

  if (isLoading) {
    return (
      <div className="mt-5 mb-0" data-testid="cost-overview-skeleton">
        <DashboardSectionHeader title="Cost Overview" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={`sk-${String(i)}`} className="h-32 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (totalCost === 0 && agentCostBreakdown.length === 0) {
    return null;
  }

  return (
    <div className="mt-5 mb-0">
      <DashboardSectionHeader title="Cost Overview" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total cost */}
        <div className="border border-border/50 rounded-lg bg-card p-4 transition-all duration-200 hover:border-border/80 hover:shadow-sm flex flex-col justify-center">
          <div className="text-[11px] font-medium text-muted-foreground mb-1">
            Total Session Cost
          </div>
          <div className="text-2xl font-semibold font-mono text-foreground">
            {formatCost(totalCost)}
          </div>
          <div className="mt-2 h-12" data-testid="cost-trend-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyCostTrend} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <Line
                  type="monotone"
                  dataKey="costUsd"
                  stroke="#22c55e"
                  strokeWidth={1.75}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            across {sessionList.filter((s) => (s.metadata?.costUsd ?? 0) > 0).length} sessions
          </div>
          <div className="text-[10px] text-muted-foreground">7-day daily trend</div>
        </div>

        {/* Bar chart: cost per agent */}
        <div className="border border-border/50 rounded-lg bg-card p-4 transition-all duration-200 hover:border-border/80 hover:shadow-sm">
          <div className="text-[11px] font-medium text-muted-foreground mb-3">Cost by Agent</div>
          {agentCostBreakdown.length > 0 ? (
            <div className="space-y-2">
              {agentCostBreakdown.map((agent) => {
                const pct = maxAgentCost > 0 ? (agent.totalCostUsd / maxAgentCost) * 100 : 0;
                return (
                  <Link
                    key={agent.id}
                    href={`/agents/${agent.id}`}
                    className="block no-underline group"
                  >
                    <div className="flex justify-between items-center text-[11px] mb-0.5">
                      <span className="text-foreground truncate max-w-[140px] group-hover:text-primary transition-colors">
                        {agent.name}
                      </span>
                      <span className="font-mono text-muted-foreground shrink-0 ml-2">
                        {formatCost(agent.totalCostUsd)}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-green-600 to-green-400 transition-all duration-500"
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="text-[12px] text-muted-foreground">No agent cost data yet</div>
          )}
        </div>

        {/* Top 5 most expensive sessions */}
        <div className="border border-border/50 rounded-lg bg-card p-4 transition-all duration-200 hover:border-border/80 hover:shadow-sm">
          <div className="text-[11px] font-medium text-muted-foreground mb-3">
            Most Expensive Sessions
          </div>
          {topSessions.length > 0 ? (
            <div className="space-y-1.5">
              {topSessions.map((session, idx) => (
                <Link
                  key={session.id}
                  href={`/sessions/${session.id}`}
                  className="flex items-center justify-between no-underline hover:bg-accent/10 rounded px-1.5 py-1 -mx-1.5 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] text-muted-foreground font-mono w-4 shrink-0">
                      #{idx + 1}
                    </span>
                    <span className="text-[12px] text-foreground truncate">
                      {truncate(
                        session.agentName ??
                          (session.claudeSessionId
                            ? `Session ${session.claudeSessionId.slice(0, 8)}`
                            : `Session ${session.id.slice(0, 8)}`),
                        24,
                      )}
                    </span>
                  </div>
                  <span className="text-[12px] font-mono text-green-600 dark:text-green-400 shrink-0 ml-2">
                    {formatCost(session.metadata?.costUsd ?? 0)}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-[12px] text-muted-foreground">No session cost data yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
