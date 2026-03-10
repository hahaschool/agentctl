'use client';

import { useQuery } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { machinesQuery, runtimeConfigDriftQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

import { buildWorkerRuntimeInventory, RUNTIME_LABELS } from './types';

function statusTone(
  row: ReturnType<typeof buildWorkerRuntimeInventory>[number]['runtimeRows'][number],
): string {
  if (row.drifted) return 'text-amber-600 dark:text-amber-300';
  if (row.authenticated) return 'text-green-600 dark:text-green-300';
  if (row.installed) return 'text-muted-foreground';
  return 'text-red-600 dark:text-red-300';
}

export function WorkersSyncSection(): React.JSX.Element {
  const machines = useQuery(machinesQuery());
  const drift = useQuery(runtimeConfigDriftQuery());

  const isLoading = machines.isLoading || drift.isLoading;
  const inventory = buildWorkerRuntimeInventory(machines.data ?? [], drift.data);

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 rounded-[24px]" />
          <Skeleton className="h-40 rounded-[24px]" />
        </div>
      ) : inventory.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-border/60 bg-muted/20 p-6 text-sm text-muted-foreground">
          No workers are registered yet. Once workers connect, runtime inventory and drift status
          will appear here.
        </div>
      ) : (
        inventory.map((machine) => (
          <article
            key={machine.machineId}
            className="rounded-[24px] border border-border/50 bg-background/80 p-4 md:p-5"
          >
            <div className="flex flex-col gap-3 border-b border-border/40 pb-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold tracking-tight">{machine.hostname}</h3>
                  <Badge variant="secondary" className="border border-border/40 bg-muted/70">
                    {machine.machineId}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Worker status: {machine.status}. Inventory shows managed sync state and
                  worker-local access discovery per runtime.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled>
                  Inspect local access
                </Button>
                <Button size="sm" variant="outline" disabled>
                  Sync now
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {machine.runtimeRows.map((row) => (
                <div
                  key={`${machine.machineId}-${row.runtime}`}
                  className="rounded-[20px] border border-border/40 bg-muted/25 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{RUNTIME_LABELS[row.runtime]}</div>
                      <div className={cn('mt-1 text-sm font-medium', statusTone(row))}>
                        {row.authenticated
                          ? 'Authenticated'
                          : row.installed
                            ? 'Installed, auth missing'
                            : 'Not installed'}
                      </div>
                    </div>
                    {row.drifted && (
                      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10">
                        Drifted
                      </Badge>
                    )}
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-2xl border border-border/40 bg-background/60 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/80">
                        Local access
                      </div>
                      <div className="mt-1 text-sm font-medium">{row.localCredentialCount}</div>
                    </div>
                    <div className="rounded-2xl border border-border/40 bg-background/60 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/80">
                        Mirrored managed
                      </div>
                      <div className="mt-1 text-sm font-medium">{row.mirroredCredentialCount}</div>
                    </div>
                  </div>

                  <div className="mt-3 text-[12px] text-muted-foreground">
                    Sync status: {row.syncStatus}. Last applied:{' '}
                    {row.lastAppliedAt ? new Date(row.lastAppliedAt).toLocaleString() : 'Never'}.
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))
      )}
    </div>
  );
}
