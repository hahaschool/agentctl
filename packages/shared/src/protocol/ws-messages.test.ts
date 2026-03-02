import { describe, expect, it } from 'vitest';

import type { AGENT_STATUSES } from '../types/agent.js';
import type {
  AgentApprovalEvent,
  AgentCostEvent,
  AgentEvent,
  AgentHeartbeatEvent,
  AgentOutputEvent,
  AgentStatusEvent,
} from './events.js';

// ── Helpers ─────────────────────────────────────────────────────────

/** Runtime type-guard: narrows AgentEvent by its `event` discriminant. */
function isOutputEvent(e: AgentEvent): e is AgentOutputEvent {
  return e.event === 'output';
}
function isStatusEvent(e: AgentEvent): e is AgentStatusEvent {
  return e.event === 'status';
}
function isCostEvent(e: AgentEvent): e is AgentCostEvent {
  return e.event === 'cost';
}
function isApprovalEvent(e: AgentEvent): e is AgentApprovalEvent {
  return e.event === 'approval_needed';
}
function isHeartbeatEvent(e: AgentEvent): e is AgentHeartbeatEvent {
  return e.event === 'heartbeat';
}

// ── AgentOutputEvent ────────────────────────────────────────────────

describe('AgentOutputEvent', () => {
  it('has the correct shape with type "text"', () => {
    const event: AgentOutputEvent = {
      event: 'output',
      data: { type: 'text', content: 'Hello, world!' },
    };

    expect(event.event).toBe('output');
    expect(event.data.type).toBe('text');
    expect(event.data.content).toBe('Hello, world!');
  });

  it('accepts all valid output data types', () => {
    const validTypes = ['text', 'tool_use', 'tool_result', 'tool_blocked'] as const;

    for (const type of validTypes) {
      const event: AgentOutputEvent = {
        event: 'output',
        data: { type, content: `content for ${type}` },
      };

      expect(event.data.type).toBe(type);
    }
  });

  it('is identified by the discriminant through a type guard', () => {
    const event: AgentEvent = {
      event: 'output',
      data: { type: 'tool_use', content: 'bash ls' },
    };

    expect(isOutputEvent(event)).toBe(true);
    expect(isStatusEvent(event)).toBe(false);
    expect(isCostEvent(event)).toBe(false);
    expect(isApprovalEvent(event)).toBe(false);
    expect(isHeartbeatEvent(event)).toBe(false);
  });
});

// ── AgentStatusEvent ────────────────────────────────────────────────

describe('AgentStatusEvent', () => {
  it('has the correct shape with required fields', () => {
    const event: AgentStatusEvent = {
      event: 'status',
      data: { status: 'running' },
    };

    expect(event.event).toBe('status');
    expect(event.data.status).toBe('running');
    expect(event.data.reason).toBeUndefined();
  });

  it('accepts an optional reason field', () => {
    const event: AgentStatusEvent = {
      event: 'status',
      data: { status: 'error', reason: 'Out of memory' },
    };

    expect(event.data.reason).toBe('Out of memory');
  });

  it('accepts all AGENT_STATUSES values', () => {
    const statuses: (typeof AGENT_STATUSES)[number][] = [
      'registered',
      'starting',
      'running',
      'stopping',
      'stopped',
      'error',
      'timeout',
      'restarting',
    ];

    for (const status of statuses) {
      const event: AgentStatusEvent = {
        event: 'status',
        data: { status },
      };
      expect(event.data.status).toBe(status);
    }
  });

  it('is identified by the discriminant through a type guard', () => {
    const event: AgentEvent = {
      event: 'status',
      data: { status: 'stopped' },
    };

    expect(isStatusEvent(event)).toBe(true);
    expect(isOutputEvent(event)).toBe(false);
  });
});

// ── AgentCostEvent ──────────────────────────────────────────────────

describe('AgentCostEvent', () => {
  it('has the correct shape with turnCost and totalCost', () => {
    const event: AgentCostEvent = {
      event: 'cost',
      data: { turnCost: 0.0032, totalCost: 1.45 },
    };

    expect(event.event).toBe('cost');
    expect(event.data.turnCost).toBe(0.0032);
    expect(event.data.totalCost).toBe(1.45);
  });

  it('handles zero costs', () => {
    const event: AgentCostEvent = {
      event: 'cost',
      data: { turnCost: 0, totalCost: 0 },
    };

    expect(event.data.turnCost).toBe(0);
    expect(event.data.totalCost).toBe(0);
  });

  it('is identified by the discriminant through a type guard', () => {
    const event: AgentEvent = {
      event: 'cost',
      data: { turnCost: 0.01, totalCost: 0.50 },
    };

    expect(isCostEvent(event)).toBe(true);
    expect(isOutputEvent(event)).toBe(false);
    expect(isHeartbeatEvent(event)).toBe(false);
  });
});

// ── AgentApprovalEvent ──────────────────────────────────────────────

describe('AgentApprovalEvent', () => {
  it('has the correct shape with tool, input, and timeoutSeconds', () => {
    const event: AgentApprovalEvent = {
      event: 'approval_needed',
      data: {
        tool: 'Bash',
        input: { command: 'rm -rf /tmp/test' },
        timeoutSeconds: 120,
      },
    };

    expect(event.event).toBe('approval_needed');
    expect(event.data.tool).toBe('Bash');
    expect(event.data.input).toEqual({ command: 'rm -rf /tmp/test' });
    expect(event.data.timeoutSeconds).toBe(120);
  });

  it('accepts any value for the input field (unknown type)', () => {
    const stringInput: AgentApprovalEvent = {
      event: 'approval_needed',
      data: { tool: 'Write', input: 'string input', timeoutSeconds: 60 },
    };
    expect(stringInput.data.input).toBe('string input');

    const nullInput: AgentApprovalEvent = {
      event: 'approval_needed',
      data: { tool: 'Read', input: null, timeoutSeconds: 30 },
    };
    expect(nullInput.data.input).toBeNull();

    const arrayInput: AgentApprovalEvent = {
      event: 'approval_needed',
      data: { tool: 'Edit', input: [1, 2, 3], timeoutSeconds: 30 },
    };
    expect(arrayInput.data.input).toEqual([1, 2, 3]);
  });

  it('is identified by the discriminant through a type guard', () => {
    const event: AgentEvent = {
      event: 'approval_needed',
      data: { tool: 'Bash', input: {}, timeoutSeconds: 60 },
    };

    expect(isApprovalEvent(event)).toBe(true);
    expect(isOutputEvent(event)).toBe(false);
    expect(isStatusEvent(event)).toBe(false);
  });
});

// ── AgentHeartbeatEvent ─────────────────────────────────────────────

describe('AgentHeartbeatEvent', () => {
  it('has the correct shape with timestamp', () => {
    const now = Date.now();
    const event: AgentHeartbeatEvent = {
      event: 'heartbeat',
      data: { timestamp: now },
    };

    expect(event.event).toBe('heartbeat');
    expect(event.data.timestamp).toBe(now);
  });

  it('is identified by the discriminant through a type guard', () => {
    const event: AgentEvent = {
      event: 'heartbeat',
      data: { timestamp: 1000000 },
    };

    expect(isHeartbeatEvent(event)).toBe(true);
    expect(isOutputEvent(event)).toBe(false);
    expect(isCostEvent(event)).toBe(false);
  });
});

// ── AgentEvent discriminated union ──────────────────────────────────

describe('AgentEvent discriminated union', () => {
  it('covers all five event types', () => {
    const events: AgentEvent[] = [
      { event: 'output', data: { type: 'text', content: 'hi' } },
      { event: 'status', data: { status: 'running' } },
      { event: 'cost', data: { turnCost: 0.01, totalCost: 0.10 } },
      { event: 'approval_needed', data: { tool: 'Bash', input: {}, timeoutSeconds: 60 } },
      { event: 'heartbeat', data: { timestamp: Date.now() } },
    ];

    const discriminants = events.map((e) => e.event);
    expect(discriminants).toEqual([
      'output',
      'status',
      'cost',
      'approval_needed',
      'heartbeat',
    ]);
  });

  it('narrows correctly in a switch statement', () => {
    const event: AgentEvent = {
      event: 'output',
      data: { type: 'tool_result', content: '{ "ok": true }' },
    };

    let matched = false;
    switch (event.event) {
      case 'output':
        // Inside this branch, event.data should have type and content
        expect(event.data.type).toBe('tool_result');
        expect(event.data.content).toBe('{ "ok": true }');
        matched = true;
        break;
      default:
        break;
    }
    expect(matched).toBe(true);
  });

  it('each event type has a unique discriminant', () => {
    const discriminants = new Set([
      'output',
      'status',
      'cost',
      'approval_needed',
      'heartbeat',
    ]);
    expect(discriminants.size).toBe(5);
  });

  it('can be serialized and deserialized as JSON', () => {
    const events: AgentEvent[] = [
      { event: 'output', data: { type: 'text', content: 'hello' } },
      { event: 'status', data: { status: 'running', reason: 'started' } },
      { event: 'cost', data: { turnCost: 0.05, totalCost: 2.0 } },
      { event: 'approval_needed', data: { tool: 'Bash', input: { cmd: 'ls' }, timeoutSeconds: 30 } },
      { event: 'heartbeat', data: { timestamp: 1709000000000 } },
    ];

    for (const original of events) {
      const serialized = JSON.stringify(original);
      const deserialized = JSON.parse(serialized) as AgentEvent;

      expect(deserialized.event).toBe(original.event);
      expect(deserialized.data).toEqual(original.data);
    }
  });
});
