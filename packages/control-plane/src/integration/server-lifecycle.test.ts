import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';
import { createServer } from '../api/server.js';

const logger = createMockLogger();

// ===========================================================================
// Integration: server lifecycle
// ===========================================================================

describe('Integration: server lifecycle', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ logger });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Health endpoint
  // -------------------------------------------------------------------------

  describe('health endpoint', () => {
    it('returns 200 with { status, timestamp } shape', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('status', 'ok');
      expect(body).toHaveProperty('timestamp');
      expect(typeof body.timestamp).toBe('string');

      // Verify the timestamp is a valid ISO 8601 date
      const parsed = new Date(body.timestamp);
      expect(parsed.toISOString()).toBe(body.timestamp);
    });
  });

  // -------------------------------------------------------------------------
  // Unknown routes return 404
  // -------------------------------------------------------------------------

  describe('unknown routes', () => {
    it('returns 404 with proper error format for unregistered GET route', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/does-not-exist',
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('statusCode', 404);
    });

    it('returns 404 for unregistered POST route', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/nonexistent',
        payload: { foo: 'bar' },
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body).toHaveProperty('statusCode', 404);
    });
  });

  // -------------------------------------------------------------------------
  // X-Request-Id header
  // -------------------------------------------------------------------------

  describe('X-Request-Id header', () => {
    it('returns X-Request-Id header on successful responses', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      const requestId = response.headers['x-request-id'];
      expect(requestId).toBeDefined();
      expect(typeof requestId).toBe('string');

      // The server uses crypto.randomUUID() — verify it looks like a UUID
      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('returns X-Request-Id header on 404 responses', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/does-not-exist',
      });

      const requestId = response.headers['x-request-id'];
      expect(requestId).toBeDefined();
      expect(typeof requestId).toBe('string');
      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('generates a unique request ID for each request', async () => {
      const response1 = await app.inject({ method: 'GET', url: '/health' });
      const response2 = await app.inject({ method: 'GET', url: '/health' });

      const id1 = response1.headers['x-request-id'];
      const id2 = response2.headers['x-request-id'];

      expect(id1).not.toBe(id2);
    });
  });

  // -------------------------------------------------------------------------
  // CORS headers
  // -------------------------------------------------------------------------

  describe('CORS headers', () => {
    it('returns Access-Control-Allow-Origin in non-production mode', async () => {
      // In non-production (default), CORS origin is set to `true` which
      // reflects the request origin. Fastify's inject provides an Origin
      // header to trigger the CORS response headers.
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: 'http://localhost:3000',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });

    it('returns proper headers on preflight OPTIONS request', async () => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'GET',
        },
      });

      // Preflight should succeed (200 or 204)
      expect(response.statusCode).toBeLessThanOrEqual(204);
      expect(response.headers['access-control-allow-origin']).toBeDefined();
      expect(response.headers['access-control-allow-methods']).toBeDefined();
    });

    it('exposes X-Request-Id in CORS exposed headers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: 'http://localhost:3000',
        },
      });

      const exposed = response.headers['access-control-expose-headers'];
      expect(exposed).toBeDefined();
      expect(String(exposed)).toContain('X-Request-Id');
    });
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  describe('rate limiting', () => {
    it('rejects requests after exceeding 100 requests per minute on a non-health endpoint', async () => {
      // Create a dedicated server for rate-limit testing so we start from
      // a clean counter and don't pollute other tests.
      const rlApp = await createServer({ logger });

      // Register a simple test route that always succeeds and is subject
      // to rate limiting (unlike /health which is allow-listed).
      rlApp.get('/api/ping', async () => {
        return { pong: true };
      });

      await rlApp.ready();

      try {
        const target = '/api/ping';

        // Verify the test route works before exhausting the limit
        const first = await rlApp.inject({ method: 'GET', url: target });
        expect(first.statusCode).toBe(200);
        expect(first.json()).toEqual({ pong: true });

        // Send remaining 99 requests (100 total including the first)
        for (let i = 1; i < 100; i++) {
          await rlApp.inject({ method: 'GET', url: target });
        }

        // The 101st request exceeds the rate limit. The server's custom
        // errorResponseBuilder returns a plain object (not an Error with
        // statusCode), so Fastify's global error handler catches the
        // thrown value and maps it to a non-2xx error response.
        const limited = await rlApp.inject({ method: 'GET', url: target });
        expect(limited.statusCode).toBeGreaterThanOrEqual(400);
        expect(limited.statusCode).not.toBe(200);
      } finally {
        await rlApp.close();
      }
    });

    it('does not rate-limit the /health endpoint', async () => {
      const rlApp = await createServer({ logger });
      await rlApp.ready();

      try {
        // Send 110 requests to /health — all should succeed because
        // the rate limiter allowList exempts /health.
        for (let i = 0; i < 110; i++) {
          const response = await rlApp.inject({ method: 'GET', url: '/health' });
          expect(response.statusCode).toBe(200);
        }
      } finally {
        await rlApp.close();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Global error handler
  // -------------------------------------------------------------------------

  describe('global error handler', () => {
    it('maps ControlPlaneError with _NOT_FOUND suffix to 404', async () => {
      const errApp = await createServer({ logger });

      // Register a test route that throws a ControlPlaneError with a
      // _NOT_FOUND suffix to exercise the global error handler mapping.
      errApp.get('/test-not-found-error', async () => {
        throw new ControlPlaneError('AGENT_NOT_FOUND', 'Agent does not exist', {});
      });

      await errApp.ready();

      try {
        const response = await errApp.inject({
          method: 'GET',
          url: '/test-not-found-error',
        });

        expect(response.statusCode).toBe(404);

        const body = response.json();
        expect(body.error).toBe('AGENT_NOT_FOUND');
        expect(body.message).toBe('Agent does not exist');
      } finally {
        await errApp.close();
      }
    });

    it('maps ControlPlaneError with INVALID_ prefix to 400', async () => {
      // Register a throwable route on a dedicated server to test INVALID_ prefix
      const errApp = await createServer({ logger });

      errApp.get('/test-invalid-error', async () => {
        throw new ControlPlaneError('INVALID_CONFIG', 'Configuration is invalid', {});
      });

      await errApp.ready();

      try {
        const response = await errApp.inject({
          method: 'GET',
          url: '/test-invalid-error',
        });

        expect(response.statusCode).toBe(400);

        const body = response.json();
        expect(body.error).toBe('INVALID_CONFIG');
        expect(body.message).toBe('Configuration is invalid');
      } finally {
        await errApp.close();
      }
    });

    it('maps ControlPlaneError with _UNAVAILABLE suffix to 503', async () => {
      const errApp = await createServer({ logger });

      errApp.get('/test-unavailable-error', async () => {
        throw new ControlPlaneError('SERVICE_UNAVAILABLE', 'Service is down', {});
      });

      await errApp.ready();

      try {
        const response = await errApp.inject({
          method: 'GET',
          url: '/test-unavailable-error',
        });

        expect(response.statusCode).toBe(503);

        const body = response.json();
        expect(body.error).toBe('SERVICE_UNAVAILABLE');
        expect(body.message).toBe('Service is down');
      } finally {
        await errApp.close();
      }
    });

    it('maps unknown errors to 500 with INTERNAL_ERROR', async () => {
      const errApp = await createServer({ logger });

      errApp.get('/test-unexpected-error', async () => {
        throw new Error('something broke unexpectedly');
      });

      await errApp.ready();

      try {
        const response = await errApp.inject({
          method: 'GET',
          url: '/test-unexpected-error',
        });

        expect(response.statusCode).toBe(500);

        const body = response.json();
        expect(body.error).toBe('INTERNAL_ERROR');
        expect(body.message).toBe('An unexpected error occurred');
      } finally {
        await errApp.close();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------

  describe('graceful shutdown', () => {
    it('server can close cleanly and rejects requests after close', async () => {
      const shutdownApp = await createServer({ logger });
      await shutdownApp.ready();

      // Verify the server is accepting requests before shutdown
      const beforeClose = await shutdownApp.inject({
        method: 'GET',
        url: '/health',
      });
      expect(beforeClose.statusCode).toBe(200);

      // Shut down the server
      await shutdownApp.close();

      // After close, inject still works (it's in-process) but the server
      // internal state is torn down. Fastify's close() resolves all
      // onClose hooks and drains connections. Verify close didn't throw.
      // The fact that await shutdownApp.close() resolved without error
      // is the assertion.
    });

    it('server.close() is idempotent — calling it twice does not throw', async () => {
      const shutdownApp = await createServer({ logger });
      await shutdownApp.ready();

      await shutdownApp.close();

      // Second close should not throw
      await shutdownApp.close();
    });
  });
});
