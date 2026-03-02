import { describe, expect, it } from 'vitest';

import type { AgentStatus } from './agent.js';
import { AGENT_STATUSES } from './agent.js';
import { AgentError } from './errors.js';
import {
  getStatusDescription,
  getValidNextStatuses,
  isTerminalStatus,
  isValidTransition,
  VALID_TRANSITIONS,
  validateTransition,
} from './status-machine.js';

// ── VALID_TRANSITIONS map completeness ──────────────────────────────

describe('VALID_TRANSITIONS', () => {
  it('has an entry for every status in AGENT_STATUSES', () => {
    for (const status of AGENT_STATUSES) {
      expect(VALID_TRANSITIONS).toHaveProperty(status);
    }
  });

  it('has no extra keys beyond AGENT_STATUSES', () => {
    const transitionKeys = Object.keys(VALID_TRANSITIONS);
    expect(transitionKeys.sort()).toEqual([...AGENT_STATUSES].sort());
  });

  it('every target status in each transition list is a valid AgentStatus', () => {
    const statusSet = new Set<string>(AGENT_STATUSES);
    for (const [_from, targets] of Object.entries(VALID_TRANSITIONS)) {
      for (const to of targets) {
        expect(statusSet.has(to)).toBe(true);
      }
    }
  });

  it('no transition list contains duplicate statuses', () => {
    for (const [_status, targets] of Object.entries(VALID_TRANSITIONS)) {
      const unique = new Set(targets);
      expect(unique.size).toBe(targets.length);
    }
  });

  it('every status has at least one valid transition', () => {
    for (const status of AGENT_STATUSES) {
      expect(VALID_TRANSITIONS[status].length).toBeGreaterThan(0);
    }
  });
});

// ── Valid transitions ───────────────────────────────────────────────

describe('isValidTransition — valid transitions', () => {
  const validCases: [AgentStatus, AgentStatus][] = [
    // registered ->
    ['registered', 'starting'],
    ['registered', 'error'],
    // starting ->
    ['starting', 'running'],
    ['starting', 'error'],
    ['starting', 'timeout'],
    // running ->
    ['running', 'stopping'],
    ['running', 'error'],
    ['running', 'timeout'],
    ['running', 'restarting'],
    // stopping ->
    ['stopping', 'stopped'],
    ['stopping', 'error'],
    ['stopping', 'timeout'],
    // stopped ->
    ['stopped', 'starting'],
    ['stopped', 'restarting'],
    // error ->
    ['error', 'restarting'],
    ['error', 'starting'],
    // timeout ->
    ['timeout', 'restarting'],
    ['timeout', 'starting'],
    // restarting ->
    ['restarting', 'starting'],
    ['restarting', 'error'],
  ];

  for (const [from, to] of validCases) {
    it(`allows ${from} -> ${to}`, () => {
      expect(isValidTransition(from, to)).toBe(true);
    });
  }
});

// ── Invalid transitions ─────────────────────────────────────────────

describe('isValidTransition — invalid transitions', () => {
  const invalidCases: [AgentStatus, AgentStatus][] = [
    ['registered', 'running'],
    ['registered', 'stopped'],
    ['registered', 'stopping'],
    ['registered', 'restarting'],
    ['registered', 'timeout'],
    ['starting', 'stopping'],
    ['starting', 'stopped'],
    ['starting', 'restarting'],
    ['starting', 'registered'],
    ['running', 'registered'],
    ['running', 'starting'],
    ['running', 'stopped'],
    ['stopping', 'running'],
    ['stopping', 'starting'],
    ['stopping', 'registered'],
    ['stopping', 'restarting'],
    ['stopped', 'running'],
    ['stopped', 'stopping'],
    ['stopped', 'registered'],
    ['stopped', 'error'],
    ['stopped', 'timeout'],
    ['error', 'running'],
    ['error', 'stopping'],
    ['error', 'stopped'],
    ['error', 'registered'],
    ['error', 'timeout'],
    ['timeout', 'running'],
    ['timeout', 'stopping'],
    ['timeout', 'stopped'],
    ['timeout', 'registered'],
    ['timeout', 'error'],
    ['restarting', 'running'],
    ['restarting', 'stopping'],
    ['restarting', 'stopped'],
    ['restarting', 'registered'],
    ['restarting', 'timeout'],
    ['restarting', 'restarting'],
  ];

  for (const [from, to] of invalidCases) {
    it(`rejects ${from} -> ${to}`, () => {
      expect(isValidTransition(from, to)).toBe(false);
    });
  }
});

// ── Same-status transitions (self-loops) ────────────────────────────

describe('isValidTransition — self-transitions', () => {
  it('rejects same-status transitions for all statuses', () => {
    for (const status of AGENT_STATUSES) {
      expect(isValidTransition(status, status)).toBe(false);
    }
  });
});

// ── getValidNextStatuses ────────────────────────────────────────────

describe('getValidNextStatuses', () => {
  it('returns ["starting", "error"] for registered', () => {
    expect(getValidNextStatuses('registered')).toEqual(['starting', 'error']);
  });

  it('returns ["running", "error", "timeout"] for starting', () => {
    expect(getValidNextStatuses('starting')).toEqual(['running', 'error', 'timeout']);
  });

  it('returns ["stopping", "error", "timeout", "restarting"] for running', () => {
    expect(getValidNextStatuses('running')).toEqual(['stopping', 'error', 'timeout', 'restarting']);
  });

  it('returns ["stopped", "error", "timeout"] for stopping', () => {
    expect(getValidNextStatuses('stopping')).toEqual(['stopped', 'error', 'timeout']);
  });

  it('returns ["starting", "restarting"] for stopped', () => {
    expect(getValidNextStatuses('stopped')).toEqual(['starting', 'restarting']);
  });

  it('returns ["restarting", "starting"] for error', () => {
    expect(getValidNextStatuses('error')).toEqual(['restarting', 'starting']);
  });

  it('returns ["restarting", "starting"] for timeout', () => {
    expect(getValidNextStatuses('timeout')).toEqual(['restarting', 'starting']);
  });

  it('returns ["starting", "error"] for restarting', () => {
    expect(getValidNextStatuses('restarting')).toEqual(['starting', 'error']);
  });

  it('returns the same reference as VALID_TRANSITIONS for each status', () => {
    for (const status of AGENT_STATUSES) {
      expect(getValidNextStatuses(status)).toBe(VALID_TRANSITIONS[status]);
    }
  });
});

// ── validateTransition ──────────────────────────────────────────────

describe('validateTransition', () => {
  it('does not throw for a valid transition', () => {
    expect(() => validateTransition('registered', 'starting')).not.toThrow();
  });

  it('succeeds silently for all valid transitions', () => {
    for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
      for (const to of targets) {
        expect(() => validateTransition(from as AgentStatus, to)).not.toThrow();
      }
    }
  });

  it('throws AgentError for an invalid transition', () => {
    expect(() => validateTransition('registered', 'running')).toThrow(AgentError);
  });

  it('throws with error code INVALID_STATUS_TRANSITION', () => {
    try {
      validateTransition('stopped', 'running');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      const agentErr = err as AgentError;
      expect(agentErr.code).toBe('INVALID_STATUS_TRANSITION');
    }
  });

  it('includes from, to, and validTransitions in error context', () => {
    try {
      validateTransition('starting', 'stopped');
      expect.unreachable('should have thrown');
    } catch (err) {
      const agentErr = err as AgentError;
      expect(agentErr.context).toEqual({
        from: 'starting',
        to: 'stopped',
        validTransitions: ['running', 'error', 'timeout'],
      });
    }
  });

  it('includes a human-readable error message', () => {
    try {
      validateTransition('running', 'registered');
      expect.unreachable('should have thrown');
    } catch (err) {
      const agentErr = err as AgentError;
      expect(agentErr.message).toContain('running');
      expect(agentErr.message).toContain('registered');
      expect(agentErr.message).toContain('Invalid status transition');
    }
  });

  it('throws for self-transitions', () => {
    expect(() => validateTransition('running', 'running')).toThrow(AgentError);
  });
});

// ── getStatusDescription ────────────────────────────────────────────

describe('getStatusDescription', () => {
  it('returns a non-empty string for every status', () => {
    for (const status of AGENT_STATUSES) {
      const description = getStatusDescription(status);
      expect(typeof description).toBe('string');
      expect(description.length).toBeGreaterThan(0);
    }
  });

  it('returns unique descriptions for each status', () => {
    const descriptions = AGENT_STATUSES.map((s) => getStatusDescription(s));
    const unique = new Set(descriptions);
    expect(unique.size).toBe(AGENT_STATUSES.length);
  });

  it('returns the expected description for "registered"', () => {
    expect(getStatusDescription('registered')).toBe(
      'Agent is registered in the system but has not been started yet.',
    );
  });

  it('returns the expected description for "starting"', () => {
    expect(getStatusDescription('starting')).toBe('Agent is initializing and preparing to run.');
  });

  it('returns the expected description for "running"', () => {
    expect(getStatusDescription('running')).toBe('Agent is actively executing tasks.');
  });

  it('returns the expected description for "stopping"', () => {
    expect(getStatusDescription('stopping')).toBe('Agent is gracefully shutting down.');
  });

  it('returns the expected description for "stopped"', () => {
    expect(getStatusDescription('stopped')).toBe('Agent has been stopped and is idle.');
  });

  it('returns the expected description for "error"', () => {
    expect(getStatusDescription('error')).toBe(
      'Agent encountered an error and is no longer running.',
    );
  });

  it('returns the expected description for "timeout"', () => {
    expect(getStatusDescription('timeout')).toBe(
      'Agent exceeded the allowed time limit and was terminated.',
    );
  });

  it('returns the expected description for "restarting"', () => {
    expect(getStatusDescription('restarting')).toBe(
      'Agent is being restarted after a stop, error, or timeout.',
    );
  });
});

// ── isTerminalStatus ────────────────────────────────────────────────

describe('isTerminalStatus', () => {
  it('stopped is terminal', () => {
    expect(isTerminalStatus('stopped')).toBe(true);
  });

  it('error is terminal', () => {
    expect(isTerminalStatus('error')).toBe(true);
  });

  it('timeout is terminal', () => {
    expect(isTerminalStatus('timeout')).toBe(true);
  });

  it('registered is not terminal', () => {
    expect(isTerminalStatus('registered')).toBe(false);
  });

  it('starting is not terminal', () => {
    expect(isTerminalStatus('starting')).toBe(false);
  });

  it('running is not terminal', () => {
    expect(isTerminalStatus('running')).toBe(false);
  });

  it('stopping is not terminal', () => {
    expect(isTerminalStatus('stopping')).toBe(false);
  });

  it('restarting is not terminal', () => {
    expect(isTerminalStatus('restarting')).toBe(false);
  });

  it('terminal statuses still have recovery transitions (starting or restarting)', () => {
    const terminalStatuses: AgentStatus[] = ['stopped', 'error', 'timeout'];
    for (const status of terminalStatuses) {
      const next = getValidNextStatuses(status);
      const hasRecovery = next.some((s) => s === 'starting' || s === 'restarting');
      expect(hasRecovery).toBe(true);
    }
  });
});

// ── validateTransition — exhaustive per-status error cases ──────────

describe('validateTransition — error details for each status', () => {
  it('includes valid transitions list for registered in error context', () => {
    try {
      validateTransition('registered', 'running');
      expect.unreachable('should have thrown');
    } catch (err) {
      const agentErr = err as AgentError;
      expect(agentErr.context?.validTransitions).toEqual(['starting', 'error']);
    }
  });

  it('includes valid transitions list for stopping in error context', () => {
    try {
      validateTransition('stopping', 'running');
      expect.unreachable('should have thrown');
    } catch (err) {
      const agentErr = err as AgentError;
      expect(agentErr.context?.validTransitions).toEqual(['stopped', 'error', 'timeout']);
    }
  });

  it('includes valid transitions list for error in error context', () => {
    try {
      validateTransition('error', 'running');
      expect.unreachable('should have thrown');
    } catch (err) {
      const agentErr = err as AgentError;
      expect(agentErr.context?.validTransitions).toEqual(['restarting', 'starting']);
    }
  });

  it('includes valid transitions list for timeout in error context', () => {
    try {
      validateTransition('timeout', 'running');
      expect.unreachable('should have thrown');
    } catch (err) {
      const agentErr = err as AgentError;
      expect(agentErr.context?.validTransitions).toEqual(['restarting', 'starting']);
    }
  });

  it('includes valid transitions list for restarting in error context', () => {
    try {
      validateTransition('restarting', 'running');
      expect.unreachable('should have thrown');
    } catch (err) {
      const agentErr = err as AgentError;
      expect(agentErr.context?.validTransitions).toEqual(['starting', 'error']);
    }
  });
});

// ── Full lifecycle simulation ───────────────────────────────────────

describe('status machine — lifecycle scenarios', () => {
  it('supports happy path: registered → starting → running → stopping → stopped', () => {
    const transitions: [AgentStatus, AgentStatus][] = [
      ['registered', 'starting'],
      ['starting', 'running'],
      ['running', 'stopping'],
      ['stopping', 'stopped'],
    ];

    for (const [from, to] of transitions) {
      expect(() => validateTransition(from, to)).not.toThrow();
    }
  });

  it('supports error recovery: running → error → restarting → starting → running', () => {
    const transitions: [AgentStatus, AgentStatus][] = [
      ['running', 'error'],
      ['error', 'restarting'],
      ['restarting', 'starting'],
      ['starting', 'running'],
    ];

    for (const [from, to] of transitions) {
      expect(() => validateTransition(from, to)).not.toThrow();
    }
  });

  it('supports timeout recovery: running → timeout → starting → running', () => {
    const transitions: [AgentStatus, AgentStatus][] = [
      ['running', 'timeout'],
      ['timeout', 'starting'],
      ['starting', 'running'],
    ];

    for (const [from, to] of transitions) {
      expect(() => validateTransition(from, to)).not.toThrow();
    }
  });

  it('supports restart from stopped: stopped → restarting → starting → running', () => {
    const transitions: [AgentStatus, AgentStatus][] = [
      ['stopped', 'restarting'],
      ['restarting', 'starting'],
      ['starting', 'running'],
    ];

    for (const [from, to] of transitions) {
      expect(() => validateTransition(from, to)).not.toThrow();
    }
  });

  it('supports error during restart: restarting → error → starting', () => {
    const transitions: [AgentStatus, AgentStatus][] = [
      ['restarting', 'error'],
      ['error', 'starting'],
    ];

    for (const [from, to] of transitions) {
      expect(() => validateTransition(from, to)).not.toThrow();
    }
  });
});

// ── Module-level integrity check ────────────────────────────────────

describe('status machine — module integrity', () => {
  it('AGENT_STATUSES contains exactly 8 statuses', () => {
    expect(AGENT_STATUSES.length).toBe(8);
  });

  it('AGENT_STATUSES contains all expected statuses', () => {
    const expected: AgentStatus[] = [
      'registered',
      'starting',
      'running',
      'stopping',
      'stopped',
      'error',
      'timeout',
      'restarting',
    ];
    expect([...AGENT_STATUSES]).toEqual(expected);
  });

  it('non-terminal statuses are not in terminal set', () => {
    const nonTerminal: AgentStatus[] = [
      'registered',
      'starting',
      'running',
      'stopping',
      'restarting',
    ];
    for (const status of nonTerminal) {
      expect(isTerminalStatus(status)).toBe(false);
    }
  });

  it('terminal statuses are exactly stopped, error, and timeout', () => {
    const terminal: AgentStatus[] = ['stopped', 'error', 'timeout'];
    for (const status of terminal) {
      expect(isTerminalStatus(status)).toBe(true);
    }
    // Count: exactly 3 terminal statuses
    const terminalCount = AGENT_STATUSES.filter((s) => isTerminalStatus(s)).length;
    expect(terminalCount).toBe(3);
  });
});

// ── StatusTransition type ───────────────────────────────────────────

describe('StatusTransition type', () => {
  it('can represent a valid transition as a typed object', () => {
    const transition: { from: AgentStatus; to: AgentStatus } = {
      from: 'running',
      to: 'stopping',
    };
    expect(isValidTransition(transition.from, transition.to)).toBe(true);
  });
});
