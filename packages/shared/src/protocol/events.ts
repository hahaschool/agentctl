import type { AgentStatus } from '../types/agent.js';

export type AgentOutputEvent = {
  event: 'output';
  data: {
    type: 'text' | 'tool_use' | 'tool_result';
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

export type AgentEvent =
  | AgentOutputEvent
  | AgentStatusEvent
  | AgentCostEvent
  | AgentApprovalEvent
  | AgentHeartbeatEvent;
