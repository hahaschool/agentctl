'use client';

import { type MemoryOpsJob, REQUIRES_PROVIDER } from '@agentctl/shared';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  Clock3Icon,
  Loader2Icon,
  PlayIcon,
  SquareIcon,
  XCircleIcon,
} from 'lucide-react';
import type React from 'react';

import type { MemoryOpsCapabilities } from '@/lib/api/memory-ops';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';

const KIND_META = {
  'embedding-backfill': {
    label: 'Embedding Backfill',
    description: 'Fill missing fact embeddings with the active provider.',
  },
  'drawer-backfill': {
    label: 'Drawer Backfill',
    description: 'Fill missing drawer embeddings from source files.',
  },
  consolidation: {
    label: 'Consolidation',
    description: 'Run duplicate-cleanup and consolidation maintenance.',
  },
  synthesis: {
    label: 'Synthesis',
    description: 'Generate structure and principle candidates for review.',
  },
} as const;

type JobCardProps = {
  kind: MemoryOpsJob['kind'];
  scope?: string;
  capabilities: MemoryOpsCapabilities;
  latestJob: MemoryOpsJob | null;
  isPending?: boolean;
  onRun: () => void;
  onCancel: (job: MemoryOpsJob) => void;
};

function normalizeScope(scope: string): string {
  return scope.trim().toLowerCase();
}

function statusBadgeVariant(status: MemoryOpsJob['status']): 'default' | 'destructive' | 'outline' {
  if (status === 'failed') return 'destructive';
  if (status === 'completed') return 'default';
  return 'outline';
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function isJobLocal(job: MemoryOpsJob, machineId: string): boolean {
  return job.originMachineId === machineId || job.executorMachineId === machineId;
}

export function JobCard({
  kind,
  scope = '',
  capabilities,
  latestJob,
  isPending = false,
  onRun,
  onCancel,
}: JobCardProps): React.JSX.Element {
  const meta = KIND_META[kind];
  const normalizedScope = normalizeScope(scope);
  const activeFleetEntry = capabilities.activeJobs.find(
    (job) => job.kind === kind && normalizeScope(job.scope) === normalizedScope,
  );
  const activeFleetCount = activeFleetEntry
    ? activeFleetEntry.queued + activeFleetEntry.running + activeFleetEntry.cancelling
    : 0;
  const requiresProvider = REQUIRES_PROVIDER[kind];
  const enabled = capabilities.enabled && capabilities.queueAvailable;
  const kindEnabled = capabilities.enabledKinds.includes(kind);
  const providerReady =
    !requiresProvider ||
    (!!capabilities.activeProvider?.id && capabilities.activeProviderLastTestOk === true);

  let disabledReason: string | null = null;
  if (!enabled) {
    disabledReason = capabilities.queueAvailable
      ? 'Memory operations are disabled on this machine.'
      : 'The job queue is unavailable on this machine.';
  } else if (!kindEnabled) {
    disabledReason = 'This job kind is not enabled on this machine yet.';
  } else if (!providerReady) {
    disabledReason = requiresProvider
      ? 'This job must pass a provider test before it can run.'
      : null;
  } else if (activeFleetCount > 0) {
    disabledReason = 'A job of this kind is already active somewhere in the fleet.';
  }

  const canRun = disabledReason === null && !isPending;
  const canCancel =
    latestJob !== null &&
    isJobLocal(latestJob, capabilities.machineId) &&
    ['queued', 'running', 'cancelling'].includes(latestJob.status);
  const progressTotal = latestJob?.progress.total ?? 0;
  const progressProcessed = latestJob?.progress.processed ?? 0;
  const progressPct =
    progressTotal > 0 ? Math.max(0, Math.min(100, (progressProcessed / progressTotal) * 100)) : 0;

  return (
    <Card className="gap-0 rounded-lg hover:shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <CardTitle className="text-sm">{meta.label}</CardTitle>
            <CardDescription className="leading-5">{meta.description}</CardDescription>
            {scope ? <p className="text-xs text-muted-foreground">Scope: {scope}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {latestJob ? (
              <Badge variant={statusBadgeVariant(latestJob.status)} className="capitalize">
                {latestJob.status}
              </Badge>
            ) : (
              <Badge variant="outline">Idle</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {latestJob ? (
          latestJob.status === 'running' || latestJob.status === 'cancelling' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {progressProcessed}/{progressTotal} processed
                </span>
                <span>{progressPct.toFixed(0)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{formatUsd(latestJob.progress.costUsd)}</span>
                {latestJob.progress.etaSeconds ? (
                  <span>{Math.round(latestJob.progress.etaSeconds / 60)} min ETA</span>
                ) : null}
              </div>
            </div>
          ) : latestJob.status === 'completed' ? (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              <div className="space-y-1">
                <p className="text-foreground">
                  Completed {latestJob.progress.processed.toLocaleString()} items.
                </p>
                <p>Final cost {formatUsd(latestJob.progress.costUsd)}.</p>
              </div>
            </div>
          ) : latestJob.status === 'failed' ? (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <XCircleIcon className="mt-0.5 size-4 shrink-0" />
              <div className="space-y-1">
                <p>{latestJob.errorCode ?? 'JOB_FAILED'}</p>
                <p className="text-xs">
                  {latestJob.error ?? 'The job failed without an error summary.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <Clock3Icon className="mt-0.5 size-4 shrink-0" />
              <p>Queued and waiting for the local worker to pick it up.</p>
            </div>
          )
        ) : (
          <p className="text-sm text-muted-foreground">No recent runs for this job kind.</p>
        )}

        {disabledReason ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>{disabledReason}</span>
          </div>
        ) : null}

        {activeFleetCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            Fleet active: {activeFleetCount} {activeFleetCount === 1 ? 'job' : 'jobs'}
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {capabilities.activeProvider?.model
            ? `Provider: ${capabilities.activeProvider.model}`
            : 'Provider: not configured'}
        </div>
        <div className="flex items-center gap-2">
          {canCancel && latestJob ? (
            <Button size="sm" variant="outline" onClick={() => onCancel(latestJob)}>
              {latestJob.status === 'cancelling' ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <SquareIcon className="size-4" />
              )}
              Cancel
            </Button>
          ) : null}
          <Button size="sm" onClick={onRun} disabled={!canRun}>
            {isPending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <PlayIcon className="size-4" />
            )}
            {isPending ? 'Working…' : 'Run now'}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
