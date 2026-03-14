'use client';

import type { ManagedRuntime } from '@agentctl/shared';
import { useCallback, useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

import type { ApiAccount, Machine } from '../lib/api';
import { api } from '../lib/api';
import { STORAGE_KEYS } from '../lib/storage-keys';
import { ErrorBanner } from './ErrorBanner';
import { RuntimeAwareMachineSelect } from './RuntimeAwareMachineSelect';
import { RuntimeAwareModelSelect } from './RuntimeAwareModelSelect';
import { RuntimeSelector } from './RuntimeSelector';
import { useToast } from './Toast';

type CreateSessionFormProps = {
  accounts: ApiAccount[];
  onCreated: () => void;
};

export function CreateSessionForm({
  accounts,
  onCreated,
}: CreateSessionFormProps): React.ReactNode {
  const toast = useToast();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machinesLoading, setMachinesLoading] = useState(false);
  const [machineId, setMachineId] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(
    (typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.DEFAULT_MODEL) : null) ?? '',
  );
  const [accountId, setAccountId] = useState('');
  const [runtime, setRuntime] = useState<ManagedRuntime>('claude-code');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch machines on mount
  useEffect(() => {
    setMachinesLoading(true);
    api
      .listMachines()
      .then((list) => {
        setMachines(list);
        if (list.length > 0) {
          const firstOnline = list.find((m) => m.status === 'online');
          const fallback = firstOnline ?? list[0];
          if (fallback) setMachineId((prev) => prev || fallback.id);
        }
      })
      .catch((err: unknown) => {
        setMachines([]);
        toast.error(`Failed to load machines: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        setMachinesLoading(false);
      });
  }, [toast]);

  const resetForm = useCallback(() => {
    setMachineId('');
    setProjectPath('');
    setPrompt('');
    setModel(
      (typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.DEFAULT_MODEL) : null) ??
        '',
    );
    setAccountId('');
    setRuntime('claude-code');
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!machineId) {
      setError('Please select a machine.');
      return;
    }
    const selectedMachine = machines.find((m) => m.id === machineId);
    if (selectedMachine?.status === 'offline') {
      setError('Selected machine is offline. Please choose an online machine.');
      return;
    }
    if (!projectPath.trim()) {
      setError('Project path is required.');
      return;
    }
    if (!projectPath.trim().startsWith('/')) {
      setError('Project path must be an absolute path (start with /)');
      return;
    }
    if (!prompt.trim()) {
      setError('Prompt is required.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.createSession({
        agentId: 'adhoc',
        machineId,
        projectPath: projectPath.trim(),
        prompt: prompt.trim(),
        model: model || undefined,
        accountId: accountId || undefined,
        runtime,
      });
      toast.success(`Session created: ${result.sessionId.slice(0, 16)}...`);
      resetForm();
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [
    machineId,
    projectPath,
    prompt,
    model,
    accountId,
    runtime,
    machines,
    resetForm,
    onCreated,
    toast,
  ]);

  const isDisabled = submitting || !machineId || !projectPath.trim() || !prompt.trim();

  return (
    <div className="px-4 py-4 border-b border-border bg-card/50">
      <div className="text-[13px] font-semibold mb-3 tracking-tight">Create New Session</div>

      {/* biome-ignore lint/a11y/noLabelWithoutControl: RuntimeSelector uses a radiogroup */}
      <label className="block text-[11px] text-muted-foreground mb-1">Runtime</label>
      <div className="mb-2.5">
        <RuntimeSelector value={runtime} onChange={setRuntime} variant="radio" />
      </div>

      <label
        htmlFor="create-session-machine"
        className="block text-[11px] text-muted-foreground mb-1"
      >
        Machine
      </label>
      <div className="mb-2.5">
        <RuntimeAwareMachineSelect
          runtime={runtime}
          value={machineId}
          onChange={setMachineId}
          machines={machines}
          disabled={machinesLoading}
        />
      </div>

      <label
        htmlFor="create-session-project"
        className="block text-[11px] text-muted-foreground mb-1"
      >
        Project Path
      </label>
      <input
        id="create-session-project"
        type="text"
        value={projectPath}
        onChange={(e) => setProjectPath(e.target.value)}
        placeholder="/home/user/project"
        className="w-full px-2.5 py-2 bg-muted text-foreground border border-border rounded-md font-mono text-xs mb-2.5 outline-none box-border transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
      />

      <label
        htmlFor="create-session-prompt"
        className="block text-[11px] text-muted-foreground mb-1"
      >
        Prompt
      </label>
      <textarea
        id="create-session-prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="What should Claude work on?"
        rows={3}
        className="w-full px-2.5 py-2 bg-muted text-foreground border border-border rounded-md text-xs mb-2.5 outline-none resize-y font-[inherit] box-border transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
      />

      <label
        htmlFor="create-session-model"
        className="block text-[11px] text-muted-foreground mb-1"
      >
        Model (optional)
      </label>
      <div className="mb-2.5">
        <RuntimeAwareModelSelect runtime={runtime} value={model} onChange={setModel} />
      </div>

      <label
        htmlFor="create-session-account"
        className="block text-[11px] text-muted-foreground mb-1"
      >
        Account (optional)
      </label>
      <select
        id="create-session-account"
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
        className="w-full px-2.5 py-2 bg-muted text-foreground border border-border rounded-md text-xs mb-3 outline-none transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
      >
        <option value="">Default (auto)</option>
        {accounts
          .filter((a) => a.isActive)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.provider})
            </option>
          ))}
      </select>

      {error && <ErrorBanner message={error} className="mb-2.5" />}

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={isDisabled}
        className={cn(
          'w-full h-9 px-3.5 bg-primary text-white rounded-md text-xs font-medium transition-all duration-200',
          isDisabled
            ? 'opacity-50 cursor-not-allowed'
            : 'opacity-100 cursor-pointer hover:bg-primary/90',
        )}
      >
        {submitting ? 'Creating...' : 'Create Session'}
      </button>
    </div>
  );
}
