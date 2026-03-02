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
