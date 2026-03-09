import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import { createMockLogger } from '../api/routes/test-helpers.js';
import { createServer } from '../api/server.js';
import type { DbAgentRegistry } from '../registry/db-registry.js';
import { createMockDbRegistry, makeAgent, makeMachine } from './test-helpers.js';

const logger = createMockLogger();

// ===========================================================================
// Integration: WebSocket full lifecycle (iOS-to-agent flow)
// ===========================================================================

describe('Integration: WebSocket lifecycle (iOS-to-agent flow)', () => {
  let app: FastifyInstance;
  let address: string;
  let dbRegistry: DbAgentRegistry;
  let mockTaskQueue: { add: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    dbRegistry = createMockDbRegistry();
    mockTaskQueue = {
      add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    };

    app = await createServer({
      logger,
      dbRegistry,
      taskQueue: mockTaskQueue as never,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    address = typeof addr === 'string' ? addr : `127.0.0.1:${String(addr?.port)}`;
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-wire default mock return values after clearAllMocks
    vi.mocked(dbRegistry.getAgent).mockResolvedValue(makeAgent());
    vi.mocked(dbRegistry.getMachine).mockResolvedValue(makeMachine());
    vi.mocked(dbRegistry.createRun).mockResolvedValue('run-001');
    vi.mocked(dbRegistry.completeRun).mockResolvedValue(undefined);
    vi.mocked(dbRegistry.listMachines).mockResolvedValue([makeMachine()] as never);
    vi.mocked(dbRegistry.createAgent).mockResolvedValue('new-agent-uuid');
    vi.mocked(dbRegistry.listAgents).mockResolvedValue([]);
    vi.mocked(dbRegistry.getRecentRuns).mockResolvedValue([]);
    mockTaskQueue.add.mockResolvedValue({ id: 'job-1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Utility: open a WebSocket, send a message, collect N responses
  // -------------------------------------------------------------------------

  function connectAndSend(
    message: Record<string, unknown>,
    expectedMessages = 1,
    timeoutMs = 3000,
  ): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${address}/api/ws`);
      const received: Record<string, unknown>[] = [];
      const timeout = setTimeout(() => {
        ws.close();
        resolve(received);
      }, timeoutMs);

      ws.on('open', () => {
        ws.send(JSON.stringify(message));
      });

      ws.on('message', (data: Buffer) => {
        const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
        received.push(parsed);

        if (received.length >= expectedMessages) {
          clearTimeout(timeout);
          ws.close();
          resolve(received);
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /** Opens a WebSocket and waits for the connection to be established. */
  function openWs(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${address}/api/ws`);
      ws.on('open', () => resolve(ws));
      ws.on('error', (err) => reject(err));
    });
  }

  /** Sends a JSON message on an open WebSocket. */
  function sendMessage(ws: WebSocket, msg: Record<string, unknown>): void {
    ws.send(JSON.stringify(msg));
  }

  /** Waits for N messages on a WebSocket, with a timeout. */
  function waitForMessages(
    ws: WebSocket,
    count: number,
    timeoutMs = 3000,
  ): Promise<Record<string, unknown>[]> {
    return new Promise((resolve) => {
      const received: Record<string, unknown>[] = [];

      const timeout = setTimeout(() => {
        cleanup();
        resolve(received);
      }, timeoutMs);

      const onMessage = (data: Buffer): void => {
        const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
        received.push(parsed);

        if (received.length >= count) {
          cleanup();
          resolve(received);
        }
      };

      const cleanup = (): void => {
        clearTimeout(timeout);
        ws.off('message', onMessage);
      };

      ws.on('message', onMessage);
    });
  }

  /** Close a WebSocket and wait for it to fully close. */
  function closeWs(ws: WebSocket): Promise<void> {
    return new Promise((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }

      ws.on('close', () => resolve());
      ws.close();
    });
  }

  // =========================================================================
  // 1. Connect to /api/ws, receive connection confirmation
  // =========================================================================

  describe('connection establishment', () => {
    it('successfully connects to /api/ws via WebSocket upgrade', async () => {
      const ws = await openWs();

      expect(ws.readyState).toBe(WebSocket.OPEN);

      await closeWs(ws);
    });

    it('confirms the connection is alive by responding to a ping', async () => {
      const ws = await openWs();

      sendMessage(ws, { type: 'ping' });
      const messages = await waitForMessages(ws, 1);

      expect(messages.length).toBe(1);
      expect(messages[0].type).toBe('pong');
      expect(messages[0].timestamp).toBeDefined();

      await closeWs(ws);
    });
  });

  // =========================================================================
  // 2. Send ping, receive pong
  // =========================================================================

  describe('ping/pong', () => {
    it('responds with pong containing a valid ISO 8601 timestamp', async () => {
      const messages = await connectAndSend({ type: 'ping' });

      expect(messages.length).toBe(1);

      const pong = messages[0];
      expect(pong.type).toBe('pong');
      expect(typeof pong.timestamp).toBe('string');

      // Verify the timestamp is a valid ISO 8601 date
      const parsed = new Date(pong.timestamp as string);
      expect(parsed.toISOString()).toBe(pong.timestamp);
    });

    it('handles multiple pings on the same connection', async () => {
      const ws = await openWs();

      // Send first ping
      sendMessage(ws, { type: 'ping' });
      const first = await waitForMessages(ws, 1);
      expect(first[0].type).toBe('pong');

      // Send second ping
      sendMessage(ws, { type: 'ping' });
      const second = await waitForMessages(ws, 1);
      expect(second[0].type).toBe('pong');

      // Timestamps should differ (or at least both be valid)
      expect(typeof first[0].timestamp).toBe('string');
      expect(typeof second[0].timestamp).toBe('string');

      await closeWs(ws);
    });
  });

  // =========================================================================
  // 3. Send start_agent with dbRegistry mock -> verify job enqueued
  // =========================================================================

  describe('start_agent — existing agent in dbRegistry', () => {
    it('enqueues a job via taskQueue when the agent exists', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValueOnce(makeAgent());

      const messages = await connectAndSend({
        type: 'start_agent',
        agentId: 'agent-abc',
        prompt: 'Implement the auth module',
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);

      // Verify the task queue received the job
      expect(mockTaskQueue.add).toHaveBeenCalledOnce();
      expect(mockTaskQueue.add).toHaveBeenCalledWith(
        'agent:start',
        expect.objectContaining({
          agentId: 'agent-abc',
          machineId: 'machine-xyz',
          prompt: 'Implement the auth module',
          trigger: 'manual',
        }),
      );

      // Verify the response is an agent_event with status 'starting'
      const statusMsg = messages.find((m) => m.type === 'agent_event');
      expect(statusMsg).toBeDefined();
      expect(statusMsg?.agentId).toBe('agent-abc');

      const event = statusMsg?.event as { event: string; data: { status: string; reason: string } };
      expect(event.event).toBe('status');
      expect(event.data.status).toBe('starting');
      expect(event.data.reason).toContain('job-1');
    });

    it('passes model and allowedTools from config to the job data', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValueOnce(makeAgent());

      await connectAndSend({
        type: 'start_agent',
        agentId: 'agent-abc',
        prompt: 'Fix the bug',
        config: {
          model: 'claude-opus-4-6',
          allowedTools: ['Read', 'Write', 'Edit'],
        },
      });

      expect(mockTaskQueue.add).toHaveBeenCalledWith(
        'agent:start',
        expect.objectContaining({
          model: 'claude-opus-4-6',
          allowedTools: ['Read', 'Write', 'Edit'],
        }),
      );
    });

    it('returns QUEUE_UNAVAILABLE when taskQueue is null', async () => {
      // Create a server without a taskQueue
      const noQueueApp = await createServer({
        logger,
        dbRegistry,
      });
      await noQueueApp.listen({ port: 0, host: '127.0.0.1' });
      const noQueueAddr = noQueueApp.server.address();
      const noQueueAddress =
        typeof noQueueAddr === 'string' ? noQueueAddr : `127.0.0.1:${String(noQueueAddr?.port)}`;

      try {
        const ws = new WebSocket(`ws://${noQueueAddress}/api/ws`);
        const received: Record<string, unknown>[] = [];

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            ws.close();
            resolve();
          }, 3000);

          ws.on('open', () => {
            ws.send(
              JSON.stringify({
                type: 'start_agent',
                agentId: 'agent-abc',
                prompt: 'Fix the bug',
              }),
            );
          });

          ws.on('message', (data: Buffer) => {
            received.push(JSON.parse(data.toString()) as Record<string, unknown>);
            clearTimeout(timeout);
            ws.close();
            resolve();
          });

          ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        expect(received.length).toBeGreaterThanOrEqual(1);
        const errorMsg = received.find((m) => m.type === 'error');
        expect(errorMsg).toBeDefined();
        expect(errorMsg?.code).toBe('QUEUE_UNAVAILABLE');
      } finally {
        await noQueueApp.close();
      }
    });

    it('returns INVALID_PARAMS when prompt is missing', async () => {
      const messages = await connectAndSend({
        type: 'start_agent',
        agentId: 'agent-abc',
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);

      const errorMsg = messages.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.code).toBe('INVALID_PARAMS');
      expect(mockTaskQueue.add).not.toHaveBeenCalled();
    });

    it('returns INVALID_PARAMS when agentId is missing', async () => {
      const messages = await connectAndSend({
        type: 'start_agent',
        prompt: 'Fix the bug',
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);

      const errorMsg = messages.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.code).toBe('INVALID_PARAMS');
      expect(mockTaskQueue.add).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 4. Send start_agent for nonexistent agent -> verify auto-creation
  // =========================================================================

  describe('start_agent — auto-creation for nonexistent agent', () => {
    it('auto-creates an agent when it does not exist in dbRegistry', async () => {
      vi.mocked(dbRegistry.getAgent)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(
          makeAgent({
            id: 'new-agent-uuid',
            machineId: 'machine-xyz',
            name: 'new-agent',
            type: 'adhoc',
          }) as never,
        );

      const messages = await connectAndSend({
        type: 'start_agent',
        agentId: 'new-agent',
        prompt: 'Build the dashboard',
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);

      // The agent should have been auto-created
      expect(dbRegistry.createAgent).toHaveBeenCalledWith({
        machineId: 'machine-xyz',
        name: 'new-agent',
        type: 'adhoc',
      });

      // A job should have been enqueued
      expect(mockTaskQueue.add).toHaveBeenCalledWith(
        'agent:start',
        expect.objectContaining({
          agentId: 'new-agent',
          machineId: 'machine-xyz',
          prompt: 'Build the dashboard',
        }),
      );

      // Should receive a status event
      const statusMsg = messages.find((m) => m.type === 'agent_event');
      expect(statusMsg).toBeDefined();
    });

    it('uses the explicitly provided machineId when auto-creating', async () => {
      vi.mocked(dbRegistry.getAgent)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(
          makeAgent({
            id: 'new-agent-uuid',
            machineId: 'specific-machine',
            name: 'targeted-agent',
            type: 'adhoc',
          }) as never,
        );

      await connectAndSend({
        type: 'start_agent',
        agentId: 'targeted-agent',
        prompt: 'Deploy to staging',
        machineId: 'specific-machine',
      });

      expect(dbRegistry.createAgent).toHaveBeenCalledWith({
        machineId: 'specific-machine',
        name: 'targeted-agent',
        type: 'adhoc',
      });

      // listMachines should NOT be called when machineId is explicit
      expect(dbRegistry.listMachines).not.toHaveBeenCalled();
    });

    it('returns NO_MACHINES_AVAILABLE when no online machines exist', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValueOnce(undefined);
      vi.mocked(dbRegistry.listMachines).mockResolvedValueOnce([] as never);

      const messages = await connectAndSend({
        type: 'start_agent',
        agentId: 'orphan-agent',
        prompt: 'Do something',
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);

      const errorMsg = messages.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.code).toBe('NO_MACHINES_AVAILABLE');

      // createAgent should NOT have been called
      expect(dbRegistry.createAgent).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 5. Send stop_agent -> verify HTTP call dispatched (mock fetch)
  // =========================================================================

  describe('stop_agent — dispatches HTTP stop to worker', () => {
    it('sends a POST to the worker stop endpoint for a known agent', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValue(makeAgent());
      vi.mocked(dbRegistry.getMachine).mockResolvedValue(makeMachine());

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ ok: true }),
          text: vi.fn().mockResolvedValue('{"ok":true}'),
        }),
      );

      const messages = await connectAndSend({
        type: 'stop_agent',
        agentId: 'agent-abc',
        graceful: true,
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);

      // Verify fetch was called with the correct URL and body
      expect(fetch).toHaveBeenCalledOnce();
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toContain('100.64.0.1:9000');
      expect(fetchCall[0]).toContain('/api/agents/agent-abc/stop');

      const fetchOpts = fetchCall[1] as { method: string; body: string };
      expect(fetchOpts.method).toBe('POST');

      const body = JSON.parse(fetchOpts.body) as { reason: string; graceful: boolean };
      expect(body.reason).toBe('user');
      expect(body.graceful).toBe(true);

      // Verify the response is an agent_event with status 'stopping'
      const statusMsg = messages.find((m) => m.type === 'agent_event');
      expect(statusMsg).toBeDefined();

      const event = statusMsg?.event as { event: string; data: { status: string } };
      expect(event.event).toBe('status');
      expect(event.data.status).toBe('stopping');

      vi.unstubAllGlobals();
    });

    it('defaults graceful to true when not specified', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValue(makeAgent());
      vi.mocked(dbRegistry.getMachine).mockResolvedValue(makeMachine());

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ ok: true }),
          text: vi.fn().mockResolvedValue('{"ok":true}'),
        }),
      );

      await connectAndSend({
        type: 'stop_agent',
        agentId: 'agent-abc',
      });

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const fetchOpts = fetchCall[1] as { body: string };
      const body = JSON.parse(fetchOpts.body) as { graceful: boolean };
      expect(body.graceful).toBe(true);

      vi.unstubAllGlobals();
    });

    it('returns WORKER_STOP_FAILED when the worker returns non-2xx', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValue(makeAgent());
      vi.mocked(dbRegistry.getMachine).mockResolvedValue(makeMachine());

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 503,
          json: vi.fn().mockRejectedValue(new Error('not json')),
          text: vi.fn().mockResolvedValue('Service Unavailable'),
        }),
      );

      const messages = await connectAndSend({
        type: 'stop_agent',
        agentId: 'agent-abc',
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);

      const errorMsg = messages.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.code).toBe('WORKER_STOP_FAILED');

      vi.unstubAllGlobals();
    });

    it('returns WORKER_UNREACHABLE when fetch throws a network error', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValue(makeAgent());
      vi.mocked(dbRegistry.getMachine).mockResolvedValue(makeMachine());

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const messages = await connectAndSend({
        type: 'stop_agent',
        agentId: 'agent-abc',
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);

      const errorMsg = messages.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.code).toBe('WORKER_UNREACHABLE');

      vi.unstubAllGlobals();
    });

    it('returns REGISTRY_UNAVAILABLE when dbRegistry is null', async () => {
      const noDbApp = await createServer({
        logger,
        taskQueue: mockTaskQueue as never,
      });
      await noDbApp.listen({ port: 0, host: '127.0.0.1' });
      const noDbAddr = noDbApp.server.address();
      const noDbAddress =
        typeof noDbAddr === 'string' ? noDbAddr : `127.0.0.1:${String(noDbAddr?.port)}`;

      try {
        const ws = new WebSocket(`ws://${noDbAddress}/api/ws`);
        const received: Record<string, unknown>[] = [];

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            ws.close();
            resolve();
          }, 3000);

          ws.on('open', () => {
            ws.send(
              JSON.stringify({
                type: 'stop_agent',
                agentId: 'agent-abc',
              }),
            );
          });

          ws.on('message', (data: Buffer) => {
            received.push(JSON.parse(data.toString()) as Record<string, unknown>);
            clearTimeout(timeout);
            ws.close();
            resolve();
          });

          ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        const errorMsg = received.find((m) => m.type === 'error');
        expect(errorMsg).toBeDefined();
        expect(errorMsg?.code).toBe('REGISTRY_UNAVAILABLE');
      } finally {
        await noDbApp.close();
      }
    });

    it('returns AGENT_NOT_FOUND when agent does not exist', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValue(undefined);

      const messages = await connectAndSend({
        type: 'stop_agent',
        agentId: 'nonexistent-agent',
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);

      const errorMsg = messages.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.code).toBe('AGENT_NOT_FOUND');
    });

    it('returns MACHINE_OFFLINE when the machine is offline', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValue(makeAgent());
      vi.mocked(dbRegistry.getMachine).mockResolvedValue(makeMachine({ status: 'offline' }));

      const messages = await connectAndSend({
        type: 'stop_agent',
        agentId: 'agent-abc',
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);

      const errorMsg = messages.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.code).toBe('MACHINE_OFFLINE');
    });
  });

  // =========================================================================
  // 6. Send subscribe_agent -> verify SSE subscription started
  // =========================================================================

  describe('subscribe_agent — SSE subscription', () => {
    it('resolves the worker URL and initiates an SSE subscription', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValue(makeAgent());
      vi.mocked(dbRegistry.getMachine).mockResolvedValue(makeMachine());

      // Mock fetch to simulate an SSE stream that never sends data and hangs
      // (simulating a long-lived SSE connection). We just verify it was called.
      const abortSpy = vi.fn();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((_url: string, opts?: { signal?: AbortSignal }) => {
          if (opts?.signal) {
            opts.signal.addEventListener('abort', abortSpy);
          }

          // Return a response with a body that never resolves its read
          return Promise.resolve({
            ok: true,
            status: 200,
            body: {
              getReader: () => ({
                read: () =>
                  new Promise<{ done: boolean; value?: Uint8Array }>(() => {
                    // Intentionally never resolves — simulates open SSE stream
                  }),
              }),
            },
          });
        }),
      );

      const ws = await openWs();

      sendMessage(ws, { type: 'subscribe_agent', agentId: 'agent-abc' });

      // Give the async handler time to resolve the worker URL and call fetch
      await new Promise((r) => setTimeout(r, 200));

      // Verify fetch was called with the correct SSE stream URL
      expect(fetch).toHaveBeenCalledOnce();
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toContain('100.64.0.1:9000');
      expect(fetchCall[0]).toContain('/api/agents/agent-abc/stream');

      // Close the WebSocket — this should trigger subscription cancellation
      await closeWs(ws);

      // Give the close handler time to cancel subscriptions
      await new Promise((r) => setTimeout(r, 100));

      // The abort listener should have been called when the WebSocket closed
      expect(abortSpy).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it('returns ALREADY_SUBSCRIBED when subscribing to the same agent twice', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValue(makeAgent());
      vi.mocked(dbRegistry.getMachine).mockResolvedValue(makeMachine());

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: () => new Promise<{ done: boolean; value?: Uint8Array }>(() => {}),
            }),
          },
        }),
      );

      const ws = await openWs();

      // Subscribe first time
      sendMessage(ws, { type: 'subscribe_agent', agentId: 'agent-abc' });
      await new Promise((r) => setTimeout(r, 200));

      // Subscribe second time — should get ALREADY_SUBSCRIBED error
      sendMessage(ws, { type: 'subscribe_agent', agentId: 'agent-abc' });
      const messages = await waitForMessages(ws, 1);

      expect(messages.length).toBeGreaterThanOrEqual(1);
      const errorMsg = messages.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.code).toBe('ALREADY_SUBSCRIBED');

      await closeWs(ws);

      vi.unstubAllGlobals();
    });

    it('returns REGISTRY_UNAVAILABLE when dbRegistry is null', async () => {
      const noDbApp = await createServer({
        logger,
        taskQueue: mockTaskQueue as never,
      });
      await noDbApp.listen({ port: 0, host: '127.0.0.1' });
      const noDbAddr = noDbApp.server.address();
      const noDbAddress =
        typeof noDbAddr === 'string' ? noDbAddr : `127.0.0.1:${String(noDbAddr?.port)}`;

      try {
        const ws = new WebSocket(`ws://${noDbAddress}/api/ws`);
        const received: Record<string, unknown>[] = [];

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            ws.close();
            resolve();
          }, 3000);

          ws.on('open', () => {
            ws.send(
              JSON.stringify({
                type: 'subscribe_agent',
                agentId: 'agent-abc',
              }),
            );
          });

          ws.on('message', (data: Buffer) => {
            received.push(JSON.parse(data.toString()) as Record<string, unknown>);
            clearTimeout(timeout);
            ws.close();
            resolve();
          });

          ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        const errorMsg = received.find((m) => m.type === 'error');
        expect(errorMsg).toBeDefined();
        expect(errorMsg?.code).toBe('REGISTRY_UNAVAILABLE');
      } finally {
        await noDbApp.close();
      }
    });
  });

  // =========================================================================
  // 6b. subscribe_agent — SSE subscription error paths
  // =========================================================================

  describe('subscribe_agent — error paths', () => {
    it('returns MACHINE_NOT_FOUND when the agent machine is not registered', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValue(makeAgent());
      vi.mocked(dbRegistry.getMachine).mockResolvedValue(undefined);

      const messages = await connectAndSend({
        type: 'subscribe_agent',
        agentId: 'agent-abc',
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);

      const errorMsg = messages.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.code).toBe('MACHINE_NOT_FOUND');
    });

    it('returns MACHINE_OFFLINE when agent machine is offline during subscribe', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValue(makeAgent());
      vi.mocked(dbRegistry.getMachine).mockResolvedValue(makeMachine({ status: 'offline' }));

      const messages = await connectAndSend({
        type: 'subscribe_agent',
        agentId: 'agent-abc',
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);

      const errorMsg = messages.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.code).toBe('MACHINE_OFFLINE');
    });

    it('returns INVALID_PARAMS when agentId is missing for subscribe_agent', async () => {
      const messages = await connectAndSend({
        type: 'subscribe_agent',
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);

      const errorMsg = messages.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.code).toBe('INVALID_PARAMS');
    });

    it('sends SSE_ERROR when the SSE stream fetch throws a network error', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValue(makeAgent());
      vi.mocked(dbRegistry.getMachine).mockResolvedValue(makeMachine());

      // Mock fetch to throw a network error (simulating connection refused)
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const ws = await openWs();

      sendMessage(ws, { type: 'subscribe_agent', agentId: 'agent-abc' });

      // Wait for the SSE pump to encounter the error and relay it
      const messages = await waitForMessages(ws, 1, 2000);

      expect(messages.length).toBeGreaterThanOrEqual(1);

      const errorMsg = messages.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.code).toBe('SSE_ERROR');

      await closeWs(ws);

      vi.unstubAllGlobals();
    });

    it('sends WORKER_STREAM_ERROR when the SSE stream returns non-ok response', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValue(makeAgent());
      vi.mocked(dbRegistry.getMachine).mockResolvedValue(makeMachine());

      // Mock fetch to return a non-ok response (e.g., 503)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 503,
          body: null,
        }),
      );

      const ws = await openWs();

      sendMessage(ws, { type: 'subscribe_agent', agentId: 'agent-abc' });

      // Wait for the SSE pump to encounter the error and relay it
      const messages = await waitForMessages(ws, 1, 2000);

      expect(messages.length).toBeGreaterThanOrEqual(1);

      const errorMsg = messages.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.code).toBe('WORKER_STREAM_ERROR');

      await closeWs(ws);

      vi.unstubAllGlobals();
    });
  });

  // =========================================================================
  // 6c. stop_agent — additional error paths
  // =========================================================================

  describe('stop_agent — additional error paths', () => {
    it('returns INVALID_PARAMS when agentId is missing for stop_agent', async () => {
      const messages = await connectAndSend({
        type: 'stop_agent',
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);

      const errorMsg = messages.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.code).toBe('INVALID_PARAMS');
    });

    it('returns MACHINE_NOT_FOUND when agent machine does not exist during stop', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValue(makeAgent());
      vi.mocked(dbRegistry.getMachine).mockResolvedValue(undefined);

      const messages = await connectAndSend({
        type: 'stop_agent',
        agentId: 'agent-abc',
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);

      const errorMsg = messages.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.code).toBe('MACHINE_NOT_FOUND');
    });
  });

  // =========================================================================
  // 7. Send invalid message -> receive error response
  // =========================================================================

  describe('invalid messages — error handling', () => {
    it('returns INVALID_JSON for non-JSON text', async () => {
      const ws = await openWs();

      ws.send('this is not valid JSON {{{');
      const messages = await waitForMessages(ws, 1);

      expect(messages.length).toBe(1);
      expect(messages[0].type).toBe('error');
      expect(messages[0].code).toBe('INVALID_JSON');

      await closeWs(ws);
    });

    it('returns UNKNOWN_MESSAGE_TYPE for an unrecognized type', async () => {
      const messages = await connectAndSend({
        type: 'do_something_unknown',
        data: 'whatever',
      });

      expect(messages.length).toBe(1);
      expect(messages[0].type).toBe('error');
      expect(messages[0].code).toBe('UNKNOWN_MESSAGE_TYPE');
      expect(messages[0].message).toContain('do_something_unknown');
    });

    it('returns UNKNOWN_MESSAGE_TYPE when type field is missing', async () => {
      const messages = await connectAndSend({
        agentId: 'agent-abc',
        prompt: 'Fix the bug',
      });

      expect(messages.length).toBe(1);
      expect(messages[0].type).toBe('error');
      expect(messages[0].code).toBe('UNKNOWN_MESSAGE_TYPE');
    });

    it('returns UNKNOWN_MESSAGE_TYPE when type is a number', async () => {
      const messages = await connectAndSend({
        type: 42,
      });

      expect(messages.length).toBe(1);
      expect(messages[0].type).toBe('error');
      expect(messages[0].code).toBe('UNKNOWN_MESSAGE_TYPE');
    });

    it('returns INVALID_JSON for an empty string message', async () => {
      const ws = await openWs();

      ws.send('');
      const messages = await waitForMessages(ws, 1);

      expect(messages.length).toBe(1);
      expect(messages[0].type).toBe('error');
      expect(messages[0].code).toBe('INVALID_JSON');

      await closeWs(ws);
    });
  });

  // =========================================================================
  // 8. Multiple concurrent connections don't interfere
  // =========================================================================

  describe('concurrent connections — isolation', () => {
    it('two connections receive independent pong responses', async () => {
      const ws1 = await openWs();
      const ws2 = await openWs();

      // Send pings on both connections
      sendMessage(ws1, { type: 'ping' });
      sendMessage(ws2, { type: 'ping' });

      const [msgs1, msgs2] = await Promise.all([waitForMessages(ws1, 1), waitForMessages(ws2, 1)]);

      expect(msgs1.length).toBe(1);
      expect(msgs1[0].type).toBe('pong');

      expect(msgs2.length).toBe(1);
      expect(msgs2[0].type).toBe('pong');

      await Promise.all([closeWs(ws1), closeWs(ws2)]);
    });

    it('an error on one connection does not affect the other', async () => {
      const ws1 = await openWs();
      const ws2 = await openWs();

      // Send an invalid message on ws1
      ws1.send('NOT JSON');
      const errMsgs = await waitForMessages(ws1, 1);
      expect(errMsgs[0].type).toBe('error');
      expect(errMsgs[0].code).toBe('INVALID_JSON');

      // ws2 should still work fine
      sendMessage(ws2, { type: 'ping' });
      const pongMsgs = await waitForMessages(ws2, 1);
      expect(pongMsgs[0].type).toBe('pong');

      await Promise.all([closeWs(ws1), closeWs(ws2)]);
    });

    it('starting an agent on one connection does not leak events to another', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValue(makeAgent());

      const ws1 = await openWs();
      const ws2 = await openWs();

      // Start agent on ws1
      sendMessage(ws1, {
        type: 'start_agent',
        agentId: 'agent-abc',
        prompt: 'Fix the bug',
      });

      const ws1Msgs = await waitForMessages(ws1, 1);
      expect(ws1Msgs.length).toBe(1);
      expect(ws1Msgs[0].type).toBe('agent_event');

      // ws2 should NOT receive any messages (wait briefly to confirm)
      const ws2Msgs = await waitForMessages(ws2, 1, 500);
      expect(ws2Msgs.length).toBe(0);

      await Promise.all([closeWs(ws1), closeWs(ws2)]);
    });

    it('closing one connection does not close the other', async () => {
      const ws1 = await openWs();
      const ws2 = await openWs();

      // Close ws1
      await closeWs(ws1);

      // ws2 should still be usable
      expect(ws2.readyState).toBe(WebSocket.OPEN);

      sendMessage(ws2, { type: 'ping' });
      const msgs = await waitForMessages(ws2, 1);
      expect(msgs[0].type).toBe('pong');

      await closeWs(ws2);
    });

    it('handles multiple concurrent start_agent messages on the same connection', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValue(makeAgent());

      const ws = await openWs();

      // Fire off two start_agent messages rapidly
      sendMessage(ws, {
        type: 'start_agent',
        agentId: 'agent-abc',
        prompt: 'First task',
      });
      sendMessage(ws, {
        type: 'start_agent',
        agentId: 'agent-abc',
        prompt: 'Second task',
      });

      const msgs = await waitForMessages(ws, 2);
      expect(msgs.length).toBe(2);

      // Both should be agent_event responses
      for (const msg of msgs) {
        expect(msg.type).toBe('agent_event');
      }

      // taskQueue should have been called twice
      expect(mockTaskQueue.add).toHaveBeenCalledTimes(2);

      await closeWs(ws);
    });
  });
});
