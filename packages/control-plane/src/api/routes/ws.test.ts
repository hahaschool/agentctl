import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { AgentRegistry } from '../../registry/agent-registry.js';
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
    vi.mocked(mockDbRegistry.listMachines).mockReset().mockResolvedValue([
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
    expect(mockTaskQueue.add).toHaveBeenCalledWith('agent:start', expect.objectContaining({
      agentId: 'my-new-agent',
      machineId: 'machine-1',
      prompt: 'Fix the bug',
    }));

    // Should receive a status event
    const statusMsg = messages.find(
      (m) => m.type === 'agent_event',
    );
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
});
