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

// ── Module mocks (hoisted) ───────────────────────────────────────

vi.mock('../../utils/tier-config.js', () => ({
  loadTierConfigs: vi.fn(() => MOCK_TIER_CONFIGS),
  isValidSourceTier: vi.fn((source: string) => /^dev-\d+$/.test(source)),
  clearTierConfigCache: vi.fn(),
}));

vi.mock('../../utils/pm2-client.js', () => ({
  pm2List: vi.fn().mockResolvedValue([]),
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
    });

    it('respects limit and offset query params', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/deployment/history?limit=5&offset=10',
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
