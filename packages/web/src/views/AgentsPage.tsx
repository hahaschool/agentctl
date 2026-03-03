'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type React from 'react';
import { useMemo, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CopyableText } from '../components/CopyableText';
import { EmptyState } from '../components/EmptyState';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { formatCost, timeAgo } from '../lib/format-utils';
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

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createMachineId, setCreateMachineId] = useState('');
  const [createType, setCreateType] = useState<string>('autonomous');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);

  const [promptAgentId, setPromptAgentId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');

  // -- Filter / Sort state --
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AgentStatusFilter>('all');
  const [sortOrder, setSortOrder] = useState<AgentSortOrder>('name');

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
  const handleCreate = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!createName.trim() || !createMachineId) return;

    setCreateError(null);
    setCreateLoading(true);
    createAgent.mutate(
      {
        name: createName.trim(),
        machineId: createMachineId,
        type: createType,
      },
      {
        onSuccess: () => {
          toast.success(`Agent "${createName.trim()}" created`);
          setCreateName('');
          setCreateMachineId('');
          setCreateType('autonomous');
          setShowCreateForm(false);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : String(err));
        },
        onSettled: () => {
          setCreateLoading(false);
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

  const isCreateDisabled = createLoading || !createName.trim() || !createMachineId;

  return (
    <div className="p-6 max-w-[1100px]">
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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void agents.refetch()}
            className="px-3.5 py-1.5 bg-muted text-muted-foreground border border-border rounded-sm text-[13px] cursor-pointer"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowCreateForm((prev) => !prev)}
            className="px-3.5 py-1.5 bg-primary text-white border-none rounded-sm text-[13px] font-medium cursor-pointer"
          >
            {showCreateForm ? 'Cancel' : 'Create Agent'}
          </button>
        </div>
      </div>

      {/* Error banners */}
      {agents.error && (
        <div className="px-4 py-2.5 bg-red-900 text-red-300 rounded-lg mb-4 text-[13px]">
          {agents.error.message}
        </div>
      )}

      {/* Inline create form */}
      {showCreateForm && (
        <form onSubmit={handleCreate} className="p-4 bg-card border border-border rounded-lg mb-5">
          <h3 className="text-sm font-semibold mb-3">New Agent</h3>

          {createError && (
            <div className="px-3 py-2 bg-red-900 text-red-300 rounded-sm mb-3 text-xs">
              {createError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label
                htmlFor="create-agent-name"
                className="block text-[11px] text-muted-foreground uppercase tracking-[0.04em] mb-1"
              >
                Name
              </label>
              <input
                id="create-agent-name"
                type="text"
                required
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="my-agent"
                className="w-full px-2.5 py-2 bg-muted text-foreground border border-border rounded-sm text-[13px] outline-none box-border"
              />
            </div>

            <div>
              <label
                htmlFor="create-agent-machine"
                className="block text-[11px] text-muted-foreground uppercase tracking-[0.04em] mb-1"
              >
                Machine
              </label>
              <select
                id="create-agent-machine"
                required
                value={createMachineId}
                onChange={(e) => setCreateMachineId(e.target.value)}
                className="w-full px-2.5 py-2 bg-muted text-foreground border border-border rounded-sm text-[13px] outline-none box-border"
              >
                <option value="">Select machine...</option>
                {machineList.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.hostname} ({m.id})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="create-agent-type"
                className="block text-[11px] text-muted-foreground uppercase tracking-[0.04em] mb-1"
              >
                Type
              </label>
              <select
                id="create-agent-type"
                value={createType}
                onChange={(e) => setCreateType(e.target.value)}
                className="w-full px-2.5 py-2 bg-muted text-foreground border border-border rounded-sm text-[13px] outline-none box-border"
              >
                {AGENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="submit"
              disabled={isCreateDisabled}
              className={cn(
                'px-5 py-2 bg-primary text-white border-none rounded-sm text-[13px] font-medium',
                isCreateDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer opacity-100',
              )}
            >
              {createLoading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {/* Filter / Sort controls */}
      <div className="flex gap-2.5 items-center mb-4 flex-wrap">
        <input
          type="text"
          placeholder="Search agents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs outline-none min-w-[120px] flex-1 sm:flex-none sm:min-w-[180px]"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AgentStatusFilter)}
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
          className="px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs"
        >
          <option value="name">Sort: Name</option>
          <option value="status">Sort: Status</option>
          <option value="lastRun">Sort: Last run</option>
          <option value="cost">Sort: Total cost</option>
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
                  {agent.lastRunAt ? timeAgo(agent.lastRunAt) : 'never run'}
                </span>
              </div>

              {/* Actions */}
              <div className="mt-2.5 pt-2.5 border-t border-border flex gap-2 items-center">
                {agent.status === 'running' ? (
                  <button
                    type="button"
                    onClick={() => handleStop(agent.id)}
                    className="px-3.5 py-1.5 bg-red-900 text-red-300 border border-red-800 rounded-sm text-xs font-medium cursor-pointer"
                  >
                    Stop
                  </button>
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
