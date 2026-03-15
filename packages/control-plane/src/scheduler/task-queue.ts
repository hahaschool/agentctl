import type { McpServerConfig, RunTrigger, SessionMode } from '@agentctl/shared';
import type { ConnectionOptions } from 'bullmq';
import { Queue, type QueueOptions } from 'bullmq';

export const AGENT_TASKS_QUEUE = 'agent-tasks';

export type AgentTaskJobData = {
  agentId: string;
  machineId: string;
  prompt: string | null;
  model: string | null;
  trigger: RunTrigger;
  allowedTools: string[] | null;
  resumeSession: string | null;
  createdAt: string;
  signalMetadata?: Record<string, unknown>;
  /** Whether to start a fresh session or resume the previous one. */
  sessionMode?: SessionMode;
  /** Zero-based iteration counter for scheduled/repeating runs. */
  iteration?: number;
  /** MCP server definitions to include in the dispatch payload for the worker. */
  mcpServers?: Record<string, McpServerConfig> | null;
  /** Run ID from the first attempt. Set by the task worker on the initial attempt so retries can link back. */
  __firstRunId?: string | null;
};

export type AgentTaskJobName = 'agent:start' | 'agent:heartbeat' | 'agent:cron' | 'agent:signal';

export function createTaskQueue(
  connection: ConnectionOptions,
): Queue<AgentTaskJobData, void, AgentTaskJobName> {
  const opts: QueueOptions = {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  };

  return new Queue<AgentTaskJobData, void, AgentTaskJobName>(AGENT_TASKS_QUEUE, opts);
}
