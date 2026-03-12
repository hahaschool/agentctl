'use client';

import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CronBuilder } from '@/components/CronBuilder';
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
import { cn } from '@/lib/utils';
import type { Agent, AgentConfig, Machine, McpServerConfig } from '../lib/api';
import { shortenPath } from '../lib/format-utils';
import { AGENT_TYPES, DEFAULT_MODEL, ALL_MODELS as MODEL_OPTIONS } from '../lib/model-options';
import { memoryScopesQuery } from '../lib/queries';
import { STORAGE_KEYS } from '../lib/storage-keys';
import { McpServerPicker } from './McpServerPicker';

// ---------------------------------------------------------------------------
// Memory budget defaults
// ---------------------------------------------------------------------------

const DEFAULT_MEMORY_MAX_TOKENS = 2400;
const DEFAULT_MEMORY_MAX_FACTS = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Slugify the first ~30 chars of a prompt into a name like "fix-auth-bug-in-login" */
function slugifyPrompt(prompt: string): string {
  return (
    prompt
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 40)
      .replace(/-+$/, '') || 'new-agent'
  );
}

/** Pick the first online machine, or fallback to last-used, or first available */
function pickDefaultMachine(machines: Machine[]): string {
  const lastUsed =
    typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.LAST_MACHINE_ID) : null;
  const online = machines.filter((m) => m.status === 'online');
  if (lastUsed && machines.some((m) => m.id === lastUsed)) return lastUsed;
  if (online.length > 0) return online[0]?.id ?? '';
  return machines.length > 0 ? (machines[0]?.id ?? '') : '';
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryBudget = {
  maxTokens: number;
  maxFacts: number;
  scopeId?: string;
};

export type AgentFormCreateData = {
  name: string;
  machineId: string;
  type: string;
  schedule?: string;
  projectPath?: string;
  config?: AgentConfig;
  memoryBudget?: MemoryBudget;
};

export type AgentFormEditData = {
  id: string;
  name: string;
  machineId: string;
  type: string;
  schedule: string | null;
  config?: AgentConfig;
};

export type AgentFormDialogProps = {
  mode: 'create' | 'edit';
  open: boolean;
  onClose: () => void;
  onSubmit: (data: AgentFormCreateData | AgentFormEditData) => void;
  isPending: boolean;
  /** Agent to edit — required when mode is 'edit' */
  agent?: Agent | null;
  machines: Machine[];
  recentProjectPaths: string[];
};

// (MCP server form helpers removed — now handled by McpServerPicker component)

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentFormDialog({
  mode,
  open,
  onClose,
  onSubmit,
  isPending,
  agent,
  machines,
  recentProjectPaths,
}: AgentFormDialogProps): React.JSX.Element {
  const isCreate = mode === 'create';

  // -----------------------------------------------------------------------
  // Shared form state
  // -----------------------------------------------------------------------
  const [name, setName] = useState('');
  const [machineId, setMachineId] = useState('');
  const [type, setType] = useState<string>('adhoc');
  const [model, setModel] = useState('');
  const [initialPrompt, setInitialPrompt] = useState('');
  const [schedule, setSchedule] = useState('');
  const [maxTurns, setMaxTurns] = useState('');
  const [permissionMode, setPermissionMode] = useState('default');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [mcpServers, setMcpServers] = useState<Record<string, McpServerConfig>>({});

  // Create-only state
  const [projectPath, setProjectPath] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [memoryScopeId, setMemoryScopeId] = useState('');
  const [memoryMaxTokens, setMemoryMaxTokens] = useState(String(DEFAULT_MEMORY_MAX_TOKENS));
  const [memoryMaxFacts, setMemoryMaxFacts] = useState(String(DEFAULT_MEMORY_MAX_FACTS));

  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);

  // Memory scopes for the scope selector (create mode only)
  const scopesQuery = useQuery({ ...memoryScopesQuery(), enabled: isCreate && open });

  // -----------------------------------------------------------------------
  // Derived data
  // -----------------------------------------------------------------------

  const filteredProjectPaths = useMemo(() => {
    if (!projectSearchQuery.trim()) return recentProjectPaths;
    const q = projectSearchQuery.toLowerCase();
    return recentProjectPaths.filter((p) => p.toLowerCase().includes(q));
  }, [recentProjectPaths, projectSearchQuery]);

  // Auto-select machine for create mode
  const autoSelectMachine = useCallback(() => {
    if (!machineId && machines.length > 0) {
      setMachineId(pickDefaultMachine(machines));
    }
  }, [machineId, machines]);

  // -----------------------------------------------------------------------
  // Reset / populate form
  // -----------------------------------------------------------------------

  const resetCreateForm = useCallback(() => {
    setInitialPrompt('');
    setName('');
    setMachineId('');
    setType('adhoc');
    setModel(
      (typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.DEFAULT_MODEL) : null) ??
        DEFAULT_MODEL,
    );
    setProjectPath('');
    setAdvancedOpen(false);
    setSchedule('');
    setMaxTurns('');
    setPermissionMode('default');
    setSystemPrompt('');
    setDefaultPrompt('');
    setMcpServers({});
    setProjectSearchQuery('');
    setShowProjectDropdown(false);
    setMemoryScopeId('');
    setMemoryMaxTokens(String(DEFAULT_MEMORY_MAX_TOKENS));
    setMemoryMaxFacts(String(DEFAULT_MEMORY_MAX_FACTS));
  }, []);

  const populateEditForm = useCallback((a: Agent) => {
    setName(a.name);
    setMachineId(a.machineId);
    setType(a.type);
    setModel(a.config?.model ?? '');
    setInitialPrompt(a.config?.initialPrompt ?? '');
    setSchedule(a.schedule ?? '');
    setMaxTurns(a.config?.maxTurns != null ? String(a.config.maxTurns) : '');
    setPermissionMode(a.config?.permissionMode ?? 'default');
    setSystemPrompt(a.config?.systemPrompt ?? '');
    setDefaultPrompt(a.config?.defaultPrompt ?? '');
    setMcpServers(a.config?.mcpServers ?? {});
  }, []);

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

  // -----------------------------------------------------------------------
  // Submission
  // -----------------------------------------------------------------------

  const handleSubmit = (): void => {
    if (isCreate) {
      if (!initialPrompt.trim() || !machineId) return;

      const agentName = name.trim() || slugifyPrompt(initialPrompt);
      const config: AgentConfig = {};
      if (model.trim()) config.model = model.trim();
      if (initialPrompt.trim()) config.initialPrompt = initialPrompt.trim();
      if (maxTurns.trim() && Number(maxTurns) > 0) config.maxTurns = Number(maxTurns);
      if (permissionMode && permissionMode !== 'default')
        config.permissionMode = permissionMode as AgentConfig['permissionMode'];
      if (systemPrompt.trim()) config.systemPrompt = systemPrompt.trim();
      if (defaultPrompt.trim()) config.defaultPrompt = defaultPrompt.trim();
      if (Object.keys(mcpServers).length > 0) config.mcpServers = mcpServers;

      // Remember last-used machine
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(STORAGE_KEYS.LAST_MACHINE_ID, machineId);
        } catch {
          // localStorage may throw in private browsing or when quota is exceeded
        }
      }

      const maxTokensNum = Number(memoryMaxTokens);
      const maxFactsNum = Number(memoryMaxFacts);
      const hasCustomBudget =
        maxTokensNum !== DEFAULT_MEMORY_MAX_TOKENS ||
        maxFactsNum !== DEFAULT_MEMORY_MAX_FACTS ||
        memoryScopeId.trim().length > 0;
      const memoryBudget: MemoryBudget | undefined = hasCustomBudget
        ? {
            maxTokens: maxTokensNum > 0 ? maxTokensNum : DEFAULT_MEMORY_MAX_TOKENS,
            maxFacts: maxFactsNum > 0 ? maxFactsNum : DEFAULT_MEMORY_MAX_FACTS,
            ...(memoryScopeId.trim() ? { scopeId: memoryScopeId.trim() } : {}),
          }
        : undefined;

      onSubmit({
        name: agentName,
        machineId,
        type,
        ...(type === 'cron' && schedule.trim() ? { schedule: schedule.trim() } : {}),
        ...(projectPath.trim() ? { projectPath: projectPath.trim() } : {}),
        ...(Object.keys(config).length > 0 ? { config } : {}),
        ...(memoryBudget ? { memoryBudget } : {}),
      } satisfies AgentFormCreateData);
    } else {
      if (!agent || !name.trim() || !machineId) return;

      const config: AgentConfig = { ...agent.config };
      if (model.trim()) {
        config.model = model.trim();
      } else {
        delete config.model;
      }
      if (initialPrompt.trim()) {
        config.initialPrompt = initialPrompt.trim();
      } else {
        delete config.initialPrompt;
      }
      if (maxTurns.trim() && Number(maxTurns) > 0) {
        config.maxTurns = Number(maxTurns);
      } else {
        delete config.maxTurns;
      }
      if (permissionMode && permissionMode !== 'default') {
        config.permissionMode = permissionMode as AgentConfig['permissionMode'];
      } else {
        delete config.permissionMode;
      }
      if (systemPrompt.trim()) {
        config.systemPrompt = systemPrompt.trim();
      } else {
        delete config.systemPrompt;
      }
      if (defaultPrompt.trim()) {
        config.defaultPrompt = defaultPrompt.trim();
      } else {
        delete config.defaultPrompt;
      }
      if (Object.keys(mcpServers).length > 0) {
        config.mcpServers = mcpServers;
      } else {
        delete config.mcpServers;
      }

      onSubmit({
        id: agent.id,
        name: name.trim(),
        machineId,
        type,
        schedule: type === 'cron' && schedule.trim() ? schedule.trim() : null,
        ...(Object.keys(config).length > 0 ? { config } : {}),
      } satisfies AgentFormEditData);
    }
  };

  const isDisabled = isCreate
    ? isPending || !initialPrompt.trim() || !machineId
    : isPending || !name.trim() || !machineId;

  // -----------------------------------------------------------------------
  // Dialog open/close handling
  // -----------------------------------------------------------------------

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      if (isCreate) resetCreateForm();
      onClose();
    } else if (isCreate) {
      autoSelectMachine();
      setTimeout(() => promptTextareaRef.current?.focus(), 50);
    }
  };

  // Populate edit form when agent changes
  useEffect(() => {
    if (open && !isCreate && agent) {
      populateEditForm(agent);
    }
  }, [open, isCreate, agent, populateEditForm]);

  // Auto-select machine when dialog opens in create mode
  useEffect(() => {
    if (open && isCreate) {
      autoSelectMachine();
    }
  }, [open, isCreate, autoSelectMachine]);

  // -----------------------------------------------------------------------
  // Shared sub-components for form fields
  // -----------------------------------------------------------------------

  const machineSelect = (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" htmlFor={`${mode}-agent-machine`}>
        Machine {!isCreate && <span className="text-destructive">*</span>}
      </label>
      <Select value={machineId} onValueChange={setMachineId} disabled={isPending}>
        <SelectTrigger className="w-full" id={`${mode}-agent-machine`}>
          <SelectValue placeholder="Select a machine" />
        </SelectTrigger>
        <SelectContent position="popper" sideOffset={4}>
          {machines.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {isCreate ? (
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
              ) : (
                `${m.hostname} (${m.id})`
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const typeSelect = (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" htmlFor={`${mode}-agent-type`}>
        Type
      </label>
      <Select value={type} onValueChange={setType} disabled={isPending}>
        <SelectTrigger className="w-full" id={`${mode}-agent-type`}>
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
  );

  const scheduleInput =
    type === 'cron' ? (
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor={`${mode}-agent-schedule`}>
          Schedule
        </label>
        <CronBuilder
          value={schedule || '0 */6 * * *'}
          onChange={setSchedule}
          disabled={isPending}
        />
      </div>
    ) : null;

  const maxTurnsInput = (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" htmlFor={`${mode}-agent-maxturns`}>
        Max Turns
      </label>
      <Input
        id={`${mode}-agent-maxturns`}
        type="number"
        min={1}
        placeholder="unlimited"
        value={maxTurns}
        onChange={(e) => setMaxTurns(e.target.value)}
        disabled={isPending}
      />
      <p className="text-[11px] text-muted-foreground">
        Maximum interaction turns before the agent stops. Leave empty for unlimited.
      </p>
    </div>
  );

  const permissionModeSelect = (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" htmlFor={`${mode}-agent-permission`}>
        Permission Mode
      </label>
      <Select value={permissionMode} onValueChange={setPermissionMode} disabled={isPending}>
        <SelectTrigger className="w-full" id={`${mode}-agent-permission`}>
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
            <span className="ml-2 text-muted-foreground text-[10px]">
              No file changes, planning mode
            </span>
          </SelectItem>
          <SelectItem value="bypassPermissions">
            <span className="font-medium">Bypass Permissions</span>
            <span className="ml-2 text-muted-foreground text-[10px]">Auto-approve everything</span>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  const systemPromptTextarea = (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" htmlFor={`${mode}-agent-sysprompt`}>
        System Prompt
      </label>
      <textarea
        id={`${mode}-agent-sysprompt`}
        rows={3}
        placeholder="Custom system instructions..."
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        disabled={isPending}
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
  );

  const defaultPromptTextarea = (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" htmlFor={`${mode}-agent-defaultprompt`}>
        Default Prompt
      </label>
      <textarea
        id={`${mode}-agent-defaultprompt`}
        rows={3}
        placeholder="Prompt used when no explicit prompt is provided..."
        value={defaultPrompt}
        onChange={(e) => setDefaultPrompt(e.target.value)}
        disabled={isPending}
        className={cn(
          'w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground resize-y',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'dark:bg-input/30',
        )}
      />
      <p className="text-[11px] text-muted-foreground">
        Used when no explicit prompt is provided (e.g. cron/heartbeat triggers).
      </p>
    </div>
  );

  // -----------------------------------------------------------------------
  // MCP server picker
  // -----------------------------------------------------------------------

  const mcpServersSection = (
    <McpServerPicker
      machineId={machineId}
      projectPath={projectPath || agent?.projectPath || undefined}
      value={mcpServers}
      onChange={setMcpServers}
      disabled={isPending}
    />
  );

  const memoryScopeSelect = isCreate ? (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" htmlFor="create-agent-memory-scope">
        Memory Scope
      </label>
      <Select
        value={memoryScopeId || '__none__'}
        onValueChange={(v) => setMemoryScopeId(v === '__none__' ? '' : v)}
        disabled={isPending}
      >
        <SelectTrigger className="w-full" id="create-agent-memory-scope">
          <SelectValue placeholder="All scopes (default)" />
        </SelectTrigger>
        <SelectContent position="popper" sideOffset={4}>
          <SelectItem value="__none__">All scopes (default)</SelectItem>
          {(scopesQuery.data?.scopes ?? []).map((scope) => (
            <SelectItem key={scope.id} value={scope.id}>
              <span className="font-medium capitalize">{scope.type}</span>
              <span className="ml-2 text-muted-foreground text-[10px]">{scope.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        Restrict memory injection to a specific scope. Leave blank to include all scopes.
      </p>
    </div>
  ) : null;

  const memoryBudgetInputs = isCreate ? (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">Memory Budget</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label
            className="text-[11px] text-muted-foreground mb-1 block"
            htmlFor="create-agent-mem-tokens"
          >
            Max Tokens
          </label>
          <Input
            id="create-agent-mem-tokens"
            type="number"
            min={100}
            max={32000}
            value={memoryMaxTokens}
            onChange={(e) => setMemoryMaxTokens(e.target.value)}
            disabled={isPending}
            placeholder={String(DEFAULT_MEMORY_MAX_TOKENS)}
          />
        </div>
        <div>
          <label
            className="text-[11px] text-muted-foreground mb-1 block"
            htmlFor="create-agent-mem-facts"
          >
            Max Facts
          </label>
          <Input
            id="create-agent-mem-facts"
            type="number"
            min={1}
            max={200}
            value={memoryMaxFacts}
            onChange={(e) => setMemoryMaxFacts(e.target.value)}
            disabled={isPending}
            placeholder={String(DEFAULT_MEMORY_MAX_FACTS)}
          />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Override the memory injection budget for this agent (default: {DEFAULT_MEMORY_MAX_TOKENS}{' '}
        tokens / {DEFAULT_MEMORY_MAX_FACTS} facts).
      </p>
    </div>
  ) : null;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (isCreate) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Agent</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Prompt — primary input */}
            <div className="space-y-1.5">
              <textarea
                ref={promptTextareaRef}
                id="create-agent-prompt"
                aria-label="Agent prompt"
                rows={4}
                placeholder="What do you want the agent to do?"
                value={initialPrompt}
                onChange={(e) => setInitialPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!isDisabled) handleSubmit();
                  }
                }}
                disabled={isPending}
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
              <label className="text-sm font-medium" htmlFor="create-agent-project">
                Project
              </label>
              <div className="relative">
                <Input
                  ref={projectInputRef}
                  id="create-agent-project"
                  placeholder={
                    recentProjectPaths.length > 0
                      ? 'Select or type a project path...'
                      : '/path/to/project'
                  }
                  value={projectPath}
                  onChange={(e) => {
                    setProjectPath(e.target.value);
                    setProjectSearchQuery(e.target.value);
                    setShowProjectDropdown(true);
                  }}
                  onFocus={() => {
                    if (recentProjectPaths.length > 0) setShowProjectDropdown(true);
                  }}
                  disabled={isPending}
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
                          p === projectPath && 'bg-accent',
                        )}
                        title={p}
                        onClick={() => {
                          setProjectPath(p);
                          setProjectSearchQuery('');
                          setShowProjectDropdown(false);
                        }}
                      >
                        <span className="font-medium">{shortenPath(p)}</span>
                        <span className="text-[11px] text-muted-foreground ml-2 font-mono">
                          {p}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Machine */}
            {machineSelect}

            {/* Advanced options — collapsible */}
            <div>
              <button
                type="button"
                onClick={() => setAdvancedOpen(!advancedOpen)}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="text-xs">{advancedOpen ? '\u25BE' : '\u25B8'}</span>
                Advanced
                {(name.trim() ||
                  model !== DEFAULT_MODEL ||
                  type !== 'adhoc' ||
                  schedule.trim() ||
                  maxTurns.trim() ||
                  permissionMode !== 'default' ||
                  systemPrompt.trim() ||
                  defaultPrompt.trim() ||
                  memoryScopeId.trim() ||
                  memoryMaxTokens !== String(DEFAULT_MEMORY_MAX_TOKENS) ||
                  memoryMaxFacts !== String(DEFAULT_MEMORY_MAX_FACTS)) && (
                  <span className="text-[10px] text-primary">(customized)</span>
                )}
              </button>

              {advancedOpen && (
                <div className="mt-3 space-y-3 pl-4 border-l-2 border-border">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="create-agent-name">
                      Name
                    </label>
                    <Input
                      id="create-agent-name"
                      placeholder={
                        initialPrompt.trim()
                          ? slugifyPrompt(initialPrompt)
                          : 'auto-generated from prompt'
                      }
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={isPending}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Leave blank to auto-generate from prompt.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="create-agent-model">
                      Model
                    </label>
                    <Select
                      value={MODEL_OPTIONS.some((m) => m.value === model) ? model : '__custom__'}
                      onValueChange={(v) => {
                        if (v !== '__custom__') setModel(v);
                      }}
                      disabled={isPending}
                    >
                      <SelectTrigger className="w-full" id="create-agent-model">
                        <SelectValue>
                          {MODEL_OPTIONS.find((m) => m.value === model)?.label ?? model}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent position="popper" sideOffset={4}>
                        {MODEL_OPTIONS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            <span className="font-medium">{m.label}</span>
                            <span
                              className={cn(
                                'ml-2 text-[10px]',
                                m.tier === 'flagship'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : m.tier === 'fast'
                                    ? 'text-green-600 dark:text-green-400'
                                    : 'text-blue-600 dark:text-blue-400',
                              )}
                            >
                              {m.tier}
                            </span>
                          </SelectItem>
                        ))}
                        <SelectItem value="__custom__">
                          <span className="text-muted-foreground">Custom model ID...</span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {!MODEL_OPTIONS.some((m) => m.value === model) && (
                      <Input
                        aria-label="Custom model ID"
                        placeholder="Enter custom model ID"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        disabled={isPending}
                        className="mt-1.5"
                      />
                    )}
                  </div>

                  {typeSelect}
                  {scheduleInput}
                  {maxTurnsInput}
                  {permissionModeSelect}
                  {systemPromptTextarea}
                  {defaultPromptTextarea}
                  {memoryScopeSelect}
                  {memoryBudgetInputs}
                </div>
              )}
            </div>

            {/* MCP Servers — collapsible section */}
            {mcpServersSection}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isDisabled}>
              {isPending ? 'Starting...' : 'Start Agent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // -----------------------------------------------------------------------
  // Edit mode
  // -----------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isPending}
            />
          </div>

          {machineSelect}
          {typeSelect}

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-agent-model">
              Model
            </label>
            <Input
              id="edit-agent-model"
              placeholder="claude-sonnet-4-6"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={isPending}
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
              value={initialPrompt}
              onChange={(e) => setInitialPrompt(e.target.value)}
              disabled={isPending}
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

          {scheduleInput}
          {maxTurnsInput}
          {permissionModeSelect}
          {systemPromptTextarea}
          {defaultPromptTextarea}

          {/* MCP Servers — collapsible section */}
          {mcpServersSection}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isDisabled}>
            {isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
