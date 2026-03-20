import Link from 'next/link';
import type React from 'react';
import { useMemo } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { formatCost, truncate } from '../lib/format-utils';
import { DashboardSectionHeader } from './DashboardSectionHeader';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function getDayLabel(daysAgo: number): string {
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export type DashboardCostOverviewProps = {
  sessionList: {
    id: string;
    agentName: string | null;
    claudeSessionId: string | null;
    startedAt: string;
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
  const last7DaysSessions = useMemo(() => {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    return sessionList.filter((s) => new Date(s.startedAt).getTime() >= cutoff);
  }, [sessionList]);

  const totalCost7d = useMemo(
    () => last7DaysSessions.reduce((sum, s) => sum + (s.metadata?.costUsd ?? 0), 0),
    [last7DaysSessions],
  );

  // Daily totals: index 0 = today, index 6 = 6 days ago
  const dailyTotals = useMemo(() => {
    const snapshotNow = Date.now();
    const totals = Array.from({ length: 7 }, () => 0);
    for (const session of last7DaysSessions) {
      const sessionDate = new Date(session.startedAt);
      const msAgo = snapshotNow - sessionDate.getTime();
      const daysAgo = Math.floor(msAgo / DAY_MS);
      if (daysAgo >= 0 && daysAgo < 7) {
        totals[daysAgo] = (totals[daysAgo] ?? 0) + (session.metadata?.costUsd ?? 0);
      }
    }
    return totals;
  }, [last7DaysSessions]);

  const topSessions = useMemo(
    () =>
      [...last7DaysSessions]
        .filter((s) => (s.metadata?.costUsd ?? 0) > 0)
        .sort((a, b) => (b.metadata?.costUsd ?? 0) - (a.metadata?.costUsd ?? 0))
        .slice(0, 5),
    [last7DaysSessions],
  );

  const maxAgentCost =
    agentCostBreakdown.length > 0 ? (agentCostBreakdown[0]?.totalCostUsd ?? 0) : 0;

  const maxDailyCost = Math.max(...dailyTotals, 0.000001);

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

  if (totalCost7d === 0 && agentCostBreakdown.length === 0) {
    return null;
  }

  return (
    <div className="mt-5 mb-0">
      <DashboardSectionHeader title="Cost Overview" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total cost (last 7 days) + daily trend */}
        <div className="border border-border/50 rounded-lg bg-card p-4 transition-all duration-200 hover:border-border/80 hover:shadow-sm flex flex-col gap-3">
          <div>
            <div className="text-[11px] font-medium text-muted-foreground mb-1">
              Total Cost (Last 7 Days)
            </div>
            <div className="text-2xl font-semibold font-mono text-foreground">
              {formatCost(totalCost7d)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              across {last7DaysSessions.filter((s) => (s.metadata?.costUsd ?? 0) > 0).length}{' '}
              sessions
            </div>
          </div>

          {/* 7d daily trend */}
          <div>
            <div className="text-[11px] font-medium text-muted-foreground mb-2">7d Trend</div>
            <div className="space-y-1">
              {dailyTotals
                .map((cost, daysAgo) => ({ cost, daysAgo }))
                .reverse()
                .map(({ cost, daysAgo }) => {
                  const barPct = (cost / maxDailyCost) * 100;
                  return (
                    <div key={daysAgo} className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground w-16 shrink-0">
                        {getDayLabel(daysAgo)}
                      </span>
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-500/70 transition-all duration-500"
                          style={{ width: cost > 0 ? `${Math.max(barPct, 3)}%` : '0%' }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground w-12 text-right shrink-0">
                        {cost > 0 ? formatCost(cost) : '—'}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
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

        {/* Top 5 most expensive sessions (last 7 days) */}
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
