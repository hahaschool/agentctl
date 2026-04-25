'use client';

import type { MemoryOpsJob } from '@agentctl/shared';
import { AlertTriangleIcon, Loader2Icon, RadioIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { memoryOpsApi } from '@/lib/api/memory-ops';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet';

type MemoryOpsJobEvent = {
  eventId: string;
  jobId: string;
  eventType: 'started' | 'progress' | 'log' | 'completed' | 'failed' | 'cancelled' | 'cancelling';
  level: 'info' | 'warn' | 'error' | null;
  message: string | null;
  progress: MemoryOpsJob['progress'] | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

type JobDetailDrawerProps = {
  open: boolean;
  jobId: string | null;
  machineId: string;
  initialJob: MemoryOpsJob | null;
  onCancel: (jobId: string) => void;
  onOpenChange: (open: boolean) => void;
};

function isLocalExecutor(job: MemoryOpsJob | null, machineId: string): boolean {
  if (!job) return false;
  return job.executorMachineId === machineId;
}

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function formatStatus(status: MemoryOpsJob['status']): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function appendLog(logs: string[], event: MemoryOpsJobEvent): string[] {
  const line = event.message
    ? `[${new Date(event.createdAt).toLocaleTimeString()}] ${event.message}`
    : `[${new Date(event.createdAt).toLocaleTimeString()}] ${event.eventType}`;
  return [...logs, line].slice(-200);
}

export function JobDetailDrawer({
  open,
  jobId,
  machineId,
  initialJob,
  onCancel,
  onOpenChange,
}: JobDetailDrawerProps): React.JSX.Element | null {
  const [job, setJob] = useState<MemoryOpsJob | null>(initialJob);
  const [logs, setLogs] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setJob(initialJob);
  }, [initialJob]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  });

  useEffect(() => {
    if (!open || !jobId) {
      return;
    }

    let active = true;
    setIsLoading(true);
    setLoadError(null);

    void memoryOpsApi
      .getJob(jobId)
      .then((response) => {
        if (!active) return;
        setJob(response.job);
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : 'Failed to load job details.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, jobId]);

  const canStream = open && !!jobId && isLocalExecutor(job, machineId);

  useEffect(() => {
    if (!canStream || !jobId) {
      setStreamConnected(false);
      return;
    }

    const stream = new EventSource(memoryOpsApi.streamUrl(jobId));
    const handleEvent = (rawEvent: MessageEvent) => {
      try {
        const event = JSON.parse(String(rawEvent.data)) as MemoryOpsJobEvent;
        if (event.message) {
          setLogs((current) => appendLog(current, event));
        }
        if (event.progress) {
          setJob((current) =>
            current
              ? {
                  ...current,
                  progress: event.progress ?? current.progress,
                  status:
                    event.eventType === 'completed'
                      ? 'completed'
                      : event.eventType === 'failed'
                        ? 'failed'
                        : event.eventType === 'cancelled'
                          ? 'cancelled'
                          : event.eventType === 'cancelling'
                            ? 'cancelling'
                            : current.status,
                }
              : current,
          );
        }
        if (['completed', 'failed', 'cancelled'].includes(event.eventType)) {
          void memoryOpsApi.getJob(jobId).then((response) => setJob(response.job));
        }
      } catch {
        // Ignore malformed SSE payloads.
      }
    };

    const eventTypes: MemoryOpsJobEvent['eventType'][] = [
      'started',
      'progress',
      'log',
      'completed',
      'failed',
      'cancelled',
      'cancelling',
    ];

    for (const eventType of eventTypes) {
      stream.addEventListener(eventType, handleEvent as EventListener);
    }
    stream.onerror = () => {
      setStreamConnected(false);
      stream.close();
    };
    setStreamConnected(true);

    return () => {
      setStreamConnected(false);
      stream.close();
    };
  }, [canStream, jobId]);

  const canCancel =
    job !== null &&
    ['queued', 'running', 'cancelling'].includes(job.status) &&
    isLocalExecutor(job, machineId);
  const progressSummary = useMemo(() => {
    if (!job) return '—';
    return `${job.progress.processed}/${job.progress.total} processed`;
  }, [job]);

  if (!jobId) {
    return null;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-2xl gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div>
              <SheetTitle className="text-base">Memory Job {jobId}</SheetTitle>
              <SheetDescription>
                {job ? `${formatStatus(job.status)} · ${job.kind}` : 'Loading job details'}
              </SheetDescription>
            </div>
            {job ? <Badge variant="outline">{formatStatus(job.status)}</Badge> : null}
          </div>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
          {loadError ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{loadError}</span>
            </div>
          ) : null}

          {isLoading && !job ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Loading job details…
            </div>
          ) : null}

          {job ? (
            <>
              <section className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border px-3 py-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Progress</p>
                  <p className="mt-2 text-sm font-medium text-foreground">{progressSummary}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Cost ${job.progress.costUsd.toFixed(4)} · Failed {job.progress.failed}
                  </p>
                </div>
                <div className="rounded-lg border px-3 py-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Timing</p>
                  <p className="mt-2 text-sm text-foreground">
                    Started {formatTimestamp(job.startedAt)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Finished {formatTimestamp(job.finishedAt)}
                  </p>
                </div>
              </section>

              <section className="rounded-lg border px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Live stream
                  </p>
                  {isLocalExecutor(job, machineId) ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <RadioIcon
                        className={`size-3 ${streamConnected ? 'text-emerald-500' : 'text-amber-500'}`}
                      />
                      {streamConnected ? 'Connected' : 'Disconnected'}
                    </span>
                  ) : null}
                </div>
                {!isLocalExecutor(job, machineId) ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Live log streaming is only available on the executor peer.
                  </p>
                ) : (
                  <div className="mt-3 max-h-80 overflow-y-auto rounded-md bg-muted/30 p-3 font-mono text-xs leading-5 text-muted-foreground">
                    {logs.length > 0
                      ? logs.map((line) => <div key={line}>{line}</div>)
                      : 'No live logs yet.'}
                    <div ref={logEndRef} />
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>

        <SheetFooter className="border-t border-border">
          {canCancel && job ? (
            <Button variant="outline" onClick={() => onCancel(job.id)}>
              Cancel job
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
