'use client';

import { useQuery } from '@tanstack/react-query';
import { Bot, Filter, Settings } from 'lucide-react';
import Link from 'next/link';
import type React from 'react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  type AgentFormCreateData,
  AgentFormDialog,
  type AgentFormEditData,
} from '../components/AgentFormDialog';
import { ConfirmButton } from '../components/ConfirmButton';
import { CopyableText } from '../components/CopyableText';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { FetchingBar } from '../components/FetchingBar';
import { LastUpdated } from '../components/LastUpdated';
import { LiveTimeAgo } from '../components/LiveTimeAgo';
import { RefreshButton } from '../components/RefreshButton';
import { SimpleTooltip } from '../components/SimpleTooltip';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { useHotkeys } from '../hooks/use-hotkeys';
import { downloadCsv, formatCost } from '../lib/format-utils';
import {
  agentsQuery,
  machinesQuery,
  sessionsQuery,
  useCreateAgent,
  useStartAgent,
  useStopAgent,
} from '../lib/queries';

type AgentSortOrder = 'name' | 'status' | 'lastRun' | 'cost';
type AgentStatusFilter = 'all' | 'running' | 'registered' | 'stopped' | 'error';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AgentsPage(): React.JSX.Element {
  const toast = useToast();
  const agents = useQuery(agentsQuery());
  const machines = useQuery(machinesQuery());
  const recentSessions = useQuery(sessionsQuery({ limit: 100 }));

  const createAgent = useCreateAgent();
  const startAgent = useStartAgent();
  const stopAgent = useStopAgent();

  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const [promptAgentId, setPromptAgentId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');

  // Extract unique project paths from recent sessions
  const recentProjectPaths = useMemo(() => {
    const sessions = recentSessions.data?.sessions ?? [];
    const pathSet = new Set<string>();
    for (const s of sessions) {
      if (s.projectPath) pathSet.add(s.projectPath);
    }
    return Array.from(pathSet).sort();
  }, [recentSessions.data]);

  const machineList = machines.data ?? [];

  // -- Filter / Sort state --
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AgentStatusFilter>('all');
  const [sortOrder, setSortOrder] = useState<AgentSortOrder>('name');

  useHotkeys(
    useMemo(
      () => ({
        r: () => void agents.refetch(),
        Escape: () => {
          if (promptAgentId) setPromptAgentId(null);
          else if (showCreateDialog) setShowCreateDialog(false);
        },
      }),
      [agents, promptAgentId, showCreateDialog],
    ),
  );

  const agentList = agents.data ?? [];

  // Summary stats
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const agent of agentList) {
      counts[agent.status] = (counts[agent.status] ?? 0) + 1;
    }
    return counts;
  }, [agentList]);

  // Filtered + sorted list
  const filteredAgents = useMemo(() => {
    let list = agentList;

    // Status filter
    if (statusFilter !== 'all') {
      list = list.filter((a) => a.status === statusFilter);
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q) ||
          a.machineId.toLowerCase().includes(q) ||
          (a.projectPath ?? '').toLowerCase().includes(q),
      );
    }

    // Sort
    const sorted = [...list];
    switch (sortOrder) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'status':
        sorted.sort((a, b) => a.status.localeCompare(b.status));
        break;
      case 'lastRun':
        sorted.sort((a, b) => {
          const ta = a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0;
          const tb = b.lastRunAt ? new Date(b.lastRunAt).getTime() : 0;
          return tb - ta;
        });
        break;
      case 'cost':
        sorted.sort((a, b) => (b.totalCostUsd ?? 0) - (a.totalCostUsd ?? 0));
        break;
    }

    return sorted;
  }, [agentList, statusFilter, search, sortOrder]);

  // -- Create agent handler (delegated to AgentFormDialog) --
  const handleCreateSubmit = (data: AgentFormCreateData | AgentFormEditData): void => {
    createAgent.mutate(data as AgentFormCreateData, {
      onSuccess: () => {
        toast.success(`Agent "${data.name}" created`);
        setShowCreateDialog(false);
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : String(err));
      },
    });
  };

  // -- Start agent handler --
  const handleStart = (agentId: string): void => {
    if (!prompt.trim()) return;
    startAgent.mutate(
      { id: agentId, prompt: prompt.trim() },
      {
        onSuccess: () => {
          toast.success('Agent started');
          setPrompt('');
          setPromptAgentId(null);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : String(err));
        },
      },
    );
  };

  // -- Stop agent handler --
  const handleStop = (agentId: string): void => {
    stopAgent.mutate(agentId, {
      onSuccess: () => {
        toast.success('Agent stopped');
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : String(err));
      },
    });
  };

  // -- Stop all running agents --
  const [stoppingAll, setStoppingAll] = useState(false);
  const runningAgents = useMemo(() => agentList.filter((a) => a.status === 'running'), [agentList]);

  const handleStopAll = (): void => {
    if (runningAgents.length === 0) return;
    setStoppingAll(true);
    let completed = 0;
    let errors = 0;
    for (const agent of runningAgents) {
      stopAgent.mutate(agent.id, {
        onSuccess: () => {
          completed++;
          if (completed + errors === runningAgents.length) {
            setStoppingAll(false);
            if (errors === 0) {
              toast.success(`Stopped ${completed} agent${completed !== 1 ? 's' : ''}`);
            } else {
              toast.error(`Stopped ${completed}, failed ${errors}`);
            }
          }
        },
        onError: (err) => {
          errors++;
          if (completed + errors === runningAgents.length) {
            setStoppingAll(false);
            toast.error(
              `Stopped ${completed}, failed ${errors}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        },
      });
    }
  };

  return (
    <div className="relative p-4 md:p-6 max-w-[1100px] animate-page-enter">
      <FetchingBar isFetching={agents.isFetching && !agents.isLoading} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Agents</h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            {agentList.length} agent{agentList.length !== 1 ? 's' : ''} registered
            {Object.keys(statusCounts).length > 0 && (
              <span>
                {' '}
                &mdash;{' '}
                {Object.entries(statusCounts)
                  .map(([status, count]) => `${count} ${status}`)
                  .join(', ')}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LastUpdated dataUpdatedAt={agents.dataUpdatedAt} />
          <RefreshButton
            onClick={() => void agents.refetch()}
            isFetching={agents.isFetching && !agents.isLoading}
          />
          <Button size="sm" onClick={() => setShowCreateDialog(true)}>
            New Agent
          </Button>
        </div>
      </div>

      {/* Error banners */}
      {agents.error && (
        <ErrorBanner message={agents.error.message} onRetry={() => void agents.refetch()} />
      )}

      {/* New Agent Dialog */}
      <AgentFormDialog
        mode="create"
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onSubmit={handleCreateSubmit}
        isPending={createAgent.isPending}
        machines={machineList}
        recentProjectPaths={recentProjectPaths}
      />

      {/* Filter / Sort controls */}
      <div className="flex gap-2.5 items-center mb-4 flex-wrap">
        <input
          type="search"
          placeholder="Search agents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search agents"
          className="px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs outline-none min-w-[120px] flex-1 sm:flex-none sm:min-w-[180px] transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AgentStatusFilter)}
          aria-label="Filter by status"
          className="px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        >
          <option value="all">All statuses</option>
          <option value="running">Running</option>
          <option value="registered">Registered</option>
          <option value="stopped">Stopped</option>
          <option value="error">Error</option>
        </select>
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as AgentSortOrder)}
          aria-label="Sort by"
          className="px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        >
          <option value="name">{'\u2191'} Name (A-Z)</option>
          <option value="status">{'\u2191'} Status</option>
          <option value="lastRun">{'\u2193'} Last run</option>
          <option value="cost">{'\u2193'} Total cost</option>
        </select>
        <SimpleTooltip
          content={filteredAgents.length === 0 ? 'No agents to export' : 'Download agents as CSV'}
        >
          <button
            type="button"
            onClick={() => {
              const agents = filteredAgents;
              if (agents.length === 0) return;
              downloadCsv(
                [
                  'name',
                  'id',
                  'type',
                  'status',
                  'machineId',
                  'projectPath',
                  'lastRunAt',
                  'totalCostUsd',
                ],
                agents.map((a) => [
                  a.name,
                  a.id,
                  a.type,
                  a.status,
                  a.machineId,
                  a.projectPath,
                  a.lastRunAt,
                  a.totalCostUsd,
                ]),
                `agents-${new Date().toISOString().slice(0, 10)}.csv`,
              );
            }}
            disabled={filteredAgents.length === 0}
            className="px-2.5 py-1.5 text-[12px] font-medium bg-muted text-muted-foreground border border-border rounded-md hover:text-foreground hover:bg-accent disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            Export CSV
          </button>
        </SimpleTooltip>
        {runningAgents.length > 0 && (
          <ConfirmButton
            label={stoppingAll ? 'Stopping...' : `Stop All (${runningAgents.length})`}
            confirmLabel={`Stop ${runningAgents.length} running?`}
            onConfirm={handleStopAll}
            disabled={stoppingAll}
            className={cn(
              'px-2.5 py-1.5 text-[12px] font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800 rounded-md transition-colors whitespace-nowrap',
              stoppingAll
                ? 'cursor-not-allowed opacity-50'
                : 'cursor-pointer hover:bg-red-200 dark:hover:bg-red-900/60',
            )}
            confirmClassName="px-2.5 py-1.5 text-[12px] font-medium bg-red-700 text-white border border-red-600 rounded-md cursor-pointer animate-pulse whitespace-nowrap"
          />
        )}
        <span className="text-[11px] text-muted-foreground ml-auto">
          {filteredAgents.length}/{agentList.length} agents
        </span>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3 mb-6">
        <StatCard label="Total Agents" value={String(agentList.length)} accent="blue" />
        {Object.entries(statusCounts).map(([status, count]) => (
          <StatCard
            key={status}
            label={status.charAt(0).toUpperCase() + status.slice(1)}
            value={String(count)}
            accent={
              status === 'running'
                ? 'green'
                : status === 'error'
                  ? 'red'
                  : status === 'idle'
                    ? 'yellow'
                    : 'purple'
            }
          />
        ))}
      </div>

      {/* Agent cards grid */}
      {agents.isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={`sk-${String(i)}`}
              className="p-4 bg-card border border-border/50 rounded-lg space-y-3 transition-colors hover:border-border"
            >
              <div className="flex justify-between items-center">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
              </div>
              <Skeleton className="h-8 w-20 mt-2" />
            </div>
          ))}
        </div>
      ) : filteredAgents.length === 0 ? (
        agentList.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="No agents registered"
            description="Create an agent using the button above to get started."
          />
        ) : (
          <EmptyState icon={Filter} title="No agents match the current filters" />
        )
      ) : (
        <div
          className={cn(
            'grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3 transition-opacity duration-200',
            agents.isFetching && !agents.isLoading && 'opacity-60',
          )}
        >
          {filteredAgents.map((agent) => (
            <div
              key={agent.id}
              className={cn(
                'group p-4 bg-card border border-border/50 rounded-lg transition-all duration-200 hover:border-border/80 hover:shadow-sm',
                agent.status === 'running' && 'border-l-2 border-l-green-500',
                (agent.status === 'starting' || agent.status === 'stopping') && 'animate-pulse',
              )}
            >
              {/* Card header: name + status */}
              <div className="flex justify-between items-center mb-3">
                <Link
                  href={`/agents/${agent.id}`}
                  className="font-semibold text-[15px] hover:text-primary transition-colors no-underline text-foreground"
                >
                  {agent.name}
                </Link>
                <StatusBadge status={agent.status} />
              </div>

              {/* Card details */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Info label="ID" value={agent.id} mono copyable />
                <Info label="Machine" value={agent.machineId} mono copyable />
                <Info label="Type" value={agent.type} />
                {agent.projectPath && <Info label="Project" value={agent.projectPath} mono />}
                {agent.worktreeBranch && <Info label="Branch" value={agent.worktreeBranch} mono />}
                {agent.schedule && <Info label="Schedule" value={agent.schedule} mono />}
              </div>

              {/* Cost + Last run */}
              <div className="mt-2.5 pt-2.5 border-t border-border flex justify-between items-center text-xs">
                <div className="flex gap-4">
                  <span className="text-muted-foreground">
                    Last: {formatCost(agent.lastCostUsd)}
                  </span>
                  <span className="text-muted-foreground">
                    Total: {formatCost(agent.totalCostUsd)}
                  </span>
                </div>
                <span className="text-muted-foreground text-[11px]">
                  {agent.lastRunAt ? <LiveTimeAgo date={agent.lastRunAt} /> : 'never run'}
                </span>
              </div>

              {/* Actions */}
              <div className="mt-2.5 pt-2.5 border-t border-border flex gap-2 items-center">
                <Link
                  href={`/agents/${agent.id}/settings`}
                  aria-label={`Settings for agent ${agent.name}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs font-medium cursor-pointer hover:bg-accent transition-colors focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                >
                  <Settings className="h-3 w-3" />
                  Settings
                </Link>
                {agent.status === 'running' ? (
                  <ConfirmButton
                    label={stopAgent.isPending ? 'Stopping...' : 'Stop'}
                    confirmLabel="Stop Agent?"
                    onConfirm={() => handleStop(agent.id)}
                    disabled={stopAgent.isPending}
                    className={cn(
                      'px-3.5 py-1.5 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800 rounded-md text-xs font-medium',
                      stopAgent.isPending ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                    )}
                    confirmClassName="px-3.5 py-1.5 bg-red-700 text-white border border-red-600 rounded-md text-xs font-medium cursor-pointer animate-pulse"
                  />
                ) : promptAgentId === agent.id ? (
                  <>
                    <input
                      id={`prompt-${agent.id}`}
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleStart(agent.id);
                        if (e.key === 'Escape') {
                          setPromptAgentId(null);
                          setPrompt('');
                        }
                      }}
                      placeholder="Enter prompt..."
                      disabled={startAgent.isPending}
                      className="flex-1 px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs outline-none transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                    />
                    <button
                      type="button"
                      onClick={() => handleStart(agent.id)}
                      disabled={!prompt.trim() || startAgent.isPending}
                      aria-label="Start agent with entered prompt"
                      className={cn(
                        'px-3 py-1.5 bg-primary text-white border-none rounded-md text-xs font-medium focus:ring-2 focus:ring-primary/20',
                        !prompt.trim() || startAgent.isPending
                          ? 'cursor-not-allowed opacity-50'
                          : 'cursor-pointer opacity-100',
                      )}
                    >
                      {startAgent.isPending ? 'Starting...' : 'Go'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPromptAgentId(null);
                        setPrompt('');
                      }}
                      disabled={startAgent.isPending}
                      aria-label="Cancel agent start"
                      className={cn(
                        'px-2.5 py-1.5 bg-muted text-muted-foreground border border-border rounded-md text-xs focus:ring-2 focus:ring-primary/20 focus:border-primary/40',
                        startAgent.isPending ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                      )}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setPromptAgentId(agent.id);
                      setPrompt('');
                    }}
                    disabled={startAgent.isPending}
                    className={cn(
                      'px-3.5 py-1.5 bg-primary text-white border-none rounded-md text-xs font-medium focus:ring-2 focus:ring-primary/20',
                      startAgent.isPending ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                    )}
                  >
                    Start
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function Info({
  label,
  value,
  mono,
  copyable,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
}): React.JSX.Element {
  return (
    <div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <div className={cn('mt-px text-xs break-all', mono && 'font-mono')}>
        {copyable ? <CopyableText value={value} maxDisplay={12} /> : value}
      </div>
    </div>
  );
}
