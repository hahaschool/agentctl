import type { WsClientMessage, WsServerMessage } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebSocketClient, WebSocketClientError } from './websocket-client.js';

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  encryptSecretBox: vi.fn<(message: string, secret: string) => string>(),
  decryptSecretBox: vi.fn<(encrypted: string, secret: string) => string>(),
}));

vi.mock('@agentctl/shared', () => ({
  encryptSecretBox: mocks.encryptSecretBox,
  decryptSecretBox: mocks.decryptSecretBox,
}));

// Minimal WebSocket mock that mirrors the browser API
type WsHandler = ((event: unknown) => void) | null;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: MockWebSocket[] = [];

  readyState: number = MockWebSocket.CONNECTING;
  url: string;
  onopen: WsHandler = null;
  onmessage: WsHandler = null;
  onclose: WsHandler = null;
  onerror: WsHandler = null;

  sentMessages: string[] = [];
  closeCode?: number;
  closeReason?: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code: code ?? 1000, reason: reason ?? '' });
    }
  }

  // Test helpers — simulate server actions
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen({});
  }

  simulateMessage(data: string): void {
    if (this.onmessage) this.onmessage({ data });
  }

  simulateClose(code = 1006, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({ code, reason });
  }

  simulateError(): void {
    if (this.onerror) this.onerror({});
  }
}

// Expose constants on mock
vi.stubGlobal('WebSocket', MockWebSocket);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function latestSocket(): MockWebSocket {
  const instances = MockWebSocket.instances;
  return instances[instances.length - 1]!;
}

function serverMsg(msg: WsServerMessage): string {
  return JSON.stringify(msg);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSocketClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  describe('connect()', () => {
    it('creates a WebSocket with the configured URL', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });
      client.connect();

      expect(MockWebSocket.instances).toHaveLength(1);
      expect(latestSocket().url).toBe('wss://cp.example.com/api/ws');
    });

    it('does not create a second socket if already connecting', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });
      client.connect();
      client.connect(); // Should be a no-op

      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('does not create a second socket if already open', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });
      client.connect();
      latestSocket().simulateOpen();
      client.connect();

      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('emits open event when connection opens', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });
      const handler = vi.fn();
      client.on('open', handler);

      client.connect();
      latestSocket().simulateOpen();

      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('disconnect()', () => {
    it('closes the socket with code 1000', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });
      client.connect();
      latestSocket().simulateOpen();

      client.disconnect();

      expect(latestSocket().closeCode).toBe(1000);
      expect(latestSocket().closeReason).toBe('Client disconnect');
    });

    it('prevents auto-reconnect after disconnect', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });
      client.connect();
      latestSocket().simulateOpen();

      client.disconnect();

      // Even after time advances, no new socket should be created
      vi.advanceTimersByTime(60_000);
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('emits close event', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });
      const handler = vi.fn();
      client.on('close', handler);

      client.connect();
      latestSocket().simulateOpen();
      client.disconnect();

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith({ code: 1000, reason: 'Client disconnect' });
    });
  });

  describe('isConnected', () => {
    it('returns false before connect()', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });
      expect(client.isConnected).toBe(false);
    });

    it('returns true when socket is open', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });
      client.connect();
      latestSocket().simulateOpen();

      expect(client.isConnected).toBe(true);
    });

    it('returns false after disconnect', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });
      client.connect();
      latestSocket().simulateOpen();
      client.disconnect();

      expect(client.isConnected).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Sending messages
  // -----------------------------------------------------------------------

  describe('send()', () => {
    it('sends JSON-encoded message when connected (no encryption)', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });
      client.connect();
      latestSocket().simulateOpen();

      const msg: WsClientMessage = { type: 'ping' };
      client.send(msg);

      expect(latestSocket().sentMessages).toHaveLength(1);
      expect(latestSocket().sentMessages[0]).toBe('{"type":"ping"}');
    });

    it('encrypts messages when sharedSecret is provided', () => {
      mocks.encryptSecretBox.mockReturnValue('encrypted_payload');

      const client = new WebSocketClient({
        url: 'wss://cp.example.com/api/ws',
        sharedSecret: 'dGVzdHNlY3JldDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=',
      });
      client.connect();
      latestSocket().simulateOpen();

      const msg: WsClientMessage = { type: 'ping' };
      client.send(msg);

      expect(mocks.encryptSecretBox).toHaveBeenCalledWith(
        '{"type":"ping"}',
        'dGVzdHNlY3JldDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=',
      );
      expect(latestSocket().sentMessages[0]).toBe('encrypted_payload');
    });

    it('queues messages when not connected', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });

      const msg: WsClientMessage = { type: 'ping' };
      client.send(msg);

      expect(client.queuedMessageCount).toBe(1);
    });

    it('flushes queued messages on reconnect', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });

      // Queue a message before connecting
      client.send({ type: 'ping' });
      expect(client.queuedMessageCount).toBe(1);

      client.connect();
      latestSocket().simulateOpen();

      // Queue should now be empty and message sent
      expect(client.queuedMessageCount).toBe(0);
      expect(latestSocket().sentMessages).toHaveLength(1);
    });

    it('drops oldest message when queue exceeds max size', () => {
      const client = new WebSocketClient({
        url: 'wss://cp.example.com/api/ws',
        maxQueueSize: 2,
      });

      client.send({ type: 'ping' });
      client.send({ type: 'agent:stop', agentId: 'a1' });
      client.send({ type: 'agent:stop', agentId: 'a2' });

      expect(client.queuedMessageCount).toBe(2);

      // Connect and check what was flushed (oldest "ping" should be dropped)
      client.connect();
      latestSocket().simulateOpen();

      expect(latestSocket().sentMessages).toHaveLength(2);
      expect(latestSocket().sentMessages[0]).toContain('a1');
      expect(latestSocket().sentMessages[1]).toContain('a2');
    });
  });

  // -----------------------------------------------------------------------
  // Receiving messages
  // -----------------------------------------------------------------------

  describe('message reception', () => {
    it('emits parsed server messages', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });
      const handler = vi.fn();
      client.on('message', handler);

      client.connect();
      latestSocket().simulateOpen();

      const msg: WsServerMessage = { type: 'pong' };
      latestSocket().simulateMessage(serverMsg(msg));

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(msg);
    });

    it('decrypts incoming messages when sharedSecret is set', () => {
      mocks.decryptSecretBox.mockReturnValue('{"type":"pong"}');
      mocks.encryptSecretBox.mockImplementation((msg) => msg); // passthrough for send

      const client = new WebSocketClient({
        url: 'wss://cp.example.com/api/ws',
        sharedSecret: 'dGVzdHNlY3JldDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=',
      });
      const handler = vi.fn();
      client.on('message', handler);

      client.connect();
      latestSocket().simulateOpen();
      latestSocket().simulateMessage('encrypted_server_data');

      expect(mocks.decryptSecretBox).toHaveBeenCalledWith(
        'encrypted_server_data',
        'dGVzdHNlY3JldDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=',
      );
      expect(handler).toHaveBeenCalledWith({ type: 'pong' });
    });

    it('emits error when decryption fails', () => {
      mocks.decryptSecretBox.mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      const client = new WebSocketClient({
        url: 'wss://cp.example.com/api/ws',
        sharedSecret: 'dGVzdHNlY3JldDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=',
      });
      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      client.connect();
      latestSocket().simulateOpen();
      latestSocket().simulateMessage('bad_encrypted_data');

      expect(errorHandler).toHaveBeenCalledOnce();
      const err = errorHandler.mock.calls[0]?.[0] as WebSocketClientError;
      expect(err.code).toBe('DECRYPT_FAILED');
    });

    it('emits error on invalid JSON', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });
      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      client.connect();
      latestSocket().simulateOpen();
      latestSocket().simulateMessage('not json');

      expect(errorHandler).toHaveBeenCalledOnce();
      const err = errorHandler.mock.calls[0]?.[0] as WebSocketClientError;
      expect(err.code).toBe('PARSE_ERROR');
    });

    it('handles agent:output messages correctly', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });
      const handler = vi.fn();
      client.on('message', handler);

      client.connect();
      latestSocket().simulateOpen();

      const msg: WsServerMessage = {
        type: 'agent:output',
        agentId: 'a1',
        data: 'Hello world',
        stream: 'stdout',
      };
      latestSocket().simulateMessage(serverMsg(msg));

      expect(handler).toHaveBeenCalledWith(msg);
    });
  });

  // -----------------------------------------------------------------------
  // Auto-reconnect
  // -----------------------------------------------------------------------

  describe('auto-reconnect', () => {
    it('attempts to reconnect after unexpected close', () => {
      const client = new WebSocketClient({
        url: 'wss://cp.example.com/api/ws',
        reconnectBaseDelayMs: 100,
      });
      client.connect();
      latestSocket().simulateOpen();

      // Simulate unexpected close
      latestSocket().simulateClose(1006, 'abnormal');

      const countBefore = MockWebSocket.instances.length;
      vi.advanceTimersByTime(200);

      expect(MockWebSocket.instances.length).toBe(countBefore + 1);
    });

    it('uses exponential backoff across consecutive failures', () => {
      const reconnectingHandler = vi.fn();
      const client = new WebSocketClient({
        url: 'wss://cp.example.com/api/ws',
        reconnectBaseDelayMs: 1000,
        reconnectMaxDelayMs: 60_000,
        maxReconnectAttempts: 10,
      });
      client.on('reconnecting', reconnectingHandler);

      client.connect();
      latestSocket().simulateOpen();

      // First disconnect — triggers attempt 1
      latestSocket().simulateClose(1006);
      expect(reconnectingHandler).toHaveBeenCalledTimes(1);

      const firstDelay = reconnectingHandler.mock.calls[0]?.[0].delayMs;
      // First attempt delay: base * 2^0 + jitter = ~1000..2000ms
      expect(firstDelay).toBeGreaterThanOrEqual(1000);
      expect(firstDelay).toBeLessThanOrEqual(2000);

      // Advance timer to fire reconnect — new socket created but NOT opened
      vi.advanceTimersByTime(firstDelay + 1);
      // Simulate the reconnect socket also closing immediately (connection failure)
      latestSocket().simulateClose(1006);
      expect(reconnectingHandler).toHaveBeenCalledTimes(2);

      const secondDelay = reconnectingHandler.mock.calls[1]?.[0].delayMs;
      // Second attempt delay: base * 2^1 + jitter = ~2000..3000ms
      expect(secondDelay).toBeGreaterThanOrEqual(2000);
      expect(secondDelay).toBeLessThanOrEqual(3000);

      client.disconnect();
    });

    it('resets reconnect attempt counter on successful connection', () => {
      const client = new WebSocketClient({
        url: 'wss://cp.example.com/api/ws',
        reconnectBaseDelayMs: 100,
      });
      client.connect();
      latestSocket().simulateOpen();

      // Disconnect and reconnect
      latestSocket().simulateClose(1006);
      expect(client.currentReconnectAttempt).toBe(1);

      vi.advanceTimersByTime(500);
      latestSocket().simulateOpen();

      expect(client.currentReconnectAttempt).toBe(0);
    });

    it('stops after maxReconnectAttempts', () => {
      const errorHandler = vi.fn();
      const client = new WebSocketClient({
        url: 'wss://cp.example.com/api/ws',
        maxReconnectAttempts: 2,
        reconnectBaseDelayMs: 100,
      });
      client.on('error', errorHandler);

      client.connect();
      latestSocket().simulateOpen();

      // First close → reconnect attempt 1
      latestSocket().simulateClose(1006);
      vi.advanceTimersByTime(500);

      // Second close → reconnect attempt 2
      latestSocket().simulateClose(1006);
      vi.advanceTimersByTime(500);

      // Third close → exceeds max, should emit error
      latestSocket().simulateClose(1006);

      const maxExceededError = errorHandler.mock.calls.find(
        (call) => (call[0] as WebSocketClientError).code === 'MAX_RECONNECT_EXCEEDED',
      );
      expect(maxExceededError).toBeDefined();
    });

    it('does not reconnect when autoReconnect is false', () => {
      const client = new WebSocketClient({
        url: 'wss://cp.example.com/api/ws',
        autoReconnect: false,
      });
      client.connect();
      latestSocket().simulateOpen();

      const countBefore = MockWebSocket.instances.length;
      latestSocket().simulateClose(1006);
      vi.advanceTimersByTime(60_000);

      expect(MockWebSocket.instances.length).toBe(countBefore);
    });

    it('emits reconnecting event with attempt number and delay', () => {
      const handler = vi.fn();
      const client = new WebSocketClient({
        url: 'wss://cp.example.com/api/ws',
        reconnectBaseDelayMs: 500,
      });
      client.on('reconnecting', handler);

      client.connect();
      latestSocket().simulateOpen();
      latestSocket().simulateClose(1006);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]?.[0].attempt).toBe(1);
      expect(typeof handler.mock.calls[0]?.[0].delayMs).toBe('number');
    });

    it('caps delay at reconnectMaxDelayMs', () => {
      const reconnectingHandler = vi.fn();
      const client = new WebSocketClient({
        url: 'wss://cp.example.com/api/ws',
        reconnectBaseDelayMs: 10_000,
        reconnectMaxDelayMs: 15_000,
        maxReconnectAttempts: 10,
      });
      client.on('reconnecting', reconnectingHandler);

      client.connect();
      latestSocket().simulateOpen();

      // Trigger several disconnects to drive delay up
      for (let i = 0; i < 5; i++) {
        latestSocket().simulateClose(1006);
        vi.advanceTimersByTime(20_000);
        if (latestSocket().readyState !== MockWebSocket.OPEN) {
          latestSocket().simulateOpen();
        }
      }

      for (const call of reconnectingHandler.mock.calls) {
        expect(call[0].delayMs).toBeLessThanOrEqual(15_000);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Event emitter
  // -----------------------------------------------------------------------

  describe('on() / off()', () => {
    it('supports multiple handlers for the same event', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      client.on('open', handler1);
      client.on('open', handler2);

      client.connect();
      latestSocket().simulateOpen();

      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });

    it('removes handler with off()', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });
      const handler = vi.fn();
      client.on('open', handler);
      client.off('open', handler);

      client.connect();
      latestSocket().simulateOpen();

      expect(handler).not.toHaveBeenCalled();
    });

    it('swallows errors thrown by event handlers', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });
      const throwingHandler = vi.fn(() => {
        throw new Error('handler crash');
      });
      const normalHandler = vi.fn();
      client.on('open', throwingHandler);
      client.on('open', normalHandler);

      client.connect();

      // Should not throw
      expect(() => latestSocket().simulateOpen()).not.toThrow();
      expect(normalHandler).toHaveBeenCalledOnce();
    });
  });

  // -----------------------------------------------------------------------
  // WebSocket error event
  // -----------------------------------------------------------------------

  describe('WebSocket error', () => {
    it('emits error event on socket error', () => {
      const client = new WebSocketClient({ url: 'wss://cp.example.com/api/ws' });
      const handler = vi.fn();
      client.on('error', handler);

      client.connect();
      latestSocket().simulateError();

      expect(handler).toHaveBeenCalledOnce();
      const err = handler.mock.calls[0]?.[0] as WebSocketClientError;
      expect(err.code).toBe('WS_ERROR');
    });
  });

  // -----------------------------------------------------------------------
  // WebSocketClientError
  // -----------------------------------------------------------------------

  describe('WebSocketClientError', () => {
    it('has the correct name property', () => {
      const err = new WebSocketClientError('TEST', 'msg');
      expect(err.name).toBe('WebSocketClientError');
    });

    it('stores code, message, and context', () => {
      const err = new WebSocketClientError('C', 'M', { key: 'val' });
      expect(err.code).toBe('C');
      expect(err.message).toBe('M');
      expect(err.context).toEqual({ key: 'val' });
    });

    it('is an instance of Error', () => {
      expect(new WebSocketClientError('C', 'M')).toBeInstanceOf(Error);
    });
  });
});
