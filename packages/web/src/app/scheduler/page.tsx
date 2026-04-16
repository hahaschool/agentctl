'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

import { ErrorBanner } from '@/components/ErrorBanner';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { FetchingBar } from '@/components/FetchingBar';
import { RefreshButton } from '@/components/RefreshButton';
import { useToast } from '@/components/Toast';
import {
  type CreateCronJobInput,
  type CreateHeartbeatJobInput,
  isSchedulerNotConfigured,
  type RepeatableJobInfo,
  schedulerApi,
} from '@/lib/api/scheduler';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCHEDULER_JOBS_QUERY_KEY = ['scheduler-jobs'] as const;
const SCHEDULER_JOBS_POLL_INTERVAL = 30_000;

type JobType = 'heartbeat' | 'cron';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function classifyJob(info: RepeatableJobInfo): { type: JobType | 'unknown'; agentId: string } {
  const parts = info.key.split(':');
  const prefix = parts[0] ?? '';
  const agentId = parts.length > 1 ? parts.slice(1).join(':') : info.key;
  const type: JobType | 'unknown' =
    prefix === 'heartbeat' ? 'heartbeat' : prefix === 'cron' ? 'cron' : 'unknown';
  return { type, agentId };
}

function formatSchedule(info: RepeatableJobInfo): string {
  if (info.pattern) return info.pattern;
  if (info.every) {
    const ms = Number(info.every);
    if (Number.isFinite(ms) && ms > 0) return `every ${Math.round(ms / 1000)}s`;
    return `every ${info.every}`;
  }
  return '—';
}

function formatNextRun(ts: number | null): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

// ---------------------------------------------------------------------------
// Create dialog — tabbed heartbeat | cron
// ---------------------------------------------------------------------------

type CreateDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

function CreateJobDialog({
  open,
  onClose,
  onCreated,
}: CreateDialogProps): React.JSX.Element | null {
  const toast = useToast();
  const [tab, setTab] = useState<JobType>('heartbeat');
  const [agentId, setAgentId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [intervalSec, setIntervalSec] = useState('60');
  const [pattern, setPattern] = useState('');
  const [model, setModel] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab('heartbeat');
    setAgentId('');
    setMachineId('');
    setIntervalSec('60');
    setPattern('');
    setModel('');
    setError(null);
  }, [open]);

  const heartbeatMutation = useMutation({
    mutationFn: (body: CreateHeartbeatJobInput) => schedulerApi.createSchedulerHeartbeatJob(body),
    onSuccess: () => {
      toast.success(`Heartbeat job created for ${agentId}`);
      onCreated();
      onClose();
    },
    onError: (err) => setError(errorMessage(err, 'Failed to create heartbeat job')),
  });

  const cronMutation = useMutation({
    mutationFn: (body: CreateCronJobInput) => schedulerApi.createSchedulerCronJob(body),
    onSuccess: () => {
      toast.success(`Cron job created for ${agentId}`);
      onCreated();
      onClose();
    },
    onError: (err) => setError(errorMessage(err, 'Failed to create cron job')),
  });

  const isPending = heartbeatMutation.isPending || cronMutation.isPending;

  if (!open) return null;

  const handleSubmit = (evt: React.FormEvent<HTMLFormElement>): void => {
    evt.preventDefault();
    const trimmedAgent = agentId.trim();
    const trimmedMachine = machineId.trim();
    if (!trimmedAgent) {
      setError('Agent ID is required');
      return;
    }
    if (!trimmedMachine) {
      setError('Machine ID is required');
      return;
    }

    if (tab === 'heartbeat') {
      const seconds = Number(intervalSec);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        setError('Interval must be a positive number of seconds');
        return;
      }
      setError(null);
      heartbeatMutation.mutate({
        agentId: trimmedAgent,
        machineId: trimmedMachine,
        intervalMs: Math.round(seconds * 1000),
      });
      return;
    }

    const trimmedPattern = pattern.trim();
    if (!trimmedPattern) {
      setError('Cron pattern is required');
      return;
    }
    setError(null);
    const body: CreateCronJobInput = model.trim()
      ? {
          agentId: trimmedAgent,
          machineId: trimmedMachine,
          pattern: trimmedPattern,
          model: model.trim(),
        }
      : { agentId: trimmedAgent, machineId: trimmedMachine, pattern: trimmedPattern };
    cronMutation.mutate(body);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scheduler-job-form-title"
      data-testid="scheduler-job-form-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-xl rounded-md border border-border bg-card shadow-xl">
        <form onSubmit={handleSubmit} className="flex flex-col" noValidate>
          <div className="px-5 py-3 border-b border-border">
            <h2 id="scheduler-job-form-title" className="text-sm font-semibold text-foreground">
              New scheduled job
            </h2>
          </div>

          <div className="px-5 pt-3">
            <div
              role="tablist"
              aria-label="Job type"
              className="inline-flex rounded-md border border-border overflow-hidden text-xs"
            >
              {(['heartbeat', 'cron'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  data-testid={`scheduler-tab-${value}`}
                  onClick={() => setTab(value)}
                  className={cn(
                    'px-3 py-1.5 font-medium uppercase tracking-wide',
                    tab === value
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-accent/10',
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <div className="px-5 py-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label
                  htmlFor="scheduler-agent-id"
                  className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
                >
                  Agent ID
                </label>
                <input
                  id="scheduler-agent-id"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  className="w-full bg-muted border border-border rounded-md text-xs px-2 py-1.5 font-mono text-foreground"
                  placeholder="code-reviewer"
                />
              </div>

              <div>
                <label
                  htmlFor="scheduler-machine-id"
                  className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
                >
                  Machine ID
                </label>
                <input
                  id="scheduler-machine-id"
                  value={machineId}
                  onChange={(e) => setMachineId(e.target.value)}
                  className="w-full bg-muted border border-border rounded-md text-xs px-2 py-1.5 font-mono text-foreground"
                  placeholder="mac-mini-1"
                />
              </div>
            </div>

            {tab === 'heartbeat' ? (
              <div>
                <label
                  htmlFor="scheduler-interval"
                  className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
                >
                  Interval (seconds)
                </label>
                <input
                  id="scheduler-interval"
                  type="number"
                  min={1}
                  value={intervalSec}
                  onChange={(e) => setIntervalSec(e.target.value)}
                  className="w-full bg-muted border border-border rounded-md text-xs px-2 py-1.5 font-mono text-foreground"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Control plane receives milliseconds; this field accepts seconds for convenience.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="scheduler-cron-pattern"
                    className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
                  >
                    Cron pattern
                  </label>
                  <input
                    id="scheduler-cron-pattern"
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                    className="w-full bg-muted border border-border rounded-md text-xs px-2 py-1.5 font-mono text-foreground"
                    placeholder="*/15 * * * *"
                  />
                </div>
                <div>
                  <label
                    htmlFor="scheduler-model"
                    className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
                  >
                    Model (optional)
                  </label>
                  <input
                    id="scheduler-model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full bg-muted border border-border rounded-md text-xs px-2 py-1.5 font-mono text-foreground"
                    placeholder="claude-opus-4-5"
                  />
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="text-xs text-red-400" data-testid="scheduler-form-error">
                {error}
              </p>
            )}
          </div>

          <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="px-3 py-1.5 rounded-md border border-border bg-muted text-xs text-foreground hover:bg-accent/10 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              data-testid="scheduler-submit"
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending ? 'Creating…' : 'Create job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SchedulerPage(): React.JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const jobsQuery = useQuery({
    queryKey: SCHEDULER_JOBS_QUERY_KEY,
    queryFn: schedulerApi.listSchedulerJobs,
    refetchInterval: SCHEDULER_JOBS_POLL_INTERVAL,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RepeatableJobInfo | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (agentId: string) => schedulerApi.deleteSchedulerJob(agentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SCHEDULER_JOBS_QUERY_KEY });
    },
  });

  const handleCreated = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: SCHEDULER_JOBS_QUERY_KEY });
  }, [queryClient]);

  const confirmDelete = useCallback((): void => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    const { agentId } = classifyJob(target);
    deleteMutation.mutate(agentId, {
      onSuccess: () => {
        toast.success(`Job ${target.key} removed`);
        setPendingDelete(null);
      },
      onError: (err) => {
        toast.error(errorMessage(err, 'Failed to remove job'));
        setPendingDelete(null);
      },
    });
  }, [deleteMutation, pendingDelete, toast]);

  const notConfigured = isSchedulerNotConfigured(jobsQuery.error);
  const jobs = jobsQuery.data ?? [];
  const deletingKey = deleteMutation.isPending
    ? ((deleteMutation.variables as string | undefined) ?? null)
    : null;

  return (
    <div className="relative p-4 md:p-6 max-w-[1400px] animate-page-enter">
      <FetchingBar isFetching={jobsQuery.isFetching && !jobsQuery.isLoading} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <CalendarClock size={22} className="text-primary" aria-hidden="true" />
          <h1 className="text-[22px] font-semibold tracking-tight">Scheduler</h1>
          {jobs.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-semibold">
              {jobs.length} job{jobs.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton
            onClick={() => void jobsQuery.refetch()}
            isFetching={jobsQuery.isFetching && !jobsQuery.isLoading}
          />
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            disabled={notConfigured}
            data-testid="new-scheduler-job"
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
          >
            + New job
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-4 max-w-[720px]">
        Repeatable heartbeat and cron jobs managed by the control plane. Heartbeat jobs fire every N
        seconds; cron jobs run on a standard cron pattern. Deleting a row removes every job tied to
        its agent ID.
      </p>

      {notConfigured && (
        <output
          data-testid="scheduler-not-configured"
          className="mb-4 block rounded-md border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground"
        >
          <strong className="text-foreground">Scheduler not configured.</strong> The control plane
          has no repeatable-job manager bound — typically because Redis is unavailable. Configure{' '}
          <span className="font-mono">REDIS_URL</span> and restart the control plane to enable this
          page.
        </output>
      )}

      {jobsQuery.error && !notConfigured && (
        <ErrorBanner
          message={`Failed to load scheduled jobs: ${jobsQuery.error.message}`}
          onRetry={() => void jobsQuery.refetch()}
          className="mb-4"
        />
      )}

      {jobsQuery.isLoading && (
        <div className="space-y-2" data-testid="scheduler-jobs-loading">
          {[1, 2, 3].map((k) => (
            <div key={k} className="h-14 bg-muted/30 rounded-md animate-pulse" />
          ))}
        </div>
      )}

      {!jobsQuery.isLoading && !jobsQuery.error && jobs.length === 0 && (
        <div
          className="text-center py-16 text-muted-foreground text-sm"
          data-testid="scheduler-jobs-empty"
        >
          <p>No scheduled jobs yet.</p>
          <p className="mt-1 text-xs">
            Schedule a heartbeat for periodic check-ins or a cron job for fixed-time runs.
          </p>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            data-testid="empty-new-scheduler-job"
            className="mt-4 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-white hover:bg-primary/90"
          >
            Create your first job
          </button>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="border border-border rounded-md overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left" aria-label="Scheduled jobs">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Key</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Schedule</th>
                  <th className="px-4 py-2 font-medium">Agent ID</th>
                  <th className="px-4 py-2 font-medium">Next run</th>
                  <th className="px-4 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const { type, agentId } = classifyJob(job);
                  const thisRowDeleting = deletingKey === agentId;
                  return (
                    <tr key={job.key} className="border-t border-border hover:bg-accent/5">
                      <td className="px-4 py-3 align-top font-mono text-xs text-foreground break-all">
                        {job.key}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className="px-2 py-0.5 rounded-sm text-[10px] font-semibold tracking-wide uppercase bg-primary/15 text-primary">
                          {type}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top font-mono text-xs text-muted-foreground">
                        {formatSchedule(job)}
                      </td>
                      <td className="px-4 py-3 align-top font-mono text-xs text-muted-foreground">
                        {agentId}
                      </td>
                      <td className="px-4 py-3 align-top font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {formatNextRun(job.next)}
                      </td>
                      <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setPendingDelete(job)}
                          disabled={thisRowDeleting}
                          data-testid={`delete-${job.key}`}
                          title="Remove job"
                          className={cn(
                            'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
                            'border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20',
                            'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-500/10',
                          )}
                        >
                          {thisRowDeleting ? 'Removing…' : 'Remove'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CreateJobDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={handleCreated}
      />

      {pendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="scheduler-delete-title"
          data-testid="scheduler-delete-confirm"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-sm rounded-md border border-border bg-card shadow-xl p-5">
            <h2 id="scheduler-delete-title" className="text-sm font-semibold text-foreground">
              Remove scheduled job?
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              Every repeatable job tied to this agent ID will be removed.
            </p>
            <p className="mt-1.5 text-[11px] font-mono text-foreground break-all">
              {pendingDelete.key}
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={deleteMutation.isPending}
                className="px-3 py-1.5 rounded-md border border-border bg-muted text-xs text-foreground hover:bg-accent/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleteMutation.isPending}
                data-testid="confirm-delete-scheduler-job"
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page(): React.JSX.Element {
  return (
    <ErrorBoundary>
      <SchedulerPage />
    </ErrorBoundary>
  );
}
