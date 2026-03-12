import { describe, expect, it } from 'vitest';

import { AGENT_MESSAGE_TYPES, isAgentMessageType } from './agent-message.js';

describe('AgentMessage types', () => {
  it('AGENT_MESSAGE_TYPES contains all expected values', () => {
    expect(AGENT_MESSAGE_TYPES).toEqual([
      'request',
      'response',
      'inform',
      'delegate',
      'escalate',
      'ack',
    ]);
  });

  it('isAgentMessageType validates correctly', () => {
    expect(isAgentMessageType('request')).toBe(true);
    expect(isAgentMessageType('response')).toBe(true);
    expect(isAgentMessageType('ack')).toBe(true);
    expect(isAgentMessageType('invalid')).toBe(false);
    expect(isAgentMessageType('')).toBe(false);
  });
});
