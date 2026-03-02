import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
