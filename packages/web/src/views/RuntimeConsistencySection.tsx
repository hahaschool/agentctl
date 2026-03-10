'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import {
  runtimeConfigDefaultsQuery,
  runtimeConfigDriftQuery,
  useSyncRuntimeConfig,
  useUpdateRuntimeConfigDefaults,
} from '@/lib/queries';

type FormState = {
  userGlobal: string;
  projectTemplate: string;
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalPolicy: 'untrusted' | 'on-failure' | 'on-request' | 'never';
  environmentInherit: string;
  environmentSet: string;
};

const EMPTY_FORM: FormState = {
  userGlobal: '',
  projectTemplate: '',
  sandbox: 'workspace-write',
  approvalPolicy: 'on-request',
  environmentInherit: '',
  environmentSet: '{}',
};

export function RuntimeConsistencySection(): React.JSX.Element {
  const toast = useToast();
  const defaults = useQuery(runtimeConfigDefaultsQuery());
  const drift = useQuery(runtimeConfigDriftQuery());
  const updateDefaults = useUpdateRuntimeConfigDefaults();
  const sync = useSyncRuntimeConfig();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const initializedConfigHashRef = useRef<string | null>(null);

  useEffect(() => {
    const config = defaults.data?.config;
    const configHash = defaults.data?.hash ?? null;
    if (!config || !configHash || initializedConfigHashRef.current === configHash) return;
    initializedConfigHashRef.current = configHash;
    setForm({
      userGlobal: config.instructions.userGlobal,
      projectTemplate: config.instructions.projectTemplate,
      sandbox: config.sandbox,
      approvalPolicy: config.approvalPolicy,
      environmentInherit: config.environmentPolicy.inherit.join(', '),
      environmentSet: JSON.stringify(config.environmentPolicy.set, null, 2),
    });
  }, [defaults.data?.config, defaults.data?.hash]);

  const driftedMachineIds = useMemo(
    () =>
      Array.from(
        new Set(
          (drift.data?.items ?? []).filter((item) => item.drifted).map((item) => item.machineId),
        ),
      ),
    [drift.data?.items],
  );

  function handleSave(): void {
    const current = defaults.data?.config;
    if (!current) {
      toast.error('No managed runtime defaults are loaded yet.');
      return;
    }

    let environmentSet: Record<string, string>;
    try {
      environmentSet = JSON.parse(form.environmentSet) as Record<string, string>;
    } catch {
      toast.error('Environment JSON must be valid JSON.');
      return;
    }

    updateDefaults.mutate(
      {
        ...current,
        instructions: {
          userGlobal: form.userGlobal,
          projectTemplate: form.projectTemplate,
        },
        sandbox: form.sandbox,
        approvalPolicy: form.approvalPolicy,
        environmentPolicy: {
          inherit: form.environmentInherit
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
          set: environmentSet,
        },
      },
      {
        onSuccess: () => toast.success('Managed runtime defaults saved'),
        onError: (err) => toast.error(`Failed to save runtime defaults: ${err.message}`),
      },
    );
  }

  function handleSyncDrifted(): void {
    const version = defaults.data?.version;
    if (!version || driftedMachineIds.length === 0) {
      return;
    }

    sync.mutate(
      {
        machineIds: driftedMachineIds,
        configVersion: version,
      },
      {
        onSuccess: () => toast.success('Queued sync for drifted machines'),
        onError: (err) => toast.error(`Failed to queue drift sync: ${err.message}`),
      },
    );
  }

  return (
    <div id="runtime-consistency" className="scroll-mt-6 space-y-4">
      <div className="flex items-center justify-between pb-3 mb-1 border-b border-border/30">
        <div>
          <h3 className="text-sm font-semibold">Config Consistency</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Edit the managed Claude/Codex defaults and inspect which machines have drifted.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSyncDrifted}
          disabled={sync.isPending || driftedMachineIds.length === 0}
        >
          Sync Drifted Machines
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1 text-[12px] text-muted-foreground">
          <span>Global instructions</span>
          <textarea
            aria-label="Global instructions"
            className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground"
            value={form.userGlobal}
            onChange={(event) =>
              setForm((current) => ({ ...current, userGlobal: event.target.value }))
            }
          />
        </label>

        <label className="space-y-1 text-[12px] text-muted-foreground">
          <span>Project instructions</span>
          <textarea
            aria-label="Project instructions"
            className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground"
            value={form.projectTemplate}
            onChange={(event) =>
              setForm((current) => ({ ...current, projectTemplate: event.target.value }))
            }
          />
        </label>

        <label className="space-y-1 text-[12px] text-muted-foreground">
          <span>Sandbox</span>
          <select
            aria-label="Sandbox"
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
            value={form.sandbox}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                sandbox: event.target.value as FormState['sandbox'],
              }))
            }
          >
            <option value="read-only">read-only</option>
            <option value="workspace-write">workspace-write</option>
            <option value="danger-full-access">danger-full-access</option>
          </select>
        </label>

        <label className="space-y-1 text-[12px] text-muted-foreground">
          <span>Approval policy</span>
          <select
            aria-label="Approval policy"
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
            value={form.approvalPolicy}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                approvalPolicy: event.target.value as FormState['approvalPolicy'],
              }))
            }
          >
            <option value="untrusted">untrusted</option>
            <option value="on-failure">on-failure</option>
            <option value="on-request">on-request</option>
            <option value="never">never</option>
          </select>
        </label>

        <label className="space-y-1 text-[12px] text-muted-foreground">
          <span>Inherited env vars</span>
          <input
            aria-label="Inherited env vars"
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
            value={form.environmentInherit}
            onChange={(event) =>
              setForm((current) => ({ ...current, environmentInherit: event.target.value }))
            }
          />
        </label>

        <label className="space-y-1 text-[12px] text-muted-foreground">
          <span>Environment JSON</span>
          <textarea
            aria-label="Environment JSON"
            className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground"
            value={form.environmentSet}
            onChange={(event) =>
              setForm((current) => ({ ...current, environmentSet: event.target.value }))
            }
          />
        </label>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={updateDefaults.isPending}>
          Save Defaults
        </Button>
      </div>

      <div className="rounded-lg border border-border/50 overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className="px-3 py-2 text-left font-medium text-muted-foreground">
                Machine
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-muted-foreground">
                Runtime
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-muted-foreground">
                Sync
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-muted-foreground">
                Detail
              </th>
            </tr>
          </thead>
          <tbody>
            {(drift.data?.items ?? []).map((item) => (
              <tr key={item.id} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2">{item.machineId}</td>
                <td className="px-3 py-2">{item.runtime}</td>
                <td className="px-3 py-2">{item.syncStatus}</td>
                <td className="px-3 py-2">
                  {typeof item.metadata.reason === 'string' ? item.metadata.reason : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
