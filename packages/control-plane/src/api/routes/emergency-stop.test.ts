import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentRegistry } from '../../registry/agent-registry.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { createServer } from '../server.js';
import { createMockLogger } from './test-helpers.js';

const logger = createMockLogger();

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

  it('resolves worker URL via machineId when machine is found in in-memory registry', async () => {
    // Use 127.0.0.1 to avoid DNS lookup hangs on non-existent hostnames.
    registry.registerMachine('mac-mini-1', '127.0.0.1');

    // Mock fetch to simulate an unreachable worker so the test is
    // deterministic regardless of whether anything is listening on the
    // resolved port locally.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-1/emergency-stop?machineId=mac-mini-1',
      });

      // Worker is not actually running, so we get 502 (unreachable) —
      // but the key is that machineId resolution succeeded (no 404).
      expect(response.statusCode).toBe(502);

      const body = response.json();
      expect(body.error).toBe('WORKER_UNREACHABLE');
      expect(body.message).toContain('127.0.0.1');
    } finally {
      globalThis.fetch = originalFetch;
    }
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
    // Mock fetch to simulate an unreachable worker so the test is
    // deterministic regardless of whether anything is listening on the
    // resolved port locally.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    try {
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
    } finally {
      globalThis.fetch = originalFetch;
    }
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
    // Mock fetch to simulate an unreachable worker so the test is
    // deterministic regardless of whether anything is listening on the
    // resolved port locally.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    try {
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
    } finally {
      globalThis.fetch = originalFetch;
    }
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

  // ---------------------------------------------------------------------------
  // resolveWorkerUrl — machine found via machineId query param (with dbRegistry)
  // ---------------------------------------------------------------------------

  it('resolves via machineId query param using the in-memory registry', async () => {
    // When machineId is provided, it uses the registry (not dbRegistry).
    // We need a machine registered in the registry. But the registry here is
    // created by createServer internally. The machineId code path uses
    // opts.registry.getMachine(), which is the AgentRegistry created in server.
    // Since we didn't provide an external registry, the server creates one.
    // The internal registry is empty, so getMachine returns undefined -> 404.
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/emergency-stop?machineId=unknown',
    });

    expect(response.statusCode).toBe(404);

    const body = response.json();
    expect(body.error).toBe('MACHINE_NOT_FOUND');
  });

  // ---------------------------------------------------------------------------
  // resolveWorkerUrl — machine not found via dbRegistry.getMachine
  // ---------------------------------------------------------------------------

  it('returns 404 when machine for agent is not found in dbRegistry', async () => {
    vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(undefined as never);

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/emergency-stop',
    });

    expect(response.statusCode).toBe(404);

    const body = response.json();
    expect(body.error).toBe('MACHINE_NOT_FOUND');
    expect(body.message).toContain('machine-1');
    expect(body.message).toContain('agent-1');
  });

  // ---------------------------------------------------------------------------
  // DB updateAgentStatus failure — best-effort catch
  // ---------------------------------------------------------------------------

  it('still succeeds when dbRegistry.updateAgentStatus throws (best-effort update)', async () => {
    // We need a successful proxy response. Mock global fetch for this test.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ stopped: true, agentId: 'agent-1' }),
    });

    vi.mocked(mockDbRegistry.updateAgentStatus).mockRejectedValueOnce(new Error('DB write failed'));

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-1/emergency-stop',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.stopped).toBe(true);

      // updateAgentStatus was called but failed — should be best-effort
      expect(mockDbRegistry.updateAgentStatus).toHaveBeenCalledWith('agent-1', 'stopped');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ---------------------------------------------------------------------------
  // Successful proxy response forwarding
  // ---------------------------------------------------------------------------

  it('forwards the worker response status and data on successful proxy', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ stopped: true, agentId: 'agent-1', pid: 12345 }),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-1/emergency-stop',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.stopped).toBe(true);
      expect(body.agentId).toBe('agent-1');
      expect(body.pid).toBe(12345);

      // Verify updateAgentStatus was called for the success path
      expect(mockDbRegistry.updateAgentStatus).toHaveBeenCalledWith('agent-1', 'stopped');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ---------------------------------------------------------------------------
  // emergency-stop-all — machine ID fallback (machineId then hostname)
  // ---------------------------------------------------------------------------

  it('uses machineId as fallback when id is not present in machine record', async () => {
    vi.mocked(mockDbRegistry.listMachines).mockResolvedValueOnce([
      {
        machineId: 'machine-alt',
        hostname: 'host-alt.local',
        tailscaleIp: '127.0.0.1',
        os: 'linux',
        arch: 'x64',
        status: 'online',
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
    expect(body.results).toHaveLength(1);
    expect(body.results[0].machineId).toBe('machine-alt');
  });

  it('uses hostname as fallback when neither id nor machineId is present', async () => {
    vi.mocked(mockDbRegistry.listMachines).mockResolvedValueOnce([
      {
        hostname: 'host-only.local',
        tailscaleIp: '127.0.0.1',
        os: 'linux',
        arch: 'x64',
        status: 'online',
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
    expect(body.results).toHaveLength(1);
    expect(body.results[0].machineId).toBe('host-only.local');
  });

  // ---------------------------------------------------------------------------
  // emergency-stop-all — machine without tailscaleIp (hostname fallback)
  // ---------------------------------------------------------------------------

  it('falls back to hostname when machine has no tailscaleIp in stop-all', async () => {
    vi.mocked(mockDbRegistry.listMachines).mockResolvedValueOnce([
      {
        id: 'machine-no-ts',
        hostname: '127.0.0.1',
        os: 'linux',
        arch: 'x64',
        status: 'online',
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
    expect(body.results).toHaveLength(1);
    // Should use hostname as address since tailscaleIp is missing
    expect(body.results[0].machineId).toBe('machine-no-ts');
  });

  // ---------------------------------------------------------------------------
  // emergency-stop-all — successful proxy response with stoppedCount
  // ---------------------------------------------------------------------------

  it('reports stoppedCount from successful worker responses in stop-all', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ stoppedCount: 3 }),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/emergency-stop-all',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.results).toHaveLength(1);
      expect(body.results[0].stoppedCount).toBe(3);
      expect(body.results[0].error).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('defaults stoppedCount to 0 when worker response omits it in stop-all', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/emergency-stop-all',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.results).toHaveLength(1);
      expect(body.results[0].stoppedCount).toBe(0);
      expect(body.results[0].error).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ---------------------------------------------------------------------------
  // proxyEmergencyStop — non-Error throw
  // ---------------------------------------------------------------------------

  it('handles non-Error throws from fetch in emergency stop proxy', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue('string-error');

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-1/emergency-stop',
      });

      expect(response.statusCode).toBe(502);

      const body = response.json();
      expect(body.error).toBe('WORKER_UNREACHABLE');
      expect(body.message).toContain('string-error');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
