'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Breadcrumb } from '@/components/Breadcrumb';
import { ConfirmButton } from '@/components/ConfirmButton';
import { CopyableText } from '@/components/CopyableText';
import { ErrorBanner } from '@/components/ErrorBanner';
import { FetchingBar } from '@/components/FetchingBar';
import { LastUpdated } from '@/components/LastUpdated';
import { LiveTimeAgo } from '@/components/LiveTimeAgo';
import { RefreshButton } from '@/components/RefreshButton';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { formatCost, formatDate, formatDuration, formatDurationMs } from '@/lib/format-utils';
import {
  accountsQuery,
  agentQuery,
  agentRunsQuery,
  machinesQuery,
  sessionsQuery,
  useStartAgent,
  useStopAgent,
  useUpdateAgent,
} from '@/lib/queries';
import type { AgentRun } from '@/lib/api';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function AgentDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const agentId = params.id;

  const agent = useQuery(agentQuery(agentId));
  const runs = useQuery(agentRunsQuery(agentId));
  const agentSessions = useQuery(sessionsQuery({ agentId, limit: 20 }));
  const accounts = useQuery(accountsQuery());
  const machinesList = useQuery(machinesQuery());

  const startAgent = useStartAgent();
  const stopAgent = useStopAgent();
  const updateAgent = useUpdateAgent();
  const toast = useToast();

  useHotkeys(
    useMemo(
      () => ({
        r: () => {
          void agent.refetch();
          void runs.refetch();
        },
      }),
      [agent, runs],
    ),
  );

  const [promptVisible, setPromptVisible] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [systemPromptExpanded, setSystemPromptExpanded] = useState(false);

  // -- Edit form state --
  const [editName, setEditName] = useState('');
  const [editMachineId, setEditMachineId] = useState('');
  const [editType, setEditType] = useState('');
  const [editSchedule, setEditSchedule] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editMaxTurns, setEditMaxTurns] = useState('');

  // Sync form state only when editOpen transitions from false → true, so that
  // background refetches of agent.data do not clobber user edits mid-session.
  const prevEditOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = prevEditOpenRef.current;
    prevEditOpenRef.current = editOpen;
    if (editOpen && !wasOpen && agent.data) {
      const d = agent.data;
      setEditName(d.name);
      setEditMachineId(d.machineId);
      setEditType(d.type);
      setEditSchedule(d.schedule ?? '');
      setEditModel((d.config?.model as string) ?? '');
      setEditMaxTurns(d.config?.maxTurns != null ? String(d.config.maxTurns) : '');
    }
  }, [editOpen, agent.data]);

  const accountList = accounts.data ?? [];
  const machines = machinesList.data ?? [];

  // -- Handlers --

  const handleAccountChange = (value: string): void => {
    const newAccountId = value === '__none__' ? null : value;
    updateAgent.mutate(
      { id: agentId, accountId: newAccountId },
      {
        onSuccess: () => {
          toast.success(newAccountId ? 'Account assigned' : 'Account removed');
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : String(err));
        },
      },
    );
  };

  const handleStart = (): void => {
    if (!prompt.trim()) return;
    startAgent.mutate(
      { id: agentId, prompt: prompt.trim() },
      {
        onSuccess: () => {
          toast.success('Agent started');
          setPrompt('');
          setPromptVisible(false);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : String(err));
        },
      },
    );
  };

  const handleStop = (): void => {
    stopAgent.mutate(agentId, {
      onSuccess: () => toast.success('Agent stopped'),
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    });
  };

  const handleEditSave = (): void => {
    if (!editName.trim()) return;

    // Build config, merging new values with existing config
    const existingConfig = (agent.data?.config ?? {}) as Record<string, unknown>;
    const config: Record<string, unknown> = { ...existingConfig };

    if (editModel.trim()) {
      config.model = editModel.trim();
    } else {
      delete config.model;
    }

    if (editMaxTurns.trim()) {
      const parsed = Number(editMaxTurns);
      if (Number.isFinite(parsed) && parsed > 0) {
        config.maxTurns = parsed;
      }
    } else {
      delete config.maxTurns;
    }

    updateAgent.mutate(
      {
        id: agentId,
        name: editName.trim(),
        machineId: editMachineId,
        type: editType,
        schedule: editSchedule.trim() || null,
        config,
      },
      {
        onSuccess: () => {
          toast.success('Agent updated');
          setEditOpen(false);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : String(err));
        },
      },
    );
  };

  // -- Loading state --

  if (agent.isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-[1000px]">
        <div className="mb-5">
          <Skeleton className="h-4 w-32 mb-4" />
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          {['sk-1', 'sk-2', 'sk-3', 'sk-4', 'sk-5', 'sk-6'].map((key) => (
            <Skeleton key={key} className="h-16 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }

  // -- Error state --

  if (agent.error) {
    return (
      <div className="p-4 md:p-6 max-w-[1000px]">
        <Breadcrumb items={[{ label: 'Agents', href: '/agents' }, { label: 'Error' }]} />
        <ErrorBanner
          message={`Failed to load agent: ${agent.error.message}`}
          onRetry={() => void agent.refetch()}
          className="mt-6"
        />
      </div>
    );
  }

  const data = agent.data;

  if (!data) {
    return (
      <div className="p-4 md:p-6 max-w-[1000px]">
        <Breadcrumb items={[{ label: 'Agents', href: '/agents' }, { label: 'Error' }]} />
        <div className="mt-6 text-center text-muted-foreground text-sm py-12">Agent not found.</div>
      </div>
    );
  }

  const runList = runs.data ?? [];

  return (
    <div className="relative p-4 md:p-6 max-w-[1000px] animate-page-enter">
      <FetchingBar isFetching={(agent.isFetching || runs.isFetching) && !agent.isLoading} />
      <Breadcrumb items={[{ label: 'Agents', href: '/agents' }, { label: data.name }]} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-[22px] font-semibold tracking-tight">{data.name}</h1>
          <StatusBadge status={data.status} />
          {(data.config?.model as string | undefined) && (
            <span className="font-mono bg-purple-500/10 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded-sm border border-purple-500/30 text-[11px]">
              {data.config?.model as string}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
        </div>
        <div className="flex gap-2">
          {data.status === 'running' ? (
            <ConfirmButton
              label={stopAgent.isPending ? 'Stopping...' : 'Stop'}
              confirmLabel="Confirm Stop"
              onConfirm={handleStop}
              disabled={stopAgent.isPending}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-destructive text-destructive-foreground cursor-pointer"
              confirmClassName="px-3 py-1.5 text-sm font-medium rounded-md bg-red-600 text-white animate-pulse cursor-pointer"
            />
          ) : promptVisible ? (
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleStart();
                  if (e.key === 'Escape') {
                    setPromptVisible(false);
                    setPrompt('');
                  }
                }}
                placeholder="Enter prompt..."
                aria-label="Prompt to start agent"
                className="px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs outline-none min-w-[200px] transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
              />
              <Button
                size="sm"
                onClick={handleStart}
                disabled={!prompt.trim() || startAgent.isPending}
              >
                {startAgent.isPending ? 'Starting...' : 'Go'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPromptVisible(false);
                  setPrompt('');
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setPromptVisible(true)}>
              Start
            </Button>
          )}
          <LastUpdated dataUpdatedAt={agent.dataUpdatedAt} />
          <RefreshButton
            onClick={() => {
              void agent.refetch();
              void runs.refetch();
            }}
            isFetching={(agent.isFetching || runs.isFetching) && !agent.isLoading}
          />
        </div>
      </div>

      {/* Info grid */}
      <Card className="mb-4">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Agent Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
            <InfoField label="ID">
              <CopyableText value={data.id} maxDisplay={16} />
            </InfoField>
            <InfoField label="Machine">
              {(() => {
                const m = machines.find((machine) => machine.id === data.machineId);
                return m ? (
                  <Link
                    href={`/machines/${data.machineId}`}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 underline underline-offset-2 text-xs"
                  >
                    {m.hostname}
                  </Link>
                ) : (
                  <CopyableText value={data.machineId} maxDisplay={16} />
                );
              })()}
            </InfoField>
            <InfoField label="Type">
              <span className="capitalize">{data.type}</span>
            </InfoField>
            <InfoField label="Schedule">
              <span className="font-mono text-xs">{data.schedule ?? 'None'}</span>
            </InfoField>
            <InfoField label="Project Path">
              <span className="font-mono text-xs break-all">{data.projectPath ?? 'Not set'}</span>
            </InfoField>
            <InfoField label="Branch">
              <span className="font-mono text-xs">{data.worktreeBranch ?? 'Not set'}</span>
            </InfoField>
            <InfoField label="Account">
              <Select
                value={data.accountId ?? '__none__'}
                onValueChange={handleAccountChange}
                disabled={updateAgent.isPending}
              >
                <SelectTrigger
                  size="sm"
                  className="h-7 min-w-[140px] text-xs"
                  aria-label="Select account"
                >
                  <SelectValue placeholder="No account assigned" />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">None</span>
                  </SelectItem>
                  {accountList.length > 0 && <SelectSeparator />}
                  {accountList.map((acct) => (
                    <SelectItem key={acct.id} value={acct.id}>
                      {acct.name}{' '}
                      <span className="text-muted-foreground text-[10px]">({acct.provider})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </InfoField>
            <InfoField label="Created">
              <span>{formatDate(data.createdAt)}</span>
            </InfoField>
            <InfoField label="Last Run">
              <span>{data.lastRunAt ? <LiveTimeAgo date={data.lastRunAt} /> : 'Never'}</span>
            </InfoField>
            {data.currentSessionId && (
              <InfoField label="Current Session">
                <Link
                  href={`/sessions/${data.currentSessionId}`}
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 underline underline-offset-2 font-mono text-xs"
                >
                  {data.currentSessionId.slice(0, 12)}...
                </Link>
              </InfoField>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Cost cards */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] font-medium text-muted-foreground mb-1.5">
              Last Run Cost
            </div>
            <div className="text-2xl font-semibold text-foreground">
              {formatCost(data.lastCostUsd)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] font-medium text-muted-foreground mb-1.5">Total Cost</div>
            <div className="text-2xl font-semibold text-foreground">
              {formatCost(data.totalCostUsd)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Agent Configuration */}
      {data.config && Object.keys(data.config).length > 0 && (
        <Card className="mb-4" data-testid="agent-config-card">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm">Agent Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
              {(data.config.model as string | undefined) && (
                <InfoField label="Model">
                  <span className="font-mono bg-purple-500/10 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded-sm border border-purple-500/30 text-[11px]">
                    {data.config.model as string}
                  </span>
                </InfoField>
              )}
              <InfoField label="Max Turns">
                <span className="font-mono text-xs">
                  {data.config.maxTurns != null ? String(data.config.maxTurns) : 'Unlimited'}
                </span>
              </InfoField>
              <InfoField label="Permission Mode">
                <span className="font-mono text-xs">
                  {data.config.permissionMode ?? 'default'}
                </span>
              </InfoField>
              <InfoField label="Allowed Tools">
                <span className="text-xs">
                  {(data.config.allowedTools ?? []).length > 0
                    ? (data.config.allowedTools as string[]).join(', ')
                    : 'All'}
                </span>
              </InfoField>
              <InfoField label="Disallowed Tools">
                <span className="text-xs">
                  {(data.config.disallowedTools ?? []).length > 0
                    ? (data.config.disallowedTools as string[]).join(', ')
                    : 'None'}
                </span>
              </InfoField>
              {(data.config.systemPrompt as string | undefined) && (
                <div className="col-span-2 md:col-span-3">
                  <InfoField label="System Prompt">
                    <div className="font-mono text-xs whitespace-pre-wrap break-words bg-muted/50 rounded-md p-2 border border-border/50">
                      {systemPromptExpanded || (data.config.systemPrompt as string).length <= 200
                        ? (data.config.systemPrompt as string)
                        : `${(data.config.systemPrompt as string).slice(0, 200)}...`}
                    </div>
                    {(data.config.systemPrompt as string).length > 200 && (
                      <button
                        type="button"
                        className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline mt-1"
                        onClick={() => setSystemPromptExpanded((prev) => !prev)}
                      >
                        {systemPromptExpanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                  </InfoField>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sessions for this agent */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            Sessions
            {(agentSessions.data?.sessions ?? []).length > 0 && (
              <span className="text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md">
                {agentSessions.data?.sessions.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {agentSessions.isLoading ? (
            <div className="space-y-2">
              {['sess-sk-1', 'sess-sk-2'].map((key) => (
                <Skeleton key={key} className="h-10 rounded" />
              ))}
            </div>
          ) : agentSessions.error ? (
            <ErrorBanner
              message={`Failed to load sessions: ${agentSessions.error.message}`}
              onRetry={() => void agentSessions.refetch()}
            />
          ) : (agentSessions.data?.sessions ?? []).length === 0 ? (
            <div className="py-6 text-center text-muted-foreground text-sm">
              No sessions found for this agent.
            </div>
          ) : (
            <div className="space-y-1.5">
              {(agentSessions.data?.sessions ?? []).map((sess) => (
                <Link
                  key={sess.id}
                  href={`/sessions/${sess.id}`}
                  className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent transition-colors"
                >
                  <StatusBadge status={sess.status} />
                  <span className="text-xs font-mono text-muted-foreground">
                    {sess.id.slice(0, 12)}
                  </span>
                  {sess.model && (
                    <span className="text-[10px] font-mono text-purple-600 dark:text-purple-400 bg-purple-500/10 px-1 py-0.5 rounded-sm">
                      {sess.model}
                    </span>
                  )}
                  {sess.startedAt && sess.endedAt && (
                    <span className="text-[11px] text-muted-foreground">
                      {formatDuration(sess.startedAt, sess.endedAt)}
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    <LiveTimeAgo date={sess.startedAt} />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Run history visualization */}
      <RunHistoryBar runs={runList} />

      {/* Recent runs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            Recent Runs
            {runList.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md">
                {runList.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {runs.isLoading ? (
            <div className="space-y-2">
              {['run-sk-1', 'run-sk-2', 'run-sk-3'].map((key) => (
                <Skeleton key={key} className="h-10 rounded" />
              ))}
            </div>
          ) : runs.error ? (
            <ErrorBanner
              message={`Failed to load runs: ${runs.error.message}`}
              onRetry={() => void runs.refetch()}
            />
          ) : runList.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No runs recorded yet. Use the Start button above to run this agent.
            </div>
          ) : (
            <>
              {/* Mobile card layout */}
              <div className="sm:hidden space-y-2">
                {runList.map((run) => (
                  <div
                    key={run.id}
                    className="rounded-lg border border-border/50 p-3 space-y-1.5 transition-colors hover:border-border"
                  >
                    <div className="flex items-center justify-between">
                      <StatusBadge status={run.status} />
                      <span className="text-xs font-mono text-muted-foreground">
                        {formatDurationMs(run.durationMs ?? 0)}
                      </span>
                    </div>
                    <div>
                      <span
                        className={cn(
                          'text-xs leading-snug',
                          run.prompt ? 'text-foreground' : 'text-muted-foreground',
                        )}
                        title={run.prompt}
                      >
                        {run.prompt
                          ? run.prompt.length > 80
                            ? `${run.prompt.slice(0, 80)}...`
                            : run.prompt
                          : '-'}
                      </span>
                      {run.errorMessage && (
                        <div
                          className="text-[11px] text-red-600 dark:text-red-400 mt-0.5 truncate"
                          title={run.errorMessage}
                        >
                          {run.errorMessage}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="font-mono">{formatCost(run.costUsd ?? null)}</span>
                      <span>
                        {run.endedAt ? (
                          <LiveTimeAgo date={run.endedAt} />
                        ) : (
                          <LiveTimeAgo date={run.startedAt} />
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table layout */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm" aria-label="Recent agent runs">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th scope="col" className="pb-2 pr-4 font-medium">
                        Status
                      </th>
                      <th scope="col" className="pb-2 pr-4 font-medium">
                        Prompt
                      </th>
                      <th scope="col" className="pb-2 pr-4 font-medium">
                        Duration
                      </th>
                      <th scope="col" className="pb-2 pr-4 font-medium">
                        Cost
                      </th>
                      <th scope="col" className="pb-2 pr-4 font-medium">
                        Started
                      </th>
                      <th scope="col" className="pb-2 font-medium hidden md:table-cell">
                        Ended
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {runList.map((run) => (
                      <tr key={run.id} className="border-b border-border/50 last:border-0">
                        <td className="py-2.5 pr-4">
                          <StatusBadge status={run.status} />
                        </td>
                        <td className="py-2.5 pr-4 max-w-[200px]">
                          <span
                            className={cn(
                              'text-xs',
                              run.prompt ? 'text-foreground' : 'text-muted-foreground',
                            )}
                            title={run.prompt}
                          >
                            {run.prompt
                              ? run.prompt.length > 50
                                ? `${run.prompt.slice(0, 50)}...`
                                : run.prompt
                              : '-'}
                          </span>
                          {run.errorMessage && (
                            <div
                              className="text-[11px] text-red-600 dark:text-red-400 mt-0.5 truncate max-w-[200px]"
                              title={run.errorMessage}
                            >
                              {run.errorMessage}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-xs font-mono text-muted-foreground">
                          {formatDurationMs(run.durationMs ?? 0)}
                        </td>
                        <td className="py-2.5 pr-4 text-xs font-mono text-muted-foreground">
                          {formatCost(run.costUsd ?? null)}
                        </td>
                        <td className="py-2.5 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                          <LiveTimeAgo date={run.startedAt} />
                        </td>
                        <td className="py-2.5 text-xs text-muted-foreground whitespace-nowrap hidden md:table-cell">
                          {run.endedAt ? <LiveTimeAgo date={run.endedAt} /> : 'In progress'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Edit Agent Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Agent</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-agent-name">
                Name
              </label>
              <Input
                id="edit-agent-name"
                placeholder="Agent name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                disabled={updateAgent.isPending}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-agent-machine">
                Machine
              </label>
              {machines.length === 0 ? (
                <div className="px-3 py-2 border border-border rounded-md text-sm text-muted-foreground">
                  No machines available
                </div>
              ) : (
                <Select
                  value={editMachineId}
                  onValueChange={setEditMachineId}
                  disabled={updateAgent.isPending}
                >
                  <SelectTrigger className="w-full" id="edit-agent-machine">
                    <SelectValue placeholder="Select a machine" />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4}>
                    {machines.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.hostname ?? `Machine ${m.id.slice(0, 8)}`}{' '}
                        <span className="text-muted-foreground text-[10px]">
                          ({m.id.slice(0, 8)})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-agent-type">
                Type
              </label>
              <Select value={editType} onValueChange={setEditType} disabled={updateAgent.isPending}>
                <SelectTrigger className="w-full" id="edit-agent-type">
                  <SelectValue placeholder="Select agent type" />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="adhoc">Ad-hoc</SelectItem>
                  <SelectItem value="heartbeat">Heartbeat</SelectItem>
                  <SelectItem value="cron">Cron</SelectItem>
                  <SelectItem value="loop">Loop</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editType === 'cron' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="edit-agent-schedule">
                  Schedule
                </label>
                <Input
                  id="edit-agent-schedule"
                  placeholder="e.g. */15 * * * * (cron expression)"
                  value={editSchedule}
                  onChange={(e) => setEditSchedule(e.target.value)}
                  disabled={updateAgent.isPending}
                />
                <p className="text-[11px] text-muted-foreground">
                  Cron expression for periodic execution. Leave empty for no schedule.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-agent-model">
                Model
              </label>
              <Input
                id="edit-agent-model"
                placeholder="e.g. claude-sonnet-4-20250514"
                value={editModel}
                onChange={(e) => setEditModel(e.target.value)}
                disabled={updateAgent.isPending}
              />
              <p className="text-[11px] text-muted-foreground">
                LLM model identifier. Leave empty to use the default.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-agent-max-turns">
                Max turns
              </label>
              <Input
                id="edit-agent-max-turns"
                type="number"
                min={1}
                placeholder="e.g. 50"
                value={editMaxTurns}
                onChange={(e) => setEditMaxTurns(e.target.value)}
                disabled={updateAgent.isPending}
              />
              <p className="text-[11px] text-muted-foreground">
                Maximum number of conversation turns per run. Leave empty for unlimited.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditSave} disabled={!editName.trim() || updateAgent.isPending}>
              {updateAgent.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function InfoField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted-foreground mb-1">{label}</div>
      <div className="text-foreground">{children}</div>
    </div>
  );
}

function getRunColor(status: string): { bg: string; label: string } {
  if (status === 'completed' || status === 'ended') {
    return { bg: 'bg-green-500', label: 'success' };
  }
  if (status === 'error' || status === 'timeout') {
    return { bg: 'bg-red-500', label: 'error' };
  }
  return { bg: 'bg-yellow-500', label: 'other' };
}

function RunHistoryBar({ runs }: { runs: AgentRun[] }): React.JSX.Element | null {
  const last20 = runs.slice(0, 20);
  if (last20.length === 0) return null;

  const successCount = last20.filter(
    (r) => r.status === 'completed' || r.status === 'ended',
  ).length;
  const successRate = Math.round((successCount / last20.length) * 100);

  return (
    <div className="mb-4" data-testid="run-history-bar">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Run History</span>
        <span className="text-[11px] text-muted-foreground">{successRate}% success rate</span>
      </div>
      <div className="flex gap-0.5">
        {last20.map((run) => {
          const { bg, label } = getRunColor(run.status);
          const tooltip = `${formatDate(run.startedAt)} — ${run.status}`;
          return (
            <div
              key={run.id}
              className={cn('h-5 flex-1 rounded-sm transition-opacity hover:opacity-80', bg)}
              title={tooltip}
              aria-label={`Run ${label}: ${run.status}`}
            />
          );
        })}
      </div>
    </div>
  );
}
