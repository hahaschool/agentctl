import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockLogger } from './routes/test-helpers.js';
import { createServer } from './server.js';

const logger = createMockLogger();

// ===========================================================================
// Production CORS behaviour
// ===========================================================================

describe('CORS in production mode', () => {
  it('blocks requests with unknown origin when corsOrigins is set', async () => {
    const app = await createServer({
      logger,
      isProduction: true,
      corsOrigins: 'https://app.agentctl.dev,https://admin.agentctl.dev',
    });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'https://evil.example.com' },
      });

      // The request still succeeds (CORS doesn't block server-side),
      // but the Access-Control-Allow-Origin header should NOT reflect
      // the disallowed origin.
      expect(response.statusCode).toBe(200);
      const acao = response.headers['access-control-allow-origin'];
      expect(acao).not.toBe('https://evil.example.com');
    } finally {
      await app.close();
    }
  });

  it('allows requests from whitelisted origins', async () => {
    const app = await createServer({
      logger,
      isProduction: true,
      corsOrigins: 'https://app.agentctl.dev,https://admin.agentctl.dev',
    });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'https://app.agentctl.dev' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('https://app.agentctl.dev');
    } finally {
      await app.close();
    }
  });

  it('disables CORS entirely when production mode with no corsOrigins', async () => {
    const app = await createServer({
      logger,
      isProduction: true,
      // No corsOrigins — should disable CORS (origin: false)
    });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'https://anything.example.com' },
      });

      expect(response.statusCode).toBe(200);
      // With origin: false, no CORS headers should be present
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

// ===========================================================================
// controlPlaneErrorToStatus — _OFFLINE suffix
// ===========================================================================

describe('global error handler — _OFFLINE suffix', () => {
  it('maps ControlPlaneError with _OFFLINE suffix to 503', async () => {
    const app = await createServer({ logger });

    app.get('/test-offline-error', async () => {
      throw new ControlPlaneError('MACHINE_OFFLINE', 'Machine is offline', {});
    });

    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/test-offline-error',
      });

      expect(response.statusCode).toBe(503);

      const body = response.json();
      expect(body.error).toBe('MACHINE_OFFLINE');
      expect(body.message).toBe('Machine is offline');
    } finally {
      await app.close();
    }
  });
});

// ===========================================================================
// Structured request logging
// ===========================================================================

describe('structured request logging', () => {
  it('logs 2xx responses at info level', async () => {
    const testLogger = createMockLogger();
    const app = await createServer({ logger: testLogger });
    await app.ready();

    try {
      await app.inject({ method: 'GET', url: '/health' });

      // The onSend hook logs at info for 2xx status codes
      expect(testLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: '/health',
          statusCode: 200,
        }),
        'request completed',
      );
    } finally {
      await app.close();
    }
  });

  it('logs 4xx responses at warn level', async () => {
    const testLogger = createMockLogger();
    const app = await createServer({ logger: testLogger });
    await app.ready();

    try {
      await app.inject({ method: 'GET', url: '/does-not-exist' });

      expect(testLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: '/does-not-exist',
          statusCode: 404,
        }),
        'request completed',
      );
    } finally {
      await app.close();
    }
  });

  it('logs 5xx responses at error level', async () => {
    const testLogger = createMockLogger();
    const app = await createServer({ logger: testLogger });

    app.get('/test-500', async () => {
      throw new Error('boom');
    });

    await app.ready();

    try {
      await app.inject({ method: 'GET', url: '/test-500' });

      expect(testLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: '/test-500',
          statusCode: 500,
        }),
        'request completed',
      );
    } finally {
      await app.close();
    }
  });

  it('includes requestId in log data', async () => {
    const testLogger = createMockLogger();
    const app = await createServer({ logger: testLogger });
    await app.ready();

    try {
      await app.inject({ method: 'GET', url: '/health' });

      expect(testLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
          ),
        }),
        'request completed',
      );
    } finally {
      await app.close();
    }
  });
});

describe('manual takeover route registration', () => {
  it('registers manual takeover routes on the control-plane server', async () => {
    const app = await createServer({ logger });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/runtime-sessions/ms-1/manual-takeover',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: 'MANAGED_SESSION_NOT_FOUND',
        message: "Managed session 'ms-1' was not found",
      });
    } finally {
      await app.close();
    }
  });
});

// ===========================================================================
// Metrics self-exclusion
// ===========================================================================

describe('metrics tracking self-exclusion', () => {
  it('does not track /metrics requests in the request tracker', async () => {
    const app = await createServer({ logger });
    await app.ready();

    try {
      // Make a few /metrics requests
      await app.inject({ method: 'GET', url: '/metrics' });
      await app.inject({ method: 'GET', url: '/metrics' });

      // Now get the metrics output and verify no self-referential entries
      const metricsResponse = await app.inject({ method: 'GET', url: '/metrics' });
      const body = metricsResponse.body;

      // The agentctl_http_requests_total metric should not contain
      // path="/metrics" entries since the onResponse hook skips /metrics
      const lines = body.split('\n').filter((l: string) => l.includes('path="/metrics"'));
      const requestLines = lines.filter((l: string) =>
        l.startsWith('agentctl_http_requests_total'),
      );
      expect(requestLines).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('does track non-metrics requests', async () => {
    const app = await createServer({ logger });
    await app.ready();

    try {
      // Make health requests which should be tracked
      await app.inject({ method: 'GET', url: '/health' });
      await app.inject({ method: 'GET', url: '/health' });

      const metricsResponse = await app.inject({ method: 'GET', url: '/metrics' });
      const body = metricsResponse.body;

      // Should contain path="/health" entries
      const healthLines = body
        .split('\n')
        .filter(
          (l: string) =>
            l.startsWith('agentctl_http_requests_total') && l.includes('path="/health"'),
        );
      expect(healthLines.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});

// ===========================================================================
// Conditional route registration
// ===========================================================================

describe('conditional route registration', () => {
  describe('without optional dependencies', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await createServer({ logger });
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('does not register /api/audit routes without dbRegistry', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/audit/actions',
      });
      expect(response.statusCode).toBe(404);
    });

    it('does not register /api/router routes without litellmClient', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/router/models',
      });
      expect(response.statusCode).toBe(404);
    });

    it('does not register /api/memory routes without mem0Client', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/search',
        payload: { query: 'test' },
      });
      expect(response.statusCode).toBe(404);
    });

    it('does not register /api/webhooks routes without db', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/webhooks',
      });
      expect(response.statusCode).toBe(404);
    });

    it('does not register /api/dashboard routes without db+dbRegistry', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/stats',
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('always-registered routes', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await createServer({ logger });
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('registers /health', async () => {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
    });

    it('registers /metrics', async () => {
      const response = await app.inject({ method: 'GET', url: '/metrics' });
      expect(response.statusCode).toBe(200);
    });

    it('registers /api/docs (Swagger UI)', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/docs/json' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.openapi).toBeDefined();
      expect(body.info.title).toBe('AgentCTL Control Plane');
    });

    it('registers /api/scheduler routes', async () => {
      // The scheduler routes are always registered, even without repeatableJobs
      const response = await app.inject({ method: 'GET', url: '/api/scheduler/jobs' });
      // Should not be 404 — the route exists even if it returns an error
      // because repeatableJobs is null
      expect(response.statusCode).not.toBe(404);
    });
  });
});

// ===========================================================================
// Default registry fallback
// ===========================================================================

describe('default registry fallback', () => {
  it('creates an in-memory AgentRegistry when no external registry provided', async () => {
    // When no registry option is passed, createServer creates a new
    // AgentRegistry internally. This should not throw.
    const app = await createServer({ logger });
    await app.ready();

    try {
      // The metrics endpoint queries the registry — it should work
      // without an externally provided one.
      const response = await app.inject({ method: 'GET', url: '/metrics' });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('agentctl_agents_total');
    } finally {
      await app.close();
    }
  });
});

// ===========================================================================
// workerPort option threading
// ===========================================================================

describe('workerPort option', () => {
  it('accepts custom workerPort without errors', async () => {
    const app = await createServer({ logger, workerPort: 9999 });
    await app.ready();

    try {
      // Server should start successfully with custom port
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
