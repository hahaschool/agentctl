import { readFileSync } from 'node:fs';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-04-25T00:00:00Z');

function createLogger() {
  return {
    child: () => createLogger(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    kind: 'consolidation',
    status: 'running',
    params: {},
    progress: { processed: 0, embedded: 0, failed: 0, total: 0, costUsd: 0, usageEstimated: false },
    result: null,
    error: null,
    error_code: null,
    credential_id: null,
    provider_kind: null,
    provider_model: null,
    provider_host: null,
    price_usd_per_mtoken: null,
    origin_machine_id: 'remote',
    executor_machine_id: 'remote',
    cancel_requested_at: null,
    started_at: NOW,
    finished_at: null,
    created_at: NOW,
    egress_confirmed_at: null,
    egress_confirmed_by: null,
    egress_snapshot: null,
    ...overrides,
  };
}

function createMockPool() {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM api_accounts')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('GROUP BY kind')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('SELECT * FROM memory_ops_jobs WHERE id = $1')) {
      return { rows: [makeJobRow()], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return {
    query,
    connect: vi.fn().mockResolvedValue({
      query,
      release: vi.fn(),
    }),
  };
}

async function buildApp(env: Record<string, string | undefined> = {}): Promise<FastifyInstance> {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  const { memoryOpsRoutes } = await import('./memory-ops.js');
  const app = Fastify({ logger: false });
  await app.register(memoryOpsRoutes, {
    prefix: '/api/memory/ops',
    db: {} as never,
    pool: createMockPool() as never,
    queue: { add: vi.fn() } as never,
    encryptionKey: 'a'.repeat(64),
    logger: createLogger() as never,
    machineId: 'local',
  });
  await app.ready();
  return app;
}

describe('memoryOpsRoutes', () => {
  const originalEnv = { ...process.env };
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    process.env = { ...originalEnv };
    vi.resetModules();
    await app?.close();
    app = undefined;
  });

  it('keeps database-backed memory ops routes rate-limited for CodeQL', () => {
    const source = readFileSync(new URL('./memory-ops.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/import rateLimit from '@fastify\/rate-limit';/);
    expect(source).toMatch(/await app\.register\(rateLimit,\s*\{/);
    expect(source).toMatch(
      /'\/capabilities'[\s\S]*?config:\s*\{\s*rateLimit:\s*memoryOpsFastifyRateLimit\s*\}[\s\S]*?preHandler:\s*\[\s*app\.rateLimit\(memoryOpsFastifyRateLimit\),\s*sendCapabilities\s*\]/,
    );
    expect(source).toMatch(
      /const sendCapabilities: preHandlerHookHandler[\s\S]*?loadActiveEmbeddingProvider\(opts\.pool\)[\s\S]*?jobs\.countActiveByKindScope\(\)[\s\S]*?return reply\.send/,
    );
    expect(source).toMatch(
      /app\.get\(\s*'\/capabilities'[\s\S]*?preHandler:\s*\[\s*app\.rateLimit\(memoryOpsFastifyRateLimit\),\s*sendCapabilities\s*\][\s\S]*?async\s*\(\)\s*=>\s*undefined/,
    );
    expect(source).toMatch(
      /app\.post\(\s*'\/jobs'[\s\S]*?preHandler:\s*\[\s*app\.rateLimit\(memoryOpsFastifyRateLimit\)\s*\][\s\S]*?\/\/ codeql\[js\/missing-rate-limiting\][\s\S]*?async/,
    );
  });

  it('GET /capabilities returns feature flag, enabled kinds, provider, and active job counts', async () => {
    app = await buildApp({
      MEMORY_OPS_ENABLED: 'false',
      MEMORY_OPS_ENABLED_KINDS: '',
      MEMORY_OPS_SIGNING_SECRET: '',
    });

    const response = await app.inject({ method: 'GET', url: '/api/memory/ops/capabilities' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      enabled: false,
      enabledKinds: [],
      machineId: 'local',
      queueAvailable: true,
      activeProvider: null,
      activeJobs: [],
    });
  });

  it('POST /jobs/preview returns 503 when the signing secret is missing', async () => {
    app = await buildApp({ MEMORY_OPS_SIGNING_SECRET: '' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/ops/jobs/preview',
      payload: { kind: 'embedding-backfill', params: {} },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'SIGNING_SECRET_MISSING' });
  });

  it('POST /jobs rejects submissions while the feature flag is disabled', async () => {
    app = await buildApp({
      MEMORY_OPS_ENABLED: 'false',
      MEMORY_OPS_ENABLED_KINDS: 'consolidation',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/ops/jobs',
      payload: { kind: 'consolidation', params: {} },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'FEATURE_DISABLED' });
  });

  it('POST /jobs/:id/cancel rejects jobs owned by another peer', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: `/api/memory/ops/jobs/${JOB_ID}/cancel`,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'REMOTE_PEER_JOB' });
  });
});
