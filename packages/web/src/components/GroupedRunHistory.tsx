'use client';

import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LiveTimeAgo } from '@/components/LiveTimeAgo';
import type { RunStatusFilter, RunTriggerFilter } from '@/components/RunHistoryFilters';
import { RunHistoryFilters } from '@/components/RunHistoryFilters';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AgentRun } from '@/lib/api';
import { formatCost, formatDurationMs } from '@/lib/format-utils';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DateGroup = {
  label: string;
  dateKey: string;
  runs: AgentRun[];
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
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const highlightRef = useRef<HTMLTableRowElement | null>(null);
  const highlightMobileRef = useRef<HTMLDivElement | null>(null);

  // Scroll to highlighted run when it changes
  useEffect(() => {
    if (!highlightedRunId) return;
    const el = highlightRef.current ?? highlightMobileRef.current;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedRunId]);

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
    () => filteredRuns.slice(0, visibleCount),
    [filteredRuns, visibleCount],
  );
  const hasMore = visibleCount < filteredRuns.length;

  // -- Group by date --
  const groups = useMemo(() => groupRunsByDate(paginatedRuns), [paginatedRuns]);

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
                    <div className="sm:hidden space-y-1.5 pl-5">
                      {group.runs.map((run) => (
                        <RunCardMobile
                          key={run.id}
                          run={run}
                          errorExpanded={expandedErrors.has(run.id)}
                          onToggleError={() => toggleError(run.id)}
                          isHighlighted={run.id === highlightedRunId}
                          highlightRef={
                            run.id === highlightedRunId ? highlightMobileRef : undefined
                          }
                        />
                      ))}
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
                          {group.runs.map((run) => (
                            <RunRowDesktop
                              key={run.id}
                              run={run}
                              errorExpanded={expandedErrors.has(run.id)}
                              onToggleError={() => toggleError(run.id)}
                              isHighlighted={run.id === highlightedRunId}
                              highlightRef={run.id === highlightedRunId ? highlightRef : undefined}
                            />
                          ))}
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

function RunCardMobile({
  run,
  errorExpanded,
  onToggleError,
  isHighlighted,
  highlightRef,
}: {
  run: AgentRun;
  errorExpanded: boolean;
  onToggleError: () => void;
  isHighlighted?: boolean;
  highlightRef?: React.Ref<HTMLDivElement>;
}): React.JSX.Element {
  return (
    <div
      ref={isHighlighted ? highlightRef : undefined}
      className={cn(
        'rounded-lg border p-3 space-y-1.5 transition-colors hover:border-border',
        isHighlighted
          ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/30'
          : 'border-border/50',
      )}
      data-run-id={run.id}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusBadge status={run.status} />
          <TriggerBadge trigger={run.trigger} />
        </div>
        <span className="text-xs font-mono text-muted-foreground">
          {formatDurationMs(run.durationMs ?? 0)}
        </span>
      </div>
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
}: {
  run: AgentRun;
  errorExpanded: boolean;
  onToggleError: () => void;
  isHighlighted?: boolean;
  highlightRef?: React.Ref<HTMLTableRowElement>;
}): React.JSX.Element {
  return (
    <tr
      ref={isHighlighted ? highlightRef : undefined}
      className={cn(
        'border-b border-border/30 last:border-0',
        isHighlighted && 'bg-primary/5 ring-1 ring-primary/30 rounded',
      )}
      data-run-id={run.id}
    >
      <td className="py-2 pr-3">
        <StatusBadge status={run.status} />
      </td>
      <td className="py-2 pr-3">
        <TriggerBadge trigger={run.trigger} />
      </td>
      <td className="py-2 pr-3 max-w-[300px]">
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
      <td className="py-2 pr-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
        {formatDurationMs(run.durationMs ?? 0)}
      </td>
      <td className="py-2 pr-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
        {formatCost(run.costUsd ?? null)}
      </td>
      <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">
        {run.finishedAt ? (
          <LiveTimeAgo date={run.finishedAt} />
        ) : (
          <LiveTimeAgo date={run.startedAt} />
        )}
      </td>
      <td className="py-2 text-xs whitespace-nowrap">
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

function groupRunsByDate(runs: AgentRun[]): DateGroup[] {
  const groups = new Map<string, AgentRun[]>();

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
    successCount: groupRuns.filter((r) => r.status === 'success').length,
    totalCost: groupRuns.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
  }));
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
