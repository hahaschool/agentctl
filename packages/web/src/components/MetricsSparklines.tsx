'use client';

import type React from 'react';
import { useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

import type { MetricsSample } from '../lib/use-metrics-history';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SparklineCardProps = {
  title: string;
  data: Array<{ value: number }>;
  formatValue?: (v: number) => string;
};

type MetricsSparklinesProps = {
  history: MetricsSample[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHART_HEIGHT = 80;
const FILL_COLOR = '#3b82f6';
const FILL_OPACITY = 0.15;

// ---------------------------------------------------------------------------
// SparklineCard — a single titled area chart
// ---------------------------------------------------------------------------

function SparklineCard({ title, data, formatValue }: SparklineCardProps): React.JSX.Element {
  const latestValue = data.at(-1)?.value ?? 0;
  const displayValue = formatValue ? formatValue(latestValue) : String(latestValue);

  if (data.length < 2) {
    return (
      <div className="flex flex-col gap-1.5 bg-card border border-border/50 rounded-lg p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            {title}
          </span>
        </div>
        <div
          className="flex items-center justify-center text-[11px] text-muted-foreground"
          style={{ height: CHART_HEIGHT }}
        >
          Collecting data...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 bg-card border border-border/50 rounded-lg p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </span>
        <span className="text-[13px] font-mono font-semibold text-foreground tabular-nums">
          {displayValue}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`sparkGrad-${title}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={FILL_COLOR} stopOpacity={FILL_OPACITY * 2} />
              <stop offset="95%" stopColor={FILL_COLOR} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={FILL_COLOR}
            strokeWidth={1.5}
            fill={`url(#sparkGrad-${title})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetricsSparklines — 3-chart panel rendered below stat cards
// ---------------------------------------------------------------------------

export function MetricsSparklines({ history }: MetricsSparklinesProps): React.JSX.Element {
  // Active agents — raw value per sample
  const activeAgentsData = useMemo(
    () => history.map((s) => ({ value: s.agentctl_agents_active ?? 0 })),
    [history],
  );

  // Run rate — delta of total runs between consecutive samples
  const runRateData = useMemo(() => {
    return history.map((s, i) => {
      if (i === 0) return { value: 0 };
      const prev = history[i - 1];
      const delta = (s.agentctl_runs_total ?? 0) - (prev?.agentctl_runs_total ?? 0);
      return { value: Math.max(0, delta) };
    });
  }, [history]);

  // HTTP requests/min — derive from http_request_duration_seconds_count delta
  const httpRateData = useMemo(() => {
    const key = 'http_request_duration_seconds_count';
    const hasHttpMetric = history.some((s) => key in s);
    if (!hasHttpMetric) return [] as Array<{ value: number }>;

    return history.map((s, i) => {
      if (i === 0) return { value: 0 };
      const prev = history[i - 1];
      const deltaCount = (s[key] ?? 0) - (prev?.[key] ?? 0);
      const deltaSec = (s.ts - (prev?.ts ?? s.ts)) / 1000 || 1;
      const perMin = Math.max(0, (deltaCount / deltaSec) * 60);
      return { value: Math.round(perMin) };
    });
  }, [history]);

  const showHttpChart = httpRateData.length >= 2;

  return (
    <div
      className={`grid grid-cols-1 ${showHttpChart ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-3 mb-5`}
      data-testid="metrics-sparklines"
    >
      <SparklineCard title="Active Agents" data={activeAgentsData} />
      <SparklineCard title="Run Rate" data={runRateData} />
      {showHttpChart && (
        <SparklineCard title="Requests/min" data={httpRateData} formatValue={(v) => v.toFixed(0)} />
      )}
    </div>
  );
}
