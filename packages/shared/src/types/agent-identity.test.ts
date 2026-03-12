import { describe, expect, it } from 'vitest';

import {
  AGENT_INSTANCE_STATUSES,
  AGENT_RUNTIME_TYPES,
  isAgentInstanceStatus,
  isAgentRuntimeType,
} from './agent-identity.js';

describe('AgentIdentity types', () => {
  it('AGENT_RUNTIME_TYPES contains expected values', () => {
    expect(AGENT_RUNTIME_TYPES).toEqual(['claude-code', 'codex', 'openclaw', 'nanoclaw']);
  });

  it('AGENT_INSTANCE_STATUSES contains expected values', () => {
    expect(AGENT_INSTANCE_STATUSES).toEqual(['idle', 'running', 'paused', 'crashed']);
  });

  it('isAgentRuntimeType validates correctly', () => {
    expect(isAgentRuntimeType('claude-code')).toBe(true);
    expect(isAgentRuntimeType('codex')).toBe(true);
    expect(isAgentRuntimeType('invalid')).toBe(false);
  });

  it('isAgentInstanceStatus validates correctly', () => {
    expect(isAgentInstanceStatus('idle')).toBe(true);
    expect(isAgentInstanceStatus('crashed')).toBe(true);
    expect(isAgentInstanceStatus('invalid')).toBe(false);
  });
});
