'use client';

import type { MemoryOpsJob } from '@agentctl/shared';
import type React from 'react';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

const KIND_LABELS: Record<MemoryOpsJob['kind'], string> = {
  'embedding-backfill': 'Embedding Backfill',
  'drawer-backfill': 'Drawer Backfill',
  consolidation: 'Consolidation',
  synthesis: 'Synthesis',
};

type RecentJobsTableProps = {
  jobs: MemoryOpsJob[];
  machineId: string;
  selectedJobId: string | null;
  onSelect: (job: MemoryOpsJob) => void;
};

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RecentJobsTable({
  jobs,
  machineId,
  selectedJobId,
  onSelect,
}: RecentJobsTableProps): React.JSX.Element {
  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
        No memory operation jobs yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Job</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">Finished</th>
              <th className="px-4 py-3">Done</th>
              <th className="px-4 py-3">Cost</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const isRemote = job.executorMachineId !== machineId;
              const isSelected = selectedJobId === job.id;
              return (
                <tr key={job.id} className={isSelected ? 'bg-accent/10' : 'border-t border-border'}>
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-col gap-2">
                      <Button
                        variant="ghost"
                        size="xs"
                        className="w-fit px-0 text-left font-medium text-foreground hover:bg-transparent"
                        onClick={() => onSelect(job)}
                        aria-label={`Open job ${job.id}`}
                      >
                        {KIND_LABELS[job.kind]}
                      </Button>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{job.id}</span>
                        <Badge variant="outline">{isRemote ? 'Remote' : 'Local'}</Badge>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <Badge
                      variant={job.status === 'failed' ? 'destructive' : 'outline'}
                      className="capitalize"
                    >
                      {job.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 align-top text-muted-foreground">
                    {formatTimestamp(job.startedAt)}
                  </td>
                  <td className="px-4 py-3 align-top text-muted-foreground">
                    {formatTimestamp(job.finishedAt)}
                  </td>
                  <td className="px-4 py-3 align-top text-muted-foreground">
                    {job.progress.processed.toLocaleString()}/{job.progress.total.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 align-top text-muted-foreground">
                    ${job.progress.costUsd.toFixed(4)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
