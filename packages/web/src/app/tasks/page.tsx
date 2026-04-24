'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type React from 'react';
import { useState } from 'react';

import { ConfirmButton } from '@/components/ConfirmButton';
import { ErrorBanner } from '@/components/ErrorBanner';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { FetchingBar } from '@/components/FetchingBar';
import { LastUpdated } from '@/components/LastUpdated';
import { PageContainer } from '@/components/PageContainer';
import { RefreshButton } from '@/components/RefreshButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, formatNumber } from '@/lib/format-utils';
import { taskGraphsQuery, useCreateTaskGraph, useDeleteTaskGraph } from '@/lib/queries';
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

function CreateTaskGraphDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createMutation = useCreateTaskGraph();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required.');
      return;
    }
    setError(null);
    createMutation.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          setName('');
          onOpenChange(false);
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'Failed to create task graph.');
        },
      },
    );
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!createMutation.isPending) {
      setName('');
      setError(null);
      onOpenChange(nextOpen);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Task Graph</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="py-3 space-y-3">
            <Input
              autoFocus
              placeholder="Graph name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              disabled={createMutation.isPending}
              aria-label="Task graph name"
            />
            {error && (
              <p className="text-[12px] text-red-500" role="alert">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function TasksPage(): React.JSX.Element {
  const graphs = useQuery(taskGraphsQuery());
  const deleteMutation = useDeleteTaskGraph();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    setDeleteError(null);
    deleteMutation.mutate(id, {
      onError: (err) => {
        setDeleteError(err instanceof Error ? err.message : 'Failed to delete task graph.');
      },
    });
  };

  return (
    <ErrorBoundary>
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
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                New Task Graph
              </Button>
              <LastUpdated dataUpdatedAt={graphs.dataUpdatedAt} />
              <RefreshButton
                onClick={() => void graphs.refetch()}
                isFetching={graphs.isFetching && !graphs.isLoading}
              />
            </div>
          </div>

          {deleteError && (
            <ErrorBanner
              message={`Delete failed: ${deleteError}`}
              onRetry={() => setDeleteError(null)}
            />
          )}

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
              <p>
                Click{' '}
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="text-blue-500 underline underline-offset-2 hover:text-blue-400"
                >
                  New Task Graph
                </button>{' '}
                to create one.
              </p>
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
                    <th scope="col" className="px-4 py-3 font-medium">
                      <span className="sr-only">Actions</span>
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
                      <td className="px-4 py-3 text-right">
                        <ConfirmButton
                          label="Delete"
                          confirmLabel="Confirm delete?"
                          onConfirm={() => handleDelete(graph.id)}
                          disabled={deleteMutation.isPending}
                          className="text-[12px] px-2 py-1 rounded text-red-500 hover:bg-red-500/10 transition-colors"
                          confirmClassName="text-[12px] px-2 py-1 rounded text-red-400 bg-red-500/10"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PageContainer>
      </div>

      <CreateTaskGraphDialog open={createOpen} onOpenChange={setCreateOpen} />
    </ErrorBoundary>
  );
}
