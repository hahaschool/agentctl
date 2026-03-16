'use client';

import type { ExecutionSummary } from '@agentctl/shared';
import { toExecutionSummary } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import { Copy, Download, Settings } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';

import { AgentHealthBadge } from '@/components/AgentHealthBadge';
import { Breadcrumb } from '@/components/Breadcrumb';
import { ConfirmButton } from '@/components/ConfirmButton';
import { CopyableText } from '@/components/CopyableText';
import { ErrorBanner } from '@/components/ErrorBanner';
import { FetchingBar } from '@/components/FetchingBar';
import { GroupedRunHistory } from '@/components/GroupedRunHistory';
import { LastUpdated } from '@/components/LastUpdated';
import { LiveTimeAgo } from '@/components/LiveTimeAgo';
import { AgentMemorySection } from '@/components/memory/AgentMemorySection';
import { RefreshButton } from '@/components/RefreshButton';
import { RunHistoryChart } from '@/components/RunHistoryChart';
import { SimpleTooltip } from '@/components/SimpleTooltip';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { describeCron, getNextRuns, isValidCron } from '@/lib/cron-utils';
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

  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [systemPromptExpanded, setSystemPromptExpanded] = useState(false);
  const [highlightedRunId, setHighlightedRunId] = useState<string | null>(null);

  const accountList = accounts.data ?? [];
  const machines = machinesList.data ?? [];
  const runList = useMemo(() => {
    const list = runs.data ?? [];
    return [...list].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  }, [runs.data]);

  // Build a sessionId -> runId lookup for linkage
  const sessionToRunMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const run of runList) {
      if (run.sessionId) {
        map.set(run.sessionId, run.id);
      }
    }
    return map;
  }, [runList]);

  const latestRunSummary = useMemo(() => {
    for (const run of runList) {
      const summary = toExecutionSummary(run.resultSummary ?? null, {
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt ?? null,
        costUsd: run.costUsd ?? null,
      });

      if (summary) {
        return summary;
      }
    }

    return null;
  }, [runList]);

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
    const effectivePrompt = prompt.trim() || agent.data?.config?.defaultPrompt || '';
    if (!effectivePrompt || isStarting) return;
    setIsStarting(true);
    startAgent.mutate(
      { id: agentId, prompt: effectivePrompt },
      {
        onSuccess: () => {
          setIsStarting(false);
          toast.success('Agent started');
          setPrompt('');
          setStartDialogOpen(false);
        },
        onError: (err) => {
          setIsStarting(false);
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

  const closeStartDialog = (): void => {
    setStartDialogOpen(false);
    setPrompt('');
  };

  // -- Export & Duplicate handlers --

  const handleExportConfig = useCallback((): void => {
    const d = agent.data;
    if (!d) return;
    const exportData = {
      name: d.name,
      type: d.type,
      machineId: d.machineId,
      schedule: d.schedule,
      config: d.config,
      projectPath: d.projectPath,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-${d.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Config exported');
  }, [agent.data, toast]);

  const handleDuplicate = useCallback((): void => {
    const d = agent.data;
    if (!d) return;
    const exportData = {
      name: d.name,
      type: d.type,
      machineId: d.machineId,
      schedule: d.schedule,
      config: d.config,
      projectPath: d.projectPath,
    };
    void navigator.clipboard
      .writeText(JSON.stringify(exportData, null, 2))
      .then(() => toast.success('Agent config copied to clipboard'))
      .catch(() => toast.error('Failed to copy'));
  }, [agent.data, toast]);

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

  return (
    <div className="relative p-4 md:p-6 max-w-[1000px] animate-page-enter">
      <FetchingBar isFetching={(agent.isFetching || runs.isFetching) && !agent.isLoading} />
      <Breadcrumb items={[{ label: 'Agents', href: '/agents' }, { label: data.name }]} />

      {/* Header */}
      <div className="mb-6 space-y-3">
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <h1
              className="text-[22px] font-semibold tracking-tight truncate min-w-0 max-w-[300px]"
              title={data.name}
            >
              {data.name}
            </h1>
            <StatusBadge status={data.status} />
            {(data.type === 'cron' || data.type === 'heartbeat' || data.type === 'loop') && (
              <AgentHealthBadge agentId={agentId} />
            )}
            {(data.config?.model as string | undefined) && (
              <span className="font-mono bg-purple-500/10 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded-sm border border-purple-500/30 text-[11px]">
                {data.config?.model as string}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <SimpleTooltip content="Export config as JSON">
              <Button
                variant="outline"
                size="sm"
                className="px-2"
                onClick={handleExportConfig}
                aria-label="Export config"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </SimpleTooltip>
            <SimpleTooltip content="Copy config to clipboard">
              <Button
                variant="outline"
                size="sm"
                className="px-2"
                onClick={handleDuplicate}
                aria-label="Duplicate agent"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </SimpleTooltip>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Link href={`/agents/${agentId}/settings`}>
              <Button variant="outline" size="sm">
                <Settings className="h-3.5 w-3.5 mr-1.5" />
                Settings
              </Button>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            {data.status === 'running' ? (
              <ConfirmButton
                label={stopAgent.isPending ? 'Stopping...' : 'Stop'}
                confirmLabel="Confirm Stop"
                onConfirm={handleStop}
                disabled={stopAgent.isPending}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-destructive text-destructive-foreground cursor-pointer"
                confirmClassName="px-3 py-1.5 text-sm font-medium rounded-md bg-red-600 text-white animate-pulse cursor-pointer"
              />
            ) : (
              <Button size="sm" onClick={() => setStartDialogOpen(true)} disabled={isStarting}>
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
      </div>

      <Dialog
        open={startDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setStartDialogOpen(true);
          } else {
            closeStartDialog();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start Agent</DialogTitle>
            <DialogDescription>
              {data.config?.defaultPrompt
                ? 'Provide an override prompt or leave empty to use the configured default prompt.'
                : 'Provide a prompt to start this agent run.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleStart();
                }
                if (e.key === 'Escape') {
                  closeStartDialog();
                }
              }}
              placeholder={data.config?.defaultPrompt ? 'Use default prompt' : 'Enter prompt...'}
              aria-label="Prompt to start agent"
              disabled={isStarting}
              autoFocus
            />
            {data.config?.defaultPrompt && (
              <p className="text-[11px] text-muted-foreground">Default prompt is configured.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeStartDialog} disabled={isStarting}>
              Cancel
            </Button>
            <Button
              onClick={handleStart}
              disabled={(!prompt.trim() && !data.config?.defaultPrompt) || isStarting}
            >
              {isStarting ? 'Starting...' : 'Go'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              {data.schedule && isValidCron(data.schedule) && (
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {describeCron(data.schedule)}
                </div>
              )}
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
                <span className="font-mono text-xs">{data.config.permissionMode ?? 'default'}</span>
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
                        aria-expanded={systemPromptExpanded}
                        aria-label={
                          systemPromptExpanded ? 'Collapse system prompt' : 'Expand system prompt'
                        }
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

      {/* Cron Schedule — next runs */}
      {data.schedule && isValidCron(data.schedule) && <CronScheduleCard schedule={data.schedule} />}

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
              {(agentSessions.data?.sessions ?? []).map((sess) => {
                const linkedRunId = sessionToRunMap.get(sess.id);
                return (
                  <div
                    key={sess.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent transition-colors"
                  >
                    <Link
                      href={`/sessions/${sess.id}`}
                      className="flex items-center gap-3 flex-1 min-w-0"
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
                    {linkedRunId && (
                      <button
                        type="button"
                        className="shrink-0 text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 hover:underline cursor-pointer"
                        onClick={() => setHighlightedRunId(linkedRunId)}
                        title="Highlight the corresponding run in Execution History"
                      >
                        View Run
                      </button>
                    )}
                  </div>
                );
              })}
              {(agentSessions.data?.sessions ?? []).length === 20 && (
                <div className="pt-2 text-center">
                  <Link
                    href={`/sessions?agentId=${agentId}`}
                    className="text-[11px] text-primary font-medium hover:underline"
                  >
                    Load more sessions
                  </Link>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Memory usage */}
      <Card className="mb-4" data-testid="agent-memory-card">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Memory</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentMemorySection agentId={agentId} />
        </CardContent>
      </Card>

      {/* Run history visualization */}
      <RunHistoryChart runs={runList} onRunClick={setHighlightedRunId} />

      {/* Execution history — grouped by date with filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            Execution History
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
          ) : (
            <>
              {latestRunSummary && <ExecutionSummaryCard summary={latestRunSummary} />}
              <GroupedRunHistory runs={runList} highlightedRunId={highlightedRunId} />
            </>
          )}
        </CardContent>
      </Card>
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

function CronScheduleCard({ schedule }: { schedule: string }): React.JSX.Element {
  const nextRuns = getNextRuns(schedule, 5);
  const description = describeCron(schedule);

  return (
    <Card className="mb-4" data-testid="cron-schedule-card">
      <CardHeader className="pb-0">
        <CardTitle className="text-sm">Cron Schedule</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs bg-muted px-2 py-1 rounded-md border border-border/50">
              {schedule}
            </span>
            <span className="text-xs text-muted-foreground">{description}</span>
          </div>
          {nextRuns.length > 0 && (
            <div>
              <span className="text-[11px] font-medium text-muted-foreground block mb-1.5">
                Next scheduled runs
              </span>
              <div className="space-y-0.5">
                {nextRuns.map((date) => (
                  <div
                    key={date.toISOString()}
                    className="text-[11px] font-mono text-muted-foreground"
                  >
                    {date.toLocaleString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ExecutionSummaryCard({ summary }: { summary: ExecutionSummary }): React.JSX.Element {
  return (
    <div className="mb-4 rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">Latest Run Summary</div>
          <div className="text-xs text-muted-foreground">
            {summary.commandsRun} tool call{summary.commandsRun === 1 ? '' : 's'} ·{' '}
            {formatCost(summary.costUsd)} · {formatDurationMs(summary.durationMs)}
          </div>
        </div>
        <StatusBadge status={summary.status} />
      </div>
      <div className="text-sm text-foreground leading-6">{summary.executiveSummary}</div>
      {summary.keyFindings.length > 0 && (
        <div className="space-y-1">
          {summary.keyFindings.map((finding) => (
            <div key={finding} className="text-xs text-muted-foreground">
              • {finding}
            </div>
          ))}
        </div>
      )}
      {summary.followUps.length > 0 && (
        <div className="space-y-1">
          {summary.followUps.map((item) => (
            <div key={item} className="text-xs text-muted-foreground">
              Next: {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
