'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Play } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type React from 'react';
import { useState } from 'react';

import { ErrorBanner } from '@/components/ErrorBanner';
import { FetchingBar } from '@/components/FetchingBar';
import { LastUpdated } from '@/components/LastUpdated';
import { RefreshButton } from '@/components/RefreshButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { TaskDefinition, TaskRun } from '@/lib/api';
import { formatDate, formatDateTime, timeAgo } from '@/lib/format-utils';
import { taskGraphQuery, taskRunsQuery, useCreateTaskRun } from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Status badge styles
// ---------------------------------------------------------------------------

const GRAPH_STATUS_CLASSES: Record<string, string> = {
  ready: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  invalid: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  empty: 'border-border bg-muted/40 text-muted-foreground',
};

const NODE_TYPE_CLASSES: Record<string, string> = {
  task: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  gate: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  fork: 'border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400',
  join: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
};

const RUN_STATUS_CLASSES: Record<string, string> = {
  pending: 'border-border bg-muted/40 text-muted-foreground',
  claimed: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  running: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  blocked: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  failed: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  cancelled: 'border-border bg-muted/40 text-muted-foreground',
};

function NodeTypeBadge({ type }: { type: string }): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className={cn(
        'capitalize text-[10px] font-medium',
        NODE_TYPE_CLASSES[type] ?? 'border-border bg-muted/40 text-muted-foreground',
      )}
    >
      {type}
    </Badge>
  );
}

function RunStatusBadge({ status }: { status: string }): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className={cn(
        'capitalize text-[10px] font-medium',
        RUN_STATUS_CLASSES[status] ?? 'border-border bg-muted/40 text-muted-foreground',
      )}
    >
      {status}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDependencies(
  defId: string,
  edges: Array<{ fromDefinition: string; toDefinition: string; type: string }>,
): string[] {
  return edges
    .filter((e) => e.toDefinition === defId && e.type === 'blocks')
    .map((e) => e.fromDefinition);
}

function getDefName(defId: string, definitions: TaskDefinition[]): string {
  return definitions.find((d) => d.id === defId)?.name ?? defId.slice(0, 8);
}

// ---------------------------------------------------------------------------
// NodesTable
// ---------------------------------------------------------------------------

type NodesTableProps = {
  definitions: TaskDefinition[];
  edges: Array<{ fromDefinition: string; toDefinition: string; type: string }>;
};

function NodesTable({ definitions, edges }: NodesTableProps): React.JSX.Element {
  if (definitions.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground text-sm">
        No task nodes defined yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-border rounded-lg bg-card">
      <table className="w-full text-sm" aria-label="Task nodes">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="px-4 py-3 font-medium">
              Name
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Type
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Dependencies
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Created
            </th>
          </tr>
        </thead>
        <tbody>
          {definitions.map((def) => {
            const deps = getDependencies(def.id, edges);
            return (
              <tr key={def.id} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{def.name}</div>
                  {def.description && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {def.description}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{def.id}</div>
                </td>
                <td className="px-4 py-3">
                  <NodeTypeBadge type={def.type} />
                </td>
                <td className="px-4 py-3">
                  {deps.length === 0 ? (
                    <span className="text-muted-foreground text-xs">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {deps.map((depId) => (
                        <span
                          key={depId}
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm border border-border bg-muted/40 text-muted-foreground"
                        >
                          {getDefName(depId, definitions)}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                  {formatDate(def.createdAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunHistoryTable
// ---------------------------------------------------------------------------

type RunHistoryTableProps = {
  runs: TaskRun[];
  definitions: TaskDefinition[];
};

function RunHistoryTable({ runs, definitions }: RunHistoryTableProps): React.JSX.Element {
  if (runs.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground text-sm">
        No runs yet. Click &ldquo;Start Run&rdquo; to execute a task.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-border rounded-lg bg-card">
      <table className="w-full text-sm" aria-label="Task run history">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="px-4 py-3 font-medium">
              Run ID
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Definition
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Attempt
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Started
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Completed
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-b border-border/50 last:border-0">
              <td className="px-4 py-3">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {run.id.slice(0, 8)}
                </span>
              </td>
              <td className="px-4 py-3 text-muted-foreground text-xs">
                {getDefName(run.definitionId, definitions)}
              </td>
              <td className="px-4 py-3">
                <RunStatusBadge status={run.status} />
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{run.attempt}</td>
              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                {run.startedAt ? timeAgo(run.startedAt) : '—'}
              </td>
              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                {run.completedAt ? formatDateTime(run.completedAt) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StartRunPanel
// ---------------------------------------------------------------------------

type StartRunPanelProps = {
  definitions: TaskDefinition[];
};

function StartRunPanel({ definitions }: StartRunPanelProps): React.JSX.Element {
  const [selectedDefId, setSelectedDefId] = useState<string>(definitions[0]?.id ?? '');
  const createRun = useCreateTaskRun();

  const handleStart = (): void => {
    if (!selectedDefId) return;
    createRun.mutate({ definitionId: selectedDefId });
  };

  if (definitions.length === 0) return <></>;

  return (
    <div className="flex items-center gap-2">
      <select
        value={selectedDefId}
        onChange={(e) => setSelectedDefId(e.target.value)}
        className="text-sm bg-background border border-border rounded-md px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        aria-label="Select task definition"
      >
        {definitions.map((def) => (
          <option key={def.id} value={def.id}>
            {def.name}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        onClick={handleStart}
        disabled={!selectedDefId || createRun.isPending}
        className="gap-1.5"
      >
        <Play size={13} />
        {createRun.isPending ? 'Starting…' : 'Start Run'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TaskGraphDetailPage
// ---------------------------------------------------------------------------

export default function TaskGraphDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const graphId = params.id;

  const graphQuery = useQuery(taskGraphQuery(graphId));
  const runsQuery = useQuery(taskRunsQuery());

  const graph = graphQuery.data;
  const definitions = graph?.definitions ?? [];
  const edges = graph?.edges ?? [];

  // Filter runs that belong to this graph's definitions
  const defIds = new Set(definitions.map((d) => d.id));
  const runsForGraph = (runsQuery.data ?? []).filter((r) => defIds.has(r.definitionId));

  // Determine graph status
  const graphStatus: 'empty' | 'ready' | 'invalid' = definitions.length === 0 ? 'empty' : 'ready';

  const isFetching =
    (graphQuery.isFetching && !graphQuery.isLoading) ||
    (runsQuery.isFetching && !runsQuery.isLoading);

  const handleRefetch = (): void => {
    void graphQuery.refetch();
    void runsQuery.refetch();
  };

  return (
    <div className="relative p-4 md:p-6 max-w-[1000px] animate-page-enter">
      <FetchingBar isFetching={isFetching} />

      {/* Back link */}
      <div className="mb-4">
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          All Tasks
        </Link>
      </div>

      {/* Header skeleton */}
      {graphQuery.isLoading && (
        <div className="space-y-3 mb-6">
          <Skeleton className="h-7 w-56 rounded-md" />
          <Skeleton className="h-4 w-80 rounded-md" />
        </div>
      )}

      {/* Error */}
      {graphQuery.error && (
        <ErrorBanner
          message={`Failed to load task graph: ${graphQuery.error.message}`}
          onRetry={handleRefetch}
        />
      )}

      {/* Loaded content */}
      {!graphQuery.isLoading && graph && (
        <>
          {/* Page header */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-[22px] font-semibold tracking-tight">{graph.name}</h1>
                <Badge
                  variant="outline"
                  className={cn(
                    'capitalize text-[11px] font-medium',
                    GRAPH_STATUS_CLASSES[graphStatus],
                  )}
                >
                  {graphStatus}
                </Badge>
              </div>
              <p className="text-[12px] font-mono text-muted-foreground">{graph.id}</p>
              <p className="text-[13px] text-muted-foreground mt-1">
                Created {formatDate(graph.createdAt)}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <LastUpdated dataUpdatedAt={graphQuery.dataUpdatedAt} />
              <RefreshButton onClick={handleRefetch} isFetching={isFetching} />
            </div>
          </div>

          {/* Nodes section */}
          <section className="mb-8">
            <h2 className="text-[15px] font-semibold mb-3">
              Nodes
              <span className="ml-2 text-[12px] font-mono text-muted-foreground">
                ({definitions.length})
              </span>
            </h2>
            <NodesTable definitions={definitions} edges={edges} />
          </section>

          {/* Run history section */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[15px] font-semibold">
                Run History
                <span className="ml-2 text-[12px] font-mono text-muted-foreground">
                  ({runsForGraph.length})
                </span>
              </h2>
              {definitions.length > 0 && <StartRunPanel definitions={definitions} />}
            </div>

            {runsQuery.error && (
              <ErrorBanner
                message={`Failed to load run history: ${runsQuery.error.message}`}
                onRetry={() => void runsQuery.refetch()}
              />
            )}

            {runsQuery.isLoading ? (
              <div className="space-y-2">
                {['run-sk-1', 'run-sk-2'].map((key) => (
                  <Skeleton key={key} className="h-12 rounded-md" />
                ))}
              </div>
            ) : (
              <RunHistoryTable runs={runsForGraph} definitions={definitions} />
            )}
          </section>
        </>
      )}
    </div>
  );
}
