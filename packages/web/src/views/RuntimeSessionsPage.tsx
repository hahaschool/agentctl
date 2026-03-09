'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, Cable, Cpu, GitBranch, History, Layers3 } from 'lucide-react';
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
import type {
  RuntimeSession,
  RuntimeSessionHandoff,
} from '../lib/api';
import { formatDateTime, formatDuration, formatNumber, timeAgo, truncate } from '../lib/format-utils';
import {
  machinesQuery,
  useHandoffRuntimeSession,
  runtimeSessionHandoffsQuery,
  runtimeSessionsQuery,
} from '../lib/queries';

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

function summarizeMetadata(metadata: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 6)
    .map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]);
}

function HandoffHistoryItem({ handoff }: { handoff: RuntimeSessionHandoff }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card/70 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={handoff.status} />
        <span className="text-xs text-muted-foreground font-medium">{handoff.strategy}</span>
        <span className="text-xs text-muted-foreground">
          {runtimeLabel(handoff.sourceRuntime)} to {runtimeLabel(handoff.targetRuntime)}
        </span>
      </div>
      <div className="text-sm text-foreground">
        Reason: <span className="font-medium">{handoff.reason}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {handoff.createdAt ? formatDateTime(handoff.createdAt) : 'Created time unavailable'}
      </div>
      <div className="text-sm text-muted-foreground leading-6">
        {handoff.snapshot.diffSummary || handoff.snapshot.conversationSummary || 'No snapshot summary'}
      </div>
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

export function RuntimeSessionsPage(): React.JSX.Element {
  const toast = useToast();
  const [runtimeFilter, setRuntimeFilter] = useState<(typeof RUNTIME_OPTIONS)[number]['value']>('all');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]['value']>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [handoffTargetRuntime, setHandoffTargetRuntime] = useState<RuntimeSession['runtime']>('claude-code');
  const [handoffPrompt, setHandoffPrompt] = useState('');

  const sessions = useQuery(runtimeSessionsQuery({ limit: 100 }));
  const machines = useQuery(machinesQuery());
  const handoffs = useQuery(runtimeSessionHandoffsQuery(selectedId ?? '', 20));
  const handoffMutation = useHandoffRuntimeSession();

  const machineNames = useMemo(() => {
    const entries = (machines.data ?? []).map((machine) => [machine.id, machine.hostname] as const);
    return new Map(entries);
  }, [machines.data]);

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
  }, [runtimeFilter, searchQuery, sessions.data?.sessions, statusFilter]);

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
    if (selectedId) {
      void handoffs.refetch();
    }
  }, [handoffs, machines, selectedId, sessions]);

  const errorMessage = sessions.error?.message ?? machines.error?.message ?? handoffs.error?.message;
  const totalCount = sessions.data?.count ?? 0;
  const activeCount = (sessions.data?.sessions ?? []).filter((session) => session.status === 'active').length;
  const handingOffCount = (sessions.data?.sessions ?? []).filter(
    (session) => session.status === 'handing_off',
  ).length;
  const combinedUpdatedAt = Math.max(
    sessions.dataUpdatedAt || 0,
    machines.dataUpdatedAt || 0,
    handoffs.dataUpdatedAt || 0,
  );
  const metadataSummary = selectedSession ? summarizeMetadata(selectedSession.metadata) : [];
  const canHandoff = Boolean(
    selectedSession &&
      selectedSession.nativeSessionId &&
      (selectedSession.status === 'active' || selectedSession.status === 'paused'),
  );

  useEffect(() => {
    if (!selectedSession) return;
    setHandoffTargetRuntime(selectedSession.runtime === 'codex' ? 'claude-code' : 'codex');
  }, [selectedSession]);

  const handleHandoff = useCallback(async () => {
    if (!selectedSession || !canHandoff) {
      return;
    }

    try {
      const result = await handoffMutation.mutateAsync({
        id: selectedSession.id,
        targetRuntime: handoffTargetRuntime,
        reason: 'manual',
        ...(handoffPrompt.trim() ? { prompt: handoffPrompt.trim() } : {}),
      });
      toast.success(`Handed off to ${runtimeLabel(result.session.runtime)}`);
      setSelectedId(result.session.id);
      setHandoffPrompt('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to hand off runtime session');
    }
  }, [canHandoff, handoffMutation, handoffPrompt, handoffTargetRuntime, selectedSession, toast]);

  return (
    <div className="relative p-4 md:p-6 max-w-[1280px] animate-page-enter space-y-5">
      <FetchingBar
        isFetching={sessions.isFetching || machines.isFetching || (Boolean(selectedId) && handoffs.isFetching)}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Runtime Sessions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Unified managed session view for Claude Code and Codex, with cross-runtime handoff history.
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
          <RefreshButton onClick={refreshAll} isFetching={sessions.isFetching || machines.isFetching} />
        </div>
      </div>

      {errorMessage && <ErrorBanner message={errorMessage} onRetry={refreshAll} />}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Managed</div>
          <div className="mt-2 text-2xl font-semibold">{formatNumber(totalCount)}</div>
          <div className="mt-1 text-sm text-muted-foreground">Sessions under runtime management</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Active</div>
          <div className="mt-2 text-2xl font-semibold">{formatNumber(activeCount)}</div>
          <div className="mt-1 text-sm text-muted-foreground">Live sessions still executing</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Switching</div>
          <div className="mt-2 text-2xl font-semibold">{formatNumber(handingOffCount)}</div>
          <div className="mt-1 text-sm text-muted-foreground">Sessions currently handing off runtimes</div>
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
              onChange={(event) => setRuntimeFilter(event.target.value as (typeof runtimeFilter))}
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
              onChange={(event) => setStatusFilter(event.target.value as (typeof statusFilter))}
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
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`runtime-session-skeleton-${index}`} className="h-24 rounded-lg bg-muted/60 animate-pulse" />
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
                            <Cpu className="h-3 w-3" />
                            {runtimeLabel(session.runtime)}
                          </span>
                          <StatusBadge status={session.status} />
                        </div>
                        <div className="text-sm font-medium text-foreground break-all">{session.id}</div>
                        <PathBadge path={session.projectPath} />
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{machineName}</span>
                          {session.nativeSessionId && <span>native {truncate(session.nativeSessionId, 24)}</span>}
                          {activity && <span>{timeAgo(activity)}</span>}
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground space-y-1">
                        <div>Config v{session.configRevision}</div>
                        <div>{formatDuration(session.startedAt ?? new Date().toISOString(), session.endedAt)}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Session Detail</h2>
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
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Native Session</div>
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
                    {selectedSession.lastHeartbeat ? `Heartbeat ${timeAgo(selectedSession.lastHeartbeat)}` : 'No heartbeat yet'}
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-background/40 p-3">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Handoff Source</div>
                  <div className="mt-2 text-sm text-foreground break-all">
                    {selectedSession.handoffSourceSessionId ?? 'None'}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Config v{selectedSession.configRevision}</div>
                </div>
              </div>

              {metadataSummary.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-foreground">Metadata</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {metadataSummary.map(([key, value]) => (
                      <div key={key} className="rounded-lg border border-border bg-background/40 p-3">
                        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{key}</div>
                        <div className="mt-2 text-sm text-foreground break-words">{truncate(value, 180)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                  <div className="text-sm font-semibold text-foreground">Manual Handoff</div>
                </div>
                <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
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
                      disabled={!canHandoff || handoffMutation.isPending}
                      onClick={() => void handleHandoff()}
                      className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {handoffMutation.isPending ? 'Handing Off...' : 'Start Handoff'}
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
                    {Array.from({ length: 2 }).map((_, index) => (
                      <div key={`handoff-skeleton-${index}`} className="h-28 rounded-lg bg-muted/60 animate-pulse" />
                    ))}
                  </div>
                ) : (handoffs.data?.handoffs ?? []).length === 0 ? (
                  <EmptyState
                    title="No handoffs recorded"
                    description="This managed session has not been handed off between Claude Code and Codex yet."
                  />
                ) : (
                  <div className="space-y-3">
                    {(handoffs.data?.handoffs ?? []).map((handoff) => (
                      <HandoffHistoryItem key={handoff.id} handoff={handoff} />
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border bg-background/40 p-3 text-xs text-muted-foreground space-y-2">
                <div className="flex items-center gap-2">
                  <Cable className="h-3.5 w-3.5" />
                  Active MCP servers: {(selectedSession.metadata?.activeMcpServers as string[] | undefined)?.length ?? 0}
                </div>
                <div className="flex items-center gap-2">
                  <GitBranch className="h-3.5 w-3.5" />
                  Worktree path {selectedSession.worktreePath ? 'tracked' : 'not recorded'}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
