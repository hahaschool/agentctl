'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import {
  machinesQuery,
  runtimeConfigDefaultsQuery,
  runtimeConfigDriftQuery,
  useRefreshRuntimeConfig,
  useSyncRuntimeConfig,
} from '@/lib/queries';

const RUNTIME_ORDER = ['claude-code', 'codex'] as const;

function runtimeLabel(runtime: (typeof RUNTIME_ORDER)[number]): string {
  return runtime === 'claude-code' ? 'Claude Code' : 'Codex';
}

function loginCommand(runtime: (typeof RUNTIME_ORDER)[number]): string {
  return runtime === 'claude-code' ? 'claude login' : 'codex login';
}

export function RuntimeAccessSection(): React.JSX.Element {
  const toast = useToast();
  const machines = useQuery(machinesQuery());
  const defaults = useQuery(runtimeConfigDefaultsQuery());
  const drift = useQuery(runtimeConfigDriftQuery());
  const sync = useSyncRuntimeConfig();
  const refresh = useRefreshRuntimeConfig();

  const items = drift.data?.items ?? [];

  function handleSync(machineId: string): void {
    const configVersion = defaults.data?.version;
    if (!configVersion) {
      toast.error('No managed runtime defaults are loaded yet.');
      return;
    }

    sync.mutate(
      {
        machineIds: [machineId],
        configVersion,
      },
      {
        onSuccess: () => toast.success(`Queued runtime config sync for ${machineId}`),
        onError: (err) => toast.error(`Failed to sync runtime config: ${err.message}`),
      },
    );
  }

  function handleRefresh(): void {
    refresh.mutate(undefined, {
      onSuccess: () => {
        toast.success('Runtime status refreshed');
        void Promise.all([machines.refetch?.(), drift.refetch?.(), defaults.refetch?.()]);
      },
      onError: (err) => toast.error(`Failed to refresh runtime status: ${err.message}`),
    });
  }

  return (
    <div id="runtime-access" className="scroll-mt-6 space-y-4">
      <div className="flex items-center justify-between pb-3 mb-1 border-b border-border/30">
        <div>
          <h3 className="text-sm font-semibold">Machine Runtime Access</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Inspect machine-local Claude Code and Codex login state, then open a machine terminal to
            complete CLI setup.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refresh.isPending}>
          {refresh.isPending ? 'Refreshing…' : 'Refresh Status'}
        </Button>
      </div>

      <div className="space-y-4">
        {(machines.data ?? []).map((machine) => {
          const machineItems = items.filter((item) => item.machineId === machine.id);
          return (
            <div
              key={machine.id}
              className="rounded-lg border border-border/50 bg-card/40 p-4 space-y-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="text-sm font-semibold">{machine.hostname || machine.id}</h4>
                  <p className="text-[12px] text-muted-foreground">
                    {machine.os} / {machine.arch} · {machine.status}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/machines/${machine.id}/terminal`}>Open Terminal</Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSync(machine.id)}
                    disabled={sync.isPending}
                  >
                    Sync Config
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {RUNTIME_ORDER.map((runtime) => {
                  const item = machineItems.find((candidate) => candidate.runtime === runtime);
                  return (
                    <div key={runtime} className="rounded-md border border-border/40 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <h5 className="text-sm font-medium">{runtimeLabel(runtime)}</h5>
                        <span className="text-[11px] text-muted-foreground">
                          {item?.syncStatus ?? 'unknown'}
                        </span>
                      </div>
                      <div className="space-y-1 text-[13px]">
                        <p>{item?.isInstalled ? 'Installed' : 'Not installed'}</p>
                        <p>{item?.isAuthenticated ? 'Authenticated' : 'Not authenticated'}</p>
                        <p className="text-muted-foreground">
                          Config version {item?.configVersion ?? 'not applied'}
                        </p>
                        {typeof item?.metadata?.reason === 'string' && (
                          <p className="text-amber-600">{item.metadata.reason}</p>
                        )}
                      </div>
                      <div className="rounded-md bg-muted/40 px-2 py-1 text-[12px]">
                        <span className="text-muted-foreground">Login command: </span>
                        <code>{loginCommand(runtime)}</code>
                      </div>
                      <Button asChild size="sm" variant="ghost" className="justify-start">
                        <Link
                          href={`/machines/${machine.id}/terminal?command=${encodeURIComponent(loginCommand(runtime))}`}
                        >
                          {runtime === 'claude-code' ? 'Run Claude Login' : 'Run Codex Login'}
                        </Link>
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
