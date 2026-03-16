import { EventEmitter } from 'node:events';

import type { TierConfig } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock state ───────────────────────────────────────────────────

let mockMutexLocked = false;

const MOCK_TIER_CONFIGS: readonly TierConfig[] = [
  {
    name: 'dev-1',
    label: 'Dev 1',
    cpPort: 8081,
    workerPort: 9001,
    webPort: 5174,
    database: 'agentctl_dev1',
    redisDb: 1,
  },
  {
    name: 'beta',
    label: 'Beta',
    cpPort: 8080,
    workerPort: 9000,
    webPort: 5173,
    database: 'agentctl',
    redisDb: 0,
  },
];

const mockRunPreflight = vi.fn();
const mockPromote = vi.fn();
const mockPm2List = vi.fn().mockResolvedValue([]);

// ── Module mocks (hoisted) ───────────────────────────────────────

vi.mock('../../utils/tier-config.js', () => ({
  loadTierConfigs: vi.fn(() => MOCK_TIER_CONFIGS),
  isValidSourceTier: vi.fn((source: string) => /^dev-\d+$/.test(source)),
  clearTierConfigCache: vi.fn(),
}));

vi.mock('../../utils/pm2-client.js', () => ({
  pm2List: mockPm2List,
  pm2Restart: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/promotion-runner.js', () => ({
  PromotionRunner: vi.fn().mockImplementation(() => ({
    runPreflight: mockRunPreflight,
    promote: mockPromote,
  })),
  createPromotionMutex: vi.fn(() => ({
    get isLocked() {
      return mockMutexLocked;
    },
    acquire: vi.fn().mockResolvedValue(() => {}),
  })),
}));

vi.mock('../../db/schema-deployment.js', () => ({
  promotionHistory: {
    id: 'id',
    startedAt: 'started_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val, _type: 'eq' })),
  desc: vi.fn((col: unknown) => ({ col, _type: 'desc' })),
  sql: vi.fn(),
}));

// Mock global fetch for health probes
const mockFetch = vi.fn<typeof globalThis.fetch>();
vi.stubGlobal('fetch', mockFetch);

// ── Test helpers ─────────────────────────────────────────────────

function createMockDb() {
  const mockCountResult = [{ count: 0 }];
  const mockRecords: unknown[] = [];

  return {
    select: vi.fn().mockImplementation((fields?: Record<string, unknown>) => {
      // If select() is called with fields (for count), return count chain
      if (fields && 'count' in fields) {
        return {
          from: vi.fn().mockResolvedValue(mockCountResult),
        };
      }
      // Normal select chain
      return {
        from: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue(mockRecords),
            }),
          }),
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      };
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'promo-1' }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  };
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn().mockReturnThis(),
  level: 'silent',
  silent: vi.fn(),
};

async function buildApp(): Promise<FastifyInstance> {
  const Fastify = await import('fastify');
  const { deploymentRoutes } = await import('./deployment.js');
  const app = Fastify.default({ logger: false });
  const db = createMockDb();

  await app.register(deploymentRoutes, {
    prefix: '/api/deployment',
    db: db as never,
    logger: mockLogger as never,
  });

  return app;
}

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function mockHeadResponse(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}

// ── Tests ────────────────────────────────────────────────────────

describe('deploymentRoutes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMutexLocked = false;

    // Default: all health probes fail (services not running in test)
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── GET /tiers ──────────────────────────────────────────────────

  describe('GET /tiers', () => {
    it('returns tier list with health status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/deployment/tiers',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('tiers');
      expect(body.tiers).toHaveLength(2);
      expect(body.tiers[0]).toMatchObject({
        name: 'dev-1',
        label: 'Dev 1',
        status: 'stopped',
      });
      expect(body.tiers[0].services).toHaveLength(3);
      expect(body.tiers[0].config).toMatchObject({ cpPort: 8081 });
    });

    it('reports running status when all probes succeed', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok' }),
      } as Response);

      const response = await app.inject({
        method: 'GET',
        url: '/api/deployment/tiers',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.tiers).toHaveLength(2);
      expect(body.tiers[0].status).toBe('running');
      expect(body.tiers[0].services.every((s: { healthy: boolean }) => s.healthy)).toBe(true);
    });

    it('preserves dev cp and worker metrics from health payloads without PM2', async () => {
      mockFetch.mockImplementation(async (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

        if (init?.method === 'HEAD') {
          return mockHeadResponse();
        }

        if (url === 'http://localhost:8081/health') {
          return mockJsonResponse({
            status: 'ok',
            uptime: 123,
            memoryUsage: { rss: 512 * 1024 * 1024 },
          });
        }

        if (url === 'http://localhost:9001/health') {
          return mockJsonResponse({
            status: 'ok',
            uptime: 789,
            memoryUsage: { rss: 256 * 1024 * 1024 },
          });
        }

        return mockJsonResponse({ status: 'ok' });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/deployment/tiers',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      const devTier = body.tiers.find((tier: { name: string }) => tier.name === 'dev-1');
      expect(devTier.status).toBe('running');

      const cpService = devTier.services.find((svc: { name: string }) => svc.name === 'cp');
      const workerService = devTier.services.find((svc: { name: string }) => svc.name === 'worker');
      const webService = devTier.services.find((svc: { name: string }) => svc.name === 'web');

      expect(cpService).toMatchObject({
        healthy: true,
        memoryMb: 512,
        uptimeSeconds: 123,
      });
      expect(workerService).toMatchObject({
        healthy: true,
        memoryMb: 256,
        uptimeSeconds: 789,
      });
      expect(typeof cpService.memoryMb).toBe('number');
      expect(typeof cpService.uptimeSeconds).toBe('number');
      expect(typeof workerService.memoryMb).toBe('number');
      expect(typeof workerService.uptimeSeconds).toBe('number');
      expect(webService.memoryMb).toBeUndefined();
      expect(webService.uptimeSeconds).toBeUndefined();
    });

    it('prefers PM2 metrics over health payload metrics when available for dev tiers', async () => {
      mockPm2List.mockResolvedValueOnce([
        {
          name: 'agentctl-cp-dev1',
          pid: 101,
          status: 'online',
          memoryMb: 999.99,
          uptimeMs: 12_000,
          restarts: 2,
        },
        {
          name: 'agentctl-worker-dev1',
          pid: 202,
          status: 'online',
          memoryMb: 888.88,
          uptimeMs: 34_000,
          restarts: 1,
        },
        {
          name: 'agentctl-web-dev1',
          pid: 303,
          status: 'online',
          memoryMb: 777.77,
          uptimeMs: 56_000,
          restarts: 0,
        },
      ]);

      mockFetch.mockImplementation(async (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

        if (init?.method === 'HEAD') {
          return mockHeadResponse();
        }

        if (url === 'http://localhost:8081/health') {
          return mockJsonResponse({
            status: 'ok',
            uptime: 10,
            memoryUsage: { rss: 20 * 1024 * 1024 },
          });
        }

        if (url === 'http://localhost:9001/health') {
          return mockJsonResponse({
            status: 'ok',
            uptime: 30,
            memoryUsage: { rss: 40 * 1024 * 1024 },
          });
        }

        return mockJsonResponse({ status: 'ok' });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/deployment/tiers',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      const devTier = body.tiers.find((tier: { name: string }) => tier.name === 'dev-1');

      const cpService = devTier.services.find((svc: { name: string }) => svc.name === 'cp');
      const workerService = devTier.services.find((svc: { name: string }) => svc.name === 'worker');
      const webService = devTier.services.find((svc: { name: string }) => svc.name === 'web');

      expect(cpService).toMatchObject({
        memoryMb: 999.99,
        uptimeSeconds: 12,
        restarts: 2,
        pid: 101,
      });
      expect(workerService).toMatchObject({
        memoryMb: 888.88,
        uptimeSeconds: 34,
        restarts: 1,
        pid: 202,
      });
      expect(webService).toMatchObject({
        memoryMb: 777.77,
        uptimeSeconds: 56,
        restarts: 0,
        pid: 303,
      });
    });
  });

  // ── GET /preflight/:tier ────────────────────────────────────────

  describe('GET /preflight/:tier', () => {
    it('runs preflight checks for a valid tier', async () => {
      mockRunPreflight.mockResolvedValue({
        passed: true,
        checks: [
          { name: 'source_health', status: 'pass', message: 'OK' },
          { name: 'target_health', status: 'pass', message: 'OK' },
          { name: 'migration_parity', status: 'pass', message: '5 migrations in sync' },
          { name: 'build', status: 'pass', message: 'Build succeeded' },
        ],
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/deployment/preflight/dev-1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ready).toBe(true);
      expect(body.checks).toHaveLength(4);
      expect(body.checks[0]).toMatchObject({ name: 'source_health', status: 'pass' });
    });

    it('returns not-ready when preflight fails', async () => {
      mockRunPreflight.mockResolvedValue({
        passed: false,
        checks: [
          { name: 'source_health', status: 'fail', message: 'Unhealthy: cp' },
          { name: 'target_health', status: 'skipped', message: 'Skipped' },
          { name: 'migration_parity', status: 'skipped', message: 'Skipped' },
          { name: 'build', status: 'skipped', message: 'Skipped' },
        ],
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/deployment/preflight/dev-1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ready).toBe(false);
      expect(body.checks[0].status).toBe('fail');
    });

    it('rejects invalid tier name', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/deployment/preflight/beta',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_SOURCE' });
    });

    it('rejects non-existent tier name', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/deployment/preflight/production',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_SOURCE' });
    });
  });

  // ── POST /promote/preflight ─────────────────────────────────────

  describe('POST /promote/preflight', () => {
    it('validates source tier and runs preflight', async () => {
      mockRunPreflight.mockResolvedValue({
        passed: true,
        checks: [
          { name: 'source_health', status: 'pass', message: 'OK' },
          { name: 'target_health', status: 'pass', message: 'OK' },
          { name: 'migration_parity', status: 'pass', message: '5 migrations in sync' },
          { name: 'build', status: 'pass', message: 'Build succeeded' },
        ],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/deployment/promote/preflight',
        payload: { source: 'dev-1' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ready).toBe(true);
      expect(body.checks).toHaveLength(4);
    });

    it('rejects invalid source tier (non-dev name)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/deployment/promote/preflight',
        payload: { source: 'beta' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_SOURCE' });
    });

    it('returns 400 when source is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/deployment/promote/preflight',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_SOURCE' });
    });
  });

  // ── POST /promote ──────────────────────────────────────────────

  describe('POST /promote', () => {
    it('returns 202 with promotion ID when started', async () => {
      const emitter = new EventEmitter();
      mockPromote.mockResolvedValue({ id: 'promo-abc', events: emitter });

      const response = await app.inject({
        method: 'POST',
        url: '/api/deployment/promote',
        payload: { source: 'dev-1' },
      });

      expect(response.statusCode).toBe(202);
      const body = response.json();
      expect(body).toMatchObject({ id: 'promo-abc', status: 'pending' });
    });

    it('returns 409 when mutex is locked', async () => {
      mockMutexLocked = true;

      const response = await app.inject({
        method: 'POST',
        url: '/api/deployment/promote',
        payload: { source: 'dev-1' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: 'PROMOTION_IN_PROGRESS' });
    });

    it('rejects invalid source tier', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/deployment/promote',
        payload: { source: 'production' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_SOURCE' });
    });
  });

  // ── GET /promote/:id/stream ──────────────────────────────────────

  describe('GET /promote/:id/stream', () => {
    it('returns SSE content-type header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/deployment/promote/non-existent-id/stream',
      });

      // The route writes to raw response, so inject() returns the raw output
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream');
    });

    it('sends error event for unknown promotion ID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/deployment/promote/unknown-id/stream',
      });

      expect(response.statusCode).toBe(200);
      // The response body should contain a JSON event with type 'error'
      const lines = response.body.split('\n').filter((l: string) => l.startsWith('data: '));
      expect(lines.length).toBeGreaterThan(0);
      const event = JSON.parse(lines[0].replace('data: ', ''));
      expect(event.type).toBe('error');
      expect(event.message).toBe('Promotion not found');
    });
  });

  // ── GET /history ───────────────────────────────────────────────

  describe('GET /history', () => {
    it('returns paginated promotion records', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/deployment/history',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('records');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.records)).toBe(true);
      expect(typeof body.total).toBe('number');
    });

    it('respects limit and offset query params', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/deployment/history?limit=5&offset=10',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('records');
      expect(body).toHaveProperty('total');
    });

    it('clamps limit to max 100', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/deployment/history?limit=500',
      });

      // Should still succeed (limit clamped internally)
      expect(response.statusCode).toBe(200);
    });

    it('handles invalid limit/offset gracefully', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/deployment/history?limit=abc&offset=-5',
      });

      // Should still succeed with fallback defaults
      expect(response.statusCode).toBe(200);
    });
  });

  // ── GET /tiers — degraded status ──────────────────────────────

  describe('GET /tiers — degraded status', () => {
    it('reports degraded when some probes fail', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        // First two calls succeed (cp + worker), third fails (web HEAD)
        if (callCount % 3 === 0) {
          throw new Error('Connection refused');
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'ok' }),
        } as Response;
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/deployment/tiers',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      // At least one tier should be degraded since web probe fails
      const degradedTiers = body.tiers.filter((t: { status: string }) => t.status === 'degraded');
      expect(degradedTiers.length).toBeGreaterThan(0);
    });
  });
});
