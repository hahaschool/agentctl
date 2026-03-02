import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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

// ---------------------------------------------------------------------------
// Tests WITHOUT dbRegistry -- REGISTRY_UNAVAILABLE is expected
// ---------------------------------------------------------------------------

describe('Emergency stop proxy routes -- without dbRegistry', () => {
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

  it('POST /api/agents/:id/emergency-stop returns 500 when no resolution method is available', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/emergency-stop',
    });

    expect(response.statusCode).toBe(500);

    const body = response.json();
    expect(body.error).toBe('REGISTRY_UNAVAILABLE');
  });

  it('POST /api/agents/:id/emergency-stop returns 404 when machineId is not found in registry', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/emergency-stop?machineId=unknown-machine',
    });

    expect(response.statusCode).toBe(404);

    const body = response.json();
    expect(body.error).toBe('MACHINE_NOT_FOUND');
  });

  it('POST /api/agents/:id/emergency-stop returns 502 when worker is unreachable', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/emergency-stop?workerUrl=http://127.0.0.1:19999',
    });

    expect(response.statusCode).toBe(502);

    const body = response.json();
    expect(body.error).toBe('WORKER_UNREACHABLE');
  });

  it('POST /api/agents/emergency-stop-all returns 200 with empty results when no machines registered', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/emergency-stop-all',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests WITH dbRegistry -- agent resolution via database
// ---------------------------------------------------------------------------

describe('Emergency stop proxy routes -- with dbRegistry', () => {
  let app: FastifyInstance;

  const mockDbRegistry = {
    registerMachine: vi.fn(),
    heartbeat: vi.fn(),
    listMachines: vi.fn().mockResolvedValue([
      {
        id: 'machine-1',
        hostname: 'worker-host.local',
        tailscaleIp: '127.0.0.1',
        os: 'linux',
        arch: 'x64',
        status: 'online',
        lastHeartbeat: new Date(),
        capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
        createdAt: new Date(),
      },
    ]),
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
    vi.mocked(mockDbRegistry.updateAgentStatus).mockReset();
    vi.mocked(mockDbRegistry.listMachines)
      .mockReset()
      .mockResolvedValue([
        {
          id: 'machine-1',
          hostname: 'worker-host.local',
          tailscaleIp: '127.0.0.1',
          os: 'linux',
          arch: 'x64',
          status: 'online',
          lastHeartbeat: new Date(),
          capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
          createdAt: new Date(),
        },
      ] as never);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/agents/:id/emergency-stop resolves via dbRegistry and returns 502 when worker is down', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/emergency-stop',
    });

    // Worker is not actually running, so fetch() will fail
    expect(response.statusCode).toBe(502);

    const body = response.json();
    expect(body.error).toBe('WORKER_UNREACHABLE');

    // Verify the registry was consulted
    expect(mockDbRegistry.getAgent).toHaveBeenCalledWith('agent-1');
    expect(mockDbRegistry.getMachine).toHaveBeenCalledWith('machine-1');
  });

  it('returns 404 when agent is not found in dbRegistry', async () => {
    vi.mocked(mockDbRegistry.getAgent).mockResolvedValueOnce(undefined as never);

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/ghost/emergency-stop',
    });

    expect(response.statusCode).toBe(404);

    const body = response.json();
    expect(body.error).toBe('AGENT_NOT_FOUND');
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
      method: 'POST',
      url: '/api/agents/agent-1/emergency-stop',
    });

    expect(response.statusCode).toBe(503);

    const body = response.json();
    expect(body.error).toBe('MACHINE_OFFLINE');
  });

  it('resolves via explicit workerUrl query param, bypassing registry', async () => {
    vi.mocked(mockDbRegistry.getAgent).mockClear();
    vi.mocked(mockDbRegistry.getMachine).mockClear();

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/emergency-stop?workerUrl=http://127.0.0.1:19999',
    });

    // Worker unreachable (no server at that address)
    expect(response.statusCode).toBe(502);

    const body = response.json();
    expect(body.error).toBe('WORKER_UNREACHABLE');

    // dbRegistry should NOT have been consulted since workerUrl was provided
    expect(mockDbRegistry.getAgent).not.toHaveBeenCalled();
    expect(mockDbRegistry.getMachine).not.toHaveBeenCalled();
  });

  it('POST /api/agents/emergency-stop-all fans out to all online machines', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/emergency-stop-all',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.results)).toBe(true);

    // There should be one result for the single mocked machine
    expect(body.results).toHaveLength(1);

    // The worker is not running, so the result should have an error
    const machineResult = body.results[0];
    expect(machineResult.machineId).toBe('machine-1');
    expect(machineResult.error).toBeDefined();
  });

  it('POST /api/agents/emergency-stop-all skips offline machines', async () => {
    vi.mocked(mockDbRegistry.listMachines).mockResolvedValueOnce([
      {
        id: 'machine-online',
        hostname: 'host-online.local',
        tailscaleIp: '127.0.0.1',
        os: 'linux',
        arch: 'x64',
        status: 'online',
        lastHeartbeat: new Date(),
        capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
        createdAt: new Date(),
      },
      {
        id: 'machine-offline',
        hostname: 'host-offline.local',
        tailscaleIp: '127.0.0.2',
        os: 'linux',
        arch: 'x64',
        status: 'offline',
        lastHeartbeat: new Date(),
        capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
        createdAt: new Date(),
      },
    ] as never);

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/emergency-stop-all',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.results).toHaveLength(2);

    // The offline machine should report machine_offline
    const offlineResult = body.results.find(
      (r: { machineId: string }) => r.machineId === 'machine-offline',
    );
    expect(offlineResult).toBeDefined();
    expect(offlineResult.stoppedCount).toBe(0);
    expect(offlineResult.error).toBe('machine_offline');
  });
});
