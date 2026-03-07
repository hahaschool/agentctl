import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentRegistry } from '../../registry/agent-registry.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { createServer } from '../server.js';
import { createMockLogger } from './test-helpers.js';

const logger = createMockLogger();

// ---------------------------------------------------------------------------
// Tests WITHOUT dbRegistry — REGISTRY_UNAVAILABLE is expected
// ---------------------------------------------------------------------------

describe('Loop proxy routes — without dbRegistry', () => {
  let app: FastifyInstance;
  let registry: AgentRegistry;

  beforeAll(async () => {
    registry = new AgentRegistry();
    app = await createServer({ logger, registry });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/agents/:id/loop returns 500 when no resolution method is available', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/loop',
      payload: {
        prompt: 'Start iterating',
        config: { mode: 'result-feedback', maxIterations: 5 },
      },
    });

    expect(response.statusCode).toBe(500);

    const body = response.json();
    expect(body.error).toBe('REGISTRY_UNAVAILABLE');
  });

  it('GET /api/agents/:id/loop returns 500 when no resolution method is available', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/agents/agent-1/loop',
    });

    expect(response.statusCode).toBe(500);

    const body = response.json();
    expect(body.error).toBe('REGISTRY_UNAVAILABLE');
  });

  it('PUT /api/agents/:id/loop returns 500 when no resolution method is available', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/agents/agent-1/loop',
      payload: { action: 'pause' },
    });

    expect(response.statusCode).toBe(500);

    const body = response.json();
    expect(body.error).toBe('REGISTRY_UNAVAILABLE');
  });

  it('DELETE /api/agents/:id/loop returns 500 when no resolution method is available', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/agents/agent-1/loop',
    });

    expect(response.statusCode).toBe(500);

    const body = response.json();
    expect(body.error).toBe('REGISTRY_UNAVAILABLE');
  });

  it('POST /api/agents/:id/loop returns 404 when machineId is not found in registry', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/loop?machineId=unknown-machine',
      payload: {
        prompt: 'Start iterating',
        config: { mode: 'result-feedback', maxIterations: 5 },
      },
    });

    expect(response.statusCode).toBe(404);

    const body = response.json();
    expect(body.error).toBe('MACHINE_NOT_FOUND');
  });

  it('POST /api/agents/:id/loop returns 502 when worker is unreachable', async () => {
    // Register a machine so resolution succeeds, but the worker is not running.
    await app.inject({
      method: 'POST',
      url: '/api/agents/register',
      payload: {
        machineId: 'loop-test-machine',
        hostname: 'loop-host.local',
        tailscaleIp: '127.0.0.1',
        os: 'linux',
        arch: 'x64',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/loop?workerUrl=http://127.0.0.1:19999',
      payload: {
        prompt: 'Start iterating',
        config: { mode: 'result-feedback', maxIterations: 5 },
      },
    });

    expect(response.statusCode).toBe(502);

    const body = response.json();
    expect(body.error).toBe('WORKER_UNREACHABLE');
  });
});

// ---------------------------------------------------------------------------
// Tests WITH dbRegistry — agent resolution via database
// ---------------------------------------------------------------------------

describe('Loop proxy routes — with dbRegistry', () => {
  let app: FastifyInstance;

  const mockDbRegistry = {
    registerMachine: vi.fn(),
    heartbeat: vi.fn(),
    listMachines: vi.fn().mockResolvedValue([]),
    createAgent: vi.fn().mockResolvedValue('agent-new'),
    getAgent: vi.fn().mockResolvedValue({
      id: 'agent-1',
      machineId: 'machine-1',
      name: 'Test Agent',
      config: { model: 'claude-sonnet-4-20250514' },
    }),
    updateAgentStatus: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    getRecentRuns: vi.fn().mockResolvedValue([]),
    completeRun: vi.fn().mockResolvedValue(undefined),
    createRun: vi.fn().mockResolvedValue('run-001'),
    insertActions: vi.fn(),
    getMachine: vi.fn().mockResolvedValue({
      id: 'machine-1',
      hostname: 'worker-host.local',
      tailscaleIp: '127.0.0.1',
      os: 'linux',
      arch: 'x64',
      status: 'online',
      lastHeartbeat: new Date(),
      capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
      createdAt: new Date(),
    }),
  } as unknown as DbAgentRegistry;

  beforeAll(async () => {
    app = await createServer({
      logger,
      dbRegistry: mockDbRegistry,
      workerPort: 19999,
    });
    await app.ready();
  });

  afterEach(() => {
    vi.mocked(mockDbRegistry.getAgent)
      .mockReset()
      .mockResolvedValue({
        id: 'agent-1',
        machineId: 'machine-1',
        name: 'Test Agent',
        config: { model: 'claude-sonnet-4-20250514' },
      } as never);
    vi.mocked(mockDbRegistry.getMachine)
      .mockReset()
      .mockResolvedValue({
        id: 'machine-1',
        hostname: 'worker-host.local',
        tailscaleIp: '127.0.0.1',
        os: 'linux',
        arch: 'x64',
        status: 'online',
        lastHeartbeat: new Date(),
        capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
        createdAt: new Date(),
      } as never);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/agents/:id/loop resolves via dbRegistry and returns 502 when worker is down', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/loop',
      payload: {
        prompt: 'Iterate on code',
        config: { mode: 'result-feedback', maxIterations: 5 },
      },
    });

    // The worker is not actually running, so fetch() will fail with WORKER_UNREACHABLE
    expect(response.statusCode).toBe(502);

    const body = response.json();
    expect(body.error).toBe('WORKER_UNREACHABLE');

    // Verify the registry was consulted for the agent and machine
    expect(mockDbRegistry.getAgent).toHaveBeenCalledWith('agent-1');
    expect(mockDbRegistry.getMachine).toHaveBeenCalledWith('machine-1');
  });

  it('GET /api/agents/:id/loop resolves via dbRegistry and returns 502', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/agents/agent-1/loop',
    });

    expect(response.statusCode).toBe(502);

    const body = response.json();
    expect(body.error).toBe('WORKER_UNREACHABLE');
  });

  it('DELETE /api/agents/:id/loop resolves via dbRegistry and returns 502', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/agents/agent-1/loop',
    });

    expect(response.statusCode).toBe(502);

    const body = response.json();
    expect(body.error).toBe('WORKER_UNREACHABLE');
  });

  it('returns 404 when agent is not found in dbRegistry', async () => {
    vi.mocked(mockDbRegistry.getAgent).mockResolvedValueOnce(undefined as never);

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/ghost/loop',
      payload: {
        prompt: 'Do work',
        config: { mode: 'result-feedback', maxIterations: 3 },
      },
    });

    expect(response.statusCode).toBe(404);

    const body = response.json();
    expect(body.error).toBe('AGENT_NOT_FOUND');
  });

  it('POST /api/agents/:id/loop returns 400 when prompt is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/loop',
      payload: { config: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_PROMPT');
  });

  it('POST /api/agents/:id/loop returns 400 when prompt is empty', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/loop',
      payload: { prompt: '', config: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_PROMPT');
  });

  it('POST /api/agents/:id/loop returns 400 when prompt exceeds 32000 chars', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/loop',
      payload: { prompt: 'x'.repeat(32_001), config: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('PROMPT_TOO_LONG');
  });

  it('POST /api/agents/:id/loop returns 400 when config is not an object', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/loop',
      payload: { prompt: 'Do work', config: 'not-an-object' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_CONFIG');
  });

  it('POST /api/agents/:id/loop returns 400 when config is an array', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/loop',
      payload: { prompt: 'Do work', config: [1, 2, 3] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_CONFIG');
  });

  it('PUT /api/agents/:id/loop returns 400 for invalid action', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/agents/agent-1/loop',
      payload: { action: 'invalid' },
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();
    expect(body.error).toBe('INVALID_ACTION');
    expect(body.message).toContain('invalid');
  });

  it('PUT /api/agents/:id/loop accepts pause action and proxies to worker', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/agents/agent-1/loop',
      payload: { action: 'pause' },
    });

    // Validation passes — reaches the proxy step which returns 502 (worker not running)
    expect(response.statusCode).toBe(502);

    const body = response.json();
    expect(body.error).toBe('WORKER_UNREACHABLE');
  });

  it('PUT /api/agents/:id/loop accepts resume action and proxies to worker', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/agents/agent-1/loop',
      payload: { action: 'resume' },
    });

    // Validation passes — reaches the proxy step which returns 502 (worker not running)
    expect(response.statusCode).toBe(502);

    const body = response.json();
    expect(body.error).toBe('WORKER_UNREACHABLE');
  });

  it('returns 503 when machine is offline', async () => {
    vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce({
      id: 'machine-1',
      hostname: 'dead-host',
      tailscaleIp: '127.0.0.1',
      os: 'linux',
      arch: 'x64',
      status: 'offline',
      lastHeartbeat: new Date(),
      capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
      createdAt: new Date(),
    } as never);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/agents/agent-1/loop',
      payload: { action: 'pause' },
    });

    expect(response.statusCode).toBe(503);

    const body = response.json();
    expect(body.error).toBe('MACHINE_OFFLINE');
  });

  it('resolves via explicit workerUrl query param, bypassing registry', async () => {
    // Reset mocks to verify they are NOT called
    vi.mocked(mockDbRegistry.getAgent).mockClear();
    vi.mocked(mockDbRegistry.getMachine).mockClear();

    const response = await app.inject({
      method: 'GET',
      url: '/api/agents/agent-1/loop?workerUrl=http://127.0.0.1:19999',
    });

    // Worker unreachable (no server at that address)
    expect(response.statusCode).toBe(502);

    const body = response.json();
    expect(body.error).toBe('WORKER_UNREACHABLE');

    // dbRegistry should NOT have been consulted since workerUrl was provided
    expect(mockDbRegistry.getAgent).not.toHaveBeenCalled();
    expect(mockDbRegistry.getMachine).not.toHaveBeenCalled();
  });
});
