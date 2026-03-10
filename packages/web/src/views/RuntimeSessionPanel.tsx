'use client';

import {
  describeHandoffCompletion,
  describeHandoffExecution,
  formatHandoffHistoryFilterLabel,
  formatHandoffStrategyLabel,
  formatMachineSelectionLabel,
  HANDOFF_HISTORY_FILTERS,
  isMachineSelectable,
  matchesHandoffHistoryFilter,
  pickPreferredMachineId,
  sortMachinesForSelection,
  summarizeHandoffAnalytics,
  summarizeNativeImportPreflightStatus,
} from '@agentctl/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Cable, GitBranch, History, Layers3 } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { PathBadge } from '@/components/PathBadge';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { cn } from '@/lib/utils';
import type { Machine, RuntimeSession, RuntimeSessionHandoff } from '../lib/api';
import { formatDateTime, formatDuration, timeAgo, truncate } from '../lib/format-utils';
import {
  machinesQuery,
  runtimeSessionHandoffsQuery,
  runtimeSessionPreflightQuery,
  useForkRuntimeSession,
  useHandoffRuntimeSession,
  useResumeRuntimeSession,
} from '../lib/queries';

const RUNTIME_OPTIONS = [
  { value: 'all', label: 'All runtimes' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
] as const;

const HANDOFF_SKELETON_KEYS = ['handoff-skeleton-a', 'handoff-skeleton-b'] as const;

type RuntimeSessionPreflight = {
  nativeImportCapable: boolean;
  attempt: {
    reason?: string | null;
    metadata?: Record<string, unknown>;
  };
};

type RuntimeSessionPanelProps = {
  selectedSession: RuntimeSession | null;
  onBack?: () => void;
  onSelectedSessionChange?: (id: string | null) => void;
};

function runtimeLabel(runtime: RuntimeSession['runtime']): string {
  return runtime === 'claude-code' ? 'Claude Code' : 'Codex';
}

function summarizeMetadata(metadata: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 6)
    .map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]);
}

function formatNativeImportReason(reason?: string | null): string {
  if (!reason) return 'unknown';
  return reason.replaceAll('_', ' ');
}

function formatTargetCli(targetCli: Record<string, unknown>): string | null {
  const command = typeof targetCli.command === 'string' ? targetCli.command : null;
  const version = typeof targetCli.version === 'string' ? targetCli.version : null;
  if (!command) return version;
  return version ? `${command} (${version})` : command;
}

function formatSourceStorage(sourceStorage: Record<string, unknown>): string | null {
  if (typeof sourceStorage.sessionPath === 'string') return sourceStorage.sessionPath;
  if (typeof sourceStorage.rootPath === 'string') return sourceStorage.rootPath;
  return null;
}

function describeNativeImportAttempt(attempt?: {
  ok: boolean;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}): string | null {
  if (!attempt) {
    return null;
  }

  const details: string[] = [];
  const targetCli =
    typeof attempt.metadata?.targetCli === 'string'
      ? attempt.metadata.targetCli
      : typeof attempt.metadata?.targetCli === 'object' && attempt.metadata.targetCli !== null
        ? formatTargetCli(attempt.metadata.targetCli as Record<string, unknown>)
        : null;
  const sourceStorage =
    typeof attempt.metadata?.sourceStorage === 'string'
      ? attempt.metadata.sourceStorage
      : typeof attempt.metadata?.sourceStorage === 'object' &&
          attempt.metadata.sourceStorage !== null
        ? formatSourceStorage(attempt.metadata.sourceStorage as Record<string, unknown>)
        : null;
  const sourceSessionSummary =
    typeof attempt.metadata?.sourceSessionSummary === 'object' &&
    attempt.metadata.sourceSessionSummary !== null
      ? (attempt.metadata.sourceSessionSummary as Record<string, unknown>)
      : null;
  const messageCounts =
    sourceSessionSummary &&
    typeof sourceSessionSummary.messageCounts === 'object' &&
    sourceSessionSummary.messageCounts !== null
      ? (sourceSessionSummary.messageCounts as Record<string, unknown>)
      : null;
  const userMessages = typeof messageCounts?.user === 'number' ? messageCounts.user : 0;
  const assistantMessages =
    typeof messageCounts?.assistant === 'number' ? messageCounts.assistant : 0;
  const lastActivity =
    typeof sourceSessionSummary?.lastActivity === 'string'
      ? sourceSessionSummary.lastActivity
      : null;

  if (targetCli) {
    details.push(`target CLI ${targetCli}`);
  }
  if (sourceStorage) {
    details.push(`source storage ${sourceStorage}`);
  }
  if (userMessages + assistantMessages > 0) {
    details.push(`${userMessages} user / ${assistantMessages} assistant messages`);
  }
  if (lastActivity) {
    details.push(`last activity ${formatDateTime(lastActivity)}`);
  }

  const suffix = details.length > 0 ? `, ${details.join(', ')}` : '';
  return attempt.ok
    ? `Native import succeeded${suffix}`
    : `Native import unavailable: ${formatNativeImportReason(attempt.reason)}${suffix}`;
}

function describeNativeImportPreflight(preflight?: RuntimeSessionPreflight | null): string | null {
  if (!preflight) {
    return null;
  }

  if (preflight.nativeImportCapable) {
    const targetCli =
      typeof preflight.attempt.metadata?.targetCli === 'string'
        ? preflight.attempt.metadata.targetCli
        : typeof preflight.attempt.metadata?.targetCli === 'object' &&
            preflight.attempt.metadata.targetCli !== null
          ? formatTargetCli(preflight.attempt.metadata.targetCli as Record<string, unknown>)
          : null;
    const storage =
      typeof preflight.attempt.metadata?.sourceStorage === 'string'
        ? preflight.attempt.metadata.sourceStorage
        : typeof preflight.attempt.metadata?.sourceStorage === 'object' &&
            preflight.attempt.metadata.sourceStorage !== null
          ? formatSourceStorage(preflight.attempt.metadata.sourceStorage as Record<string, unknown>)
          : null;
    const details = [
      targetCli ? `target CLI ${targetCli}` : null,
      storage ? `source storage ${storage}` : null,
    ]
      .filter(Boolean)
      .join(', ');

    return details ? `Native import ready, ${details}` : 'Native import ready on this target runtime.';
  }

  const fallbackSummary = describeNativeImportAttempt({
    ok: false,
    reason: preflight.attempt.reason ?? null,
    metadata: preflight.attempt.metadata,
  });
  return fallbackSummary ? `${fallbackSummary}. Snapshot handoff will be used.` : null;
}

function HandoffHistoryItem({ handoff }: { handoff: RuntimeSessionHandoff }): React.JSX.Element {
  const nativeImportSummary = describeNativeImportAttempt(handoff.nativeImportAttempt);

  return (
    <div className="rounded-lg border border-border bg-card/70 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={handoff.status} />
        <span className="text-xs text-muted-foreground font-medium">
          {formatHandoffStrategyLabel(handoff.strategy)}
        </span>
        <span className="text-xs text-muted-foreground">
          {runtimeLabel(handoff.sourceRuntime)} to {runtimeLabel(handoff.targetRuntime)}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        {describeHandoffExecution({
          strategy: handoff.strategy,
          nativeImportAttempt: handoff.nativeImportAttempt,
        })}
      </div>
      <div className="text-sm text-foreground">
        Reason: <span className="font-medium">{handoff.reason}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {handoff.createdAt ? formatDateTime(handoff.createdAt) : 'Created time unavailable'}
      </div>
      <div className="text-sm text-muted-foreground leading-6">
        {handoff.snapshot.diffSummary ||
          handoff.snapshot.conversationSummary ||
          'No snapshot summary'}
      </div>
      {nativeImportSummary && (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">
          {nativeImportSummary}
        </div>
      )}
      {(handoff.snapshot.openTodos?.length ?? 0) > 0 && (
        <div className="text-xs text-muted-foreground">
          Next: {handoff.snapshot.openTodos.slice(0, 2).join(' · ')}
        </div>
      )}
      {handoff.errorMessage && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-2 text-xs text-red-500">
          {handoff.errorMessage}
        </div>
      )}
    </div>
  );
}

export function RuntimeSessionPanel({
  selectedSession,
  onBack,
  onSelectedSessionChange,
}: RuntimeSessionPanelProps): React.JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [resumePrompt, setResumePrompt] = useState('');
  const [resumeModel, setResumeModel] = useState('');
  const [forkPrompt, setForkPrompt] = useState('');
  const [forkModel, setForkModel] = useState('');
  const [forkMachineId, setForkMachineId] = useState('');
  const [handoffTargetRuntime, setHandoffTargetRuntime] =
    useState<RuntimeSession['runtime']>('claude-code');
  const [handoffMachineId, setHandoffMachineId] = useState('');
  const [handoffPrompt, setHandoffPrompt] = useState('');
  const [handoffHistoryFilter, setHandoffHistoryFilter] = useState<
    'all' | 'native-import' | 'fallback' | 'failed'
  >('all');

  const machines = useQuery(machinesQuery());
  const availableMachines = useMemo(
    () => sortMachinesForSelection((machines.data ?? []) as Machine[]),
    [machines.data],
  );
  const machineNames = useMemo(
    () => new Map(availableMachines.map((machine) => [machine.id, machine.hostname] as const)),
    [availableMachines],
  );
  const handoffs = useQuery(runtimeSessionHandoffsQuery(selectedSession?.id ?? '', 20));
  const preflight = useQuery(
    runtimeSessionPreflightQuery(selectedSession?.id ?? '', {
      targetRuntime: handoffTargetRuntime,
      ...(handoffMachineId ? { targetMachineId: handoffMachineId } : {}),
    }),
  );
  const resumeMutation = useResumeRuntimeSession();
  const forkMutation = useForkRuntimeSession();
  const handoffMutation = useHandoffRuntimeSession();

  const metadataSummary = selectedSession ? summarizeMetadata(selectedSession.metadata) : [];
  const canHandoff = Boolean(
    selectedSession?.nativeSessionId &&
      (selectedSession.status === 'active' || selectedSession.status === 'paused'),
  );
  const canResume = Boolean(
    selectedSession?.nativeSessionId &&
      (selectedSession.status === 'paused' ||
        selectedSession.status === 'ended' ||
        selectedSession.status === 'error'),
  );
  const canFork = Boolean(selectedSession?.nativeSessionId);
  const preflightSummary =
    canHandoff && selectedSession && selectedSession.runtime !== handoffTargetRuntime
      ? describeNativeImportPreflight((preflight.data as RuntimeSessionPreflight | undefined) ?? null)
      : null;
  const preflightStatus = summarizeNativeImportPreflightStatus({
    preflight:
      canHandoff && selectedSession && selectedSession.runtime !== handoffTargetRuntime
        ? (((preflight.data as RuntimeSessionPreflight | undefined) ?? null) as
            | Pick<RuntimeSessionPreflight, 'nativeImportCapable'>
            | null)
        : null,
    isLoading:
      Boolean(selectedSession?.id) &&
      preflight.isFetching &&
      selectedSession?.runtime !== handoffTargetRuntime,
  });
  const handoffActionDisabled =
    !canHandoff ||
    handoffMutation.isPending ||
    (Boolean(selectedSession?.id) &&
      preflight.isFetching &&
      selectedSession?.runtime !== handoffTargetRuntime);
  const filteredHandoffs = useMemo(
    () =>
      (((handoffs.data as { handoffs?: RuntimeSessionHandoff[] } | undefined)?.handoffs ?? []).filter(
        (handoff) => matchesHandoffHistoryFilter(handoff, handoffHistoryFilter),
      ) as RuntimeSessionHandoff[]),
    [handoffHistoryFilter, handoffs.data],
  );
  const handoffAnalytics = useMemo(
    () => summarizeHandoffAnalytics(filteredHandoffs),
    [filteredHandoffs],
  );

  useEffect(() => {
    if (!selectedSession) {
      return;
    }
    setHandoffTargetRuntime(selectedSession.runtime === 'codex' ? 'claude-code' : 'codex');
    const preferredMachineId = pickPreferredMachineId(availableMachines, selectedSession.machineId);
    setForkMachineId(preferredMachineId);
    setHandoffMachineId(preferredMachineId);
  }, [availableMachines, selectedSession]);

  const invalidateRuntimeQueries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['runtime-sessions'] });
    void queryClient.invalidateQueries({ queryKey: ['machines'] });
  }, [queryClient]);

  const handleResume = useCallback(async () => {
    if (!selectedSession || !canResume || !resumePrompt.trim()) {
      toast.error('Resume requires a prompt and a resumable session');
      return;
    }

    try {
      await resumeMutation.mutateAsync({
        id: selectedSession.id,
        prompt: resumePrompt.trim(),
        ...(resumeModel.trim() ? { model: resumeModel.trim() } : {}),
      });
      toast.success(`Resumed ${runtimeLabel(selectedSession.runtime)} session`);
      setResumePrompt('');
      setResumeModel('');
      invalidateRuntimeQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to resume runtime session');
    }
  }, [
    canResume,
    invalidateRuntimeQueries,
    resumeModel,
    resumeMutation,
    resumePrompt,
    selectedSession,
    toast,
  ]);

  const handleFork = useCallback(async () => {
    if (!selectedSession || !canFork) {
      toast.error('Fork requires a session with a native session id');
      return;
    }

    try {
      const result = await forkMutation.mutateAsync({
        id: selectedSession.id,
        ...(forkPrompt.trim() ? { prompt: forkPrompt.trim() } : {}),
        ...(forkModel.trim() ? { model: forkModel.trim() } : {}),
        ...(forkMachineId && forkMachineId !== selectedSession.machineId
          ? { targetMachineId: forkMachineId }
          : {}),
      });
      toast.success(`Forked to new ${runtimeLabel(result.session.runtime)} session`);
      setForkPrompt('');
      setForkModel('');
      invalidateRuntimeQueries();
      onSelectedSessionChange?.(result.session.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to fork runtime session');
    }
  }, [
    canFork,
    forkMachineId,
    forkModel,
    forkMutation,
    forkPrompt,
    invalidateRuntimeQueries,
    onSelectedSessionChange,
    selectedSession,
    toast,
  ]);

  const handleHandoff = useCallback(async () => {
    if (!selectedSession || !canHandoff) {
      return;
    }

    try {
      const result = await handoffMutation.mutateAsync({
        id: selectedSession.id,
        targetRuntime: handoffTargetRuntime,
        reason: 'manual',
        ...(handoffMachineId ? { targetMachineId: handoffMachineId } : {}),
        ...(handoffPrompt.trim() ? { prompt: handoffPrompt.trim() } : {}),
      });
      toast.success(
        describeHandoffCompletion({
          targetRuntime: result.session.runtime,
          strategy: result.strategy,
          nativeImportAttempt: result.nativeImportAttempt,
        }),
      );
      setHandoffPrompt('');
      invalidateRuntimeQueries();
      onSelectedSessionChange?.(result.session.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to hand off runtime session');
    }
  }, [
    canHandoff,
    handoffMachineId,
    handoffMutation,
    handoffPrompt,
    handoffTargetRuntime,
    invalidateRuntimeQueries,
    onSelectedSessionChange,
    selectedSession,
    toast,
  ]);

  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="md:hidden text-muted-foreground text-sm shrink-0 hover:text-foreground transition-colors duration-200"
              aria-label="Back to session list"
            >
              {'\u2190'}
            </button>
          )}
          <h2 className="text-sm font-semibold text-foreground">Session Detail</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Managed runtime metadata and handoff timeline for the selected session.
        </p>
      </div>

      {!selectedSession ? (
        <div className="p-4">
          <EmptyState
            title="Select a runtime session"
            description="Choose a managed session from the left to inspect runtime state and handoff history."
          />
        </div>
      ) : (
        <div className="p-4 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              <Layers3 className="h-3 w-3" />
              {runtimeLabel(selectedSession.runtime)}
            </span>
            <StatusBadge status={selectedSession.status} />
            {selectedSession.handoffStrategy && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <ArrowRightLeft className="h-3 w-3" />
                {selectedSession.handoffStrategy}
              </span>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-base font-semibold text-foreground break-all">{selectedSession.id}</div>
            <PathBadge path={selectedSession.projectPath} className="block max-w-full" />
            {selectedSession.worktreePath && (
              <PathBadge path={selectedSession.worktreePath} className="block max-w-full" />
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-background/40 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Machine</div>
              <div className="mt-2 text-sm font-medium text-foreground">
                {machineNames.get(selectedSession.machineId) ?? selectedSession.machineId}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{selectedSession.machineId}</div>
            </div>
            <div className="rounded-lg border border-border bg-background/40 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Native Session
              </div>
              <div className="mt-2 text-sm font-medium text-foreground break-all">
                {selectedSession.nativeSessionId ?? 'Pending runtime assignment'}
              </div>
              {selectedSession.agentId && (
                <div className="mt-1 text-xs text-muted-foreground">Agent {selectedSession.agentId}</div>
              )}
            </div>
            <div className="rounded-lg border border-border bg-background/40 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Timeline</div>
              <div className="mt-2 text-sm text-foreground">
                Started {selectedSession.startedAt ? formatDateTime(selectedSession.startedAt) : 'unknown'}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {selectedSession.lastHeartbeat
                  ? `Heartbeat ${timeAgo(selectedSession.lastHeartbeat)}`
                  : 'No heartbeat yet'}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-background/40 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Handoff Source
              </div>
              <div className="mt-2 text-sm text-foreground break-all">
                {selectedSession.handoffSourceSessionId ?? 'None'}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Config v{selectedSession.configRevision}
              </div>
            </div>
          </div>

          {metadataSummary.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-semibold text-foreground">Metadata</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {metadataSummary.map(([key, value]) => (
                  <div key={key} className="rounded-lg border border-border bg-background/40 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      {key}
                    </div>
                    <div className="mt-2 text-sm text-foreground break-words">
                      {truncate(value, 180)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="text-sm font-semibold text-foreground">Session Actions</div>
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-lg border border-border bg-background/40 p-3 space-y-3">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Resume</div>
                <label className="space-y-1.5 text-sm text-muted-foreground block">
                  <span>Prompt</span>
                  <input
                    aria-label="Resume prompt"
                    value={resumePrompt}
                    disabled={!canResume || resumeMutation.isPending}
                    onChange={(event) => setResumePrompt(event.target.value)}
                    placeholder="Prompt to continue the existing session"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
                <label className="space-y-1.5 text-sm text-muted-foreground block">
                  <span>Model</span>
                  <input
                    aria-label="Resume model"
                    value={resumeModel}
                    disabled={!canResume || resumeMutation.isPending}
                    onChange={(event) => setResumeModel(event.target.value)}
                    placeholder="Optional resume model override"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleResume()}
                  disabled={!canResume || resumeMutation.isPending}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {resumeMutation.isPending ? 'Resuming...' : 'Resume Session'}
                </button>
              </div>

              <div className="rounded-lg border border-border bg-background/40 p-3 space-y-3">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Fork</div>
                <label className="space-y-1.5 text-sm text-muted-foreground block">
                  <span>Prompt</span>
                  <input
                    aria-label="Fork prompt"
                    value={forkPrompt}
                    disabled={!canFork || forkMutation.isPending}
                    onChange={(event) => setForkPrompt(event.target.value)}
                    placeholder="Optional fork prompt"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
                <label className="space-y-1.5 text-sm text-muted-foreground block">
                  <span>Model</span>
                  <input
                    aria-label="Fork model"
                    value={forkModel}
                    disabled={!canFork || forkMutation.isPending}
                    onChange={(event) => setForkModel(event.target.value)}
                    placeholder="Optional fork model override"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
                <label className="space-y-1.5 text-sm text-muted-foreground block">
                  <span>Target machine</span>
                  <select
                    aria-label="Fork target machine"
                    value={forkMachineId}
                    disabled={!canFork || forkMutation.isPending}
                    onChange={(event) => setForkMachineId(event.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {availableMachines.map((machine) => (
                      <option
                        key={machine.id}
                        value={machine.id}
                        disabled={!isMachineSelectable(machine)}
                      >
                        {formatMachineSelectionLabel(machine)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void handleFork()}
                  disabled={!canFork || forkMutation.isPending}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {forkMutation.isPending ? 'Forking...' : 'Fork Session'}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
              <div className="text-sm font-semibold text-foreground">Manual Handoff</div>
            </div>
            <div className="grid gap-3 lg:grid-cols-[220px_220px_minmax(0,1fr)_auto]">
              <label className="space-y-1.5 text-sm text-muted-foreground">
                <span>Target runtime</span>
                <select
                  aria-label="Target runtime"
                  value={handoffTargetRuntime}
                  disabled={!canHandoff || handoffMutation.isPending}
                  onChange={(event) =>
                    setHandoffTargetRuntime(event.target.value as RuntimeSession['runtime'])
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {RUNTIME_OPTIONS.filter((option) => option.value !== 'all').map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      disabled={option.value === selectedSession.runtime}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 text-sm text-muted-foreground">
                <span>Target machine</span>
                <select
                  aria-label="Handoff target machine"
                  value={handoffMachineId}
                  disabled={!canHandoff || handoffMutation.isPending}
                  onChange={(event) => setHandoffMachineId(event.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {availableMachines.map((machine) => (
                    <option
                      key={machine.id}
                      value={machine.id}
                      disabled={!isMachineSelectable(machine)}
                    >
                      {formatMachineSelectionLabel(machine)}
                    </option>
                  ))}
                </select>
              </label>
              {canHandoff && selectedSession.runtime !== handoffTargetRuntime && (
                <div className="lg:col-span-4 flex items-center">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]',
                      preflightStatus.tone === 'success' &&
                        'border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
                      preflightStatus.tone === 'warning' &&
                        'border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-300',
                      preflightStatus.tone === 'neutral' &&
                        'border-border bg-background/60 text-muted-foreground',
                    )}
                  >
                    {preflightStatus.badgeLabel}
                  </span>
                </div>
              )}
              {preflightSummary && (
                <div
                  className={cn(
                    'lg:col-span-4 rounded-md border px-3 py-2 text-xs',
                    (preflight.data as RuntimeSessionPreflight | undefined)?.nativeImportCapable
                      ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
                      : 'border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-300',
                  )}
                >
                  {preflight.isFetching
                    ? 'Refreshing native import preflight...'
                    : preflightSummary}
                </div>
              )}
              <label className="space-y-1.5 text-sm text-muted-foreground">
                <span>Takeover prompt</span>
                <input
                  aria-label="Takeover prompt"
                  value={handoffPrompt}
                  disabled={!canHandoff || handoffMutation.isPending}
                  onChange={(event) => setHandoffPrompt(event.target.value)}
                  placeholder="Optional guidance for the target runtime"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={handoffActionDisabled}
                  onClick={() => void handleHandoff()}
                  className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {handoffMutation.isPending ? 'Handing Off...' : preflightStatus.actionLabel}
                </button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Uses managed snapshot handoff and automatically falls back if native import is unavailable.
            </div>
            {!canHandoff && (
              <div className="text-xs text-muted-foreground">
                Handoff is enabled only for active or paused sessions with a native session id.
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <div className="text-sm font-semibold text-foreground">Handoff History</div>
            </div>
            {handoffs.isLoading ? (
              <div className="space-y-3">
                {HANDOFF_SKELETON_KEYS.map((key) => (
                  <div key={key} className="h-28 rounded-lg bg-muted/60 animate-pulse" />
                ))}
              </div>
            ) : (((handoffs.data as { handoffs?: RuntimeSessionHandoff[] } | undefined)?.handoffs ?? []).length === 0) ? (
              <EmptyState
                title="No handoffs recorded"
                description="This managed session has not been handed off between Claude Code and Codex yet."
              />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {HANDOFF_HISTORY_FILTERS.map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setHandoffHistoryFilter(filter)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-xs font-medium transition',
                        handoffHistoryFilter === filter
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border bg-background/40 text-muted-foreground hover:bg-accent/10',
                      )}
                    >
                      {formatHandoffHistoryFilterLabel(filter)}
                    </button>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-border bg-background/40 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Total</div>
                    <div className="mt-2 text-lg font-semibold text-foreground">{handoffAnalytics.total}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-background/40 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Succeeded</div>
                    <div className="mt-2 text-lg font-semibold text-foreground">{handoffAnalytics.succeeded}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-background/40 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Native Import</div>
                    <div className="mt-2 text-lg font-semibold text-foreground">
                      {handoffAnalytics.nativeImportSuccesses}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-background/40 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Fallbacks</div>
                    <div className="mt-2 text-lg font-semibold text-foreground">
                      {handoffAnalytics.nativeImportFallbacks}
                    </div>
                  </div>
                </div>
                {filteredHandoffs.length === 0 ? (
                  <EmptyState
                    title="No handoffs match this filter"
                    description={`Try a different filter or clear back to ${formatHandoffHistoryFilterLabel('all')}.`}
                  />
                ) : (
                  filteredHandoffs.map((handoff) => (
                    <HandoffHistoryItem key={handoff.id} handoff={handoff} />
                  ))
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-background/40 p-3 text-xs text-muted-foreground space-y-2">
            <div className="flex items-center gap-2">
              <Cable className="h-3.5 w-3.5" />
              Active MCP servers:{' '}
              {(selectedSession.metadata?.activeMcpServers as string[] | undefined)?.length ?? 0}
            </div>
            <div className="flex items-center gap-2">
              <GitBranch className="h-3.5 w-3.5" />
              Worktree path {selectedSession.worktreePath ? 'tracked' : 'not recorded'}
            </div>
            <div className="flex items-center gap-2">
              <History className="h-3.5 w-3.5" />
              Session duration{' '}
              {formatDuration(
                selectedSession.startedAt ?? new Date().toISOString(),
                selectedSession.endedAt,
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
