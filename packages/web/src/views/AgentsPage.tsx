'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import { Bot, Filter } from 'lucide-react';
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
import type { Agent, Machine } from '../lib/api';
import {
  agentsQuery,
  machinesQuery,
  sessionsQuery,
  useCreateAgent,
  useStartAgent,
  useStopAgent,
  useUpdateAgent,
} from '../lib/queries';

const AGENT_TYPES = [
  { value: 'adhoc', label: 'Ad-hoc', desc: 'One-shot task, runs once then stops' },
  { value: 'manual', label: 'Manual', desc: 'Started/stopped manually, persistent config' },
  { value: 'loop', label: 'Loop', desc: 'Runs in a loop until stopped or goal met' },
  { value: 'heartbeat', label: 'Heartbeat', desc: 'Triggered periodically (e.g. every 30min)' },
  { value: 'cron', label: 'Cron', desc: 'Triggered on a cron schedule' },
] as const;
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', tier: 'flagship' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', tier: 'balanced' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', tier: 'fast' },
  { value: 'claude-sonnet-4-5-20250514', label: 'Claude Sonnet 4.5', tier: 'balanced' },
  { value: 'claude-opus-4-0-20250514', label: 'Claude Opus 4', tier: 'flagship' },
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', tier: 'balanced' },
] as const;

type AgentSortOrder = 'name' | 'status' | 'lastRun' | 'cost';
type AgentStatusFilter = 'all' | 'running' | 'registered' | 'stopped' | 'error';

/** Slugify the first ~30 chars of a prompt into a name like "fix-auth-bug-in-login" */
function slugifyPrompt(prompt: string): string {
  return prompt
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '') || 'new-task';
}

/** Show last 2 path segments for compact display */
function shortPath(fullPath: string): string {
  const segments = fullPath.replace(/\/+$/, '').split('/');
  return segments.length <= 2 ? fullPath : `~/${segments.slice(-2).join('/')}`;
}

/** Pick the first online machine, or fallback to last-used, or first available */
function pickDefaultMachine(machines: Machine[]): string {
  const lastUsed = typeof window !== 'undefined'
    ? localStorage.getItem('agentctl:lastMachineId')
    : null;
  const online = machines.filter((m) => m.status === 'online');
  if (lastUsed && machines.some((m) => m.id === lastUsed)) return lastUsed;
  if (online.length > 0) return online[0]!.id;
  return machines.length > 0 ? machines[0]!.id : '';
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AgentsPage(): React.JSX.Element {
  const toast = useToast();
  const agents = useQuery(agentsQuery());
  const machines = useQuery(machinesQuery());
  const recentSessions = useQuery(sessionsQuery({ limit: 100 }));

  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();
  const startAgent = useStartAgent();
  const stopAgent = useStopAgent();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [editName, setEditName] = useState('');
  const [editMachineId, setEditMachineId] = useState('');
  const [editType, setEditType] = useState<string>('adhoc');
  const [editModel, setEditModel] = useState('');
  const [editInitialPrompt, setEditInitialPrompt] = useState('');
  const [editSchedule, setEditSchedule] = useState('');
  const [editMaxTurns, setEditMaxTurns] = useState('');
  const [editPermissionMode, setEditPermissionMode] = useState('default');
  const [editSystemPrompt, setEditSystemPrompt] = useState('');

  // New task dialog state
  const [createPrompt, setCreatePrompt] = useState('');
  const [createProjectPath, setCreateProjectPath] = useState('');
  const [createMachineId, setCreateMachineId] = useState('');
  const [createAdvancedOpen, setCreateAdvancedOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createType, setCreateType] = useState<string>('adhoc');
  const [createModel, setCreateModel] = useState(
    () =>
      (typeof window !== 'undefined' ? localStorage.getItem('agentctl:defaultModel') : null) ??
      DEFAULT_MODEL,
  );
  const [createSchedule, setCreateSchedule] = useState('');
  const [createMaxTurns, setCreateMaxTurns] = useState('');
  const [createPermissionMode, setCreatePermissionMode] = useState('default');
  const [createSystemPrompt, setCreateSystemPrompt] = useState('');
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);

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

  // Filtered project paths for dropdown
  const filteredProjectPaths = useMemo(() => {
    if (!projectSearchQuery.trim()) return recentProjectPaths;
    const q = projectSearchQuery.toLowerCase();
    return recentProjectPaths.filter((p) => p.toLowerCase().includes(q));
  }, [recentProjectPaths, projectSearchQuery]);

  // Auto-select first online machine when dialog opens
  const machineList = machines.data ?? [];
  const autoSelectMachine = useCallback(() => {
    if (!createMachineId && machineList.length > 0) {
      setCreateMachineId(pickDefaultMachine(machineList));
    }
  }, [createMachineId, machineList]);

  // Close project dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (
        projectDropdownRef.current &&
        !projectDropdownRef.current.contains(e.target as Node) &&
        projectInputRef.current &&
        !projectInputRef.current.contains(e.target as Node)
      ) {
        setShowProjectDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
          else if (editingAgent) setEditingAgent(null);
          else if (showCreateDialog) setShowCreateDialog(false);
        },
      }),
      [agents, promptAgentId, editingAgent, showCreateDialog],
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

  // -- Create agent handler --
  function resetCreateForm(): void {
    setCreatePrompt('');
    setCreateName('');
    setCreateMachineId('');
    setCreateType('adhoc');
    setCreateModel(
      (typeof window !== 'undefined' ? localStorage.getItem('agentctl:defaultModel') : null) ??
        DEFAULT_MODEL,
    );
    setCreateProjectPath('');
    setCreateAdvancedOpen(false);
    setCreateSchedule('');
    setCreateMaxTurns('');
    setCreatePermissionMode('default');
    setCreateSystemPrompt('');
    setProjectSearchQuery('');
    setShowProjectDropdown(false);
  }

  // -- Edit agent helpers --
  function openEditDialog(agent: Agent): void {
    setEditName(agent.name);
    setEditMachineId(agent.machineId);
    setEditType(agent.type);
    setEditModel((agent.config as Record<string, unknown>)?.model as string ?? '');
    setEditInitialPrompt((agent.config as Record<string, unknown>)?.initialPrompt as string ?? '');
    setEditSchedule(agent.schedule ?? '');
    setEditMaxTurns(
      (agent.config as Record<string, unknown>)?.maxTurns != null
        ? String((agent.config as Record<string, unknown>).maxTurns)
        : '',
    );
    setEditPermissionMode(
      ((agent.config as Record<string, unknown>)?.permissionMode as string) ?? 'default',
    );
    setEditSystemPrompt(
      ((agent.config as Record<string, unknown>)?.systemPrompt as string) ?? '',
    );
    setEditingAgent(agent);
  }

  const handleEdit = (): void => {
    if (!editingAgent || !editName.trim() || !editMachineId) return;

    const config: Record<string, unknown> = { ...editingAgent.config };
    if (editModel.trim()) {
      config.model = editModel.trim();
    } else {
      delete config.model;
    }
    if (editInitialPrompt.trim()) {
      config.initialPrompt = editInitialPrompt.trim();
    } else {
      delete config.initialPrompt;
    }
    if (editMaxTurns.trim() && Number(editMaxTurns) > 0) {
      config.maxTurns = Number(editMaxTurns);
    } else {
      delete config.maxTurns;
    }
    if (editPermissionMode && editPermissionMode !== 'default') {
      config.permissionMode = editPermissionMode;
    } else {
      delete config.permissionMode;
    }
    if (editSystemPrompt.trim()) {
      config.systemPrompt = editSystemPrompt.trim();
    } else {
      delete config.systemPrompt;
    }

    updateAgent.mutate(
      {
        id: editingAgent.id,
        name: editName.trim(),
        machineId: editMachineId,
        type: editType,
        schedule: editType === 'cron' && editSchedule.trim() ? editSchedule.trim() : null,
        ...(Object.keys(config).length > 0 ? { config } : {}),
      },
      {
        onSuccess: () => {
          toast.success(`Agent "${editName.trim()}" updated`);
          setEditingAgent(null);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : String(err));
        },
      },
    );
  };

  const isEditDisabled = updateAgent.isPending || !editName.trim() || !editMachineId;

  const handleCreate = (): void => {
    if (!createPrompt.trim() || !createMachineId) return;

    const agentName = createName.trim() || slugifyPrompt(createPrompt);
    const config: Record<string, unknown> = {};
    if (createModel.trim()) config.model = createModel.trim();
    if (createPrompt.trim()) config.initialPrompt = createPrompt.trim();
    if (createMaxTurns.trim() && Number(createMaxTurns) > 0) config.maxTurns = Number(createMaxTurns);
    if (createPermissionMode && createPermissionMode !== 'default') config.permissionMode = createPermissionMode;
    if (createSystemPrompt.trim()) config.systemPrompt = createSystemPrompt.trim();

    // Remember last-used machine
    if (typeof window !== 'undefined') {
      localStorage.setItem('agentctl:lastMachineId', createMachineId);
    }

    createAgent.mutate(
      {
        name: agentName,
        machineId: createMachineId,
        type: createType,
        ...(createType === 'cron' && createSchedule.trim() ? { schedule: createSchedule.trim() } : {}),
        ...(createProjectPath.trim() ? { projectPath: createProjectPath.trim() } : {}),
        ...(Object.keys(config).length > 0 ? { config } : {}),
      },
      {
        onSuccess: () => {
          toast.success(`Agent "${agentName}" created`);
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

  const isCreateDisabled = createAgent.isPending || !createPrompt.trim() || !createMachineId;

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
            New Task
          </Button>
        </div>
      </div>

      {/* Error banners */}
      {agents.error && (
        <ErrorBanner message={agents.error.message} onRetry={() => void agents.refetch()} />
      )}

      {/* New Task Dialog */}
      <Dialog
        open={showCreateDialog}
        onOpenChange={(open) => {
          if (!open) resetCreateForm();
          setShowCreateDialog(open);
          if (open) {
            autoSelectMachine();
            // Auto-focus the prompt textarea after dialog renders
            setTimeout(() => promptTextareaRef.current?.focus(), 50);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Task</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Prompt — primary input */}
            <div className="space-y-1.5">
              <textarea
                ref={promptTextareaRef}
                id="create-task-prompt"
                rows={4}
                placeholder="What do you want the agent to do?"
                value={createPrompt}
                onChange={(e) => setCreatePrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!isCreateDisabled) handleCreate();
                  }
                }}
                disabled={createAgent.isPending}
                className={cn(
                  'w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2.5 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground resize-y',
                  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  'dark:bg-input/30',
                )}
              />
              <p className="text-[11px] text-muted-foreground">
                Press Enter to start. Shift+Enter for newline.
              </p>
            </div>

            {/* Project path — combobox with recent projects */}
            <div className="space-y-1.5 relative">
              <label className="text-sm font-medium" htmlFor="create-task-project">
                Project
              </label>
              <div className="relative">
                <Input
                  ref={projectInputRef}
                  id="create-task-project"
                  placeholder={recentProjectPaths.length > 0 ? 'Select or type a project path...' : '/path/to/project'}
                  value={createProjectPath}
                  onChange={(e) => {
                    setCreateProjectPath(e.target.value);
                    setProjectSearchQuery(e.target.value);
                    setShowProjectDropdown(true);
                  }}
                  onFocus={() => {
                    if (recentProjectPaths.length > 0) setShowProjectDropdown(true);
                  }}
                  disabled={createAgent.isPending}
                />
                {showProjectDropdown && filteredProjectPaths.length > 0 && (
                  <div
                    ref={projectDropdownRef}
                    className="absolute z-50 mt-1 w-full max-h-[160px] overflow-y-auto rounded-md border border-border bg-popover shadow-md"
                  >
                    {filteredProjectPaths.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors',
                          p === createProjectPath && 'bg-accent',
                        )}
                        title={p}
                        onClick={() => {
                          setCreateProjectPath(p);
                          setProjectSearchQuery('');
                          setShowProjectDropdown(false);
                        }}
                      >
                        <span className="font-medium">{shortPath(p)}</span>
                        <span className="text-[11px] text-muted-foreground ml-2 font-mono">{p}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Machine — auto-selected, shown inline */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="create-task-machine">
                Machine
              </label>
              <Select
                value={createMachineId}
                onValueChange={setCreateMachineId}
                disabled={createAgent.isPending}
              >
                <SelectTrigger className="w-full" id="create-task-machine">
                  <SelectValue placeholder="Select a machine" />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  {machineList.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            'inline-block w-2 h-2 rounded-full',
                            m.status === 'online' ? 'bg-green-500' : 'bg-gray-400',
                          )}
                        />
                        {m.hostname}
                        <span className="text-muted-foreground text-[11px]">({m.id})</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Advanced options — collapsible */}
            <div>
              <button
                type="button"
                onClick={() => setCreateAdvancedOpen(!createAdvancedOpen)}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="text-xs">{createAdvancedOpen ? '\u25BE' : '\u25B8'}</span>
                Advanced
                {(createName.trim() || createModel !== DEFAULT_MODEL || createType !== 'adhoc' || createSchedule.trim() || createMaxTurns.trim() || createPermissionMode !== 'default' || createSystemPrompt.trim()) && (
                  <span className="text-[10px] text-primary">(customized)</span>
                )}
              </button>

              {createAdvancedOpen && (
                <div className="mt-3 space-y-3 pl-4 border-l-2 border-border">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="create-task-name">
                      Name
                    </label>
                    <Input
                      id="create-task-name"
                      placeholder={createPrompt.trim() ? slugifyPrompt(createPrompt) : 'auto-generated from prompt'}
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      disabled={createAgent.isPending}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Leave blank to auto-generate from prompt.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="create-task-model">
                      Model
                    </label>
                    <Select
                      value={MODEL_OPTIONS.some((m) => m.value === createModel) ? createModel : '__custom__'}
                      onValueChange={(v) => {
                        if (v !== '__custom__') setCreateModel(v);
                      }}
                      disabled={createAgent.isPending}
                    >
                      <SelectTrigger className="w-full" id="create-task-model">
                        <SelectValue>
                          {MODEL_OPTIONS.find((m) => m.value === createModel)?.label ?? createModel}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent position="popper" sideOffset={4}>
                        {MODEL_OPTIONS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            <span className="font-medium">{m.label}</span>
                            <span className={cn(
                              'ml-2 text-[10px]',
                              m.tier === 'flagship' ? 'text-amber-600 dark:text-amber-400' : m.tier === 'fast' ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400',
                            )}>
                              {m.tier}
                            </span>
                          </SelectItem>
                        ))}
                        <SelectItem value="__custom__">
                          <span className="text-muted-foreground">Custom model ID...</span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {!MODEL_OPTIONS.some((m) => m.value === createModel) && (
                      <Input
                        placeholder="Enter custom model ID"
                        value={createModel}
                        onChange={(e) => setCreateModel(e.target.value)}
                        disabled={createAgent.isPending}
                        className="mt-1.5"
                      />
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="create-task-type">
                      Type
                    </label>
                    <Select
                      value={createType}
                      onValueChange={setCreateType}
                      disabled={createAgent.isPending}
                    >
                      <SelectTrigger className="w-full" id="create-task-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper" sideOffset={4}>
                        {AGENT_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            <span className="font-medium">{t.label}</span>
                            <span className="ml-2 text-muted-foreground text-[10px]">{t.desc}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Schedule — only for cron type */}
                  {createType === 'cron' && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium" htmlFor="create-task-schedule">
                        Schedule (cron)
                      </label>
                      <Input
                        id="create-task-schedule"
                        placeholder="0 */6 * * *"
                        value={createSchedule}
                        onChange={(e) => setCreateSchedule(e.target.value)}
                        disabled={createAgent.isPending}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Cron expression. Examples: <code className="text-[10px]">*/30 * * * *</code> (every 30 min),{' '}
                        <code className="text-[10px]">0 9 * * 1-5</code> (weekdays 9am),{' '}
                        <code className="text-[10px]">0 */6 * * *</code> (every 6h)
                      </p>
                    </div>
                  )}

                  {/* Max Turns */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="create-task-maxturns">
                      Max Turns
                    </label>
                    <Input
                      id="create-task-maxturns"
                      type="number"
                      min={1}
                      placeholder="unlimited"
                      value={createMaxTurns}
                      onChange={(e) => setCreateMaxTurns(e.target.value)}
                      disabled={createAgent.isPending}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Maximum interaction turns before the agent stops. Leave empty for unlimited.
                    </p>
                  </div>

                  {/* Permission Mode */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="create-task-permission">
                      Permission Mode
                    </label>
                    <Select
                      value={createPermissionMode}
                      onValueChange={setCreatePermissionMode}
                      disabled={createAgent.isPending}
                    >
                      <SelectTrigger className="w-full" id="create-task-permission">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper" sideOffset={4}>
                        <SelectItem value="default">
                          <span className="font-medium">Default</span>
                          <span className="ml-2 text-muted-foreground text-[10px]">Ask before risky actions</span>
                        </SelectItem>
                        <SelectItem value="acceptEdits">
                          <span className="font-medium">Accept Edits</span>
                          <span className="ml-2 text-muted-foreground text-[10px]">Auto-approve file edits</span>
                        </SelectItem>
                        <SelectItem value="plan">
                          <span className="font-medium">Plan Only</span>
                          <span className="ml-2 text-muted-foreground text-[10px]">No file changes, planning mode</span>
                        </SelectItem>
                        <SelectItem value="bypassPermissions">
                          <span className="font-medium">Bypass Permissions</span>
                          <span className="ml-2 text-muted-foreground text-[10px]">Auto-approve everything</span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* System Prompt */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="create-task-sysprompt">
                      System Prompt
                    </label>
                    <textarea
                      id="create-task-sysprompt"
                      rows={3}
                      placeholder="Custom system instructions..."
                      value={createSystemPrompt}
                      onChange={(e) => setCreateSystemPrompt(e.target.value)}
                      disabled={createAgent.isPending}
                      className={cn(
                        'w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground resize-y',
                        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        'dark:bg-input/30',
                      )}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Custom system instructions appended to the base prompt.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isCreateDisabled}>
              {createAgent.isPending ? 'Starting...' : 'Start Agent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Agent Dialog */}
      <Dialog
        open={editingAgent !== null}
        onOpenChange={(open) => {
          if (!open) setEditingAgent(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Agent</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-agent-name">
                Name <span className="text-destructive">*</span>
              </label>
              <Input
                id="edit-agent-name"
                placeholder="my-agent"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                disabled={updateAgent.isPending}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-agent-machine">
                Machine <span className="text-destructive">*</span>
              </label>
              <Select
                value={editMachineId}
                onValueChange={setEditMachineId}
                disabled={updateAgent.isPending}
              >
                <SelectTrigger className="w-full" id="edit-agent-machine">
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
              <label className="text-sm font-medium" htmlFor="edit-agent-type">
                Type
              </label>
              <Select
                value={editType}
                onValueChange={setEditType}
                disabled={updateAgent.isPending}
              >
                <SelectTrigger className="w-full" id="edit-agent-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  {AGENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <span className="font-medium">{t.label}</span>
                      <span className="ml-2 text-muted-foreground text-[10px]">{t.desc}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-agent-model">
                Model
              </label>
              <Input
                id="edit-agent-model"
                placeholder="claude-sonnet-4-6"
                value={editModel}
                onChange={(e) => setEditModel(e.target.value)}
                disabled={updateAgent.isPending}
              />
              <p className="text-[11px] text-muted-foreground">
                The Claude model to use for this agent.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-agent-prompt">
                Initial Prompt
              </label>
              <textarea
                id="edit-agent-prompt"
                rows={3}
                placeholder="Describe what this agent should do..."
                value={editInitialPrompt}
                onChange={(e) => setEditInitialPrompt(e.target.value)}
                disabled={updateAgent.isPending}
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

            {/* Schedule — only for cron type */}
            {editType === 'cron' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="edit-agent-schedule">
                  Schedule (cron)
                </label>
                <Input
                  id="edit-agent-schedule"
                  placeholder="0 */6 * * *"
                  value={editSchedule}
                  onChange={(e) => setEditSchedule(e.target.value)}
                  disabled={updateAgent.isPending}
                />
                <p className="text-[11px] text-muted-foreground">
                  Cron expression. Examples: <code className="text-[10px]">*/30 * * * *</code> (every 30 min),{' '}
                  <code className="text-[10px]">0 9 * * 1-5</code> (weekdays 9am),{' '}
                  <code className="text-[10px]">0 */6 * * *</code> (every 6h)
                </p>
              </div>
            )}

            {/* Max Turns */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-agent-maxturns">
                Max Turns
              </label>
              <Input
                id="edit-agent-maxturns"
                type="number"
                min={1}
                placeholder="unlimited"
                value={editMaxTurns}
                onChange={(e) => setEditMaxTurns(e.target.value)}
                disabled={updateAgent.isPending}
              />
              <p className="text-[11px] text-muted-foreground">
                Maximum interaction turns before the agent stops. Leave empty for unlimited.
              </p>
            </div>

            {/* Permission Mode */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-agent-permission">
                Permission Mode
              </label>
              <Select
                value={editPermissionMode}
                onValueChange={setEditPermissionMode}
                disabled={updateAgent.isPending}
              >
                <SelectTrigger className="w-full" id="edit-agent-permission">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  <SelectItem value="default">
                    <span className="font-medium">Default</span>
                    <span className="ml-2 text-muted-foreground text-[10px]">Ask before risky actions</span>
                  </SelectItem>
                  <SelectItem value="acceptEdits">
                    <span className="font-medium">Accept Edits</span>
                    <span className="ml-2 text-muted-foreground text-[10px]">Auto-approve file edits</span>
                  </SelectItem>
                  <SelectItem value="plan">
                    <span className="font-medium">Plan Only</span>
                    <span className="ml-2 text-muted-foreground text-[10px]">No file changes, planning mode</span>
                  </SelectItem>
                  <SelectItem value="bypassPermissions">
                    <span className="font-medium">Bypass Permissions</span>
                    <span className="ml-2 text-muted-foreground text-[10px]">Auto-approve everything</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* System Prompt */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-agent-sysprompt">
                System Prompt
              </label>
              <textarea
                id="edit-agent-sysprompt"
                rows={3}
                placeholder="Custom system instructions..."
                value={editSystemPrompt}
                onChange={(e) => setEditSystemPrompt(e.target.value)}
                disabled={updateAgent.isPending}
                className={cn(
                  'w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground resize-y',
                  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  'dark:bg-input/30',
                )}
              />
              <p className="text-[11px] text-muted-foreground">
                Custom system instructions appended to the base prompt.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAgent(null)}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={isEditDisabled}>
              {updateAgent.isPending ? 'Saving...' : 'Save Changes'}
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
          aria-label="Sort order"
          className="px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
          {filteredAgents.map((agent) => (
            <div key={agent.id} className="p-4 bg-card border border-border/50 rounded-lg transition-colors hover:border-border">
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
                <button
                  type="button"
                  onClick={() => openEditDialog(agent)}
                  aria-label={`Edit agent ${agent.name}`}
                  className="px-3 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs font-medium cursor-pointer hover:bg-accent transition-colors focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                >
                  Edit
                </button>
                {agent.status === 'running' ? (
                  <ConfirmButton
                    label={stopAgent.isPending ? 'Stopping...' : 'Stop'}
                    confirmLabel="Stop Agent?"
                    onConfirm={() => handleStop(agent.id)}
                    disabled={stopAgent.isPending}
                    className={cn(
                      'px-3.5 py-1.5 bg-red-900 text-red-300 border border-red-800 rounded-md text-xs font-medium',
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
