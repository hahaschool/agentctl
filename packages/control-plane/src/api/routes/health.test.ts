import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createServer } from '../server.js';
import { createMockLogger } from './test-helpers.js';

const logger = createMockLogger();

// ── Helpers ──────────────────────────────────────────────────────────────
function createMockDb(options: { shouldFail?: boolean } = {}) {
  return {
    execute: vi.fn().mockImplementation(async () => {
      if (options.shouldFail) {
        throw new Error('ECONNREFUSED');
      }
      return [{ '?column?': 1 }];
    }),
  };
}

function createMockRedis(options: { shouldFail?: boolean } = {}) {
  return {
    ping: vi.fn().mockImplementation(async () => {
      if (options.shouldFail) {
        throw new Error('ECONNREFUSED');
      }
      return 'PONG';
    }),
  };
}

function createMockMem0Client(options: { shouldFail?: boolean } = {}) {
  return {
    health: vi.fn().mockImplementation(async () => {
      if (options.shouldFail) {
        return false;
      }
      return true;
    }),
  };
}

function createMockLitellmClient(options: { shouldFail?: boolean } = {}) {
  return {
    health: vi.fn().mockImplementation(async () => {
      if (options.shouldFail) {
        return false;
      }
      return true;
    }),
  };
}

// ── Simple health (no dependencies) ─────────────────────────────────────
describe('GET /health (no dependencies)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ logger });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with status ok', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    expect(typeof body.timestamp).toBe('string');
  });

  it('returns a valid ISO 8601 timestamp', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    const body = response.json();
    const parsed = new Date(body.timestamp);
    expect(parsed.toISOString()).toBe(body.timestamp);
  });

  it('returns process metrics (uptime, nodeVersion, memoryUsage)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    const body = response.json();
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThan(0);
    expect(typeof body.nodeVersion).toBe('string');
    expect(body.nodeVersion).toMatch(/^v\d+/);
    expect(typeof body.memoryUsage).toBe('object');
    expect(typeof body.memoryUsage.rss).toBe('number');
    expect(typeof body.memoryUsage.heapUsed).toBe('number');
    expect(typeof body.memoryUsage.heapTotal).toBe('number');
  });

  it('does not include dependencies in simple response', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    const body = response.json();
    expect(body.dependencies).toBeUndefined();
  });

  it('returns dependencies when detail=true is provided', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?detail=true',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.dependencies).toBeDefined();
    expect(body.dependencies.postgres).toBeDefined();
    expect(body.dependencies.redis).toBeDefined();
    expect(body.dependencies.mem0).toBeDefined();
    expect(body.dependencies.litellm).toBeDefined();
  });

  it('returns ok status for all dependencies when none are configured', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?detail=true',
    });

    const body = response.json();
    expect(body.dependencies.postgres.status).toBe('ok');
    expect(body.dependencies.redis.status).toBe('ok');
    expect(body.dependencies.mem0.status).toBe('ok');
    expect(body.dependencies.litellm.status).toBe('ok');
  });
});

// ── Health with all dependencies healthy ────────────────────────────────
describe('GET /health (all dependencies healthy)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({
      logger,
      db: createMockDb() as never,
      redis: createMockRedis(),
      mem0Client: createMockMem0Client() as never,
      litellmClient: createMockLitellmClient() as never,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns ok status in simple response when all deps are healthy', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.dependencies).toBeUndefined();
  });

  it('returns ok status with full details when detail=true', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?detail=true',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.dependencies.postgres.status).toBe('ok');
    expect(body.dependencies.postgres.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.dependencies.redis.status).toBe('ok');
    expect(body.dependencies.redis.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.dependencies.mem0.status).toBe('ok');
    expect(body.dependencies.litellm.status).toBe('ok');
  });
});

// ── Health with degraded dependencies ───────────────────────────────────
describe('GET /health (degraded dependencies)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({
      logger,
      db: createMockDb({ shouldFail: true }) as never,
      redis: createMockRedis(),
      mem0Client: createMockMem0Client() as never,
      litellmClient: createMockLitellmClient() as never,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns degraded status when postgres is down (simple)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('degraded');
  });

  it('returns degraded status with error details when postgres is down (detail)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?detail=true',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.dependencies.postgres.status).toBe('error');
    expect(body.dependencies.postgres.error).toBeDefined();
    expect(body.dependencies.redis.status).toBe('ok');
    expect(body.dependencies.mem0.status).toBe('ok');
    expect(body.dependencies.litellm.status).toBe('ok');
  });
});

describe('GET /health (redis down)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({
      logger,
      db: createMockDb() as never,
      redis: createMockRedis({ shouldFail: true }),
      mem0Client: createMockMem0Client() as never,
      litellmClient: createMockLitellmClient() as never,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns degraded status when redis is down', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('degraded');
  });

  it('shows redis error detail when detail=true', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?detail=true',
    });

    const body = response.json();
    expect(body.dependencies.redis.status).toBe('error');
    expect(body.dependencies.redis.error).toContain('ECONNREFUSED');
    expect(body.dependencies.postgres.status).toBe('ok');
  });
});

describe('GET /health (mem0 down)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({
      logger,
      mem0Client: createMockMem0Client({ shouldFail: true }) as never,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns degraded status when mem0 health returns false', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?detail=true',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.dependencies.mem0.status).toBe('error');
    expect(body.dependencies.mem0.error).toContain('non-OK');
  });
});

describe('GET /health (litellm down)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({
      logger,
      litellmClient: createMockLitellmClient({ shouldFail: true }) as never,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns degraded status when litellm health returns false', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?detail=true',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.dependencies.litellm.status).toBe('error');
    expect(body.dependencies.litellm.error).toContain('non-OK');
  });
});

// ── Timeout behaviour ───────────────────────────────────────────────────
describe('GET /health (timeout)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('reports error when a dependency check hangs beyond 2 seconds', async () => {
    const hangingDb = {
      execute: vi
        .fn()
        .mockImplementation(() => new Promise<void>((resolve) => setTimeout(resolve, 10_000))),
    };

    app = await createServer({
      logger,
      db: hangingDb as never,
    });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/health?detail=true',
    });

    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.dependencies.postgres.status).toBe('error');
    expect(body.dependencies.postgres.error).toContain('timed out');
  }, 10_000);
});

// ── Multiple deps down ──────────────────────────────────────────────────
describe('GET /health (multiple deps down)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({
      logger,
      db: createMockDb({ shouldFail: true }) as never,
      redis: createMockRedis({ shouldFail: true }),
      mem0Client: createMockMem0Client({ shouldFail: true }) as never,
      litellmClient: createMockLitellmClient({ shouldFail: true }) as never,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns degraded when all deps are down with all errors in detail', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?detail=true',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.dependencies.postgres.status).toBe('error');
    expect(body.dependencies.redis.status).toBe('error');
    expect(body.dependencies.mem0.status).toBe('error');
    expect(body.dependencies.litellm.status).toBe('error');
  });
});
