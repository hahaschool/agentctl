'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type React from 'react';

import { ErrorBanner } from '@/components/ErrorBanner';
import { FetchingBar } from '@/components/FetchingBar';
import { LastUpdated } from '@/components/LastUpdated';
import { PageContainer } from '@/components/PageContainer';
import { RefreshButton } from '@/components/RefreshButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, formatNumber } from '@/lib/format-utils';
import { taskGraphsQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

const STATUS_CLASSES: Record<string, string> = {
  ready: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  invalid: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  empty: 'border-border bg-muted/40 text-muted-foreground',
};

function GraphStatusBadge({ status }: { status: string }): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className={cn('capitalize text-[11px] font-medium', STATUS_CLASSES[status])}
    >
      {status}
    </Badge>
  );
}

export default function TasksPage(): React.JSX.Element {
  const graphs = useQuery(taskGraphsQuery());

  return (
    <div className="relative animate-page-enter">
      <FetchingBar isFetching={graphs.isFetching && !graphs.isLoading} />
      <PageContainer className="py-4 md:py-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Tasks</h1>
            <p className="text-[13px] text-muted-foreground mt-1">
              Task graph DAGs for space collaboration workflows.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/spaces">Spaces</Link>
            </Button>
            <LastUpdated dataUpdatedAt={graphs.dataUpdatedAt} />
            <RefreshButton
              onClick={() => void graphs.refetch()}
              isFetching={graphs.isFetching && !graphs.isLoading}
            />
          </div>
        </div>

        {graphs.isLoading && (
          <div className="space-y-2">
            {['task-sk-1', 'task-sk-2', 'task-sk-3'].map((key) => (
              <Skeleton key={key} className="h-12 rounded-md" />
            ))}
          </div>
        )}

        {graphs.error && (
          <ErrorBanner
            message={`Failed to load task graphs: ${graphs.error.message}`}
            onRetry={() => void graphs.refetch()}
          />
        )}

        {!graphs.isLoading && !graphs.error && (graphs.data ?? []).length === 0 && (
          <div className="text-center py-16 text-muted-foreground text-sm">
            <p className="mb-2">No task graphs found.</p>
            <p>Create one through the backend task graph API to see it here.</p>
          </div>
        )}

        {!graphs.isLoading && !graphs.error && (graphs.data ?? []).length > 0 && (
          <div className="overflow-x-auto border border-border rounded-lg bg-card">
            <table className="w-full text-sm" aria-label="Task graphs">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Task Count
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {(graphs.data ?? []).map((graph) => (
                  <tr key={graph.id} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{graph.name || graph.id}</div>
                      <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                        {graph.id}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <GraphStatusBadge status={graph.status} />
                    </td>
                    <td className="px-4 py-3 font-mono">{formatNumber(graph.taskCount)}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {formatDate(graph.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageContainer>
    </div>
  );
}
