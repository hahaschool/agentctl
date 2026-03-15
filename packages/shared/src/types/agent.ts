import type { ManagedSkill } from './runtime-management.js';

export type AgentType = 'heartbeat' | 'cron' | 'manual' | 'adhoc' | 'loop';

export type AgentRuntime = 'claude-code' | 'codex' | 'nanoclaw' | 'openclaw';

export const AGENT_RUNTIMES: readonly { value: AgentRuntime; label: string; desc: string }[] = [
  { value: 'claude-code', label: 'Claude Code', desc: 'Full Claude Code CLI with built-in tools' },
  { value: 'codex', label: 'Codex', desc: 'OpenAI Codex CLI runtime with managed sessions' },
  { value: 'nanoclaw', label: 'NanoClaw', desc: 'Lightweight agent with filesystem IPC' },
  { value: 'openclaw', label: 'OpenClaw', desc: 'Open-source agent runtime' },
] as const;

export type SessionMode = 'fresh' | 'resume';

export type ScheduleConfig = {
  /** Session mode: 'fresh' starts a new session, 'resume' continues the last. */
  sessionMode: SessionMode;
  /** Prompt template supporting {{date}}, {{iteration}}, {{lastResult}}, {{agentId}} variables. */
  promptTemplate: string;
  /** Cron expression or interval pattern. */
  pattern: string;
  /** IANA timezone for cron evaluation (e.g. "America/New_York"). */
  timezone?: string;
};

export type PromptTemplateVars = {
  /** ISO date string for the current run. */
  date: string;
  /** Zero-based iteration counter for scheduled runs. */
  iteration: number;
  /** Summary of the last run result, if available. */
  lastResult?: string;
  /** The agent's unique identifier. */
  agentId: string;
};

export const AGENT_STATUSES = [
  'registered',
  'starting',
  'running',
  'stopping',
  'stopped',
  'error',
  'timeout',
  'restarting',
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

/** Source indicating where an MCP server config was discovered or injected. */
export type McpServerSource = 'project' | 'machine' | 'global' | 'template' | 'custom';

/** An MCP server discovered via auto-detection or templates. */
export type DiscoveredMcpServer = {
  /** Unique key for this server (e.g. "filesystem", "memory"). */
  name: string;
  /** The MCP server configuration. */
  config: McpServerConfig;
  /** Where this server definition was found. */
  source: McpServerSource;
  /** Optional human-readable description of this server. */
  description?: string;
  /** Absolute path of the config file where this server was discovered. */
  configFile?: string;
};

/** A skill discovered from SKILL.md files on the machine. */
export type DiscoveredSkill = {
  /** Unique identifier derived from the skill directory name. */
  id: string;
  /** Human-readable name from SKILL.md frontmatter. */
  name: string;
  /** Description of when/how to use the skill. */
  description: string;
  /** Absolute path to the SKILL.md file. */
  path: string;
  /** Where this skill was discovered: global or project scope. */
  source: 'global' | 'project';
  /** Which runtime this skill targets. */
  runtime: 'claude-code' | 'codex';
  /** Whether the user can invoke this skill directly via slash command. */
  userInvokable?: boolean;
  /** Description of arguments the skill accepts. */
  args?: string;
};

/** A pre-configured MCP server template for common use cases. */
export type McpServerTemplate = {
  /** Unique identifier for this template. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description of what this MCP server does. */
  description: string;
  /** Shell command to start the server. */
  command: string;
  /** Command arguments. */
  args?: string[];
  /** Environment variables. */
  env?: Record<string, string>;
  /** Which agent runtimes this template is compatible with. */
  runtimeTypes?: AgentRuntime[];
};

/** A custom MCP server config with a required display name for matching. */
export type CustomMcpServer = McpServerConfig & { name: string };

/** Per-agent override to exclude machine-default MCP servers or add custom ones. */
export type AgentMcpOverride = {
  /** Server names to exclude from machine defaults. */
  excluded: string[];
  /** Custom servers to add for this agent only. */
  custom: CustomMcpServer[];
};

/** Per-agent override to exclude machine-default skills or add custom ones. */
export type AgentSkillOverride = {
  /** Skill ids to exclude from machine defaults. */
  excluded: string[];
  /** Custom skills to add for this agent only. */
  custom: ManagedSkill[];
};

/** Per-agent runtime config overrides (sandbox, approval, Codex-specific settings). */
export type AgentRuntimeConfigOverrides = {
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never';
  codexReasoningEffort?: 'low' | 'medium' | 'high';
  codexModelProvider?: 'openai' | 'azure';
};

export type AgentConfig = {
  allowedTools?: string[];
  disallowedTools?: string[];
  model?: string;
  maxTurns?: number;
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  systemPrompt?: string;
  initialPrompt?: string;
  /** Default prompt used when no explicit prompt is provided (e.g. cron/heartbeat triggers). */
  defaultPrompt?: string;
  /** MCP server definitions to write to `.mcp.json` before agent startup. */
  mcpServers?: Record<string, McpServerConfig>;
  /** Per-agent MCP server overrides (exclude defaults, add custom). */
  mcpOverride?: AgentMcpOverride;
  /** Per-agent skill overrides (exclude defaults, add custom). */
  skillOverride?: AgentSkillOverride;
  /** Per-agent runtime config overrides (sandbox, approval policy, Codex settings). */
  runtimeConfigOverrides?: AgentRuntimeConfigOverrides;
};

export type Agent = {
  id: string;
  machineId: string;
  name: string;
  type: AgentType;
  runtime?: AgentRuntime;
  status: AgentStatus;
  schedule: string | null;
  projectPath: string | null;
  worktreeBranch: string | null;
  currentSessionId: string | null;
  config: AgentConfig;
  lastRunAt: Date | null;
  lastCostUsd: number | null;
  totalCostUsd: number;
  accountId: string | null;
  createdAt: Date;
};
