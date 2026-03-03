import type { AgentStatus } from './agent.js';
import { AGENT_STATUSES } from './agent.js';
import { AgentError } from './errors.js';

export type StatusTransition = {
  from: AgentStatus;
  to: AgentStatus;
};

/** Map of valid transitions from each status. */
export const VALID_TRANSITIONS: Record<AgentStatus, readonly AgentStatus[]> = {
  registered: ['starting', 'error'],
  starting: ['running', 'error', 'timeout', 'stopped'],
  running: ['stopping', 'error', 'timeout', 'restarting'],
  stopping: ['stopped', 'error', 'timeout'],
  stopped: ['starting', 'restarting'],
  error: ['restarting', 'starting'],
  timeout: ['restarting', 'starting'],
  restarting: ['starting', 'error'],
} as const;

/** Terminal statuses have no further transitions except restart/recovery paths. */
const TERMINAL_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>([
  'stopped',
  'error',
  'timeout',
]);

/** Human-readable descriptions of each agent status. */
const STATUS_DESCRIPTIONS: Record<AgentStatus, string> = {
  registered: 'Agent is registered in the system but has not been started yet.',
  starting: 'Agent is initializing and preparing to run.',
  running: 'Agent is actively executing tasks.',
  stopping: 'Agent is gracefully shutting down.',
  stopped: 'Agent has been stopped and is idle.',
  error: 'Agent encountered an error and is no longer running.',
  timeout: 'Agent exceeded the allowed time limit and was terminated.',
  restarting: 'Agent is being restarted after a stop, error, or timeout.',
};

/** Check if a status transition is valid. */
export function isValidTransition(from: AgentStatus, to: AgentStatus): boolean {
  const validTargets = VALID_TRANSITIONS[from];
  return validTargets.includes(to);
}

/** Get all valid next statuses from current status. */
export function getValidNextStatuses(current: AgentStatus): readonly AgentStatus[] {
  return VALID_TRANSITIONS[current];
}

/** Validate a transition, throwing a typed error if invalid. */
export function validateTransition(from: AgentStatus, to: AgentStatus): void {
  if (!isValidTransition(from, to)) {
    const validTargets = VALID_TRANSITIONS[from];
    throw new AgentError(
      'INVALID_STATUS_TRANSITION',
      `Invalid status transition from '${from}' to '${to}'. Valid transitions from '${from}': [${validTargets.join(', ')}]`,
      { from, to, validTransitions: [...validTargets] },
    );
  }
}

/** Get a human-readable description of the status. */
export function getStatusDescription(status: AgentStatus): string {
  return STATUS_DESCRIPTIONS[status];
}

/** Check if a status is terminal (no further transitions possible except restart). */
export function isTerminalStatus(status: AgentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Verify at module load time that every status in AGENT_STATUSES has a
 * corresponding entry in VALID_TRANSITIONS and STATUS_DESCRIPTIONS.
 * This is a development-time safeguard against forgetting to update maps
 * when a new status is added.
 */
for (const status of AGENT_STATUSES) {
  if (!(status in VALID_TRANSITIONS)) {
    throw new AgentError(
      'STATUS_MACHINE_INIT',
      `Missing VALID_TRANSITIONS entry for status '${status}'`,
      { status },
    );
  }
  if (!(status in STATUS_DESCRIPTIONS)) {
    throw new AgentError(
      'STATUS_MACHINE_INIT',
      `Missing STATUS_DESCRIPTIONS entry for status '${status}'`,
      { status },
    );
  }
}
