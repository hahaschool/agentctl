'use client';

import type { MemoryStats } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import { Brain } from 'lucide-react';
import Link from 'next/link';
import type React from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { memoryStatsQuery } from '@/lib/queries';

// ---------------------------------------------------------------------------
// DashboardMemoryCard — memory health summary for the main dashboard
// ---------------------------------------------------------------------------

export function DashboardMemoryCard(): React.JSX.Element {
  const { data, isLoading, error } = useQuery(memoryStatsQuery());
  const stats = data?.stats;

  if (isLoading) {
    return (
      <div
        className="border border-border/50 rounded-lg bg-card p-4 space-y-3"
        data-testid="dashboard-memory-card-loading"
      >
        <Skeleton className="h-4 w-28" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={`sk-stat-${String(i)}`} className="h-12 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div
        className="border border-border/50 rounded-lg bg-card p-4"
        data-testid="dashboard-memory-card-error"
      >
        <div className="flex items-center gap-2 mb-1">
          <Brain className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-[13px] font-medium text-foreground">Memory Health</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {error ? 'Could not load memory stats.' : 'No data available.'}
        </p>
      </div>
    );
  }

  return (
    <MemoryCardContent stats={stats} />
  );
}

function MemoryCardContent({ stats }: { stats: MemoryStats }): React.JSX.Element {
  const sparklineMax = Math.max(
    1,
    ...stats.growthTrend.map((p) => p.count),
  );
  const recentPoints = stats.growthTrend.slice(-7);

  return (
    <Link
      href="/memory/dashboard"
      className={cn(
        'block border border-border/50 rounded-lg bg-card p-4 no-underline',
        'transition-all duration-200 hover:border-border/80 hover:shadow-sm hover:bg-accent/5',
      )}
      data-testid="dashboard-memory-card"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" aria-hidden="true" />
          <span className="text-[13px] font-semibold text-foreground">Memory Health</span>
        </div>
        <span className="text-[10px] text-muted-foreground">→ full view</span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-3">
        <StatItem
          label="Total Facts"
          value={String(stats.totalFacts)}
          accent="blue"
        />
        <StatItem
          label="New This Week"
          value={`+${stats.newThisWeek}`}
          accent="green"
        />
        <StatItem
          label="Avg Confidence"
          value={`${Math.round(stats.avgConfidence * 100)}%`}
          accent={stats.avgConfidence >= 0.8 ? 'green' : stats.avgConfidence >= 0.5 ? 'yellow' : 'red'}
        />
        <StatItem
          label="Pending Review"
          value={String(stats.pendingConsolidation)}
          accent={stats.pendingConsolidation > 10 ? 'red' : stats.pendingConsolidation > 0 ? 'yellow' : 'green'}
        />
      </div>

      {/* Sparkline */}
      {recentPoints.length >= 2 && (
        <div
          className="flex items-end gap-0.5 h-8"
          aria-label="Growth trend sparkline"
          data-testid="memory-sparkline"
        >
          {recentPoints.map((point, i) => {
            const heightPct = Math.max(0.1, point.count / sparklineMax);
            return (
              <div
                key={`sp-${String(i)}`}
                className="flex-1 bg-primary/30 rounded-sm transition-all"
                style={{ height: `${Math.round(heightPct * 100)}%` }}
                title={`${point.date}: ${point.count}`}
              />
            );
          })}
        </div>
      )}
    </Link>
  );
}

function StatItem({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: 'blue' | 'green' | 'yellow' | 'red';
}): React.JSX.Element {
  const valueClass =
    accent === 'blue'
      ? 'text-blue-500 dark:text-blue-400'
      : accent === 'green'
        ? 'text-emerald-500 dark:text-emerald-400'
        : accent === 'yellow'
          ? 'text-amber-500 dark:text-amber-400'
          : 'text-red-500 dark:text-red-400';

  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn('text-[15px] font-mono font-semibold tabular-nums', valueClass)}>
        {value}
      </div>
    </div>
  );
}
