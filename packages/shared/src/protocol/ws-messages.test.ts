import { describe, expect, it } from 'vitest';

import type { WsClientMessage, WsServerMessage } from './ws-messages.js';
import {
  isValidClientMessageType,
  parseClientMessage,
  serializeServerMessage,
} from './ws-messages.js';

// ---------------------------------------------------------------------------
// parseClientMessage
// ---------------------------------------------------------------------------

describe('parseClientMessage', () => {
  it('parses an agent:start message', () => {
    const raw = JSON.stringify({
      type: 'agent:start',
      agentId: 'agent-1',
      machineId: 'machine-1',
      prompt: 'Fix the bug',
      model: 'claude-sonnet-4-20250514',
    });

    const msg = parseClientMessage(raw);

    expect(msg).not.toBeNull();
    expect(msg?.type).toBe('agent:start');

    if (msg?.type === 'agent:start') {
      expect(msg.agentId).toBe('agent-1');
      expect(msg.machineId).toBe('machine-1');
      expect(msg.prompt).toBe('Fix the bug');
      expect(msg.model).toBe('claude-sonnet-4-20250514');
    }
  });

  it('parses an agent:start message without optional model field', () => {
    const raw = JSON.stringify({
      type: 'agent:start',
      agentId: 'a1',
      machineId: 'm1',
      prompt: 'Hello',
    });

    const msg = parseClientMessage(raw);

    expect(msg).not.toBeNull();

    if (msg?.type === 'agent:start') {
      expect(msg.model).toBeUndefined();
    }
  });

  it('parses an agent:stop message', () => {
    const raw = JSON.stringify({ type: 'agent:stop', agentId: 'agent-2' });
    const msg = parseClientMessage(raw);

    expect(msg).not.toBeNull();
    expect(msg?.type).toBe('agent:stop');

    if (msg?.type === 'agent:stop') {
      expect(msg.agentId).toBe('agent-2');
    }
  });

  it('parses an agent:signal message', () => {
    const raw = JSON.stringify({
      type: 'agent:signal',
      agentId: 'agent-3',
      message: 'check tests',
      metadata: { priority: 1 },
    });
    const msg = parseClientMessage(raw);

    expect(msg).not.toBeNull();
    expect(msg?.type).toBe('agent:signal');

    if (msg?.type === 'agent:signal') {
      expect(msg.agentId).toBe('agent-3');
      expect(msg.message).toBe('check tests');
      expect(msg.metadata).toEqual({ priority: 1 });
    }
  });

  it('parses an agent:signal message without optional metadata', () => {
    const raw = JSON.stringify({
      type: 'agent:signal',
      agentId: 'agent-3',
      message: 'hello',
    });
    const msg = parseClientMessage(raw);

    expect(msg).not.toBeNull();

    if (msg?.type === 'agent:signal') {
      expect(msg.metadata).toBeUndefined();
    }
  });

  it('parses an agent:subscribe message', () => {
    const raw = JSON.stringify({ type: 'agent:subscribe', agentId: 'agent-4' });
    const msg = parseClientMessage(raw);

    expect(msg).not.toBeNull();
    expect(msg?.type).toBe('agent:subscribe');

    if (msg?.type === 'agent:subscribe') {
      expect(msg.agentId).toBe('agent-4');
    }
  });

  it('parses an agent:unsubscribe message', () => {
    const raw = JSON.stringify({ type: 'agent:unsubscribe', agentId: 'agent-5' });
    const msg = parseClientMessage(raw);

    expect(msg).not.toBeNull();
    expect(msg?.type).toBe('agent:unsubscribe');

    if (msg?.type === 'agent:unsubscribe') {
      expect(msg.agentId).toBe('agent-5');
    }
  });

  it('parses a ping message', () => {
    const raw = JSON.stringify({ type: 'ping' });
    const msg = parseClientMessage(raw);

    expect(msg).not.toBeNull();
    expect(msg?.type).toBe('ping');
  });

  it('returns null for invalid JSON', () => {
    expect(parseClientMessage('not json at all')).toBeNull();
    expect(parseClientMessage('{broken')).toBeNull();
    expect(parseClientMessage('')).toBeNull();
  });

  it('returns null for a JSON array', () => {
    expect(parseClientMessage('[1,2,3]')).toBeNull();
  });

  it('returns null for a JSON primitive', () => {
    expect(parseClientMessage('"just a string"')).toBeNull();
    expect(parseClientMessage('42')).toBeNull();
    expect(parseClientMessage('null')).toBeNull();
    expect(parseClientMessage('true')).toBeNull();
  });

  it('returns null when type field is missing', () => {
    expect(parseClientMessage(JSON.stringify({ agentId: 'x' }))).toBeNull();
  });

  it('returns null for an unknown message type', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'unknown:action' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'agent:destroy' }))).toBeNull();
  });

  it('returns null for server message types sent as client messages', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'pong' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'agent:started', agentId: 'a1' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'error', message: 'fail' }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// serializeServerMessage
// ---------------------------------------------------------------------------

describe('serializeServerMessage', () => {
  it('serializes an agent:started message', () => {
    const msg: WsServerMessage = {
      type: 'agent:started',
      agentId: 'agent-1',
      sessionId: 'sess-abc',
    };
    const json = serializeServerMessage(msg);
    const parsed = JSON.parse(json);

    expect(parsed.type).toBe('agent:started');
    expect(parsed.agentId).toBe('agent-1');
    expect(parsed.sessionId).toBe('sess-abc');
  });

  it('serializes an agent:stopped message', () => {
    const msg: WsServerMessage = { type: 'agent:stopped', agentId: 'agent-1' };
    const json = serializeServerMessage(msg);
    const parsed = JSON.parse(json);

    expect(parsed.type).toBe('agent:stopped');
    expect(parsed.agentId).toBe('agent-1');
  });

  it('serializes an agent:output message with stdout', () => {
    const msg: WsServerMessage = {
      type: 'agent:output',
      agentId: 'agent-1',
      data: 'Hello world\n',
      stream: 'stdout',
    };
    const json = serializeServerMessage(msg);
    const parsed = JSON.parse(json);

    expect(parsed.type).toBe('agent:output');
    expect(parsed.stream).toBe('stdout');
    expect(parsed.data).toBe('Hello world\n');
  });

  it('serializes an agent:output message with stderr', () => {
    const msg: WsServerMessage = {
      type: 'agent:output',
      agentId: 'agent-1',
      data: 'Error occurred',
      stream: 'stderr',
    };
    const json = serializeServerMessage(msg);
    const parsed = JSON.parse(json);

    expect(parsed.stream).toBe('stderr');
  });

  it('serializes an agent:status message', () => {
    const msg: WsServerMessage = {
      type: 'agent:status',
      agentId: 'agent-1',
      status: 'running',
    };
    const json = serializeServerMessage(msg);
    const parsed = JSON.parse(json);

    expect(parsed.type).toBe('agent:status');
    expect(parsed.status).toBe('running');
  });

  it('serializes an agent:error message', () => {
    const msg: WsServerMessage = {
      type: 'agent:error',
      agentId: 'agent-1',
      error: 'Something went wrong',
      code: 'AGENT_TIMEOUT',
    };
    const json = serializeServerMessage(msg);
    const parsed = JSON.parse(json);

    expect(parsed.type).toBe('agent:error');
    expect(parsed.error).toBe('Something went wrong');
    expect(parsed.code).toBe('AGENT_TIMEOUT');
  });

  it('serializes an agent:cost_alert message', () => {
    const msg: WsServerMessage = {
      type: 'agent:cost_alert',
      agentId: 'agent-1',
      message: 'Cost exceeds 80% of budget',
      severity: 'warning',
      percentage: 82.5,
    };
    const json = serializeServerMessage(msg);
    const parsed = JSON.parse(json);

    expect(parsed.type).toBe('agent:cost_alert');
    expect(parsed.percentage).toBe(82.5);
    expect(parsed.severity).toBe('warning');
  });

  it('serializes a pong message', () => {
    const msg: WsServerMessage = { type: 'pong' };
    const json = serializeServerMessage(msg);
    const parsed = JSON.parse(json);

    expect(parsed.type).toBe('pong');
  });

  it('serializes a top-level error message', () => {
    const msg: WsServerMessage = {
      type: 'error',
      message: 'Invalid request',
      code: 'INVALID_JSON',
    };
    const json = serializeServerMessage(msg);
    const parsed = JSON.parse(json);

    expect(parsed.type).toBe('error');
    expect(parsed.message).toBe('Invalid request');
    expect(parsed.code).toBe('INVALID_JSON');
  });

  it('serializes a top-level error without optional code', () => {
    const msg: WsServerMessage = { type: 'error', message: 'Unknown error' };
    const json = serializeServerMessage(msg);
    const parsed = JSON.parse(json);

    expect(parsed.type).toBe('error');
    expect(parsed.code).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Round-trip parse/serialize
// ---------------------------------------------------------------------------

describe('round-trip', () => {
  it('a serialized server message produces valid JSON', () => {
    const messages: WsServerMessage[] = [
      { type: 'agent:started', agentId: 'a1' },
      { type: 'agent:stopped', agentId: 'a1' },
      { type: 'agent:output', agentId: 'a1', data: 'text', stream: 'stdout' },
      { type: 'agent:status', agentId: 'a1', status: 'running' },
      { type: 'agent:error', agentId: 'a1', error: 'boom', code: 'ERR' },
      { type: 'agent:cost_alert', agentId: 'a1', message: 'hi', severity: 'warn', percentage: 50 },
      { type: 'pong' },
      { type: 'error', message: 'bad' },
    ];

    for (const msg of messages) {
      const json = serializeServerMessage(msg);
      const parsed = JSON.parse(json) as WsServerMessage;
      expect(parsed.type).toBe(msg.type);
    }
  });

  it('a client message can be serialized and parsed back', () => {
    const original: WsClientMessage = {
      type: 'agent:start',
      agentId: 'agent-1',
      machineId: 'machine-1',
      prompt: 'Deploy',
    };

    const json = JSON.stringify(original);
    const parsed = parseClientMessage(json);

    expect(parsed).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// isValidClientMessageType
// ---------------------------------------------------------------------------

describe('isValidClientMessageType', () => {
  it('returns true for all valid client message types', () => {
    const validTypes = [
      'agent:start',
      'agent:stop',
      'agent:signal',
      'agent:subscribe',
      'agent:unsubscribe',
      'ping',
    ];

    for (const t of validTypes) {
      expect(isValidClientMessageType(t)).toBe(true);
    }
  });

  it('returns false for server message types', () => {
    const serverTypes = [
      'agent:started',
      'agent:stopped',
      'agent:output',
      'agent:status',
      'agent:error',
      'agent:cost_alert',
      'pong',
      'error',
    ];

    for (const t of serverTypes) {
      expect(isValidClientMessageType(t)).toBe(false);
    }
  });

  it('returns false for arbitrary strings', () => {
    expect(isValidClientMessageType('')).toBe(false);
    expect(isValidClientMessageType('foo')).toBe(false);
    expect(isValidClientMessageType('agent:destroy')).toBe(false);
    expect(isValidClientMessageType('PING')).toBe(false);
  });
});
