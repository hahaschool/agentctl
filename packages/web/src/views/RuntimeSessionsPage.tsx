'use client';

import {
  formatMachineSelectionLabel,
  isMachineSelectable,
  pickPreferredMachineId,
  sortMachinesForSelection,
} from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import { Cpu } from 'lucide-react';
import Link from 'next/link';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { FetchingBar } from '@/components/FetchingBar';
import { LastUpdated } from '@/components/LastUpdated';
import { PathBadge } from '@/components/PathBadge';
import { RefreshButton } from '@/components/RefreshButton';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { cn } from '@/lib/utils';
import type { RuntimeSession } from '../lib/api';
import { formatDuration, formatNumber, timeAgo, truncate } from '../lib/format-utils';
import { machinesQuery, runtimeSessionsQuery, useCreateRuntimeSession } from '../lib/queries';
import { RuntimeSessionPanel } from './RuntimeSessionPanel';

const RUNTIME_OPTIONS = [
  { value: 'all', label: 'All runtimes' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
] as const;

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'starting', label: 'Starting' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'handing_off', label: 'Handing Off' },
  { value: 'ended', label: 'Ended' },
  { value: 'error', label: 'Error' },
] as const;

const SESSION_SKELETON_KEYS = [
  'runtime-session-skeleton-a',
  'runtime-session-skeleton-b',
  'runtime-session-skeleton-c',
  'runtime-session-skeleton-d',
] as const;

function runtimeLabel(runtime: RuntimeSession['runtime']): string {
  return runtime === 'claude-code' ? 'Claude Code' : 'Codex';
}

function getSessionActivity(session: RuntimeSession): string | null {
  return session.endedAt ?? session.lastHeartbeat ?? session.startedAt;
}

function matchesSearch(session: RuntimeSession, query: string, extraTerms: string[] = []): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const fields = [
    session.id,
    session.runtime,
    session.nativeSessionId ?? '',
    session.machineId,
    session.agentId ?? '',
    session.projectPath,
    session.worktreePath ?? '',
    String(session.metadata?.model ?? ''),
    ...extraTerms,
  ];
  return fields.some((field) => field.toLowerCase().includes(q));
}

export function RuntimeSessionsPage(): React.JSX.Element {
  const toast = useToast();
  const [runtimeFilter, setRuntimeFilter] =
    useState<(typeof RUNTIME_OPTIONS)[number]['value']>('all');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]['value']>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createRuntime, setCreateRuntime] = useState<RuntimeSession['runtime']>('codex');
  const [createMachineId, setCreateMachineId] = useState('');
  const [createProjectPath, setCreateProjectPath] = useState('');
  const [createPrompt, setCreatePrompt] = useState('');
  const [createModel, setCreateModel] = useState('');

  const sessions = useQuery(runtimeSessionsQuery({ limit: 100 }));
  const machines = useQuery(machinesQuery());
  const createMutation = useCreateRuntimeSession();
  const availableMachines = useMemo(
    () => sortMachinesForSelection(machines.data ?? []),
    [machines.data],
  );

  const machineNames = useMemo(() => {
    const entries = availableMachines.map((machine) => [machine.id, machine.hostname] as const);
    return new Map(entries);
  }, [availableMachines]);

  const filteredSessions = useMemo(() => {
    const list = sessions.data?.sessions ?? [];
    return [...list]
      .filter((session) => (runtimeFilter === 'all' ? true : session.runtime === runtimeFilter))
      .filter((session) => (statusFilter === 'all' ? true : session.status === statusFilter))
      .filter((session) =>
        matchesSearch(session, searchQuery, [machineNames.get(session.machineId) ?? '']),
      )
      .sort((a, b) => {
        const aTime = getSessionActivity(a);
        const bTime = getSessionActivity(b);
        return new Date(bTime ?? 0).getTime() - new Date(aTime ?? 0).getTime();
      });
  }, [machineNames, runtimeFilter, searchQuery, sessions.data?.sessions, statusFilter]);

  useEffect(() => {
    if (filteredSessions.length === 0) {
      setSelectedId(null);
      return;
    }

    if (!selectedId || !filteredSessions.some((session) => session.id === selectedId)) {
      setSelectedId(filteredSessions[0]?.id ?? null);
    }
  }, [filteredSessions, selectedId]);

  const selectedSession = useMemo(
    () => filteredSessions.find((session) => session.id === selectedId) ?? null,
    [filteredSessions, selectedId],
  );

  const refreshAll = useCallback(() => {
    void sessions.refetch();
    void machines.refetch();
  }, [machines, sessions]);

  const errorMessage = sessions.error?.message ?? machines.error?.message;
  const totalCount = sessions.data?.count ?? 0;
  const activeCount = (sessions.data?.sessions ?? []).filter(
    (session) => session.status === 'active',
  ).length;
  const handingOffCount = (sessions.data?.sessions ?? []).filter(
    (session) => session.status === 'handing_off',
  ).length;
  const combinedUpdatedAt = Math.max(sessions.dataUpdatedAt || 0, machines.dataUpdatedAt || 0);

  useEffect(() => {
    if (createMachineId) return;
    const preferredMachineId = pickPreferredMachineId(availableMachines);
    if (preferredMachineId) {
      setCreateMachineId(preferredMachineId);
    }
  }, [availableMachines, createMachineId]);

  const handleCreateSession = useCallback(async () => {
    if (!createMachineId || !createProjectPath.trim() || !createPrompt.trim()) {
      toast.error('Runtime, machine, project path, and prompt are required');
      return;
    }

    try {
      const result = await createMutation.mutateAsync({
        runtime: createRuntime,
        machineId: createMachineId,
        projectPath: createProjectPath.trim(),
        prompt: createPrompt.trim(),
        ...(createModel.trim() ? { model: createModel.trim() } : {}),
      });
      toast.success(`Created ${runtimeLabel(result.session.runtime)} session`);
      setSelectedId(result.session.id);
      setCreateProjectPath('');
      setCreatePrompt('');
      setCreateModel('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create runtime session');
    }
  }, [
    createMachineId,
    createModel,
    createMutation,
    createProjectPath,
    createPrompt,
    createRuntime,
    toast,
  ]);

  return (
    <div className="relative p-4 md:p-6 max-w-[1280px] animate-page-enter space-y-5">
      <FetchingBar isFetching={sessions.isFetching || machines.isFetching} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Runtime Sessions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Unified managed session view for Claude Code and Codex, with cross-runtime handoff
            history.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/sessions"
            className="px-3 py-1.5 bg-transparent text-primary border border-primary/50 rounded-md text-xs font-medium no-underline hover:bg-primary/10 transition-colors"
          >
            Classic Sessions
          </Link>
          <LastUpdated dataUpdatedAt={combinedUpdatedAt} />
          <RefreshButton
            onClick={refreshAll}
            isFetching={sessions.isFetching || machines.isFetching}
          />
        </div>
      </div>

      {errorMessage && <ErrorBanner message={errorMessage} onRetry={refreshAll} />}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Managed</div>
          <div className="mt-2 text-2xl font-semibold">{formatNumber(totalCount)}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Sessions under runtime management
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Active</div>
          <div className="mt-2 text-2xl font-semibold">{formatNumber(activeCount)}</div>
          <div className="mt-1 text-sm text-muted-foreground">Live sessions still executing</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Switching</div>
          <div className="mt-2 text-2xl font-semibold">{formatNumber(handingOffCount)}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Sessions currently handing off runtimes
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_220px_220px]">
          <label className="space-y-1.5 text-sm text-muted-foreground">
            <span>Search</span>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search runtime sessions..."
              aria-label="Search runtime sessions"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/40"
            />
          </label>
          <label className="space-y-1.5 text-sm text-muted-foreground">
            <span>Runtime</span>
            <select
              aria-label="Filter by runtime"
              value={runtimeFilter}
              onChange={(event) => setRuntimeFilter(event.target.value as typeof runtimeFilter)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
            >
              {RUNTIME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-sm text-muted-foreground">
            <span>Status</span>
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Create Managed Session</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Start a new Claude Code or Codex session under managed runtime control.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-[180px_220px_minmax(0,1fr)]">
          <label className="space-y-1.5 text-sm text-muted-foreground">
            <span>Runtime</span>
            <select
              aria-label="Create runtime"
              value={createRuntime}
              onChange={(event) =>
                setCreateRuntime(event.target.value as RuntimeSession['runtime'])
              }
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
            >
              {RUNTIME_OPTIONS.filter((option) => option.value !== 'all').map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-sm text-muted-foreground">
            <span>Machine</span>
            <select
              aria-label="Create machine"
              value={createMachineId}
              onChange={(event) => setCreateMachineId(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
            >
              <option value="">Select machine</option>
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
          <label className="space-y-1.5 text-sm text-muted-foreground">
            <span>Project path</span>
            <input
              aria-label="Create project path"
              value={createProjectPath}
              onChange={(event) => setCreateProjectPath(event.target.value)}
              placeholder="/abs/path/to/project"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/40"
            />
          </label>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto]">
          <label className="space-y-1.5 text-sm text-muted-foreground">
            <span>Prompt</span>
            <input
              aria-label="Create prompt"
              value={createPrompt}
              onChange={(event) => setCreatePrompt(event.target.value)}
              placeholder="Tell the runtime what to do"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/40"
            />
          </label>
          <label className="space-y-1.5 text-sm text-muted-foreground">
            <span>Model</span>
            <input
              aria-label="Create model"
              value={createModel}
              onChange={(event) => setCreateModel(event.target.value)}
              placeholder="Optional model override"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/40"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void handleCreateSession()}
              disabled={createMutation.isPending}
              className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createMutation.isPending ? 'Creating...' : 'Create Managed Session'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Managed Session List</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Showing {filteredSessions.length} of {totalCount} runtime sessions
              </p>
            </div>
          </div>

          {sessions.isLoading ? (
            <div className="p-4 space-y-3">
              {SESSION_SKELETON_KEYS.map((key) => (
                <div key={key} className="h-24 rounded-lg bg-muted/60 animate-pulse" />
              ))}
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No runtime sessions match the filters"
                description="Adjust runtime/status filters or refresh after creating a managed session."
              />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredSessions.map((session) => {
                const activity = getSessionActivity(session);
                const machineName = machineNames.get(session.machineId) ?? session.machineId;
                const isSelected = session.id === selectedId;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setSelectedId(session.id)}
                    className={cn(
                      'w-full text-left px-4 py-3 transition-colors hover:bg-accent/20',
                      isSelected && 'bg-accent/10',
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            <Cpu className="h-3 w-3" aria-hidden="true" />
                            {runtimeLabel(session.runtime)}
                          </span>
                          <StatusBadge status={session.status} />
                        </div>
                        <div className="text-sm font-medium text-foreground break-all">
                          {session.id}
                        </div>
                        <PathBadge path={session.projectPath} />
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{machineName}</span>
                          {session.nativeSessionId && (
                            <span>native {truncate(session.nativeSessionId, 24)}</span>
                          )}
                          {activity && <span>{timeAgo(activity)}</span>}
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground space-y-1">
                        <div>Config v{session.configRevision}</div>
                        <div>
                          {formatDuration(
                            session.startedAt ?? new Date().toISOString(),
                            session.endedAt,
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <RuntimeSessionPanel
          selectedSession={selectedSession}
          onSelectedSessionChange={setSelectedId}
        />
      </div>
    </div>
  );
}
