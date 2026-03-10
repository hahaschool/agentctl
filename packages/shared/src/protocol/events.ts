import type { AgentStatus } from '../types/agent.js';
import type { SafetyDecision, WorkdirSafetyTier } from './commands.js';

export type AgentOutputEvent = {
  event: 'output';
  data: {
    type: 'text' | 'tool_use' | 'tool_result' | 'tool_blocked';
    content: string;
  };
};

export type AgentStatusEvent = {
  event: 'status';
  data: {
    status: AgentStatus;
    reason?: string;
  };
};

export type AgentCostEvent = {
  event: 'cost';
  data: {
    turnCost: number;
    totalCost: number;
  };
};

export type AgentApprovalEvent = {
  event: 'approval_needed';
  data: {
    tool: string;
    input: unknown;
    timeoutSeconds: number;
  };
};

export type AgentHeartbeatEvent = {
  event: 'heartbeat';
  data: {
    timestamp: number;
  };
};

export type LoopIterationEvent = {
  event: 'loop_iteration';
  data: {
    iteration: number;
    costUsd: number;
    durationMs: number;
  };
};

export type LoopCompleteEvent = {
  event: 'loop_complete';
  data: {
    totalIterations: number;
    totalCostUsd: number;
    reason: string;
  };
};

export type AgentRawOutputEvent = {
  event: 'raw_output';
  data: {
    text: string;
  };
};

export type AgentUserMessageEvent = {
  event: 'user_message';
  data: {
    text: string;
  };
};

export type AgentSafetyEvent = {
  event: 'safety_warning' | 'safety_approval_needed' | 'safety_blocked';
  data: {
    tier: WorkdirSafetyTier;
    warning?: string;
    blockReason?: string;
    parallelTaskCount?: number;
    options?: Array<{ id: SafetyDecision; label: string }>;
  };
};

export type AgentEvent =
  | AgentOutputEvent
  | AgentRawOutputEvent
  | AgentStatusEvent
  | AgentCostEvent
  | AgentApprovalEvent
  | AgentHeartbeatEvent
  | LoopIterationEvent
  | LoopCompleteEvent
  | AgentUserMessageEvent
  | AgentSafetyEvent;

// ---------------------------------------------------------------------------
// Session content messages — parsed from JSONL session files and served via
// the REST API. Used by both the worker (producer) and web (consumer).
// ---------------------------------------------------------------------------

/**
 * Content type discriminants for parsed session messages.
 *
 * - `human`     — user-authored text
 * - `assistant` — model text output
 * - `thinking`  — model reasoning / chain-of-thought block
 * - `tool_use`  — tool invocation request
 * - `tool_result` — tool execution output
 * - `progress`  — bash/mcp/hook/task progress indicators
 * - `subagent`  — delegated sub-agent output
 * - `todo`      — TodoWrite block
 */
export type ContentMessageType =
  | 'human'
  | 'assistant'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'progress'
  | 'subagent'
  | 'todo';

/**
 * A single parsed message from a Claude Code JSONL session file.
 *
 * This is the wire type returned by the worker's session content endpoint
 * and consumed by the web frontend for rendering.
 */
export type ContentMessage = {
  /** Discriminant indicating what kind of content this message represents. */
  type: ContentMessageType | (string & {});
  /** The textual content of the message (may be truncated for large outputs). */
  content: string;
  /** ISO 8601 timestamp of when this message was recorded. */
  timestamp?: string;
  /** Tool name for tool_use / tool_result / progress entries. */
  toolName?: string;
  /** Unique tool invocation ID, used to pair tool_use with its tool_result. */
  toolId?: string;
  /** Sub-agent identifier when this message originated from a delegated agent. */
  subagentId?: string;
  /** Additional context that doesn't fit into the fixed fields above. */
  metadata?: Record<string, unknown>;
};
