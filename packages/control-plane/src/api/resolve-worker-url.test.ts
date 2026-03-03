import { ControlPlaneError } from '@agentctl/shared';
import { describe, expect, it, vi } from 'vitest';

import { resolveWorkerUrl, resolveWorkerUrlOrThrow } from './resolve-worker-url.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRegistry(machines: Record<string, { hostname: string; tailscaleIp?: string }>) {
  return {
    getMachine: vi.fn(async (id: string) => machines[id] ?? null),
    registerMachine: vi.fn(),
    listMachines: vi.fn(async () =>
      Object.entries(machines).map(([id, m]) => ({ id, ...m })),
    ),
  };
}

function mockDbRegistry(
  agents: Record<string, { machineId: string }>,
  machines: Record<string, { id: string; hostname: string; tailscaleIp: string; status: string }>,
) {
  return {
    getAgent: vi.fn(async (id: string) => agents[id] ?? null),
    getMachine: vi.fn(async (id: string) => machines[id] ?? null),
    listMachines: vi.fn(async () => Object.values(machines)),
    updateAgentStatus: vi.fn(),
    createAgent: vi.fn(),
  };
}

const WORKER_PORT = 9000;

// ---------------------------------------------------------------------------
// resolveWorkerUrl (result-based)
// ---------------------------------------------------------------------------

describe('resolveWorkerUrl', () => {
  it('returns explicit workerUrl when provided', async () => {
    const result = await resolveWorkerUrl('agent-1', { workerUrl: 'http://custom:8080' }, {
      workerPort: WORKER_PORT,
    });

    expect(result).toEqual({ ok: true, url: 'http://custom:8080' });
  });

  it('resolves via machineId through registry', async () => {
    const registry = mockRegistry({
      'machine-1': { hostname: 'mac-mini', tailscaleIp: '100.64.0.1' },
    });

    const result = await resolveWorkerUrl('agent-1', { machineId: 'machine-1' }, {
      registry,
      workerPort: WORKER_PORT,
    });

    expect(result).toEqual({ ok: true, url: 'http://100.64.0.1:9000' });
    expect(registry.getMachine).toHaveBeenCalledWith('machine-1');
  });

  it('falls back to hostname when tailscaleIp is missing', async () => {
    const registry = mockRegistry({
      'machine-1': { hostname: 'mac-mini' },
    });

    const result = await resolveWorkerUrl('agent-1', { machineId: 'machine-1' }, {
      registry,
      workerPort: WORKER_PORT,
    });

    expect(result).toEqual({ ok: true, url: 'http://mac-mini:9000' });
  });

  it('returns MACHINE_NOT_FOUND when machineId is unknown', async () => {
    const registry = mockRegistry({});

    const result = await resolveWorkerUrl('agent-1', { machineId: 'unknown' }, {
      registry,
      workerPort: WORKER_PORT,
    });

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'MACHINE_NOT_FOUND',
      message: "Machine 'unknown' is not registered",
    });
  });

  it('resolves via dbRegistry agent → machine lookup', async () => {
    const dbRegistry = mockDbRegistry(
      { 'agent-1': { machineId: 'machine-1' } },
      {
        'machine-1': {
          id: 'machine-1',
          hostname: 'ec2-box',
          tailscaleIp: '100.64.0.5',
          status: 'online',
        },
      },
    );

    const result = await resolveWorkerUrl('agent-1', {}, {
      dbRegistry: dbRegistry as never,
      workerPort: WORKER_PORT,
    });

    expect(result).toEqual({ ok: true, url: 'http://100.64.0.5:9000' });
  });

  it('returns AGENT_NOT_FOUND when agent is unknown', async () => {
    const dbRegistry = mockDbRegistry({}, {});

    const result = await resolveWorkerUrl('unknown-agent', {}, {
      dbRegistry: dbRegistry as never,
      workerPort: WORKER_PORT,
    });

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'AGENT_NOT_FOUND',
      message: "Agent 'unknown-agent' does not exist in the registry",
    });
  });

  it('returns MACHINE_OFFLINE when the machine is offline', async () => {
    const dbRegistry = mockDbRegistry(
      { 'agent-1': { machineId: 'machine-1' } },
      {
        'machine-1': {
          id: 'machine-1',
          hostname: 'ec2-box',
          tailscaleIp: '100.64.0.5',
          status: 'offline',
        },
      },
    );

    const result = await resolveWorkerUrl('agent-1', {}, {
      dbRegistry: dbRegistry as never,
      workerPort: WORKER_PORT,
    });

    expect(result).toEqual({
      ok: false,
      status: 503,
      error: 'MACHINE_OFFLINE',
      message: "Machine 'machine-1' (ec2-box) is offline",
    });
  });

  it('returns REGISTRY_UNAVAILABLE when no registry and no machineId', async () => {
    const result = await resolveWorkerUrl('agent-1', {}, {
      workerPort: WORKER_PORT,
    });

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'REGISTRY_UNAVAILABLE',
      message: expect.stringContaining('Cannot resolve worker URL'),
    });
  });

  it('prefers explicit workerUrl over machineId', async () => {
    const registry = mockRegistry({
      'machine-1': { hostname: 'mac-mini', tailscaleIp: '100.64.0.1' },
    });

    const result = await resolveWorkerUrl(
      'agent-1',
      { workerUrl: 'http://override:7777', machineId: 'machine-1' },
      { registry, workerPort: WORKER_PORT },
    );

    expect(result).toEqual({ ok: true, url: 'http://override:7777' });
    expect(registry.getMachine).not.toHaveBeenCalled();
  });

  it('prefers machineId over dbRegistry', async () => {
    const registry = mockRegistry({
      'machine-1': { hostname: 'via-registry', tailscaleIp: '100.64.0.1' },
    });
    const dbRegistry = mockDbRegistry(
      { 'agent-1': { machineId: 'machine-2' } },
      {
        'machine-2': {
          id: 'machine-2',
          hostname: 'via-db',
          tailscaleIp: '100.64.0.2',
          status: 'online',
        },
      },
    );

    const result = await resolveWorkerUrl(
      'agent-1',
      { machineId: 'machine-1' },
      { registry, dbRegistry: dbRegistry as never, workerPort: WORKER_PORT },
    );

    expect(result).toEqual({ ok: true, url: 'http://100.64.0.1:9000' });
    expect(dbRegistry.getAgent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resolveWorkerUrlOrThrow (exception-based wrapper)
// ---------------------------------------------------------------------------

describe('resolveWorkerUrlOrThrow', () => {
  it('returns the URL on success', async () => {
    const url = await resolveWorkerUrlOrThrow('agent-1', { workerUrl: 'http://x:1' }, {
      workerPort: 9000,
    });

    expect(url).toBe('http://x:1');
  });

  it('throws ControlPlaneError on failure', async () => {
    await expect(
      resolveWorkerUrlOrThrow('agent-1', {}, { workerPort: 9000 }),
    ).rejects.toThrow(ControlPlaneError);
  });

  it('includes agentId in the thrown error context', async () => {
    try {
      await resolveWorkerUrlOrThrow('my-agent', {}, { workerPort: 9000 });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ControlPlaneError);
      const cpErr = err as ControlPlaneError;
      expect(cpErr.code).toBe('REGISTRY_UNAVAILABLE');
      expect(cpErr.context).toEqual({ agentId: 'my-agent' });
    }
  });
});
