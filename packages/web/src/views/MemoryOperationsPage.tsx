'use client';

import type { EgressSnapshot, MemoryOpsJob, MemoryOpsJobKind } from '@agentctl/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCwIcon } from 'lucide-react';
import type React from 'react';
import { useCallback, useState } from 'react';

import { EgressConfirmationDialog } from '@/components/memory/EgressConfirmationDialog';
import { JobCard } from '@/components/memory/JobCard';
import { JobDetailDrawer } from '@/components/memory/JobDetailDrawer';
import { MissingEmbeddingAlert } from '@/components/memory/MissingEmbeddingAlert';
import { type MixedModelEntry, MixedModelsBanner } from '@/components/memory/MixedModelsBanner';
import { RecentJobsTable } from '@/components/memory/RecentJobsTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/core';
import { type MemoryOpsCapabilities, memoryOpsApi } from '@/lib/api/memory-ops';
import { memoryOpsCapabilitiesQuery, memoryOpsJobsQuery, queryKeys } from '@/lib/queries';

const JOB_KINDS: readonly MemoryOpsJobKind[] = [
  'embedding-backfill',
  'drawer-backfill',
  'consolidation',
  'synthesis',
];

const EGRESS_KINDS = new Set<MemoryOpsJobKind>(['embedding-backfill', 'drawer-backfill']);

const EMPTY_CAPABILITIES: MemoryOpsCapabilities = {
  enabled: false,
  enabledKinds: [],
  machineId: '',
  queueAvailable: false,
  activeProvider: null,
  activeProviderLastTestOk: null,
  activeJobs: [],
};

type PendingPreview = {
  kind: MemoryOpsJobKind;
  params: Record<string, unknown>;
  snapshot: EgressSnapshot;
  previewToken: string;
};

function normalizeScope(scope: string): string {
  return scope.trim().toLowerCase();
}

function paramsForScope(scope: string): Record<string, unknown> {
  const normalized = normalizeScope(scope);
  return normalized ? { scope: normalized } : {};
}

function latestJobForKind(
  jobs: readonly MemoryOpsJob[],
  kind: MemoryOpsJobKind,
  scope: string,
): MemoryOpsJob | null {
  const normalizedScope = normalizeScope(scope);
  return (
    jobs.find(
      (job) =>
        job.kind === kind && normalizeScope(String(job.params.scope ?? '')) === normalizedScope,
    ) ?? null
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return fallback;
}

function modelEntriesFromJobs(jobs: readonly MemoryOpsJob[]): readonly MixedModelEntry[] {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    if (!job.providerModel) continue;
    counts.set(job.providerModel, (counts.get(job.providerModel) ?? 0) + 1);
  }
  return [...counts.entries()].map(([model, count]) => ({
    table: 'memory_ops_jobs',
    model,
    count,
  }));
}

export function MemoryOperationsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJobSnapshot, setSelectedJobSnapshot] = useState<MemoryOpsJob | null>(null);
  const [pendingKind, setPendingKind] = useState<MemoryOpsJobKind | null>(null);
  const [pendingPreview, setPendingPreview] = useState<PendingPreview | null>(null);
  const [modelEntriesFromError, setModelEntriesFromError] = useState<
    readonly MixedModelEntry[] | null
  >(null);

  const capabilitiesQuery = useQuery(memoryOpsCapabilitiesQuery());
  const jobsQuery = useQuery(memoryOpsJobsQuery({ limit: 50 }));

  const capabilities = capabilitiesQuery.data ?? EMPTY_CAPABILITIES;
  const jobs = jobsQuery.data?.jobs ?? [];
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? selectedJobSnapshot;
  const modelEntries = modelEntriesFromError ?? modelEntriesFromJobs(jobs);
  const providerLabel = capabilities.activeProvider?.model ?? 'No active provider';
  const queueLabel = capabilities.queueAvailable ? 'Ready' : 'Unavailable';
  const enabledLabel = capabilities.enabled ? 'Enabled' : 'Disabled';

  const invalidateOpsQueries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.memory.ops.capabilities });
    void queryClient.invalidateQueries({ queryKey: queryKeys.memory.ops.jobs() });
  }, [queryClient]);

  const captureModelMismatch = useCallback((error: ApiError) => {
    const details = error.details;
    const existingModels = Array.isArray(details?.existingModels)
      ? (details.existingModels as Array<{ table?: string; model?: string; count?: number }>)
      : [];
    if (error.code !== 'MODEL_MISMATCH' || existingModels.length === 0) {
      return;
    }
    setModelEntriesFromError(
      existingModels.map((entry) => ({
        table: entry.table ?? 'memory',
        model: entry.model ?? 'unknown-model',
        count: Number(entry.count ?? 0),
      })),
    );
  }, []);

  const runCreateJob = useCallback(
    async (input: {
      kind: MemoryOpsJobKind;
      params: Record<string, unknown>;
      egressToken?: string;
      egressConfirmedBy?: string;
    }) => {
      setPendingKind(input.kind);
      setError(null);
      try {
        const response = await memoryOpsApi.createJob(input);
        setPendingPreview(null);
        setSelectedJobId(response.job.id);
        setSelectedJobSnapshot(response.job);
        invalidateOpsQueries();
      } catch (err) {
        if (err instanceof ApiError) {
          captureModelMismatch(err);
        }
        setError(errorMessage(err, 'Failed to create memory operation job.'));
      } finally {
        setPendingKind(null);
      }
    },
    [captureModelMismatch, invalidateOpsQueries],
  );

  const handleRun = useCallback(
    async (kind: MemoryOpsJobKind) => {
      setError(null);
      setModelEntriesFromError(null);
      const params = paramsForScope(scope);

      if (EGRESS_KINDS.has(kind)) {
        setPendingKind(kind);
        try {
          const preview = await memoryOpsApi.preview({ kind, params });
          setPendingPreview({
            kind,
            params,
            snapshot: preview.snapshot,
            previewToken: preview.egressToken,
          });
        } catch (err) {
          if (err instanceof ApiError) {
            captureModelMismatch(err);
          }
          setError(errorMessage(err, 'Failed to preview memory operation egress.'));
        } finally {
          setPendingKind(null);
        }
        return;
      }

      await runCreateJob({ kind, params });
    },
    [captureModelMismatch, runCreateJob, scope],
  );

  const handleCancel = useCallback(
    async (job: MemoryOpsJob) => {
      setError(null);
      try {
        await memoryOpsApi.cancelJob(job.id);
        invalidateOpsQueries();
      } catch (err) {
        setError(errorMessage(err, 'Failed to cancel memory operation job.'));
      }
    },
    [invalidateOpsQueries],
  );

  return (
    <div className="flex flex-col gap-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Memory Operations</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Trigger durable memory maintenance jobs, review provider egress, and watch recent
            backfill progress across the fleet.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void capabilitiesQuery.refetch();
            void jobsQuery.refetch();
          }}
          disabled={capabilitiesQuery.isFetching || jobsQuery.isFetching}
        >
          <RefreshCwIcon className="size-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <section
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Capabilities"
      >
        <div className="rounded-lg border px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Operations</p>
          <p className="mt-2 text-sm font-medium text-foreground">{enabledLabel}</p>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Queue</p>
          <p className="mt-2 text-sm font-medium text-foreground">{queueLabel}</p>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Machine</p>
          <p className="mt-2 truncate text-sm font-medium text-foreground">
            {capabilities.machineId || 'Unknown machine'}
          </p>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Provider</p>
          <p className="mt-2 truncate text-sm font-medium text-foreground">{providerLabel}</p>
        </div>
      </section>

      <MissingEmbeddingAlert showPeerNote />
      <MixedModelsBanner models={modelEntries} activeModel={providerLabel} />

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <section className="space-y-3" aria-label="Job scope">
        <div className="max-w-sm space-y-2 text-sm">
          <label htmlFor="memory-ops-scope" className="font-medium text-foreground">
            Optional scope
          </label>
          <Input
            id="memory-ops-scope"
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            placeholder="project:agentctl"
            aria-label="Memory operation scope"
          />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 xl:grid-cols-2" aria-label="Available jobs">
        {JOB_KINDS.map((kind) => (
          <JobCard
            key={kind}
            kind={kind}
            scope={scope}
            capabilities={capabilities}
            latestJob={latestJobForKind(jobs, kind, scope)}
            isPending={pendingKind === kind}
            onRun={() => void handleRun(kind)}
            onCancel={(job) => void handleCancel(job)}
          />
        ))}
      </section>

      <section className="space-y-3" aria-label="Recent jobs">
        <div>
          <h2 className="text-sm font-medium">Recent Jobs</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Polls every few seconds; opening a job also subscribes to its event stream.
          </p>
        </div>
        <RecentJobsTable
          jobs={jobs}
          machineId={capabilities.machineId}
          selectedJobId={selectedJobId}
          onSelect={(job) => {
            setSelectedJobId(job.id);
            setSelectedJobSnapshot(job);
          }}
        />
      </section>

      <JobDetailDrawer
        open={selectedJobId !== null}
        jobId={selectedJobId}
        machineId={capabilities.machineId}
        initialJob={selectedJob}
        onOpenChange={(open) => {
          if (!open) setSelectedJobId(null);
        }}
        onCancel={(jobId) => {
          const job = jobs.find((entry) => entry.id === jobId) ?? selectedJobSnapshot;
          if (job) {
            void handleCancel(job);
          }
        }}
      />

      {pendingPreview ? (
        <EgressConfirmationDialog
          open
          snapshot={pendingPreview.snapshot}
          previewToken={pendingPreview.previewToken}
          isSubmitting={pendingKind === pendingPreview.kind}
          onConfirm={(token) =>
            void runCreateJob({
              kind: pendingPreview.kind,
              params: pendingPreview.params,
              egressToken: token,
              egressConfirmedBy: 'web',
            })
          }
          onCancel={() => setPendingPreview(null)}
        />
      ) : null}
    </div>
  );
}
