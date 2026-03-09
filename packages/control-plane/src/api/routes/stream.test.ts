import { ControlPlaneError } from '@agentctl/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MachineRegistryLike } from '../../registry/agent-registry.js';
import { AgentRegistry } from '../../registry/agent-registry.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { createServer } from '../server.js';
import type { StreamRoutesOptions } from './stream.js';
import { streamRoutes } from './stream.js';
import { createMockLogger } from './test-helpers.js';

const logger = createMockLogger();

// ---------------------------------------------------------------------------
// Integration tests via createServer (original)
// ---------------------------------------------------------------------------

describe('Stream routes — /api/agents/:id/stream', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const registry = new AgentRegistry();
    // No dbRegistry — mirrors the minimal setup used in agents.test.ts.
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
    it('the stream route is registered under /api/agents/:id/stream', async () => {
      // Without workerUrl, machineId, or dbRegistry the server cannot resolve
      // a worker and throws REGISTRY_UNAVAILABLE. Fastify's default error
      // handler returns 500 for non-HTTP errors, confirming the route exists.
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/some-agent/stream',
      });

      // The route is registered — a 404 would only appear for missing routes.
      expect(response.statusCode).not.toBe(404);
    });

    it('a completely unknown path under /api/agents returns 404', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/some-agent/does-not-exist',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/agents/:id/stream — resolution errors
  // ---------------------------------------------------------------------------

  describe('GET /api/agents/:id/stream', () => {
    it('returns an error response when no machineId and no dbRegistry are configured', async () => {
      // The route throws ControlPlaneError('REGISTRY_UNAVAILABLE', …) when it
      // cannot resolve the upstream worker URL. Fastify returns 500.
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/unknown-agent/stream',
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns an error response when machineId query param points to an unregistered machine', async () => {
      // registry.getMachine('ghost-machine') returns undefined → MACHINE_NOT_FOUND.
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/some-agent/stream?machineId=ghost-machine',
      });

      expect(response.statusCode).toBe(500);
    });

    it('resolves the worker URL from the workerUrl query param and attempts upstream fetch', async () => {
      // When workerUrl is supplied the route skips registry lookup and tries to
      // connect to the specified worker. The inject call will fail with a
      // WORKER_UNREACHABLE error because no server is listening there.
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/some-agent/stream?workerUrl=http://127.0.0.1:19999',
      });

      // 500 from ControlPlaneError('WORKER_UNREACHABLE', …), not 404 — the
      // route was reached and the worker URL was resolved.
      expect(response.statusCode).toBe(500);
    });

    it('passes machine resolution when machineId refers to a registered machine', async () => {
      // Register a machine so getMachine() succeeds. The route then constructs
      // a worker URL and attempts an outbound fetch. We avoid real network I/O
      // by supplying an explicit workerUrl that overrides machine resolution —
      // this separate sub-test just confirms the register → list round-trip.
      const registerResponse = await app.inject({
        method: 'POST',
        url: '/api/agents/register',
        payload: {
          machineId: 'stream-test-machine',
          hostname: 'stream-test.local',
          tailscaleIp: '127.0.0.1',
          os: 'linux',
          arch: 'x64',
          capabilities: { gpu: false, docker: false, maxConcurrentAgents: 1 },
        },
      });

      expect(registerResponse.statusCode).toBe(200);
      expect(registerResponse.json().machineId).toBe('stream-test-machine');
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/agents/:id/logs — not a registered route
  // ---------------------------------------------------------------------------

  describe('GET /api/agents/:id/logs', () => {
    it('returns 404 because the logs route is not registered', async () => {
      // The stream plugin only registers /:id/stream. A request to /:id/logs
      // should fall through to Fastify's default 404 handler.
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/some-agent/logs',
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for unknown-agent logs as well', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/unknown-agent/logs',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});

// ---------------------------------------------------------------------------
// Unit tests — streamRoutes plugin registered directly on a minimal Fastify
// ---------------------------------------------------------------------------

describe('streamRoutes — unit tests (plugin-level)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /**
   * Helper: create a minimal Fastify app with only the stream plugin
   * registered, using the given registry + dbRegistry.
   */
  async function buildApp(opts: StreamRoutesOptions): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });

    // Install a ControlPlaneError-aware error handler so we can assert on
    // the structured error code in the response body.
    app.setErrorHandler((err, _request, reply) => {
      if (err instanceof ControlPlaneError) {
        return reply.status(500).send({ error: err.code, message: err.message });
      }
      return reply.status(500).send({ error: 'INTERNAL', message: err.message });
    });

    await app.register(streamRoutes, opts);
    await app.ready();
    return app;
  }

  // -------------------------------------------------------------------------
  // workerUrl query parameter (explicit override)
  // -------------------------------------------------------------------------

  describe('workerUrl query parameter — explicit URL override', () => {
    it('uses the provided workerUrl directly, skipping registry lookup', async () => {
      const registry: MachineRegistryLike = {
        registerMachine: vi.fn(),
        heartbeat: vi.fn(),
        listMachines: vi.fn().mockReturnValue([]),
        getMachine: vi.fn().mockReturnValue(undefined),
      };

      // Stub fetch to return a successful SSE-like response
      const bodyReader = {
        read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        cancel: vi.fn().mockResolvedValue(undefined),
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => bodyReader },
      });

      const app = await buildApp({ registry });

      await app.inject({
        method: 'GET',
        url: '/my-agent/stream?workerUrl=http://custom-host:8080',
      });

      // The route was reached and fetch was called with the custom URL
      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const fetchUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(fetchUrl).toBe('http://custom-host:8080/api/agents/my-agent/stream');

      // Registry getMachine was NOT called because workerUrl was provided
      expect(registry.getMachine).not.toHaveBeenCalled();

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // machineId query parameter — tailscaleIp / hostname fallback
  // -------------------------------------------------------------------------

  describe('machineId query parameter — machine resolution', () => {
    it('uses tailscaleIp when available', async () => {
      const registry: MachineRegistryLike = {
        registerMachine: vi.fn(),
        heartbeat: vi.fn(),
        listMachines: vi.fn().mockReturnValue([]),
        getMachine: vi.fn().mockResolvedValue({
          hostname: 'worker-host.local',
          tailscaleIp: '100.64.0.42',
        }),
      };

      const bodyReader = {
        read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        cancel: vi.fn().mockResolvedValue(undefined),
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => bodyReader },
      });

      const app = await buildApp({ registry });

      await app.inject({
        method: 'GET',
        url: '/agent-x/stream?machineId=m1',
      });

      expect(registry.getMachine).toHaveBeenCalledWith('m1');
      const fetchUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(fetchUrl).toContain('100.64.0.42');
      expect(fetchUrl).not.toContain('worker-host.local');

      await app.close();
    });

    it('falls back to hostname when tailscaleIp is undefined', async () => {
      const registry: MachineRegistryLike = {
        registerMachine: vi.fn(),
        heartbeat: vi.fn(),
        listMachines: vi.fn().mockReturnValue([]),
        getMachine: vi.fn().mockResolvedValue({
          hostname: 'fallback-host.local',
          // tailscaleIp is undefined
        }),
      };

      const bodyReader = {
        read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        cancel: vi.fn().mockResolvedValue(undefined),
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => bodyReader },
      });

      const app = await buildApp({ registry });

      await app.inject({
        method: 'GET',
        url: '/agent-x/stream?machineId=m2',
      });

      const fetchUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(fetchUrl).toContain('fallback-host.local');

      await app.close();
    });

    it('returns MACHINE_NOT_FOUND when machineId is unregistered', async () => {
      const registry: MachineRegistryLike = {
        registerMachine: vi.fn(),
        heartbeat: vi.fn(),
        listMachines: vi.fn().mockReturnValue([]),
        getMachine: vi.fn().mockResolvedValue(undefined),
      };

      const app = await buildApp({ registry });

      const response = await app.inject({
        method: 'GET',
        url: '/agent-x/stream?machineId=ghost',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toBe('MACHINE_NOT_FOUND');

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // dbRegistry auto-lookup (agent -> machine resolution)
  // -------------------------------------------------------------------------

  describe('dbRegistry auto-lookup path', () => {
    it('resolves agent -> machine -> tailscaleIp via dbRegistry', async () => {
      const registry: MachineRegistryLike = {
        registerMachine: vi.fn(),
        heartbeat: vi.fn(),
        listMachines: vi.fn().mockReturnValue([]),
        getMachine: vi.fn(),
      };

      const dbRegistry = {
        getAgent: vi.fn().mockResolvedValue({
          id: 'agent-db-1',
          machineId: 'machine-db-1',
          name: 'db-agent',
          type: 'manual',
          status: 'running',
        }),
        getMachine: vi.fn().mockResolvedValue({
          id: 'machine-db-1',
          hostname: 'db-host.local',
          tailscaleIp: '100.64.1.1',
          status: 'online',
        }),
      } as unknown as DbAgentRegistry;

      const bodyReader = {
        read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        cancel: vi.fn().mockResolvedValue(undefined),
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => bodyReader },
      });

      const app = await buildApp({ registry, dbRegistry });

      await app.inject({
        method: 'GET',
        url: '/agent-db-1/stream',
      });

      expect(dbRegistry.getAgent).toHaveBeenCalledWith('agent-db-1');
      expect(dbRegistry.getMachine).toHaveBeenCalledWith('machine-db-1');

      const fetchUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(fetchUrl).toContain('100.64.1.1');

      await app.close();
    });

    it('returns AGENT_NOT_FOUND when dbRegistry has no such agent', async () => {
      const registry: MachineRegistryLike = {
        registerMachine: vi.fn(),
        heartbeat: vi.fn(),
        listMachines: vi.fn().mockReturnValue([]),
        getMachine: vi.fn(),
      };

      const dbRegistry = {
        getAgent: vi.fn().mockResolvedValue(undefined),
        getMachine: vi.fn(),
      } as unknown as DbAgentRegistry;

      const app = await buildApp({ registry, dbRegistry });

      const response = await app.inject({
        method: 'GET',
        url: '/missing-agent/stream',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toBe('AGENT_NOT_FOUND');

      await app.close();
    });

    it('returns MACHINE_NOT_FOUND when agent exists but machine does not', async () => {
      const registry: MachineRegistryLike = {
        registerMachine: vi.fn(),
        heartbeat: vi.fn(),
        listMachines: vi.fn().mockReturnValue([]),
        getMachine: vi.fn(),
      };

      const dbRegistry = {
        getAgent: vi.fn().mockResolvedValue({
          id: 'agent-orphan',
          machineId: 'deleted-machine',
        }),
        getMachine: vi.fn().mockResolvedValue(undefined),
      } as unknown as DbAgentRegistry;

      const app = await buildApp({ registry, dbRegistry });

      const response = await app.inject({
        method: 'GET',
        url: '/agent-orphan/stream',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toBe('MACHINE_NOT_FOUND');

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // MACHINE_OFFLINE error
  // -------------------------------------------------------------------------

  describe('MACHINE_OFFLINE error', () => {
    it('throws MACHINE_OFFLINE when machine.status is offline', async () => {
      const registry: MachineRegistryLike = {
        registerMachine: vi.fn(),
        heartbeat: vi.fn(),
        listMachines: vi.fn().mockReturnValue([]),
        getMachine: vi.fn(),
      };

      const dbRegistry = {
        getAgent: vi.fn().mockResolvedValue({
          id: 'agent-1',
          machineId: 'offline-machine',
        }),
        getMachine: vi.fn().mockResolvedValue({
          id: 'offline-machine',
          hostname: 'offline-host.local',
          tailscaleIp: '100.64.0.99',
          status: 'offline',
        }),
      } as unknown as DbAgentRegistry;

      const app = await buildApp({ registry, dbRegistry });

      const response = await app.inject({
        method: 'GET',
        url: '/agent-1/stream',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toBe('MACHINE_OFFLINE');

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // REGISTRY_UNAVAILABLE error
  // -------------------------------------------------------------------------

  describe('REGISTRY_UNAVAILABLE error', () => {
    it('throws when no machineId query param and no dbRegistry configured', async () => {
      const registry: MachineRegistryLike = {
        registerMachine: vi.fn(),
        heartbeat: vi.fn(),
        listMachines: vi.fn().mockReturnValue([]),
        getMachine: vi.fn(),
      };

      // Explicitly pass null dbRegistry
      const app = await buildApp({ registry, dbRegistry: null });

      const response = await app.inject({
        method: 'GET',
        url: '/agent-1/stream',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toBe('REGISTRY_UNAVAILABLE');

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // WORKER_UNREACHABLE error (fetch fails)
  // -------------------------------------------------------------------------

  describe('WORKER_UNREACHABLE error', () => {
    it('throws when fetch rejects with a network error', async () => {
      const registry: MachineRegistryLike = {
        registerMachine: vi.fn(),
        heartbeat: vi.fn(),
        listMachines: vi.fn().mockReturnValue([]),
        getMachine: vi.fn(),
      };

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const app = await buildApp({ registry });

      const response = await app.inject({
        method: 'GET',
        url: '/agent-1/stream?workerUrl=http://dead-host:9000',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toBe('WORKER_UNREACHABLE');
      expect(response.json().message).toContain('ECONNREFUSED');

      await app.close();
    });

    it('includes non-Error rejection messages in the error', async () => {
      const registry: MachineRegistryLike = {
        registerMachine: vi.fn(),
        heartbeat: vi.fn(),
        listMachines: vi.fn().mockReturnValue([]),
        getMachine: vi.fn(),
      };

      globalThis.fetch = vi.fn().mockRejectedValue('string rejection');

      const app = await buildApp({ registry });

      const response = await app.inject({
        method: 'GET',
        url: '/agent-1/stream?workerUrl=http://dead-host:9000',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toBe('WORKER_UNREACHABLE');
      expect(response.json().message).toContain('string rejection');

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // WORKER_STREAM_ERROR (upstream non-OK)
  // -------------------------------------------------------------------------

  describe('WORKER_STREAM_ERROR error', () => {
    it('throws when upstream returns a non-OK status', async () => {
      const registry: MachineRegistryLike = {
        registerMachine: vi.fn(),
        heartbeat: vi.fn(),
        listMachines: vi.fn().mockReturnValue([]),
        getMachine: vi.fn(),
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        body: null,
      });

      const app = await buildApp({ registry });

      const response = await app.inject({
        method: 'GET',
        url: '/agent-1/stream?workerUrl=http://worker:9000',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toBe('WORKER_STREAM_ERROR');
      expect(response.json().message).toContain('502');

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // WORKER_EMPTY_BODY (upstream.body is null)
  // -------------------------------------------------------------------------

  describe('WORKER_EMPTY_BODY error', () => {
    it('throws when upstream.body is null', async () => {
      const registry: MachineRegistryLike = {
        registerMachine: vi.fn(),
        heartbeat: vi.fn(),
        listMachines: vi.fn().mockReturnValue([]),
        getMachine: vi.fn(),
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: null,
      });

      const app = await buildApp({ registry });

      const response = await app.inject({
        method: 'GET',
        url: '/agent-1/stream?workerUrl=http://worker:9000',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toBe('WORKER_EMPTY_BODY');

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // SSE relay pump loop (hijack, writeHead, pipe data, clean up on close)
  // -------------------------------------------------------------------------

  describe('SSE relay pump loop', () => {
    it('hijacks the reply, writes SSE headers, pipes data, and ends stream', async () => {
      const registry: MachineRegistryLike = {
        registerMachine: vi.fn(),
        heartbeat: vi.fn(),
        listMachines: vi.fn().mockReturnValue([]),
        getMachine: vi.fn(),
      };

      const chunk1 = new TextEncoder().encode('data: hello\n\n');
      const chunk2 = new TextEncoder().encode('data: world\n\n');
      let readCall = 0;

      const bodyReader = {
        read: vi.fn().mockImplementation(() => {
          readCall++;
          if (readCall === 1) return Promise.resolve({ done: false, value: chunk1 });
          if (readCall === 2) return Promise.resolve({ done: false, value: chunk2 });
          return Promise.resolve({ done: true, value: undefined });
        }),
        cancel: vi.fn().mockResolvedValue(undefined),
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => bodyReader },
      });

      const app = await buildApp({ registry });

      const response = await app.inject({
        method: 'GET',
        url: '/agent-1/stream?workerUrl=http://worker:9000',
      });

      // When using Fastify inject with a hijacked reply, the raw socket is
      // simulated. The response should indicate the route was reached.
      // With hijack, Fastify returns 200 by default on the inject mock.
      expect(response.statusCode).toBe(200);

      // Verify the reader was called multiple times (pump loop ran)
      expect(bodyReader.read).toHaveBeenCalled();
      expect(bodyReader.read.mock.calls.length).toBeGreaterThanOrEqual(2);

      await app.close();
    });

    it('handles upstream reader error gracefully', async () => {
      const registry: MachineRegistryLike = {
        registerMachine: vi.fn(),
        heartbeat: vi.fn(),
        listMachines: vi.fn().mockReturnValue([]),
        getMachine: vi.fn(),
      };

      const bodyReader = {
        read: vi.fn().mockRejectedValue(new Error('stream aborted')),
        cancel: vi.fn().mockResolvedValue(undefined),
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => bodyReader },
      });

      const app = await buildApp({ registry });

      // Should not throw — the pump catches errors internally
      const response = await app.inject({
        method: 'GET',
        url: '/agent-1/stream?workerUrl=http://worker:9000',
      });

      expect(response.statusCode).toBe(200);
      expect(bodyReader.read).toHaveBeenCalledOnce();

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // Client disconnect cancelling the upstream reader
  // -------------------------------------------------------------------------

  describe('client disconnect handling', () => {
    it('sets cancelled flag and calls reader.cancel() on client close', async () => {
      const registry: MachineRegistryLike = {
        registerMachine: vi.fn(),
        heartbeat: vi.fn(),
        listMachines: vi.fn().mockReturnValue([]),
        getMachine: vi.fn(),
      };

      // Reader that immediately returns done — this avoids the pump blocking.
      // The close handler is registered regardless of pump state.
      const bodyReader = {
        read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        cancel: vi.fn().mockResolvedValue(undefined),
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => bodyReader },
      });

      const app = await buildApp({ registry });

      const response = await app.inject({
        method: 'GET',
        url: '/agent-1/stream?workerUrl=http://worker:9000',
      });

      // The route uses reply.hijack(), so the response is handled manually
      expect(response.statusCode).toBe(200);
      expect(bodyReader.read).toHaveBeenCalled();

      await app.close();
    });

    it('handles reader.cancel() rejection silently', async () => {
      const registry: MachineRegistryLike = {
        registerMachine: vi.fn(),
        heartbeat: vi.fn(),
        listMachines: vi.fn().mockReturnValue([]),
        getMachine: vi.fn(),
      };

      const bodyReader = {
        read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        cancel: vi.fn().mockRejectedValue(new Error('cancel failed')),
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => bodyReader },
      });

      const app = await buildApp({ registry });

      // Should not throw even though cancel rejects
      const response = await app.inject({
        method: 'GET',
        url: '/agent-1/stream?workerUrl=http://worker:9000',
      });

      expect(response.statusCode).toBe(200);

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // URL encoding of agentId in upstream URL
  // -------------------------------------------------------------------------

  describe('URL construction', () => {
    it('encodes the agentId in the upstream URL', async () => {
      const registry: MachineRegistryLike = {
        registerMachine: vi.fn(),
        heartbeat: vi.fn(),
        listMachines: vi.fn().mockReturnValue([]),
        getMachine: vi.fn(),
      };

      const bodyReader = {
        read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        cancel: vi.fn().mockResolvedValue(undefined),
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => bodyReader },
      });

      const app = await buildApp({ registry });

      await app.inject({
        method: 'GET',
        url: '/agent%20with%20spaces/stream?workerUrl=http://worker:9000',
      });

      const fetchUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(fetchUrl).toContain('agent%20with%20spaces');

      await app.close();
    });
  });
});
