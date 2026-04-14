'use client';

import {
  AlertTriangleIcon,
  FileXIcon,
  FolderSearchIcon,
  LayersIcon,
  Loader2Icon,
  SparklesIcon,
  TimerIcon,
  Wand2Icon,
} from 'lucide-react';
import Link from 'next/link';
import type React from 'react';
import { type ReactNode, useCallback, useState } from 'react';

import { ScopeSelector } from '@/components/memory/ScopeSelector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  MemoryMaintenanceCoverageGap,
  MemoryMaintenanceCoverageReport,
  MemoryMaintenanceDeletedFileEntry,
  MemoryMaintenanceResponse,
  MemoryMaintenanceResult,
  MemoryMaintenanceStaleEntry,
  MemoryMaintenanceSynthesisCluster,
} from '@/lib/api';
import { useRunMemoryMaintenance } from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCOPE_OPTIONS = ['all', 'project:agentctl', 'global'] as const;
const FACT_PREVIEW_LIMIT = 200;
const MAX_GAPS_DISPLAYED = 25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(content: string, max = FACT_PREVIEW_LIMIT): string {
  if (content.length <= max) return content;
  return `${content.slice(0, max).trimEnd()}…`;
}

function factBrowserHref(factId: string): string {
  const params = new URLSearchParams({ q: factId });
  return `/memory/browser?${params.toString()}`;
}

function totalFindings(result: MemoryMaintenanceResult | null): number {
  if (!result) return 0;
  return (
    result.staleEntries.length +
    result.deletedFileEntries.length +
    result.synthesisClusters.length +
    result.coverageReport.gapCount
  );
}

// ---------------------------------------------------------------------------
// FactLink — drill-down anchor for a fact id
// ---------------------------------------------------------------------------

function FactLink({ factId }: { factId: string }): React.JSX.Element {
  return (
    <Link
      href={factBrowserHref(factId)}
      className="font-mono text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
    >
      {factId.slice(0, 8)}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// CollapsibleSection — native <details>, keyed on section id
// ---------------------------------------------------------------------------

type SectionTone = 'stale' | 'deleted' | 'cluster' | 'gap';

function CollapsibleSection({
  id,
  title,
  description,
  count,
  icon,
  tone,
  defaultOpen,
  children,
}: {
  id: string;
  title: string;
  description: string;
  count: number;
  icon: React.JSX.Element;
  tone: SectionTone;
  defaultOpen?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const toneClass =
    tone === 'stale'
      ? 'border-sky-500/40'
      : tone === 'deleted'
        ? 'border-rose-500/40'
        : tone === 'cluster'
          ? 'border-primary/40'
          : 'border-amber-500/40';

  return (
    <details
      id={`maintenance-${id}`}
      open={defaultOpen}
      className={cn('group overflow-hidden rounded-lg border bg-card transition-colors', toneClass)}
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 outline-none hover:bg-accent/10 focus-visible:ring-1 focus-visible:ring-ring"
        aria-label={`${title} — ${count} items`}
      >
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground',
            'group-open:text-foreground',
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{title}</span>
            <Badge variant="outline" className="tabular-nums">
              {count}
            </Badge>
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span>
        </span>
        <span
          aria-hidden="true"
          className="text-xs text-muted-foreground transition-transform group-open:rotate-90"
        >
          ▸
        </span>
      </summary>
      <div className="border-t border-border px-4 py-3">{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Result sections
// ---------------------------------------------------------------------------

function StaleEntriesSection({
  items,
}: {
  items: readonly MemoryMaintenanceStaleEntry[];
}): React.JSX.Element {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">No stale path references.</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((entry) => (
        <li
          key={entry.factId}
          className="rounded-md border border-border bg-background/40 px-3 py-2 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <FactLink factId={entry.factId} />
            <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
              {entry.reason}
            </span>
          </div>
          <p className="mt-1.5 font-mono text-[11px] leading-snug text-foreground">
            {truncate(entry.content)}
          </p>
          {entry.referencedPaths.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {entry.referencedPaths.map((path) => (
                <code
                  key={`${entry.factId}-${path}`}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                >
                  {path}
                </code>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function DeletedFileEntriesSection({
  items,
}: {
  items: readonly MemoryMaintenanceDeletedFileEntry[];
}): React.JSX.Element {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">No facts reference deleted files.</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((entry) => (
        <li
          key={`${entry.factId}-${entry.deletedFile}`}
          className="rounded-md border border-border bg-background/40 px-3 py-2 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <FactLink factId={entry.factId} />
            <code className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-rose-500 dark:text-rose-400">
              {entry.deletedFile}
            </code>
          </div>
          <p className="mt-1.5 font-mono text-[11px] leading-snug text-foreground">
            {truncate(entry.content)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function SynthesisClustersSection({
  clusters,
}: {
  clusters: readonly MemoryMaintenanceSynthesisCluster[];
}): React.JSX.Element {
  if (clusters.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No clusters of 3+ related facts surfaced by the knowledge graph.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {clusters.map((cluster) => (
        <li
          key={cluster.seedFactId}
          className="rounded-md border border-border bg-background/40 px-3 py-2"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Seed</span>
            <FactLink factId={cluster.seedFactId} />
            <Badge variant="outline" className="ml-auto tabular-nums text-[10px]">
              {cluster.factIds.length} facts
            </Badge>
          </div>
          <p className="mt-1.5 text-xs leading-snug text-foreground">{cluster.proposedPrinciple}</p>
          {cluster.factIds.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cluster.factIds.map((factId) => (
                <FactLink key={`${cluster.seedFactId}-${factId}`} factId={factId} />
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function CoverageGapsSection({
  report,
}: {
  report: MemoryMaintenanceCoverageReport;
}): React.JSX.Element {
  const visibleGaps: readonly MemoryMaintenanceCoverageGap[] = report.gaps.slice(
    0,
    MAX_GAPS_DISPLAYED,
  );
  const hiddenCount = report.gaps.length - visibleGaps.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span>
          <span className="font-medium tabular-nums text-foreground">
            {report.totalDirectories}
          </span>{' '}
          directories scanned
        </span>
        <span>
          <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
            {report.coveredCount}
          </span>{' '}
          covered
        </span>
        <span>
          <span className="font-medium tabular-nums text-amber-600 dark:text-amber-400">
            {report.gapCount}
          </span>{' '}
          gaps
        </span>
      </div>
      {visibleGaps.length === 0 ? (
        <p className="text-xs text-muted-foreground">No coverage gaps detected.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
          {visibleGaps.map((gap) => (
            <li
              key={gap.directory}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs"
            >
              <code className="truncate font-mono text-[11px] text-foreground">
                {gap.directory}
              </code>
              <Badge variant="outline" className="shrink-0 tabular-nums text-[10px]">
                {gap.factCount}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {hiddenCount > 0 ? (
        <p className="text-[11px] text-muted-foreground">…and {hiddenCount} more gaps not shown.</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary strip
// ---------------------------------------------------------------------------

function ResultSummary({ result }: { result: MemoryMaintenanceResult }): React.JSX.Element {
  const stats: Array<{ label: string; value: number; tone: string }> = [
    {
      label: 'stale',
      value: result.staleEntries.length,
      tone: 'text-sky-600 dark:text-sky-400',
    },
    {
      label: 'deleted-file refs',
      value: result.deletedFileEntries.length,
      tone: 'text-rose-600 dark:text-rose-400',
    },
    {
      label: 'clusters',
      value: result.synthesisClusters.length,
      tone: 'text-primary',
    },
    {
      label: 'coverage gaps',
      value: result.coverageReport.gapCount,
      tone: 'text-amber-600 dark:text-amber-400',
    },
    {
      label: 'new consolidation items',
      value: result.consolidationItems.length,
      tone: 'text-muted-foreground',
    },
  ];
  return (
    <div
      aria-live="polite"
      className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-card px-4 py-2 text-xs"
    >
      {stats.map((stat) => (
        <span key={stat.label} className="flex items-center gap-1.5">
          <span className={cn('font-medium tabular-nums', stat.tone)}>{stat.value}</span>
          <span className="text-muted-foreground">{stat.label}</span>
        </span>
      ))}
      {result.report?.id ? (
        <span className="ml-auto text-[11px] text-muted-foreground">
          Saved report{' '}
          <Link
            href={`/memory/reports?reportId=${encodeURIComponent(result.report.id)}`}
            className="font-mono underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            {result.report.id.slice(0, 8)}
          </Link>
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function MemoryMaintenancePage(): React.JSX.Element {
  const [scope, setScope] = useState<string>('all');
  const [result, setResult] = useState<MemoryMaintenanceResult | null>(null);

  const runMaintenance = useRunMemoryMaintenance();

  const handleRun = useCallback(() => {
    const scopeParam = scope === 'all' ? undefined : scope;
    runMaintenance.mutate(
      { scope: scopeParam },
      {
        onSuccess: (data: MemoryMaintenanceResponse) => {
          setResult(data.result);
        },
      },
    );
  }, [runMaintenance, scope]);

  const hasResult = result !== null;
  const findingTotal = totalFindings(result);

  return (
    <div className="flex flex-col gap-6 p-6 md:p-8">
      {/* Page header */}
      <div>
        <h1 className="text-lg font-semibold">Knowledge Maintenance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Run a maintenance sweep across memory: stale path references, facts about deleted files,
          knowledge-graph synthesis clusters, and directory coverage gaps. Results are saved as a
          memory report and may enqueue consolidation items for review.
        </p>
      </div>

      {/* Controls */}
      <section aria-label="Maintenance parameters" className="flex flex-wrap items-end gap-4">
        <ScopeSelector value={scope} options={SCOPE_OPTIONS} onValueChange={setScope} />
        <Button
          onClick={handleRun}
          disabled={runMaintenance.isPending}
          aria-label="Run memory maintenance"
        >
          {runMaintenance.isPending ? (
            <>
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
              Running maintenance…
            </>
          ) : (
            <>
              <Wand2Icon className="size-4" aria-hidden="true" />
              Run maintenance
            </>
          )}
        </Button>
        {runMaintenance.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Failed to run maintenance. Try again in a moment.
          </p>
        ) : null}
      </section>

      {/* Summary */}
      {hasResult ? <ResultSummary result={result} /> : null}

      {/* Result sections */}
      {hasResult ? (
        <div className="flex flex-col gap-3">
          <CollapsibleSection
            id="stale-entries"
            title="Stale path references"
            description="Facts referencing files that no longer exist on disk"
            count={result.staleEntries.length}
            icon={<TimerIcon className="size-4" aria-hidden="true" />}
            tone="stale"
            defaultOpen={result.staleEntries.length > 0}
          >
            <StaleEntriesSection items={result.staleEntries} />
          </CollapsibleSection>

          <CollapsibleSection
            id="deleted-files"
            title="Deleted-file references"
            description="Facts mentioning files removed from git history"
            count={result.deletedFileEntries.length}
            icon={<FileXIcon className="size-4" aria-hidden="true" />}
            tone="deleted"
            defaultOpen={result.deletedFileEntries.length > 0}
          >
            <DeletedFileEntriesSection items={result.deletedFileEntries} />
          </CollapsibleSection>

          <CollapsibleSection
            id="synthesis-clusters"
            title="Synthesis clusters"
            description="Groups of 3+ related facts suitable for higher-level principles"
            count={result.synthesisClusters.length}
            icon={<LayersIcon className="size-4" aria-hidden="true" />}
            tone="cluster"
            defaultOpen={result.synthesisClusters.length > 0}
          >
            <SynthesisClustersSection clusters={result.synthesisClusters} />
          </CollapsibleSection>

          <CollapsibleSection
            id="coverage-gaps"
            title="Coverage gaps"
            description="Code directories with no associated memory facts"
            count={result.coverageReport.gapCount}
            icon={<FolderSearchIcon className="size-4" aria-hidden="true" />}
            tone="gap"
          >
            <CoverageGapsSection report={result.coverageReport} />
          </CollapsibleSection>

          {findingTotal === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-card/40 px-4 py-8 text-center">
              <SparklesIcon className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
              <p className="mt-2 text-sm text-foreground">Memory is clean.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                No stale entries, deleted-file references, clusters, or coverage gaps in this scope.
              </p>
            </div>
          ) : null}
        </div>
      ) : runMaintenance.isPending ? null : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-6 py-14 text-center">
          <AlertTriangleIcon className="size-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-foreground">No maintenance results yet</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Run maintenance to lint memory facts against the current codebase, cluster related
            facts, and audit directory coverage. A memory report is saved on completion and
            consolidation items may be enqueued for review. Rate-limited at 20 requests per minute.
          </p>
        </div>
      )}
    </div>
  );
}
