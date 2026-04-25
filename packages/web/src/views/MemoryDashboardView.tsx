'use client';

import type { MemoryFact, MemoryStats } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useMemo } from 'react';

import { ErrorBanner } from '@/components/ErrorBanner';
import { ActivityFeed } from '@/components/memory/ActivityFeed';
import { KpiCard } from '@/components/memory/KpiCard';
import { MemoryDecayCard } from '@/components/memory/MemoryDecayCard';
import { MissingEmbeddingAlert } from '@/components/memory/MissingEmbeddingAlert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/format-utils';
import { memoryFactsQuery, memoryStatsQuery } from '@/lib/queries';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDistributionPct(count: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((count / total) * 100)}%`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type DistributionBarProps = {
  label: string;
  count: number;
  total: number;
  colorClass: string;
};

function DistributionBar({
  label,
  count,
  total,
  colorClass,
}: DistributionBarProps): React.JSX.Element {
  const pct = total > 0 ? (count / total) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="capitalize text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground">
          {formatNumber(count)}{' '}
          <span className="text-muted-foreground">({formatDistributionPct(count, total)})</span>
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div
          className={`h-full rounded-full transition-[width] ${colorClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

type GrowthTrendProps = {
  trend: ReadonlyArray<{ date: string; count: number }>;
};

function GrowthTrend({ trend }: GrowthTrendProps): React.JSX.Element {
  const max = Math.max(...trend.map((p) => p.count), 1);

  return (
    <div data-testid="growth-trend" className="flex h-16 items-end gap-0.5">
      {trend.map((point) => {
        const heightPct = Math.round((point.count / max) * 100);
        const label = new Date(point.date).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        });
        return (
          <div
            key={point.date}
            title={`${label}: ${point.count}`}
            className="flex flex-1 flex-col items-center justify-end"
          >
            <div
              className="w-full rounded-sm bg-blue-500/70 transition-[height]"
              style={{ height: `${heightPct}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

type ScopeBreakdownProps = {
  byScope: Record<string, number>;
};

function ScopeBreakdown({ byScope }: ScopeBreakdownProps): React.JSX.Element {
  const entries = Object.entries(byScope).sort(([, a], [, b]) => b - a);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);

  const SCOPE_COLORS = [
    'bg-blue-500',
    'bg-purple-500',
    'bg-emerald-500',
    'bg-amber-500',
    'bg-rose-500',
  ];

  if (entries.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground" data-testid="scope-breakdown-empty">
        No scope data.
      </p>
    );
  }

  return (
    <div data-testid="scope-breakdown" className="space-y-2">
      {entries.slice(0, 5).map(([scope, count], idx) => (
        <DistributionBar
          key={scope}
          label={scope}
          count={count}
          total={total}
          colorClass={SCOPE_COLORS[idx % SCOPE_COLORS.length] ?? 'bg-blue-500'}
        />
      ))}
    </div>
  );
}

type EntityBreakdownProps = {
  byEntityType: Record<string, number>;
};

function EntityBreakdown({ byEntityType }: EntityBreakdownProps): React.JSX.Element {
  const entries = Object.entries(byEntityType).sort(([, a], [, b]) => b - a);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);

  const ENTITY_COLORS = [
    'bg-violet-500',
    'bg-cyan-500',
    'bg-orange-500',
    'bg-teal-500',
    'bg-pink-500',
  ];

  if (entries.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground" data-testid="entity-breakdown-empty">
        No entity type data.
      </p>
    );
  }

  return (
    <div data-testid="entity-breakdown" className="space-y-2">
      {entries.slice(0, 6).map(([entityType, count], idx) => (
        <DistributionBar
          key={entityType}
          label={entityType.replace(/_/g, ' ')}
          count={count}
          total={total}
          colorClass={ENTITY_COLORS[idx % ENTITY_COLORS.length] ?? 'bg-violet-500'}
        />
      ))}
    </div>
  );
}

type StrengthDistributionProps = {
  distribution: MemoryStats['strengthDistribution'];
};

function StrengthDistribution({ distribution }: StrengthDistributionProps): React.JSX.Element {
  const total = distribution.active + distribution.decaying + distribution.archived;

  return (
    <div data-testid="strength-distribution" className="space-y-2">
      <DistributionBar
        label="active"
        count={distribution.active}
        total={total}
        colorClass="bg-emerald-500"
      />
      <DistributionBar
        label="decaying"
        count={distribution.decaying}
        total={total}
        colorClass="bg-amber-500"
      />
      <DistributionBar
        label="archived"
        count={distribution.archived}
        total={total}
        colorClass="bg-slate-400"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

// Initial loading state — shown when neither query has returned any data yet.
// Uses card-sized skeletons matching the post-load layout so the page keeps
// its shape instead of flashing blank while the first fetch is in flight.
function InitialLoadingSkeleton(): React.JSX.Element {
  return (
    <div
      className="space-y-6"
      aria-busy="true"
      aria-live="polite"
      data-testid="memory-dashboard-loading"
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Skeleton className="h-64 w-full lg:col-span-2" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}

export function MemoryDashboardView(): React.JSX.Element {
  const statsQuery = useQuery(memoryStatsQuery());
  const recentFactsQuery = useQuery(memoryFactsQuery({ limit: 10 }));

  const stats = statsQuery.data?.stats;
  const isLoading = statsQuery.isLoading;

  const recentItems = useMemo(
    () => (recentFactsQuery.data?.facts ?? []).map((fact) => ({ fact })),
    [recentFactsQuery.data],
  );

  // Surface the first failing required query. Stats is the primary data source,
  // so prefer its error. Facts power the activity feed and are also required.
  const failedQuery = statsQuery.isError
    ? statsQuery
    : recentFactsQuery.isError
      ? recentFactsQuery
      : null;
  const failureMessage = failedQuery?.error
    ? failedQuery.error instanceof Error
      ? failedQuery.error.message
      : String(failedQuery.error)
    : null;

  // Show the full-page skeleton only on the first load, before any data has
  // arrived. Subsequent refetches reuse the already-loaded content and let
  // the inner Card-level skeletons (for isLoading) handle the visual cue.
  const showInitialSkeleton =
    !failedQuery &&
    !statsQuery.data &&
    !recentFactsQuery.data &&
    (statsQuery.isLoading || recentFactsQuery.isLoading);

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Memory Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of your AI agent memory health and activity.
        </p>
      </div>

      <MissingEmbeddingAlert />

      {failureMessage && (
        <ErrorBanner
          message={`Failed to load memory dashboard: ${failureMessage}`}
          onRetry={() => {
            void failedQuery?.refetch();
          }}
        />
      )}

      {showInitialSkeleton && <InitialLoadingSkeleton />}

      {!showInitialSkeleton && !failureMessage && (
        <MemoryDashboardContent
          stats={stats}
          isLoading={isLoading}
          recentItems={recentItems}
          recentFactsLoading={recentFactsQuery.isLoading}
        />
      )}
    </div>
  );
}

type MemoryDashboardContentProps = {
  stats: MemoryStats | undefined;
  isLoading: boolean;
  recentItems: ReadonlyArray<{ fact: MemoryFact }>;
  recentFactsLoading: boolean;
};

function MemoryDashboardContent({
  stats,
  isLoading,
  recentItems,
  recentFactsLoading,
}: MemoryDashboardContentProps): React.JSX.Element {
  return (
    <>
      {/* KPI Cards */}
      <section aria-label="Key performance indicators">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KpiCard
            label="Total Facts"
            value={stats ? formatNumber(stats.totalFacts) : '—'}
            sublabel="across all scopes"
            accent="blue"
            isLoading={isLoading}
          />
          <KpiCard
            label="New This Week"
            value={stats ? formatNumber(stats.newThisWeek) : '—'}
            sublabel="recently added"
            accent="green"
            isLoading={isLoading}
          />
          <KpiCard
            label="Avg Confidence"
            value={stats ? formatConfidence(stats.avgConfidence) : '—'}
            sublabel="weighted average"
            accent="purple"
            isLoading={isLoading}
          />
          <KpiCard
            label="Pending Consolidation"
            value={stats ? formatNumber(stats.pendingConsolidation) : '—'}
            sublabel="need review"
            accent="amber"
            isLoading={isLoading}
          />
        </div>
      </section>

      {/* Growth Trend + Strength Distribution */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Growth Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div
                data-testid="growth-trend-loading"
                className="h-16 animate-pulse rounded bg-muted"
              />
            ) : stats && stats.growthTrend.length > 0 ? (
              <GrowthTrend trend={stats.growthTrend} />
            ) : (
              <p className="py-4 text-sm text-muted-foreground">No trend data available.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Memory Strength</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div data-testid="strength-loading" className="space-y-2">
                {Array.from({ length: 3 }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
                  <div key={i} className="h-5 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : stats ? (
              <StrengthDistribution distribution={stats.strengthDistribution} />
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Scope + Entity Type Breakdown */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">By Scope</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div data-testid="scope-loading" className="space-y-2">
                {Array.from({ length: 3 }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
                  <div key={i} className="h-6 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : stats ? (
              <ScopeBreakdown byScope={stats.byScope} />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">By Entity Type</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div data-testid="entity-loading" className="space-y-2">
                {Array.from({ length: 4 }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
                  <div key={i} className="h-6 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : stats ? (
              <EntityBreakdown byEntityType={stats.byEntityType} />
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity + Memory Decay */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityFeed items={recentItems} isLoading={recentFactsLoading} />
          </CardContent>
        </Card>

        <MemoryDecayCard />
      </div>
    </>
  );
}
