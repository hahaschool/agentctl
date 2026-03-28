'use client';

import { useQuery } from '@tanstack/react-query';
import { Filter, Settings } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  type AgentFormCreateData,
  AgentFormDialog,
  type AgentFormEditData,
} from '../components/AgentFormDialog';
import { ConfirmButton } from '../components/ConfirmButton';
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
type StartDialogAgent = { id: string; name: string; defaultPrompt?: string };
type AgentTemplateCard = { title: string; description: string };

const FALLBACK_AGENT_TEMPLATES: readonly AgentTemplateCard[] = [
  {
    title: 'Code Reviewer',
    description: 'Run checks on pull requests and post concise review feedback.',
  },
  {
    title: 'Release Assistant',
    description: 'Prepare release notes, validate rollout steps, and flag risks.',
  },
  {
    title: 'Incident Triage',
    description: 'Summarize logs, propose fixes, and coordinate next actions quickly.',
  },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AgentsPage(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const agents = useQuery(agentsQuery());
  const machines = useQuery(machinesQuery());
  const recentSessions = useQuery(sessionsQuery({ limit: 100 }));

  const createAgent = useCreateAgent();
  const startAgent = useStartAgent();
  const stopAgent = useStopAgent();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [startDialogAgent, setStartDialogAgent] = useState<StartDialogAgent | null>(null);
  const [startPrompt, setStartPrompt] = useState('');
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    setShowCreateDialog(true);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('new');
    const query = nextParams.toString();
    router.replace(query ? `/agents?${query}` : '/agents');
  }, [router, searchParams]);

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
        n: () => setShowCreateDialog(true),
        Escape: () => {
          if (startDialogAgent) {
            setStartDialogAgent(null);
            setStartPrompt('');
          } else if (showCreateDialog) setShowCreateDialog(false);
        },
      }),
      [agents, showCreateDialog, startDialogAgent],
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
  const templateCards = FALLBACK_AGENT_TEMPLATES;

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
  const handleStart = (): void => {
    const effectivePrompt = startPrompt.trim() || startDialogAgent?.defaultPrompt || '';
    if (!startDialogAgent || !effectivePrompt || isStarting) return;
    setIsStarting(true);
    startAgent.mutate(
      { id: startDialogAgent.id, prompt: effectivePrompt },
      {
        onSuccess: () => {
          setIsStarting(false);
          toast.success('Agent started');
          setStartPrompt('');
          setStartDialogAgent(null);
        },
        onError: (err) => {
          setIsStarting(false);
          toast.error(err instanceof Error ? err.message : String(err));
        },
      },
    );
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
      <Dialog
        open={!!startDialogAgent}
        onOpenChange={(open) => {
          if (!open) {
            setStartDialogAgent(null);
            setStartPrompt('');
            setIsStarting(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Start Agent</DialogTitle>
            <DialogDescription>
              {startDialogAgent
                ? `Start "${startDialogAgent.name}" with a one-off prompt.`
                : 'Start an agent with a one-off prompt.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="start-agent-prompt">
              Prompt
            </label>
            <Input
              id="start-agent-prompt"
              value={startPrompt}
              onChange={(e) => setStartPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleStart();
                }
              }}
              placeholder={
                startDialogAgent?.defaultPrompt ? 'Use default prompt' : 'Enter prompt...'
              }
              disabled={isStarting}
              autoFocus
            />
            {startDialogAgent?.defaultPrompt && !startPrompt.trim() && (
              <p className="text-xs text-muted-foreground">
                Default: {startDialogAgent.defaultPrompt.length > 120
                  ? `${startDialogAgent.defaultPrompt.slice(0, 120)}...`
                  : startDialogAgent.defaultPrompt}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setStartDialogAgent(null);
                setStartPrompt('');
                setIsStarting(false);
              }}
              disabled={isStarting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleStart}
              disabled={(!startPrompt.trim() && !startDialogAgent?.defaultPrompt) || isStarting}
            >
              {isStarting ? 'Starting...' : 'Start'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          <Button
            type="button"
            variant="outline"
            size="sm"
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
          >
            Export CSV
          </Button>
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
          <Card className="border-border/60 py-0">
            <CardContent className="space-y-4 p-6">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-foreground">No agents yet</h2>
                <p className="text-sm text-muted-foreground">
                  Start with a template use case and create your first agent.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {templateCards.map((template) => (
                  <Card key={template.title} className="border-border/50 bg-muted/20 py-0">
                    <CardContent className="space-y-1 p-3">
                      <h3 className="text-sm font-medium text-foreground">{template.title}</h3>
                      <p className="text-xs text-muted-foreground">{template.description}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div>
                <Button size="sm" onClick={() => setShowCreateDialog(true)}>
                  Create Agent
                </Button>
              </div>
            </CardContent>
          </Card>
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
            <Card
              key={agent.id}
              className={cn(
                'group gap-0 py-0 rounded-lg border-border/50 transition-all duration-200 hover:border-border/80 hover:shadow-sm',
                agent.status === 'running' && 'border-l-2 border-l-green-500',
                (agent.status === 'starting' || agent.status === 'stopping') && 'animate-pulse',
              )}
            >
              <CardContent className="space-y-3 px-4 py-4">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/agents/${agent.id}`}
                    className="min-w-0 text-[15px] font-semibold text-foreground no-underline transition-colors hover:text-primary"
                  >
                    <span className="block truncate">{agent.name}</span>
                  </Link>
                  <StatusBadge status={agent.status} />
                </div>
                <div className="space-y-2 text-xs">
                  <CardInfoRow
                    label="Machine"
                    value={<span className="font-mono text-[11px]">{agent.machineId}</span>}
                  />
                  <CardInfoRow
                    label="Project"
                    value={
                      agent.projectPath ? (
                        <SimpleTooltip content={agent.projectPath}>
                          <span className="block max-w-[190px] truncate font-mono text-[11px]">
                            {agent.projectPath}
                          </span>
                        </SimpleTooltip>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )
                    }
                  />
                  <CardInfoRow
                    label="Last run"
                    value={
                      agent.lastRunAt ? (
                        <span className="text-muted-foreground text-[11px]">
                          <LiveTimeAgo date={agent.lastRunAt} />
                        </span>
                      ) : (
                        'never run'
                      )
                    }
                  />
                  <CardInfoRow
                    label="Cost"
                    value={<span className="font-medium">{formatCost(agent.totalCostUsd)}</span>}
                  />
                </div>
              </CardContent>
              <div className="mt-0 border-t border-border px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setStartDialogAgent({
                        id: agent.id,
                        name: agent.name,
                        defaultPrompt: agent.config?.defaultPrompt,
                      });
                      setStartPrompt('');
                    }}
                    disabled={
                      isStarting || agent.status === 'running' || agent.status === 'starting'
                    }
                  >
                    Start
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <Link
                      href={`/agents/${agent.id}/settings`}
                      aria-label={`Settings for agent ${agent.name}`}
                    >
                      <Settings className="h-3 w-3" />
                      Settings
                    </Link>
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function CardInfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="min-w-0 text-right text-xs text-foreground">{value}</div>
    </div>
  );
}
