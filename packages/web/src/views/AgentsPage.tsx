'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type React from 'react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
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
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ConfirmButton } from '../components/ConfirmButton';
import { CopyableText } from '../components/CopyableText';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { FetchingBar } from '../components/FetchingBar';
import { LastUpdated } from '../components/LastUpdated';
import { LiveTimeAgo } from '../components/LiveTimeAgo';
import { RefreshButton } from '../components/RefreshButton';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { useHotkeys } from '../hooks/use-hotkeys';
import { formatCost } from '../lib/format-utils';
import {
  agentsQuery,
  machinesQuery,
  useCreateAgent,
  useStartAgent,
  useStopAgent,
} from '../lib/queries';

const AGENT_TYPES = ['autonomous', 'adhoc', 'scheduled'] as const;

type AgentSortOrder = 'name' | 'status' | 'lastRun' | 'cost';
type AgentStatusFilter = 'all' | 'running' | 'registered' | 'stopped' | 'error';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AgentsPage(): React.JSX.Element {
  const toast = useToast();
  const agents = useQuery(agentsQuery());
  const machines = useQuery(machinesQuery());

  const createAgent = useCreateAgent();
  const startAgent = useStartAgent();
  const stopAgent = useStopAgent();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createMachineId, setCreateMachineId] = useState('');
  const [createType, setCreateType] = useState<string>('autonomous');
  const [createModel, setCreateModel] = useState('claude-sonnet-4-6');
  const [createProjectPath, setCreateProjectPath] = useState('');
  const [createInitialPrompt, setCreateInitialPrompt] = useState('');

  const [promptAgentId, setPromptAgentId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');

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
  const machineList = machines.data ?? [];

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

  // -- Create agent handler --
  function resetCreateForm(): void {
    setCreateName('');
    setCreateMachineId('');
    setCreateType('autonomous');
    setCreateModel('claude-sonnet-4-6');
    setCreateProjectPath('');
    setCreateInitialPrompt('');
  }

  const handleCreate = (): void => {
    if (!createName.trim() || !createMachineId) return;

    const config: Record<string, unknown> = {};
    if (createModel.trim()) config.model = createModel.trim();
    if (createInitialPrompt.trim()) config.initialPrompt = createInitialPrompt.trim();

    createAgent.mutate(
      {
        name: createName.trim(),
        machineId: createMachineId,
        type: createType,
        ...(createProjectPath.trim() ? { projectPath: createProjectPath.trim() } : {}),
        ...(Object.keys(config).length > 0 ? { config } : {}),
      },
      {
        onSuccess: () => {
          toast.success(`Agent "${createName.trim()}" created`);
          resetCreateForm();
          setShowCreateDialog(false);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : String(err));
        },
      },
    );
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

  const isCreateDisabled = createAgent.isPending || !createName.trim() || !createMachineId;

  return (
    <div className="relative p-4 md:p-6 max-w-[1100px] animate-fade-in">
      <FetchingBar isFetching={agents.isFetching && !agents.isLoading} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-bold">Agents</h1>
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

      {/* Create Agent Dialog */}
      <Dialog
        open={showCreateDialog}
        onOpenChange={(open) => {
          if (!open) resetCreateForm();
          setShowCreateDialog(open);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Agent</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="create-agent-name">
                Name <span className="text-destructive">*</span>
              </label>
              <Input
                id="create-agent-name"
                placeholder="my-agent"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="create-agent-machine">
                Machine <span className="text-destructive">*</span>
              </label>
              <Select value={createMachineId} onValueChange={setCreateMachineId}>
                <SelectTrigger className="w-full" id="create-agent-machine">
                  <SelectValue placeholder="Select a machine" />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  {machineList.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.hostname} ({m.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="create-agent-type">
                Type
              </label>
              <Select value={createType} onValueChange={setCreateType}>
                <SelectTrigger className="w-full" id="create-agent-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  {AGENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="create-agent-model">
                Model
              </label>
              <Input
                id="create-agent-model"
                placeholder="claude-sonnet-4-6"
                value={createModel}
                onChange={(e) => setCreateModel(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                The Claude model to use for this agent.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="create-agent-project">
                Project Path
              </label>
              <Input
                id="create-agent-project"
                placeholder="/home/user/projects/my-app"
                value={createProjectPath}
                onChange={(e) => setCreateProjectPath(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Absolute path to the project directory on the target machine.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="create-agent-prompt">
                Initial Prompt
              </label>
              <textarea
                id="create-agent-prompt"
                rows={3}
                placeholder="Describe what this agent should do..."
                value={createInitialPrompt}
                onChange={(e) => setCreateInitialPrompt(e.target.value)}
                className={cn(
                  'w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground resize-y',
                  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  'dark:bg-input/30',
                )}
              />
              <p className="text-[11px] text-muted-foreground">
                Stored in agent config. Can be used as the default prompt when starting the agent.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isCreateDisabled}>
              {createAgent.isPending ? 'Creating...' : 'Create Agent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Filter / Sort controls */}
      <div className="flex gap-2.5 items-center mb-4 flex-wrap">
        <input
          type="text"
          placeholder="Search agents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search agents"
          className="px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs outline-none min-w-[120px] flex-1 sm:flex-none sm:min-w-[180px]"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AgentStatusFilter)}
          aria-label="Filter by status"
          className="px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs"
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
          aria-label="Sort order"
          className="px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs"
        >
          <option value="name">{'\u2191'} Name (A-Z)</option>
          <option value="status">{'\u2191'} Status</option>
          <option value="lastRun">{'\u2193'} Last run</option>
          <option value="cost">{'\u2193'} Total cost</option>
        </select>
        <span className="text-[11px] text-muted-foreground ml-auto">
          {filteredAgents.length}/{agentList.length} agents
        </span>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3 mb-6">
        <StatCard label="Total Agents" value={String(agentList.length)} />
        {Object.entries(statusCounts).map(([status, count]) => (
          <StatCard
            key={status}
            label={status.charAt(0).toUpperCase() + status.slice(1)}
            value={String(count)}
          />
        ))}
      </div>

      {/* Agent cards grid */}
      {agents.isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={`sk-${String(i)}`}
              className="p-4 bg-card border border-border rounded-lg space-y-3"
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
            icon={'\u2699'}
            title="No agents registered"
            description="Create an agent using the button above to get started."
          />
        ) : (
          <EmptyState icon={'\u2315'} title="No agents match the current filters" />
        )
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
          {filteredAgents.map((agent) => (
            <div key={agent.id} className="p-4 bg-card border border-border rounded-lg">
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
                {agent.status === 'running' ? (
                  <ConfirmButton
                    label="Stop"
                    confirmLabel="Stop Agent?"
                    onConfirm={() => handleStop(agent.id)}
                    className="px-3.5 py-1.5 bg-red-900 text-red-300 border border-red-800 rounded-sm text-xs font-medium cursor-pointer"
                    confirmClassName="px-3.5 py-1.5 bg-red-700 text-white border border-red-600 rounded-sm text-xs font-medium cursor-pointer animate-pulse"
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
                      className="flex-1 px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleStart(agent.id)}
                      disabled={!prompt.trim()}
                      aria-label="Start agent with entered prompt"
                      className={cn(
                        'px-3 py-1.5 bg-primary text-white border-none rounded-sm text-xs font-medium',
                        prompt.trim()
                          ? 'cursor-pointer opacity-100'
                          : 'cursor-not-allowed opacity-50',
                      )}
                    >
                      Go
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPromptAgentId(null);
                        setPrompt('');
                      }}
                      aria-label="Cancel agent start"
                      className="px-2.5 py-1.5 bg-muted text-muted-foreground border border-border rounded-sm text-xs cursor-pointer"
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
                    className="px-3.5 py-1.5 bg-primary text-white border-none rounded-sm text-xs font-medium cursor-pointer"
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
      <span className="text-[10px] text-muted-foreground uppercase tracking-[0.04em]">{label}</span>
      <div className={cn('mt-px text-xs break-all', mono && 'font-mono')}>
        {copyable ? <CopyableText value={value} maxDisplay={12} /> : value}
      </div>
    </div>
  );
}
