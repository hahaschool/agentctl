'use client';

import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';

import { ErrorBanner } from '@/components/ErrorBanner';
import { FetchingBar } from '@/components/FetchingBar';
import { RefreshButton } from '@/components/RefreshButton';
import type { SecurityFinding, SecurityFindingSeverity } from '@/lib/api';
import { securityFindingsQuery, securityFindingsSummaryQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

const FINDINGS_LIMIT = 200;

const SEVERITY_ORDER: readonly SecurityFindingSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
] as const;

const SEVERITY_BADGE_CLASSES: Record<SecurityFindingSeverity, string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  low: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  info: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
};

type SeverityFilter = 'all' | SecurityFindingSeverity;

function formatLocation(finding: SecurityFinding): string {
  if (!finding.file) return '—';
  return finding.line ? `${finding.file}:${String(finding.line)}` : finding.file;
}

function formatRelative(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(deltaMs)) return 'unknown';
  if (deltaMs < 0) return 'just now';
  const s = Math.floor(deltaMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

type FindingRowProps = {
  finding: SecurityFinding;
};

export function SecurityFindingRow({ finding }: FindingRowProps): React.JSX.Element {
  return (
    <tr className="border-t border-border hover:bg-accent/5 align-top">
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span
          className={cn(
            'px-2 py-0.5 rounded-sm text-[10px] font-semibold tracking-wide uppercase border',
            SEVERITY_BADGE_CLASSES[finding.severity],
          )}
        >
          {finding.severity}
        </span>
      </td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap font-mono">
        {finding.category}
      </td>
      <td className="px-3 py-2.5 text-xs text-foreground max-w-[360px]">
        <div className="truncate" title={finding.title}>
          {finding.title}
        </div>
        <div
          className="text-[10px] text-muted-foreground truncate mt-0.5"
          title={finding.description}
        >
          {finding.description}
        </div>
      </td>
      <td className="px-3 py-2.5 text-[11px] font-mono text-muted-foreground max-w-[260px]">
        <div className="truncate" title={formatLocation(finding)}>
          {formatLocation(finding)}
        </div>
      </td>
      <td className="px-3 py-2.5 text-xs whitespace-nowrap">
        {finding.acknowledged ? (
          <span className="px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
            Acked
          </span>
        ) : finding.issueCreated ? (
          <span className="px-1.5 py-0.5 rounded-sm bg-blue-500/15 text-blue-400 text-[10px] font-semibold uppercase tracking-wide">
            Issue
          </span>
        ) : (
          <span className="px-1.5 py-0.5 rounded-sm bg-red-500/10 text-red-400 text-[10px] font-semibold uppercase tracking-wide">
            Open
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">
        {formatRelative(finding.createdAt)}
      </td>
    </tr>
  );
}

export function SecurityFindingsPage(): React.JSX.Element {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');

  const listParams = useMemo(
    () => ({
      limit: FINDINGS_LIMIT,
      ...(severityFilter !== 'all' ? { severity: severityFilter } : {}),
    }),
    [severityFilter],
  );

  const findingsQ = useQuery(securityFindingsQuery(listParams));
  const summaryQ = useQuery(securityFindingsSummaryQuery());

  const findings = findingsQ.data?.findings ?? [];
  const total = findingsQ.data?.total ?? 0;
  const summary = summaryQ.data;

  const severityCounts: Record<SecurityFindingSeverity, number> = {
    critical: summary?.critical ?? 0,
    high: summary?.high ?? 0,
    medium: summary?.medium ?? 0,
    low: summary?.low ?? 0,
    info: summary?.info ?? 0,
  };

  return (
    <div className="relative p-4 md:p-6 max-w-[1400px] animate-page-enter">
      <FetchingBar isFetching={findingsQ.isFetching && !findingsQ.isLoading} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <ShieldAlert size={22} className="text-primary" aria-hidden="true" />
          <h1 className="text-[22px] font-semibold tracking-tight">Security Findings</h1>
          {summary !== undefined && (
            <span
              className="px-2 py-0.5 rounded-sm bg-muted text-muted-foreground text-[10px] font-semibold uppercase tracking-wide"
              data-testid="total-badge"
            >
              {summary.total} total
            </span>
          )}
        </div>
        <RefreshButton
          onClick={() => {
            void findingsQ.refetch();
            void summaryQ.refetch();
          }}
          isFetching={findingsQ.isFetching && !findingsQ.isLoading}
        />
      </div>

      {summary !== undefined && (
        <div className="flex items-center gap-2 flex-wrap mb-4" data-testid="summary-badges">
          {SEVERITY_ORDER.map((severity) => {
            const count = severityCounts[severity];
            if (count === 0) return null;
            return (
              <span
                key={severity}
                className={cn(
                  'px-2 py-0.5 rounded-sm text-[10px] font-semibold tracking-wide uppercase border',
                  SEVERITY_BADGE_CLASSES[severity],
                )}
                data-testid={`summary-${severity}`}
              >
                {count} {severity}
              </span>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground mb-4 max-w-[720px]">
        Security findings ingested from agent scans. Each finding includes a severity, category,
        file location and recommendation. Use the filter to scope the list by severity.
      </p>

      {/* Filter */}
      <div className="flex items-center gap-2 mb-3">
        <label
          htmlFor="severity-filter"
          className="text-[11px] uppercase tracking-wide text-muted-foreground"
        >
          Severity
        </label>
        <select
          id="severity-filter"
          data-testid="severity-filter"
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
          className="bg-muted border border-border rounded-md text-xs px-2 py-1 text-foreground"
        >
          <option value="all">All</option>
          {SEVERITY_ORDER.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-muted-foreground ml-auto">
          Showing {findings.length} of {total}
        </span>
      </div>

      {findingsQ.error && (
        <ErrorBanner
          message={`Failed to load findings: ${findingsQ.error.message}`}
          onRetry={() => void findingsQ.refetch()}
          className="mb-4"
        />
      )}

      {findingsQ.isLoading && (
        <div className="space-y-2" data-testid="loading-skeletons">
          {[1, 2, 3, 4].map((k) => (
            <div key={k} className="h-12 bg-muted/30 rounded-md animate-pulse" />
          ))}
        </div>
      )}

      {!findingsQ.isLoading && !findingsQ.error && findings.length === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <p>No security findings.</p>
          <p className="mt-1 text-xs">
            Findings are ingested via <span className="font-mono">POST /api/security/findings</span>{' '}
            from agent scans.
          </p>
        </div>
      )}

      {findings.length > 0 && (
        <div className="border border-border rounded-md overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left" aria-label="Security findings">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Severity</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Title / Description</th>
                  <th className="px-3 py-2 font-medium">File:Line</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((finding) => (
                  <SecurityFindingRow key={finding.id} finding={finding} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
