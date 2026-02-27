export type AgentType = 'heartbeat' | 'cron' | 'manual' | 'adhoc';

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
};

export type Agent = {
  id: string;
  machineId: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  schedule: string | null;
  projectPath: string | null;
  worktreeBranch: string | null;
  currentSessionId: string | null;
  config: AgentConfig;
  lastRunAt: Date | null;
  lastCostUsd: number | null;
  totalCostUsd: number;
  createdAt: Date;
};
