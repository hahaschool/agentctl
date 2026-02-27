export type AgentType = 'heartbeat' | 'cron' | 'manual' | 'adhoc';

export type AgentStatus =
  | 'registered'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error'
  | 'timeout'
  | 'restarting';

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
