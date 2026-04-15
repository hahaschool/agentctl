'use client';

// ---------------------------------------------------------------------------
// Mesh auto-update section — roadmap §33.11 /settings panel.
//
// Surfaces three affordances for the current node:
//   1. Toggle the opt-in peer-update scheduler (launchd / systemd-user).
//   2. Show the next scheduled run + the most recent run result.
//   3. Stream a `pnpm agentctl peer update --dry-run` run inline so operators
//      can preview the plan without mutating the node.
// ---------------------------------------------------------------------------

import type { AutoUpdateDryRunEvent, AutoUpdateLastRun, AutoUpdateStatus } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { streamAutoUpdateDryRun } from '@/lib/api/mesh-auto-update';
import { meshAutoUpdateQuery, useToggleMeshAutoUpdate } from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1_000) return `${ms}ms`;
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining === 0 ? `${minutes}m` : `${minutes}m ${remaining}s`;
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleString();
}

function statusToneClass(status: AutoUpdateLastRun['status']): string {
  return status === 'success'
    ? 'text-green-600 dark:text-green-300'
    : 'text-red-600 dark:text-red-300';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MeshAutoUpdateSection(): React.JSX.Element {
  const toast = useToast();
  const statusQuery = useQuery(meshAutoUpdateQuery());
  const toggle = useToggleMeshAutoUpdate();

  const [events, setEvents] = useState<AutoUpdateDryRunEvent[]>([]);
  const [dryRunActive, setDryRunActive] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleToggle = useCallback(
    (nextEnabled: boolean) => {
      toggle.mutate(
        { enabled: nextEnabled },
        {
          onSuccess: (status: AutoUpdateStatus) => {
            toast.success(
              status.enabled ? 'Mesh auto-update enabled' : 'Mesh auto-update disabled',
            );
          },
          onError: (err) => {
            toast.error(`Failed to toggle auto-update: ${err.message}`);
          },
        },
      );
    },
    [toast, toggle],
  );

  const handleDryRun = useCallback(() => {
    if (dryRunActive) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setEvents([]);
    setDryRunActive(true);

    streamAutoUpdateDryRun(
      (event) => {
        setEvents((prev) => [...prev, event]);
        if (event.type === 'done' || event.type === 'error') {
          setDryRunActive(false);
        }
      },
      { signal: controller.signal },
    )
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setEvents((prev) => [...prev, { type: 'error', message }]);
        setDryRunActive(false);
      })
      .finally(() => {
        if (abortRef.current === controller) abortRef.current = null;
      });
  }, [dryRunActive]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setDryRunActive(false);
  }, []);

  if (statusQuery.isLoading) {
    return (
      <div className="space-y-3" data-testid="mesh-auto-update-loading">
        <Skeleton className="h-32 rounded-[24px]" />
      </div>
    );
  }

  if (statusQuery.error || !statusQuery.data) {
    return (
      <div className="rounded-[24px] border border-dashed border-border/60 bg-muted/20 p-5 text-sm text-muted-foreground">
        Unable to load mesh auto-update status.
        {statusQuery.error instanceof Error ? ` ${statusQuery.error.message}` : null}
      </div>
    );
  }

  const status = statusQuery.data;
  const lastRun = status.lastRun;
  const supportsToggle = status.platform !== 'unsupported';

  return (
    <article className="rounded-[24px] border border-border/50 bg-background/80 p-4 md:p-5">
      <div className="flex flex-col gap-3 border-b border-border/40 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight">Mesh auto-update</h3>
            <Badge
              variant="outline"
              className={cn(
                'border-border/40',
                status.enabled
                  ? 'bg-green-500/10 text-green-700 dark:text-green-300'
                  : 'bg-muted/60 text-muted-foreground',
              )}
            >
              {status.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
            <Badge variant="secondary" className="border border-border/40 bg-muted/70">
              {status.platform}
            </Badge>
          </div>
          <p className="mt-1 max-w-[64ch] text-sm text-muted-foreground">
            When enabled, this node runs{' '}
            <code className="font-mono">pnpm agentctl peer update</code> on a platform scheduler
            (launchd on macOS, systemd-user on Linux). Scheduler state, next run, and the latest run
            outcome are sourced from the node itself.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={status.enabled ? 'outline' : 'default'}
            disabled={!supportsToggle || toggle.isPending}
            onClick={() => handleToggle(!status.enabled)}
          >
            {toggle.isPending ? 'Working…' : status.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button size="sm" variant="outline" onClick={dryRunActive ? handleCancel : handleDryRun}>
            {dryRunActive ? 'Cancel dry-run' : 'Run dry-run now'}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-border/40 bg-muted/25 p-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/80">
            Next scheduled run
          </div>
          <div className="mt-1 text-sm font-medium">{formatTimestamp(status.nextScheduledRun)}</div>
          {!status.enabled && (
            <div className="mt-2 text-[12px] text-muted-foreground">
              Scheduler is disabled. Enable the toggle to arm the next run.
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border/40 bg-muted/25 p-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/80">
            Last run
          </div>
          {lastRun ? (
            <div className="mt-1 space-y-1">
              <div className={cn('text-sm font-medium', statusToneClass(lastRun.status))}>
                {lastRun.status === 'success' ? 'Succeeded' : 'Failed'} — {lastRun.version}
                {lastRun.dryRun ? ' (dry-run)' : ''}
              </div>
              <div className="text-[12px] text-muted-foreground">
                {formatTimestamp(lastRun.startedAt)} · {formatDuration(lastRun.durationMs)}
              </div>
              {lastRun.error && (
                <div className="mt-1 rounded-md border border-red-500/20 bg-red-500/5 px-2 py-1 font-mono text-[11px] text-red-700 dark:text-red-300">
                  {lastRun.error}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-1 text-sm text-muted-foreground">
              No runs recorded yet for this node.
            </div>
          )}
        </div>
      </div>

      {events.length > 0 && (
        <div
          className="mt-4 rounded-2xl border border-border/40 bg-muted/10 p-3"
          data-testid="mesh-auto-update-log"
        >
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/80">
              Dry-run output
            </div>
            <div className="text-[11px] text-muted-foreground">
              {dryRunActive ? 'Streaming…' : 'Complete'}
            </div>
          </div>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-snug text-muted-foreground">
            {events.map((event, idx) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only log; order never changes
              <DryRunLine key={idx} event={event} />
            ))}
          </pre>
        </div>
      )}
    </article>
  );
}

function DryRunLine({ event }: { event: AutoUpdateDryRunEvent }): React.JSX.Element {
  switch (event.type) {
    case 'start':
      return <div className="text-foreground">$ {event.command}</div>;
    case 'stdout':
      return <span>{event.chunk}</span>;
    case 'stderr':
      return <span className="text-amber-600 dark:text-amber-300">{event.chunk}</span>;
    case 'done':
      return (
        <div className="mt-1 text-foreground">
          [exit {event.exitCode} · {formatDuration(event.durationMs)}]
        </div>
      );
    case 'error':
      return <div className="text-red-600 dark:text-red-300">error: {event.message}</div>;
  }
}
