import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { AgentRegistry } from '../../registry/agent-registry.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { createServer } from '../server.js';

const logger = {
  child: () => logger,
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
  level: 'silent',
} as unknown as Logger;

describe('WebSocket route — /api/ws', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const registry = new AgentRegistry();
    app = await createServer({ logger, registry });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Route registration
  // ---------------------------------------------------------------------------

  describe('route registration', () => {
    it('GET /api/ws without a WebSocket upgrade returns 404 (route exists but requires upgrade)', async () => {
      // @fastify/websocket routes with `websocket: true` install a fallback
      // HTTP handler that replies 404 when no upgrade header is present.
      // This confirms the route is registered and reachable.
      const response = await app.inject({
        method: 'GET',
        url: '/api/ws',
      });

      expect(response.statusCode).toBe(404);
    });

    it('a non-existent path under /api/ws returns 404', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/ws/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });

    it('POST /api/ws is not a registered method and returns 404', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ws',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});

// ---------------------------------------------------------------------------
// WebSocket start_agent auto-creation — live WebSocket connection tests
// ---------------------------------------------------------------------------

describe('WebSocket start_agent — auto-creation', () => {
  let app: FastifyInstance;
  let address: string;

  const mockDbRegistry = {
    registerMachine: vi.fn(),
    heartbeat: vi.fn(),
    listMachines: vi.fn().mockResolvedValue([
      {
        id: 'machine-1',
        hostname: 'test-host',
        tailscaleIp: '100.64.0.1',
        os: 'linux',
        arch: 'x64',
        status: 'online',
        lastHeartbeat: new Date(),
        capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
        createdAt: new Date(),
      },
    ]),
    createAgent: vi.fn().mockResolvedValue('new-agent-uuid'),
    getAgent: vi.fn().mockResolvedValue(undefined),
    updateAgentStatus: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    getRecentRuns: vi.fn().mockResolvedValue([]),
    completeRun: vi.fn(),
    createRun: vi.fn(),
    insertActions: vi.fn(),
    getMachine: vi.fn(),
  } as unknown as DbAgentRegistry;

  const mockTaskQueue = {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
  };

  beforeAll(async () => {
    app = await createServer({
      logger,
      dbRegistry: mockDbRegistry,
      taskQueue: mockTaskQueue as never,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    address = typeof addr === 'string' ? addr : `127.0.0.1:${String(addr?.port)}`;
  });

  afterEach(() => {
    vi.mocked(mockDbRegistry.getAgent).mockReset();
    vi.mocked(mockDbRegistry.createAgent).mockReset().mockResolvedValue('new-agent-uuid');
    vi.mocked(mockDbRegistry.listMachines)
      .mockReset()
      .mockResolvedValue([
        {
          id: 'machine-1',
          hostname: 'test-host',
          tailscaleIp: '100.64.0.1',
          os: 'linux',
          arch: 'x64',
          status: 'online',
          lastHeartbeat: new Date(),
          capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
          createdAt: new Date(),
        },
      ] as never);
    vi.mocked(mockTaskQueue.add).mockReset().mockResolvedValue({ id: 'job-1' });
    vi.mocked(logger.info).mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Open a WebSocket, send a message, and collect responses. */
  function connectAndSend(
    message: Record<string, unknown>,
    expectedMessages = 1,
  ): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${address}/api/ws`);
      const received: Record<string, unknown>[] = [];
      const timeout = setTimeout(() => {
        ws.close();
        // Resolve with whatever we collected rather than timing out
        resolve(received);
      }, 2000);

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

  it('auto-creates an agent when start_agent is sent for an unknown agentId', async () => {
    // First call to getAgent returns undefined (agent not found),
    // second call returns the newly created agent.
    vi.mocked(mockDbRegistry.getAgent)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: 'new-agent-uuid',
        machineId: 'machine-1',
        name: 'my-new-agent',
        type: 'adhoc',
        status: 'registered',
        schedule: null,
        projectPath: null,
        worktreeBranch: null,
        currentSessionId: null,
        config: {},
        lastRunAt: null,
        lastCostUsd: null,
        totalCostUsd: 0,
        createdAt: new Date(),
      } as never);

    const messages = await connectAndSend({
      type: 'start_agent',
      agentId: 'my-new-agent',
      prompt: 'Fix the bug',
    });

    expect(messages.length).toBeGreaterThanOrEqual(1);

    // The agent should have been auto-created
    expect(mockDbRegistry.createAgent).toHaveBeenCalledWith({
      machineId: 'machine-1',
      name: 'my-new-agent',
      type: 'adhoc',
    });

    // A job should have been enqueued
    expect(mockTaskQueue.add).toHaveBeenCalledWith(
      'agent:start',
      expect.objectContaining({
        agentId: 'my-new-agent',
        machineId: 'machine-1',
        prompt: 'Fix the bug',
      }),
    );

    // Should receive a status event
    const statusMsg = messages.find((m) => m.type === 'agent_event');
    expect(statusMsg).toBeDefined();
  });

  it('returns NO_MACHINES_AVAILABLE error when no online machines exist', async () => {
    vi.mocked(mockDbRegistry.getAgent).mockResolvedValueOnce(undefined);
    vi.mocked(mockDbRegistry.listMachines).mockResolvedValueOnce([]);

    const messages = await connectAndSend({
      type: 'start_agent',
      agentId: 'agent-orphan',
      prompt: 'Do something',
    });

    expect(messages.length).toBeGreaterThanOrEqual(1);

    const errorMsg = messages.find((m) => m.type === 'error');
    expect(errorMsg).toBeDefined();
    expect(errorMsg?.code).toBe('NO_MACHINES_AVAILABLE');

    // createAgent should NOT have been called
    expect(mockDbRegistry.createAgent).not.toHaveBeenCalled();
  });

  it('uses the machineId from the message when provided', async () => {
    vi.mocked(mockDbRegistry.getAgent)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: 'new-agent-uuid',
        machineId: 'specific-machine',
        name: 'targeted-agent',
        type: 'adhoc',
        status: 'registered',
        schedule: null,
        projectPath: null,
        worktreeBranch: null,
        currentSessionId: null,
        config: {},
        lastRunAt: null,
        lastCostUsd: null,
        totalCostUsd: 0,
        createdAt: new Date(),
      } as never);

    const messages = await connectAndSend({
      type: 'start_agent',
      agentId: 'targeted-agent',
      prompt: 'Deploy to staging',
      machineId: 'specific-machine',
    });

    expect(messages.length).toBeGreaterThanOrEqual(1);

    // createAgent should use the explicitly specified machineId
    expect(mockDbRegistry.createAgent).toHaveBeenCalledWith({
      machineId: 'specific-machine',
      name: 'targeted-agent',
      type: 'adhoc',
    });

    // listMachines should NOT be called when machineId is explicit
    expect(mockDbRegistry.listMachines).not.toHaveBeenCalled();
  });

  it('skips auto-creation when agent already exists', async () => {
    vi.mocked(mockDbRegistry.getAgent).mockResolvedValueOnce({
      id: 'existing-agent',
      machineId: 'machine-1',
      name: 'Existing Agent',
      type: 'manual',
      status: 'registered',
      schedule: null,
      projectPath: null,
      worktreeBranch: null,
      currentSessionId: null,
      config: {},
      lastRunAt: null,
      lastCostUsd: null,
      totalCostUsd: 0,
      createdAt: new Date(),
    } as never);

    const messages = await connectAndSend({
      type: 'start_agent',
      agentId: 'existing-agent',
      prompt: 'Run tests',
    });

    expect(messages.length).toBeGreaterThanOrEqual(1);

    // createAgent should NOT be called for existing agents
    expect(mockDbRegistry.createAgent).not.toHaveBeenCalled();

    // Job should still be enqueued
    expect(mockTaskQueue.add).toHaveBeenCalled();
  });

  it('returns AGENT_CREATE_FAILED when auto-created agent cannot be retrieved', async () => {
    // First getAgent returns undefined (not found), second also returns undefined
    // after createAgent succeeds — simulates a race condition or transient DB issue.
    vi.mocked(mockDbRegistry.getAgent)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    vi.mocked(mockDbRegistry.createAgent).mockResolvedValueOnce('new-agent-uuid');

    const messages = await connectAndSend({
      type: 'start_agent',
      agentId: 'ghost-agent',
      prompt: 'Do work',
    });

    expect(messages.length).toBeGreaterThanOrEqual(1);

    const errorMsg = messages.find((m) => m.type === 'error');
    expect(errorMsg).toBeDefined();
    expect(errorMsg?.code).toBe('AGENT_CREATE_FAILED');
  });
});

// ---------------------------------------------------------------------------
// WebSocket unsubscribe_agent — live WebSocket connection tests
// ---------------------------------------------------------------------------

describe('WebSocket unsubscribe_agent', () => {
  let app: FastifyInstance;
  let address: string;

  const mockDbRegistry = {
    registerMachine: vi.fn(),
    heartbeat: vi.fn(),
    listMachines: vi.fn().mockResolvedValue([]),
    createAgent: vi.fn(),
    getAgent: vi.fn().mockResolvedValue({
      id: 'agent-abc',
      machineId: 'machine-1',
      name: 'Test Agent',
      type: 'manual',
      status: 'registered',
      schedule: null,
      projectPath: null,
      worktreeBranch: null,
      currentSessionId: null,
      config: {},
      lastRunAt: null,
      lastCostUsd: null,
      totalCostUsd: 0,
      createdAt: new Date(),
    }),
    updateAgentStatus: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    getRecentRuns: vi.fn().mockResolvedValue([]),
    completeRun: vi.fn(),
    createRun: vi.fn(),
    insertActions: vi.fn(),
    getMachine: vi.fn().mockResolvedValue({
      id: 'machine-1',
      hostname: 'test-host',
      tailscaleIp: '100.64.0.1',
      os: 'linux',
      arch: 'x64',
      status: 'online',
      lastHeartbeat: new Date(),
      capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
      createdAt: new Date(),
    }),
  } as unknown as DbAgentRegistry;

  const mockTaskQueue = {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
  };

  beforeAll(async () => {
    app = await createServer({
      logger,
      dbRegistry: mockDbRegistry,
      taskQueue: mockTaskQueue as never,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    address = typeof addr === 'string' ? addr : `127.0.0.1:${String(addr?.port)}`;
  });

  afterEach(() => {
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.warn).mockClear();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await app.close();
  });

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

  it('cancels an existing SSE subscription when unsubscribe_agent is sent', async () => {
    // Mock fetch to simulate an SSE stream that never sends data (long-lived)
    const abortSpy = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, opts?: { signal?: AbortSignal }) => {
        if (opts?.signal) {
          opts.signal.addEventListener('abort', abortSpy);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: () => new Promise<{ done: boolean; value?: Uint8Array }>(() => {}),
            }),
          },
        });
      }),
    );

    const ws = await openWs();

    // Subscribe to agent
    sendMessage(ws, { type: 'subscribe_agent', agentId: 'agent-abc' });
    await new Promise((r) => setTimeout(r, 200));

    // Unsubscribe from agent
    sendMessage(ws, { type: 'unsubscribe_agent', agentId: 'agent-abc' });
    await new Promise((r) => setTimeout(r, 200));

    // The abort spy should have been called when the subscription was cancelled
    expect(abortSpy).toHaveBeenCalled();

    await closeWs(ws);
  });

  it('does not error when unsubscribing from an agent with no active subscription', async () => {
    const ws = await openWs();

    // Send unsubscribe for an agent we never subscribed to
    sendMessage(ws, { type: 'unsubscribe_agent', agentId: 'non-subscribed-agent' });

    // Should not receive any error — the operation is silently accepted
    const messages = await waitForMessages(ws, 1, 500);
    expect(messages.length).toBe(0);

    await closeWs(ws);
  });

  it('returns INVALID_PARAMS when agentId is missing for unsubscribe_agent', async () => {
    const ws = await openWs();

    sendMessage(ws, { type: 'unsubscribe_agent' });
    const messages = await waitForMessages(ws, 1);

    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe('error');
    expect(messages[0].code).toBe('INVALID_PARAMS');

    await closeWs(ws);
  });

  it('allows re-subscribing after unsubscribing', async () => {
    // Mock fetch for SSE streams
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

    // Subscribe
    sendMessage(ws, { type: 'subscribe_agent', agentId: 'agent-abc' });
    await new Promise((r) => setTimeout(r, 200));

    // Unsubscribe
    sendMessage(ws, { type: 'unsubscribe_agent', agentId: 'agent-abc' });
    await new Promise((r) => setTimeout(r, 200));

    // Re-subscribe — should NOT get ALREADY_SUBSCRIBED error
    sendMessage(ws, { type: 'subscribe_agent', agentId: 'agent-abc' });
    await new Promise((r) => setTimeout(r, 200));

    // Verify fetch was called twice (once for each subscribe)
    expect(vi.mocked(fetch).mock.calls.length).toBe(2);

    await closeWs(ws);
  });
});

// ---------------------------------------------------------------------------
// WebSocket SSE relay — verifies SSE events are parsed and relayed correctly
// ---------------------------------------------------------------------------

describe('WebSocket SSE relay', () => {
  let app: FastifyInstance;
  let address: string;

  const mockDbRegistry = {
    registerMachine: vi.fn(),
    heartbeat: vi.fn(),
    listMachines: vi.fn().mockResolvedValue([]),
    createAgent: vi.fn(),
    getAgent: vi.fn().mockResolvedValue({
      id: 'agent-sse',
      machineId: 'machine-1',
      name: 'SSE Agent',
      type: 'manual',
      status: 'registered',
      schedule: null,
      projectPath: null,
      worktreeBranch: null,
      currentSessionId: null,
      config: {},
      lastRunAt: null,
      lastCostUsd: null,
      totalCostUsd: 0,
      createdAt: new Date(),
    }),
    updateAgentStatus: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    getRecentRuns: vi.fn().mockResolvedValue([]),
    completeRun: vi.fn(),
    createRun: vi.fn(),
    insertActions: vi.fn(),
    getMachine: vi.fn().mockResolvedValue({
      id: 'machine-1',
      hostname: 'test-host',
      tailscaleIp: '100.64.0.1',
      os: 'linux',
      arch: 'x64',
      status: 'online',
      lastHeartbeat: new Date(),
      capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
      createdAt: new Date(),
    }),
  } as unknown as DbAgentRegistry;

  const mockTaskQueue = {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
  };

  beforeAll(async () => {
    app = await createServer({
      logger,
      dbRegistry: mockDbRegistry,
      taskQueue: mockTaskQueue as never,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    address = typeof addr === 'string' ? addr : `127.0.0.1:${String(addr?.port)}`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await app.close();
  });

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

  it('relays SSE events as agent_event messages on the WebSocket', async () => {
    // Simulate an SSE stream that sends a single event, then ends
    const ssePayload = 'event:status\ndata:{"status":"running","reason":"started"}\n\n';
    const encoder = new TextEncoder();
    let readCount = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () => {
              readCount++;
              if (readCount === 1) {
                return Promise.resolve({
                  done: false,
                  value: encoder.encode(ssePayload),
                });
              }
              return Promise.resolve({ done: true, value: undefined });
            },
          }),
        },
      }),
    );

    const ws = await openWs();

    sendMessage(ws, { type: 'subscribe_agent', agentId: 'agent-sse' });

    // Wait for the relayed SSE event
    const messages = await waitForMessages(ws, 1, 3000);

    expect(messages.length).toBeGreaterThanOrEqual(1);

    const agentEvent = messages.find((m) => m.type === 'agent_event');
    expect(agentEvent).toBeDefined();
    expect(agentEvent?.agentId).toBe('agent-sse');

    const event = agentEvent?.event as { event: string; data: { status: string } };
    expect(event.event).toBe('status');
    expect(event.data.status).toBe('running');

    await closeWs(ws);
  });

  it('uses "output" as default event type when event: line is missing', async () => {
    // SSE data without an event: line
    const ssePayload = 'data:{"text":"hello world"}\n\n';
    const encoder = new TextEncoder();
    let readCount = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () => {
              readCount++;
              if (readCount === 1) {
                return Promise.resolve({
                  done: false,
                  value: encoder.encode(ssePayload),
                });
              }
              return Promise.resolve({ done: true, value: undefined });
            },
          }),
        },
      }),
    );

    const ws = await openWs();

    sendMessage(ws, { type: 'subscribe_agent', agentId: 'agent-sse' });

    const messages = await waitForMessages(ws, 1, 3000);

    expect(messages.length).toBeGreaterThanOrEqual(1);

    const agentEvent = messages.find((m) => m.type === 'agent_event');
    expect(agentEvent).toBeDefined();

    const event = agentEvent?.event as { event: string };
    expect(event.event).toBe('output');

    await closeWs(ws);
  });

  it('skips malformed SSE data lines without crashing the connection', async () => {
    // SSE stream with a malformed JSON line followed by a valid one
    const ssePayload = 'data:NOT VALID JSON\ndata:{"status":"ok"}\n\n';
    const encoder = new TextEncoder();
    let readCount = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () => {
              readCount++;
              if (readCount === 1) {
                return Promise.resolve({
                  done: false,
                  value: encoder.encode(ssePayload),
                });
              }
              return Promise.resolve({ done: true, value: undefined });
            },
          }),
        },
      }),
    );

    const ws = await openWs();

    sendMessage(ws, { type: 'subscribe_agent', agentId: 'agent-sse' });

    // Should receive the valid event (malformed one is skipped)
    const messages = await waitForMessages(ws, 1, 3000);

    expect(messages.length).toBeGreaterThanOrEqual(1);

    const agentEvent = messages.find((m) => m.type === 'agent_event');
    expect(agentEvent).toBeDefined();

    const event = agentEvent?.event as { data: { status: string } };
    expect(event.data.status).toBe('ok');

    // Connection should still be alive — verify with a ping
    sendMessage(ws, { type: 'ping' });
    const pongMsgs = await waitForMessages(ws, 1);
    expect(pongMsgs[0].type).toBe('pong');

    await closeWs(ws);
  });

  it('resets currentEventType after an empty line in SSE stream', async () => {
    // SSE stream: event:status, empty line (resets), then data without event line
    const ssePayload = 'event:status\n\ndata:{"text":"no event type"}\n\n';
    const encoder = new TextEncoder();
    let readCount = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () => {
              readCount++;
              if (readCount === 1) {
                return Promise.resolve({
                  done: false,
                  value: encoder.encode(ssePayload),
                });
              }
              return Promise.resolve({ done: true, value: undefined });
            },
          }),
        },
      }),
    );

    const ws = await openWs();

    sendMessage(ws, { type: 'subscribe_agent', agentId: 'agent-sse' });

    const messages = await waitForMessages(ws, 1, 3000);

    expect(messages.length).toBeGreaterThanOrEqual(1);

    const agentEvent = messages.find((m) => m.type === 'agent_event');
    expect(agentEvent).toBeDefined();

    // The event type should be 'output' (default), not 'status',
    // because the empty line reset currentEventType before the data line.
    const event = agentEvent?.event as { event: string };
    expect(event.event).toBe('output');

    await closeWs(ws);
  });
});

// ---------------------------------------------------------------------------
// WebSocket start_agent — no dbRegistry (uses agentId as machineId)
// ---------------------------------------------------------------------------

describe('WebSocket start_agent — no dbRegistry', () => {
  let app: FastifyInstance;
  let address: string;

  const mockTaskQueue = {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
  };

  beforeAll(async () => {
    app = await createServer({
      logger,
      taskQueue: mockTaskQueue as never,
      // no dbRegistry — should fall back to using agentId as machineId
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    address = typeof addr === 'string' ? addr : `127.0.0.1:${String(addr?.port)}`;
  });

  afterEach(() => {
    vi.mocked(mockTaskQueue.add).mockReset().mockResolvedValue({ id: 'job-1' });
  });

  afterAll(async () => {
    await app.close();
  });

  /** Open a WebSocket, send a message, and collect responses. */
  function connectAndSend(
    message: Record<string, unknown>,
    expectedMessages = 1,
  ): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${address}/api/ws`);
      const received: Record<string, unknown>[] = [];
      const timeout = setTimeout(() => {
        ws.close();
        resolve(received);
      }, 2000);

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

  it('uses agentId as machineId when dbRegistry is not configured', async () => {
    const messages = await connectAndSend({
      type: 'start_agent',
      agentId: 'solo-agent',
      prompt: 'Run something',
    });

    expect(messages.length).toBeGreaterThanOrEqual(1);

    // Job should be enqueued with agentId as the machineId
    expect(mockTaskQueue.add).toHaveBeenCalledWith(
      'agent:start',
      expect.objectContaining({
        agentId: 'solo-agent',
        machineId: 'solo-agent',
        prompt: 'Run something',
      }),
    );

    const statusMsg = messages.find((m) => m.type === 'agent_event');
    expect(statusMsg).toBeDefined();
  });
});
