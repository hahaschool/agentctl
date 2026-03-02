import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CMD_EXTENSION,
  RSP_EXTENSION,
  createIpcMessage,
  createIpcResponse,
  type IpcMessage,
  type IpcResponse,
} from './ipc-channel.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ipc-channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------------

  describe('CMD_EXTENSION', () => {
    it('equals ".cmd.json"', () => {
      expect(CMD_EXTENSION).toBe('.cmd.json');
    });
  });

  describe('RSP_EXTENSION', () => {
    it('equals ".rsp.json"', () => {
      expect(RSP_EXTENSION).toBe('.rsp.json');
    });
  });

  // -------------------------------------------------------------------------
  // createIpcMessage()
  // -------------------------------------------------------------------------

  describe('createIpcMessage()', () => {
    it('returns an object with all required IpcMessage fields', () => {
      const msg = createIpcMessage('ping', { value: 42 }, 'test-sender');

      expect(msg).toHaveProperty('id');
      expect(msg).toHaveProperty('type');
      expect(msg).toHaveProperty('payload');
      expect(msg).toHaveProperty('timestamp');
      expect(msg).toHaveProperty('sender');
    });

    it('sets the type field from the argument', () => {
      const msg = createIpcMessage('agent:stop', {}, 'control-plane');

      expect(msg.type).toBe('agent:stop');
    });

    it('sets the payload field from the argument', () => {
      const payload = { agentId: 'agent-1', reason: 'timeout' };
      const msg = createIpcMessage('stop', payload, 'control-plane');

      expect(msg.payload).toEqual(payload);
    });

    it('sets the sender field from the argument', () => {
      const msg = createIpcMessage('ping', {}, 'mobile-client');

      expect(msg.sender).toBe('mobile-client');
    });

    it('generates a unique id for each message', () => {
      const msg1 = createIpcMessage('ping', {}, 'sender');
      const msg2 = createIpcMessage('ping', {}, 'sender');

      expect(msg1.id).not.toBe(msg2.id);
    });

    it('generates a UUID-formatted id', () => {
      const msg = createIpcMessage('test', {}, 'sender');

      // UUID v4 format: 8-4-4-4-12 hex characters
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(msg.id).toMatch(uuidRegex);
    });

    it('sets a valid ISO 8601 timestamp', () => {
      const before = new Date().toISOString();
      const msg = createIpcMessage('test', {}, 'sender');
      const after = new Date().toISOString();

      // The timestamp should be parseable as a Date
      const parsed = new Date(msg.timestamp);
      expect(parsed.toISOString()).toBe(msg.timestamp);

      // The timestamp should be between before and after
      expect(msg.timestamp >= before).toBe(true);
      expect(msg.timestamp <= after).toBe(true);
    });

    it('preserves complex nested payloads', () => {
      const payload = {
        config: {
          model: 'claude-opus-4-6',
          tools: ['Read', 'Write'],
          nested: { deep: { value: true } },
        },
        count: 0,
      };

      const msg = createIpcMessage('configure', payload, 'sender');

      expect(msg.payload).toEqual(payload);
    });

    it('works with an empty payload', () => {
      const msg = createIpcMessage('heartbeat', {}, 'sender');

      expect(msg.payload).toEqual({});
    });

    it('works with an empty string type', () => {
      const msg = createIpcMessage('', {}, 'sender');

      expect(msg.type).toBe('');
    });

    it('satisfies the IpcMessage type', () => {
      const msg: IpcMessage = createIpcMessage('test', { key: 'value' }, 'sender');

      expect(msg.id).toBeDefined();
      expect(msg.type).toBe('test');
      expect(msg.payload).toEqual({ key: 'value' });
      expect(msg.sender).toBe('sender');
      expect(msg.timestamp).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // createIpcResponse()
  // -------------------------------------------------------------------------

  describe('createIpcResponse()', () => {
    it('returns an object with all required IpcResponse fields', () => {
      const rsp = createIpcResponse('req-123', 'ok', { result: 'done' });

      expect(rsp).toHaveProperty('requestId');
      expect(rsp).toHaveProperty('status');
      expect(rsp).toHaveProperty('payload');
      expect(rsp).toHaveProperty('timestamp');
    });

    it('sets requestId from the argument', () => {
      const rsp = createIpcResponse('req-abc', 'ok', {});

      expect(rsp.requestId).toBe('req-abc');
    });

    it('sets status to "ok" when provided', () => {
      const rsp = createIpcResponse('req-1', 'ok', {});

      expect(rsp.status).toBe('ok');
    });

    it('sets status to "error" when provided', () => {
      const rsp = createIpcResponse('req-1', 'error', { code: 'TIMEOUT' });

      expect(rsp.status).toBe('error');
    });

    it('sets the payload from the argument', () => {
      const payload = { data: [1, 2, 3], message: 'success' };
      const rsp = createIpcResponse('req-1', 'ok', payload);

      expect(rsp.payload).toEqual(payload);
    });

    it('sets a valid ISO 8601 timestamp', () => {
      const before = new Date().toISOString();
      const rsp = createIpcResponse('req-1', 'ok', {});
      const after = new Date().toISOString();

      const parsed = new Date(rsp.timestamp);
      expect(parsed.toISOString()).toBe(rsp.timestamp);

      expect(rsp.timestamp >= before).toBe(true);
      expect(rsp.timestamp <= after).toBe(true);
    });

    it('works with an empty payload', () => {
      const rsp = createIpcResponse('req-1', 'ok', {});

      expect(rsp.payload).toEqual({});
    });

    it('preserves error details in the payload', () => {
      const errorPayload = {
        code: 'HANDLER_ERROR',
        message: 'Agent process crashed',
        stack: 'Error: Agent process crashed\n    at ...',
      };

      const rsp = createIpcResponse('req-fail', 'error', errorPayload);

      expect(rsp.status).toBe('error');
      expect(rsp.payload).toEqual(errorPayload);
    });

    it('satisfies the IpcResponse type', () => {
      const rsp: IpcResponse = createIpcResponse('req-typed', 'ok', { typed: true });

      expect(rsp.requestId).toBe('req-typed');
      expect(rsp.status).toBe('ok');
      expect(rsp.payload).toEqual({ typed: true });
      expect(rsp.timestamp).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Round-trip: message -> response correlation
  // -------------------------------------------------------------------------

  describe('message-response correlation', () => {
    it('a response can reference the id of a message', () => {
      const msg = createIpcMessage('query', { sql: 'SELECT 1' }, 'client');
      const rsp = createIpcResponse(msg.id, 'ok', { rows: [{ count: 1 }] });

      expect(rsp.requestId).toBe(msg.id);
    });

    it('multiple messages each get unique ids for independent responses', () => {
      const msg1 = createIpcMessage('cmd-a', {}, 'sender');
      const msg2 = createIpcMessage('cmd-b', {}, 'sender');
      const msg3 = createIpcMessage('cmd-c', {}, 'sender');

      const rsp1 = createIpcResponse(msg1.id, 'ok', {});
      const rsp2 = createIpcResponse(msg2.id, 'error', { code: 'FAIL' });
      const rsp3 = createIpcResponse(msg3.id, 'ok', {});

      expect(rsp1.requestId).toBe(msg1.id);
      expect(rsp2.requestId).toBe(msg2.id);
      expect(rsp3.requestId).toBe(msg3.id);

      // All request IDs should be different
      const ids = new Set([rsp1.requestId, rsp2.requestId, rsp3.requestId]);
      expect(ids.size).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // File naming convention with extensions
  // -------------------------------------------------------------------------

  describe('file naming convention', () => {
    it('command file name follows {id}.cmd.json pattern', () => {
      const msg = createIpcMessage('test', {}, 'sender');
      const fileName = `${msg.id}${CMD_EXTENSION}`;

      expect(fileName).toMatch(/^[0-9a-f-]+\.cmd\.json$/i);
    });

    it('response file name follows {id}.rsp.json pattern', () => {
      const msg = createIpcMessage('test', {}, 'sender');
      const rsp = createIpcResponse(msg.id, 'ok', {});
      const fileName = `${rsp.requestId}${RSP_EXTENSION}`;

      expect(fileName).toMatch(/^[0-9a-f-]+\.rsp\.json$/i);
    });

    it('command and response files share the same id prefix', () => {
      const msg = createIpcMessage('test', {}, 'sender');
      const rsp = createIpcResponse(msg.id, 'ok', {});

      const cmdFile = `${msg.id}${CMD_EXTENSION}`;
      const rspFile = `${rsp.requestId}${RSP_EXTENSION}`;

      // Extract the id portion (everything before the first dot)
      const cmdId = cmdFile.split('.')[0];
      const rspId = rspFile.split('.')[0];

      expect(cmdId).toBe(rspId);
    });
  });

  // -------------------------------------------------------------------------
  // JSON serialization round-trip
  // -------------------------------------------------------------------------

  describe('JSON serialization', () => {
    it('IpcMessage survives JSON round-trip', () => {
      const original = createIpcMessage('serialize', { key: 'value', num: 42 }, 'test');
      const serialized = JSON.stringify(original);
      const deserialized = JSON.parse(serialized) as IpcMessage;

      expect(deserialized).toEqual(original);
    });

    it('IpcResponse survives JSON round-trip', () => {
      const original = createIpcResponse('req-serial', 'ok', { result: true });
      const serialized = JSON.stringify(original);
      const deserialized = JSON.parse(serialized) as IpcResponse;

      expect(deserialized).toEqual(original);
    });
  });
});
