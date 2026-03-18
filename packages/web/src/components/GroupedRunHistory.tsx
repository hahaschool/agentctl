'use client';

import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type React from 'react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LiveTimeAgo } from '@/components/LiveTimeAgo';
import type { RunStatusFilter, RunTriggerFilter } from '@/components/RunHistoryFilters';
import { RunHistoryFilters } from '@/components/RunHistoryFilters';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AgentRun } from '@/lib/api';
import { formatCost, formatDurationMs } from '@/lib/format-utils';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RunWithRetryMeta = AgentRun & {
  retryOf?: string | null;
  retryIndex?: number | null;
  attemptNumber?: number;
  attemptTotal?: number;
};

type RunPhase = NonNullable<AgentRun['phase']>;

type RetryRunGroup = {
  groupId: string;
  leadRun: RunWithRetryMeta;
  previousRuns: RunWithRetryMeta[];
  allRuns: RunWithRetryMeta[];
  retryCount: number;
  latestActivityAtMs: number;
};

type DateGroup = {
  label: string;
  dateKey: string;
  runs: RunWithRetryMeta[];
  runGroups: RetryRunGroup[];
  successCount: number;
  totalCost: number;
};

export type GroupedRunHistoryProps = {
  runs: AgentRun[];
  /** Number of runs to show per "load more" page */
  pageSize?: number;
  /** Run ID to visually highlight (e.g. when linked from a session) */
  highlightedRunId?: string | null;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 20;

const FAILURE_STATUSES = new Set(['failure', 'error', 'timeout']);
const ACTIVE_PHASES = new Set<RunPhase>([
  'queued',
  'dispatching',
  'worker_contacted',
  'cli_spawning',
  'running',
]);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GroupedRunHistory({
  runs,
  pageSize = DEFAULT_PAGE_SIZE,
  highlightedRunId,
}: GroupedRunHistoryProps): React.JSX.Element {
  const [statusFilter, setStatusFilter] = useState<RunStatusFilter>('all');
  const [triggerFilter, setTriggerFilter] = useState<RunTriggerFilter>('all');
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [expandedRetryGroups, setExpandedRetryGroups] = useState<Set<string>>(new Set());
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const highlightRef = useRef<HTMLTableRowElement | null>(null);
  const highlightMobileRef = useRef<HTMLDivElement | null>(null);

  // -- Filter runs --
  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      if (statusFilter !== 'all') {
        if (statusFilter === 'failure') {
          if (!FAILURE_STATUSES.has(run.status)) return false;
        } else if (run.status !== statusFilter) {
          return false;
        }
      }

      if (triggerFilter !== 'all') {
        const runTrigger = run.trigger ?? 'manual';
        if (triggerFilter === 'schedule' && runTrigger !== 'schedule') return false;
        if (triggerFilter === 'manual' && runTrigger !== 'manual') return false;
        if (triggerFilter === 'heartbeat' && runTrigger !== 'heartbeat') return false;
        if (triggerFilter === 'adhoc' && runTrigger !== 'adhoc') return false;
      }

      return true;
    });
  }, [runs, statusFilter, triggerFilter]);

  // -- Paginate --
  const paginatedRuns = useMemo(
    () => filteredRuns.slice(0, visibleCount).map((run) => run as RunWithRetryMeta),
    [filteredRuns, visibleCount],
  );
  const hasMore = visibleCount < filteredRuns.length;

  // -- Group by date --
  const groups = useMemo(() => groupRunsByDate(paginatedRuns), [paginatedRuns]);

  const highlightedRetryGroupKey = useMemo(() => {
    if (!highlightedRunId) return null;

    for (const group of groups) {
      for (const runGroup of group.runGroups) {
        if (runGroup.allRuns.some((run) => run.id === highlightedRunId)) {
          return makeRetryGroupKey(group.dateKey, runGroup.groupId);
        }
      }
    }

    return null;
  }, [groups, highlightedRunId]);

  // Auto-expand retry groups when the highlighted run is nested.
  useEffect(() => {
    if (!highlightedRetryGroupKey) return;
    setExpandedRetryGroups((prev) => {
      if (prev.has(highlightedRetryGroupKey)) return prev;
      const next = new Set(prev);
      next.add(highlightedRetryGroupKey);
      return next;
    });
  }, [highlightedRetryGroupKey]);

  // Scroll to highlighted run when it changes.
  useEffect(() => {
    if (!highlightedRunId) return;
    const el = highlightRef.current ?? highlightMobileRef.current;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedRunId]);

  const toggleGroup = useCallback((dateKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) {
        next.delete(dateKey);
      } else {
        next.add(dateKey);
      }
      return next;
    });
  }, []);

  const toggleRetryGroup = useCallback((key: string) => {
    setExpandedRetryGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const toggleError = useCallback((runId: string) => {
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  }, []);

  const handleLoadMore = useCallback(() => {
    setVisibleCount((prev) => prev + pageSize);
  }, [pageSize]);

  if (runs.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground text-sm">
        No runs recorded yet. Use the Start button above to run this agent.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <RunHistoryFilters
          status={statusFilter}
          trigger={triggerFilter}
          onStatusChange={setStatusFilter}
          onTriggerChange={setTriggerFilter}
        />
        <span className="text-[11px] text-muted-foreground">
          {filteredRuns.length} of {runs.length} runs
        </span>
      </div>

      {filteredRuns.length === 0 ? (
        <div className="py-6 text-center text-muted-foreground text-sm">
          No runs match the current filters.
        </div>
      ) : (
        <>
          {/* Grouped runs */}
          {groups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.dateKey);
            return (
              <div key={group.dateKey} className="space-y-1">
                {/* Group header */}
                <button
                  type="button"
                  onClick={() => toggleGroup(group.dateKey)}
                  className="flex items-center gap-2 w-full text-left py-1.5 px-1 rounded-md hover:bg-accent/50 transition-colors"
                  aria-expanded={!isCollapsed}
                  aria-label={`${group.label}, ${group.runs.length} runs`}
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-xs font-semibold text-foreground">{group.label}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {group.runs.length} run{group.runs.length !== 1 ? 's' : ''}
                  </span>
                  {group.runs.length > 0 && <GroupStats group={group} />}
                </button>

                {/* Group runs */}
                {!isCollapsed && (
                  <>
                    {/* Mobile layout */}
                    <div className="sm:hidden space-y-2 pl-5">
                      {group.runGroups.map((runGroup) => {
                        const retryGroupKey = makeRetryGroupKey(group.dateKey, runGroup.groupId);
                        const retriesExpanded = expandedRetryGroups.has(retryGroupKey);

                        return (
                          <div key={retryGroupKey} className="space-y-1.5">
                            <RunCardMobile
                              run={runGroup.leadRun}
                              errorExpanded={expandedErrors.has(runGroup.leadRun.id)}
                              onToggleError={() => toggleError(runGroup.leadRun.id)}
                              isHighlighted={runGroup.leadRun.id === highlightedRunId}
                              highlightRef={
                                runGroup.leadRun.id === highlightedRunId
                                  ? highlightMobileRef
                                  : undefined
                              }
                            />
                            {runGroup.retryCount > 0 && (
                              <>
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                  onClick={() => toggleRetryGroup(retryGroupKey)}
                                  aria-expanded={retriesExpanded}
                                >
                                  {retriesExpanded ? (
                                    <ChevronDown className="h-3 w-3" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3" />
                                  )}
                                  {runGroup.retryCount} retr
                                  {runGroup.retryCount === 1 ? 'y' : 'ies'}
                                </button>
                                {retriesExpanded && (
                                  <div className="pl-3 border-l border-border/40 space-y-1.5">
                                    {runGroup.previousRuns.map((run) => (
                                      <RunCardMobile
                                        key={run.id}
                                        run={run}
                                        errorExpanded={expandedErrors.has(run.id)}
                                        onToggleError={() => toggleError(run.id)}
                                        isHighlighted={run.id === highlightedRunId}
                                        highlightRef={
                                          run.id === highlightedRunId
                                            ? highlightMobileRef
                                            : undefined
                                        }
                                        isRetryDetail
                                      />
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Desktop table layout */}
                    <div className="hidden sm:block pl-5">
                      <table className="w-full text-sm" aria-label={`Runs from ${group.label}`}>
                        <thead>
                          <tr className="border-b border-border/40 text-left text-[11px] text-muted-foreground">
                            <th scope="col" className="pb-1.5 pr-3 font-medium">
                              Status
                            </th>
                            <th scope="col" className="pb-1.5 pr-3 font-medium">
                              Trigger
                            </th>
                            <th scope="col" className="pb-1.5 pr-3 font-medium">
                              Prompt
                            </th>
                            <th scope="col" className="pb-1.5 pr-3 font-medium">
                              Duration
                            </th>
                            <th scope="col" className="pb-1.5 pr-3 font-medium">
                              Cost
                            </th>
                            <th scope="col" className="pb-1.5 pr-3 font-medium">
                              Time
                            </th>
                            <th scope="col" className="pb-1.5 font-medium">
                              Session
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.runGroups.map((runGroup) => {
                            const retryGroupKey = makeRetryGroupKey(
                              group.dateKey,
                              runGroup.groupId,
                            );
                            const retriesExpanded = expandedRetryGroups.has(retryGroupKey);

                            return (
                              <Fragment key={retryGroupKey}>
                                <RunRowDesktop
                                  run={runGroup.leadRun}
                                  errorExpanded={expandedErrors.has(runGroup.leadRun.id)}
                                  onToggleError={() => toggleError(runGroup.leadRun.id)}
                                  isHighlighted={runGroup.leadRun.id === highlightedRunId}
                                  highlightRef={
                                    runGroup.leadRun.id === highlightedRunId
                                      ? highlightRef
                                      : undefined
                                  }
                                />
                                {runGroup.retryCount > 0 && (
                                  <tr className="border-b border-border/20">
                                    <td colSpan={7} className="py-1.5 pr-3">
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                        onClick={() => toggleRetryGroup(retryGroupKey)}
                                        aria-expanded={retriesExpanded}
                                      >
                                        {retriesExpanded ? (
                                          <ChevronDown className="h-3 w-3" />
                                        ) : (
                                          <ChevronRight className="h-3 w-3" />
                                        )}
                                        {runGroup.retryCount} retr
                                        {runGroup.retryCount === 1 ? 'y' : 'ies'}
                                      </button>
                                    </td>
                                  </tr>
                                )}
                                {retriesExpanded &&
                                  runGroup.previousRuns.map((run) => (
                                    <RunRowDesktop
                                      key={run.id}
                                      run={run}
                                      errorExpanded={expandedErrors.has(run.id)}
                                      onToggleError={() => toggleError(run.id)}
                                      isHighlighted={run.id === highlightedRunId}
                                      highlightRef={
                                        run.id === highlightedRunId ? highlightRef : undefined
                                      }
                                      isRetryDetail
                                    />
                                  ))}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {/* Load more */}
          {hasMore && (
            <div className="pt-2 text-center">
              <Button variant="outline" size="sm" onClick={handleLoadMore}>
                Load more ({filteredRuns.length - visibleCount} remaining)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function GroupStats({ group }: { group: DateGroup }): React.JSX.Element {
  const successRate =
    group.runs.length > 0 ? Math.round((group.successCount / group.runs.length) * 100) : 0;

  return (
    <div className="flex items-center gap-2 ml-auto">
      <Badge
        variant="outline"
        className={cn(
          'text-[10px] gap-1',
          successRate >= 80
            ? 'text-green-600 dark:text-green-400 border-green-500/30'
            : successRate >= 50
              ? 'text-yellow-600 dark:text-yellow-400 border-yellow-500/30'
              : 'text-red-600 dark:text-red-400 border-red-500/30',
        )}
      >
        {successRate}% success
      </Badge>
      <span className="text-[10px] font-mono text-muted-foreground">
        {formatCost(group.totalCost)}
      </span>
    </div>
  );
}

function TriggerBadge({ trigger }: { trigger?: string }): React.JSX.Element {
  const label = trigger ?? 'manual';
  const colorMap: Record<string, string> = {
    schedule: 'text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20',
    manual: 'text-foreground bg-muted border-border/50',
    heartbeat: 'text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/20',
    adhoc: 'text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/20',
    signal: 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded-sm border text-[10px] font-medium capitalize',
        colorMap[label] ?? 'text-muted-foreground bg-muted border-border/50',
      )}
    >
      {label}
    </span>
  );
}

function RunStatusBadge({ status }: { status: string }): React.JSX.Element {
  const tone = getRunStatusTone(status);

  return (
    <div className="inline-flex items-center gap-1.5 flex-wrap">
      <Badge
        variant="outline"
        className={cn('h-5 px-2 gap-1 text-[10px] font-medium', tone.badgeClass)}
      >
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full bg-current shrink-0',
            tone.shouldPulse && 'animate-pulse',
          )}
        />
        {tone.label}
      </Badge>
      {tone.description ? (
        <span className="text-[10px] text-muted-foreground">{tone.description}</span>
      ) : null}
    </div>
  );
}

function RunPhaseIndicator({ run }: { run: RunWithRetryMeta }): React.JSX.Element {
  const phase = resolveRunPhase(run);
  const tone = getRunPhaseTone(phase);

  return (
    <span
      data-phase-indicator={phase}
      className={cn('inline-flex items-center gap-1 text-[10px] font-medium', tone.textClass)}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full bg-current shrink-0',
          tone.animated && 'animate-pulse',
        )}
      />
      {tone.label}
    </span>
  );
}

function RetryBadge({ run }: { run: RunWithRetryMeta }): React.JSX.Element | null {
  if (!run.attemptTotal || run.attemptTotal <= 1 || !run.attemptNumber) {
    return null;
  }

  return (
    <Badge
      variant="outline"
      className="h-5 px-1.5 text-[10px] font-medium text-muted-foreground border-border/50 bg-muted/30"
    >
      Attempt {run.attemptNumber}/{run.attemptTotal}
    </Badge>
  );
}

function RetryOfText({ run }: { run: RunWithRetryMeta }): React.JSX.Element | null {
  if (!run.retryOf) return null;

  return (
    <span className="text-[10px] text-muted-foreground">
      Retry of <span className="font-mono">{shortRunId(run.retryOf)}</span>
    </span>
  );
}

function RunCardMobile({
  run,
  errorExpanded,
  onToggleError,
  isHighlighted,
  highlightRef,
  isRetryDetail = false,
}: {
  run: RunWithRetryMeta;
  errorExpanded: boolean;
  onToggleError: () => void;
  isHighlighted?: boolean;
  highlightRef?: React.Ref<HTMLDivElement>;
  isRetryDetail?: boolean;
}): React.JSX.Element {
  return (
    <div
      ref={isHighlighted ? highlightRef : undefined}
      className={cn(
        'rounded-lg border p-3 space-y-1.5 transition-colors hover:border-border',
        isRetryDetail ? 'border-border/40 bg-muted/20 ml-1' : 'border-border/50',
        isHighlighted && 'border-primary/60 bg-primary/5 ring-1 ring-primary/30',
      )}
      data-run-id={run.id}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <RunStatusBadge status={run.status} />
          <RunPhaseIndicator run={run} />
          <RetryBadge run={run} />
          <TriggerBadge trigger={run.trigger} />
        </div>
        <span className="text-xs font-mono text-muted-foreground">
          {formatDurationMs(run.durationMs ?? 0)}
        </span>
      </div>
      <RetryOfText run={run} />
      <div>
        <span
          className={cn(
            'text-xs leading-snug',
            run.prompt ? 'text-foreground' : 'text-muted-foreground',
          )}
          title={run.prompt}
        >
          {run.prompt
            ? run.prompt.length > 80
              ? `${run.prompt.slice(0, 80)}...`
              : run.prompt
            : '-'}
        </span>
        {run.errorMessage && (
          <ErrorButton
            runId={run.id}
            errorMessage={run.errorMessage}
            expanded={errorExpanded}
            onToggle={onToggleError}
          />
        )}
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="font-mono">{formatCost(run.costUsd ?? null)}</span>
          {run.sessionId && (
            <Link
              href={`/sessions/${run.sessionId}`}
              className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-2.5 w-2.5" />
              Session
            </Link>
          )}
        </div>
        <span>
          {run.finishedAt ? (
            <LiveTimeAgo date={run.finishedAt} />
          ) : (
            <LiveTimeAgo date={run.startedAt} />
          )}
        </span>
      </div>
    </div>
  );
}

function RunRowDesktop({
  run,
  errorExpanded,
  onToggleError,
  isHighlighted,
  highlightRef,
  isRetryDetail = false,
}: {
  run: RunWithRetryMeta;
  errorExpanded: boolean;
  onToggleError: () => void;
  isHighlighted?: boolean;
  highlightRef?: React.Ref<HTMLTableRowElement>;
  isRetryDetail?: boolean;
}): React.JSX.Element {
  return (
    <tr
      ref={isHighlighted ? highlightRef : undefined}
      className={cn(
        'border-b border-border/30 last:border-0',
        isRetryDetail && 'bg-muted/20',
        isHighlighted && 'bg-primary/5 ring-1 ring-primary/30 rounded',
      )}
      data-run-id={run.id}
    >
      <td className={cn('py-2 pr-3 align-top', isRetryDetail && 'pl-4')}>
        <div className="flex flex-col items-start gap-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <RunStatusBadge status={run.status} />
            <RunPhaseIndicator run={run} />
            <RetryBadge run={run} />
          </div>
          <RetryOfText run={run} />
        </div>
      </td>
      <td className="py-2 pr-3 align-top">
        <TriggerBadge trigger={run.trigger} />
      </td>
      <td className="py-2 pr-3 max-w-[300px] align-top">
        <span
          className={cn('text-xs', run.prompt ? 'text-foreground' : 'text-muted-foreground')}
          title={run.prompt}
        >
          {run.prompt
            ? run.prompt.length > 60
              ? `${run.prompt.slice(0, 60)}...`
              : run.prompt
            : '-'}
        </span>
        {run.errorMessage && (
          <ErrorButton
            runId={run.id}
            errorMessage={run.errorMessage}
            expanded={errorExpanded}
            onToggle={onToggleError}
          />
        )}
      </td>
      <td className="py-2 pr-3 text-xs font-mono text-muted-foreground whitespace-nowrap align-top">
        {formatDurationMs(run.durationMs ?? 0)}
      </td>
      <td className="py-2 pr-3 text-xs font-mono text-muted-foreground whitespace-nowrap align-top">
        {formatCost(run.costUsd ?? null)}
      </td>
      <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap align-top">
        {run.finishedAt ? (
          <LiveTimeAgo date={run.finishedAt} />
        ) : (
          <LiveTimeAgo date={run.startedAt} />
        )}
      </td>
      <td className="py-2 text-xs whitespace-nowrap align-top">
        {run.sessionId && (
          <Link
            href={`/sessions/${run.sessionId}`}
            className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3 w-3" />
            <span>Session</span>
          </Link>
        )}
      </td>
    </tr>
  );
}

function ErrorButton({
  runId,
  errorMessage,
  expanded,
  onToggle,
}: {
  runId: string;
  errorMessage: string;
  expanded: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="block text-left text-[11px] text-red-600 dark:text-red-400 mt-0.5 w-full cursor-pointer hover:text-red-500 dark:hover:text-red-300"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={expanded ? 'Collapse error' : 'Expand error'}
      data-run-id={runId}
    >
      {expanded ? (
        <span className="whitespace-pre-wrap break-all">{errorMessage}</span>
      ) : (
        <span className="block truncate max-w-[350px]">{errorMessage}</span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

function groupRunsByDate(runs: RunWithRetryMeta[]): DateGroup[] {
  const groups = new Map<string, RunWithRetryMeta[]>();

  for (const run of runs) {
    const dateKey = getDateKey(run.startedAt);
    const existing = groups.get(dateKey);
    if (existing) {
      existing.push(run);
    } else {
      groups.set(dateKey, [run]);
    }
  }

  return Array.from(groups.entries()).map(([dateKey, groupRuns]) => ({
    label: formatDateLabel(dateKey),
    dateKey,
    runs: groupRuns,
    runGroups: groupRunsByRetryChain(groupRuns),
    successCount: groupRuns.filter((r) => r.status === 'success').length,
    totalCost: groupRuns.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
  }));
}

function groupRunsByRetryChain(runs: RunWithRetryMeta[]): RetryRunGroup[] {
  const runsById = new Map(runs.map((run) => [run.id, run]));
  const chains = new Map<string, RunWithRetryMeta[]>();

  for (const run of runs) {
    const rootId = findRootRunId(run, runsById);
    const existing = chains.get(rootId);
    if (existing) {
      existing.push(run);
    } else {
      chains.set(rootId, [run]);
    }
  }

  return Array.from(chains.entries())
    .map(([groupId, chainRuns]) => {
      const attemptsAsc = [...chainRuns].sort(compareRunsByAttemptAsc);
      const attemptTotal = attemptsAsc.length;
      const attemptsWithMeta = attemptsAsc.map((run, index) => ({
        ...run,
        attemptNumber: index + 1,
        attemptTotal,
      }));
      const leadRun = attemptsWithMeta[0];
      if (!leadRun) return null;

      const latestRun = attemptsWithMeta.at(-1);
      return {
        groupId,
        leadRun,
        previousRuns: attemptsWithMeta.slice(1),
        allRuns: attemptsWithMeta,
        retryCount: Math.max(0, attemptTotal - 1),
        latestActivityAtMs: toEpochMs(latestRun?.startedAt ?? leadRun.startedAt),
      };
    })
    .filter((group): group is RetryRunGroup => group !== null)
    .sort((a, b) => b.latestActivityAtMs - a.latestActivityAtMs);
}

function findRootRunId(run: RunWithRetryMeta, runsById: Map<string, RunWithRetryMeta>): string {
  let current = run;
  let rootId = run.id;
  const seen = new Set<string>([run.id]);

  while (current.retryOf) {
    const parentId = current.retryOf;
    rootId = parentId;

    if (seen.has(parentId)) {
      break;
    }

    seen.add(parentId);

    const parent = runsById.get(parentId);
    if (!parent) {
      break;
    }

    current = parent;
  }

  return rootId;
}

function compareRunsByAttemptAsc(a: RunWithRetryMeta, b: RunWithRetryMeta): number {
  const attemptA = a.retryIndex ?? (a.retryOf ? 1 : 0);
  const attemptB = b.retryIndex ?? (b.retryOf ? 1 : 0);

  if (attemptA !== attemptB) {
    return attemptA - attemptB;
  }

  return toEpochMs(a.startedAt) - toEpochMs(b.startedAt);
}

function getRunStatusTone(status: string): {
  label: string;
  badgeClass: string;
  description?: string;
  shouldPulse?: boolean;
} {
  if (status === 'success') {
    return {
      label: 'Success',
      badgeClass: 'bg-green-500/10 text-green-500 border-green-500/20',
    };
  }

  if (FAILURE_STATUSES.has(status)) {
    return {
      label: 'Failure',
      badgeClass: 'bg-red-500/10 text-red-500 border-red-500/20',
    };
  }

  if (status === 'empty') {
    return {
      label: 'Empty',
      badgeClass: 'bg-muted text-muted-foreground border-border/50',
      description: '(no output produced)',
    };
  }

  if (status === 'running') {
    return {
      label: 'Running',
      badgeClass: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
      shouldPulse: true,
    };
  }

  if (status === 'cancelled') {
    return {
      label: 'Cancelled',
      badgeClass: 'bg-muted text-muted-foreground border-border/50',
    };
  }

  return {
    label: toTitleCase(status),
    badgeClass: 'bg-muted text-muted-foreground border-border/50',
  };
}

function resolveRunPhase(run: RunWithRetryMeta): RunPhase {
  if (run.phase) {
    return run.phase;
  }

  if (run.status === 'running') {
    return 'running';
  }

  if (run.status === 'success') {
    return 'completed';
  }

  if (run.status === 'empty') {
    return 'empty';
  }

  if (FAILURE_STATUSES.has(run.status)) {
    return 'failed';
  }

  return 'queued';
}

function getRunPhaseTone(phase: RunPhase): { label: string; textClass: string; animated: boolean } {
  const animated = ACTIVE_PHASES.has(phase);

  if (phase === 'queued') {
    return {
      label: 'Queued',
      textClass: 'text-muted-foreground',
      animated,
    };
  }

  if (phase === 'dispatching') {
    return {
      label: 'Dispatching',
      textClass: 'text-blue-600 dark:text-blue-400',
      animated,
    };
  }

  if (phase === 'worker_contacted') {
    return {
      label: 'Worker contacted',
      textClass: 'text-cyan-600 dark:text-cyan-400',
      animated,
    };
  }

  if (phase === 'cli_spawning') {
    return {
      label: 'CLI spawning',
      textClass: 'text-sky-600 dark:text-sky-400',
      animated,
    };
  }

  if (phase === 'running') {
    return {
      label: 'Running',
      textClass: 'text-yellow-600 dark:text-yellow-400',
      animated,
    };
  }

  if (phase === 'completed') {
    return {
      label: 'Completed',
      textClass: 'text-green-600 dark:text-green-400',
      animated: false,
    };
  }

  if (phase === 'failed') {
    return {
      label: 'Failed',
      textClass: 'text-red-600 dark:text-red-400',
      animated: false,
    };
  }

  return {
    label: 'No output',
    textClass: 'text-muted-foreground',
    animated: false,
  };
}

function toEpochMs(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function toTitleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ');
}

function shortRunId(runId: string): string {
  return runId.slice(0, 8);
}

function makeRetryGroupKey(dateKey: string, groupId: string): string {
  return `${dateKey}:${groupId}`;
}

function getDateKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateLabel(dateKey: string): string {
  const today = new Date();
  const todayKey = getDateKey(today.toISOString());

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = getDateKey(yesterday.toISOString());

  if (dateKey === todayKey) return 'Today';
  if (dateKey === yesterdayKey) return 'Yesterday';

  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}
