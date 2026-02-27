export type RunTrigger = 'schedule' | 'manual' | 'signal' | 'adhoc';

export type RunStatus = 'running' | 'success' | 'failure' | 'timeout' | 'cancelled';

export type AgentRun = {
  id: string;
  agentId: string;
  trigger: RunTrigger;
  status: RunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  model: string | null;
  provider: 'anthropic' | 'bedrock' | 'vertex' | null;
  sessionId: string | null;
  errorMessage: string | null;
  resultSummary: string | null;
};
