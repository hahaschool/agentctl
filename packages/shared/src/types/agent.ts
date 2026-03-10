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

export type AgentConfig = {
  allowedTools?: string[];
  disallowedTools?: string[];
  model?: string;
  maxTurns?: number;
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  systemPrompt?: string;
  initialPrompt?: string;
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
