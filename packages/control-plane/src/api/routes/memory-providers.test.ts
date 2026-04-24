import { ControlPlaneError } from '@agentctl/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { memoryProvidersRoutes } from './memory-providers.js';

const TEST_ENCRYPTION_KEY = 'a'.repeat(64);
const NOW = new Date('2026-04-25T00:00:00Z');

vi.mock('../../utils/credential-crypto.js', () => ({
  encryptCredential: vi.fn((plaintext: string) => ({
    encrypted: `encrypted:${plaintext}`,
    iv: 'iv',
  })),
  decryptCredential: vi.fn((encrypted: string) => encrypted.replace(/^encrypted:/, '')),
  maskCredential: vi.fn((credential: string) => `***${credential.slice(-4)}`),
}));

const embeddingClientMocks = vi.hoisted(() => ({
  embedBatchWithUsage: vi.fn(),
}));

vi.mock('../../memory/embedding-client.js', () => ({
  EmbeddingClient: vi.fn().mockImplementation(() => ({
    embedBatchWithUsage: embeddingClientMocks.embedBatchWithUsage,
  })),
}));

function createLogger() {
  return {
    child: () => createLogger(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeProviderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'OpenAI Embeddings',
    provider: 'openai',
    credential: 'encrypted:sk-provider',
    credential_iv: 'iv',
    credential_last4: 'ider',
    is_active: true,
    metadata: {
      model: 'text-embedding-3-small',
      lastTestOk: null,
      lastTestError: null,
      lastTestedAt: null,
      dim: null,
      latencyMs: null,
      costUsd: null,
    },
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function createMockPool(rows: Record<string, unknown>[] = []) {
  const queryImpl = (sql: string, params?: unknown[]) => {
    if (sql.includes('FROM api_accounts') && sql.includes("credential_kind = 'embedding'")) {
      if (params?.[0]) {
        const matchedRows = rows.filter((row) => row.id === params[0]);
        return Promise.resolve({ rows: matchedRows, rowCount: matchedRows.length });
      }
      return Promise.resolve({ rows, rowCount: rows.length });
    }
    if (sql.includes('INSERT INTO api_accounts')) {
      const inserted = makeProviderRow({
        id: '33333333-3333-4333-8333-333333333333',
        name: params?.[0],
        provider: params?.[1],
        credential_last4: params?.[4],
        is_active: params?.[5],
        metadata: JSON.parse(String(params?.[6] ?? '{}')),
      });
      return Promise.resolve({ rows: [inserted], rowCount: 1 });
    }
    if (sql.includes('UPDATE api_accounts') && sql.includes('RETURNING')) {
      return Promise.resolve({
        rows: [
          makeProviderRow({
            id: params?.[0],
            is_active: params?.includes(true) ? true : rows[0]?.is_active,
            metadata: rows[0]?.metadata,
          }),
        ],
        rowCount: 1,
      });
    }
    if (sql.includes('UPDATE api_accounts')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (sql.includes('FROM memory_ops_jobs')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (sql.includes('memory_facts') || sql.includes('memory_drawers')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  };
  const client = {
    query: vi.fn().mockImplementation(queryImpl),
    release: vi.fn(),
  };
  return {
    client,
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn().mockImplementation(queryImpl),
  };
}

async function buildApp(pool: ReturnType<typeof createMockPool>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(memoryProvidersRoutes, {
    prefix: '/api/memory/providers',
    db: {} as never,
    pool: pool as never,
    encryptionKey: TEST_ENCRYPTION_KEY,
    logger: createLogger() as never,
  });
  await app.ready();
  return app;
}

describe('memoryProvidersRoutes', () => {
  const originalSigningSecret = process.env.MEMORY_OPS_SIGNING_SECRET;
  const originalRateLimitMax = process.env.MEMORY_PROVIDER_RATE_LIMIT_MAX;
  const originalRateLimitWindow = process.env.MEMORY_PROVIDER_RATE_LIMIT_WINDOW_MS;
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    process.env.MEMORY_OPS_SIGNING_SECRET = originalSigningSecret;
    if (originalRateLimitMax === undefined) delete process.env.MEMORY_PROVIDER_RATE_LIMIT_MAX;
    else process.env.MEMORY_PROVIDER_RATE_LIMIT_MAX = originalRateLimitMax;
    if (originalRateLimitWindow === undefined) {
      delete process.env.MEMORY_PROVIDER_RATE_LIMIT_WINDOW_MS;
    } else {
      process.env.MEMORY_PROVIDER_RATE_LIMIT_WINDOW_MS = originalRateLimitWindow;
    }
    await app?.close();
    app = undefined;
    embeddingClientMocks.embedBatchWithUsage.mockReset();
  });

  it('GET /api/memory/providers returns embedding providers without secrets', async () => {
    const pool = createMockPool([makeProviderRow()]);
    app = await buildApp(pool);

    const response = await app.inject({ method: 'GET', url: '/api/memory/providers' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.providers).toHaveLength(1);
    expect(body.providers[0]).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKeyLast4: 'ider',
    });
    expect(body.providers[0].credential).toBeUndefined();
  });

  it('POST /test-ephemeral returns 503 when MEMORY_OPS_SIGNING_SECRET is missing', async () => {
    process.env.MEMORY_OPS_SIGNING_SECRET = '';
    const pool = createMockPool();
    app = await buildApp(pool);

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/providers/test-ephemeral',
      payload: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'sk-test',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'SIGNING_SECRET_MISSING' });
  });

  it('accepts matching recent test tokens for provider metadata', async () => {
    process.env.MEMORY_OPS_SIGNING_SECRET = 'test-signing-secret';
    embeddingClientMocks.embedBatchWithUsage.mockResolvedValue({
      vectors: [[0.1, 0.2]],
      usage: { promptTokens: 1000 },
      model: 'text-embedding-3-small',
    });
    const pool = createMockPool();
    app = await buildApp(pool);

    const testResponse = await app.inject({
      method: 'POST',
      url: '/api/memory/providers/test-ephemeral',
      payload: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'sk-tested',
      },
    });
    const signedToken = testResponse.json().signedToken;
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/memory/providers',
      payload: {
        name: 'OpenAI',
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'sk-tested',
        active: false,
        recentTestResult: { signedToken, apiKey: 'sk-tested' },
      },
    });

    expect(testResponse.statusCode).toBe(200);
    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().provider.metadata).toMatchObject({
      lastTestOk: true,
      dim: 2,
    });
  });

  it('rejects recent test tokens when the saved provider key differs', async () => {
    process.env.MEMORY_OPS_SIGNING_SECRET = 'test-signing-secret';
    embeddingClientMocks.embedBatchWithUsage.mockResolvedValue({
      vectors: [[0.1, 0.2]],
      usage: { promptTokens: 1000 },
      model: 'text-embedding-3-small',
    });
    const pool = createMockPool();
    app = await buildApp(pool);

    const testResponse = await app.inject({
      method: 'POST',
      url: '/api/memory/providers/test-ephemeral',
      payload: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'sk-tested',
      },
    });
    const signedToken = testResponse.json().signedToken;
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/memory/providers',
      payload: {
        name: 'OpenAI',
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'sk-different',
        active: false,
        recentTestResult: { signedToken, apiKey: 'sk-different' },
      },
    });

    expect(testResponse.statusCode).toBe(200);
    expect(createResponse.statusCode).toBe(422);
    expect(createResponse.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('rejects recent test tokens when the saved provider key only shares the same suffix', async () => {
    process.env.MEMORY_OPS_SIGNING_SECRET = 'test-signing-secret';
    embeddingClientMocks.embedBatchWithUsage.mockResolvedValue({
      vectors: [[0.1, 0.2]],
      usage: { promptTokens: 1000 },
      model: 'text-embedding-3-small',
    });
    const pool = createMockPool();
    app = await buildApp(pool);

    const testResponse = await app.inject({
      method: 'POST',
      url: '/api/memory/providers/test-ephemeral',
      payload: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'sk-tested-1234',
      },
    });
    const signedToken = testResponse.json().signedToken;
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/memory/providers',
      payload: {
        name: 'OpenAI',
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'sk-different-1234',
        active: false,
        recentTestResult: { signedToken, apiKey: 'sk-different-1234' },
      },
    });

    expect(testResponse.statusCode).toBe(200);
    expect(createResponse.statusCode).toBe(422);
    expect(createResponse.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('POST /api/memory/providers rejects unverified catalog entries', async () => {
    const pool = createMockPool();
    app = await buildApp(pool);

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/providers',
      payload: {
        name: 'Gemini',
        provider: 'gemini',
        model: 'gemini-embedding-001',
        apiKey: 'gemini-key',
        active: false,
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe('VALIDATION_ERROR');
  });

  it('rate limits provider credential write routes', async () => {
    process.env.MEMORY_PROVIDER_RATE_LIMIT_MAX = '1';
    process.env.MEMORY_PROVIDER_RATE_LIMIT_WINDOW_MS = '60000';
    const pool = createMockPool();
    app = await buildApp(pool);

    const first = await app.inject({
      method: 'POST',
      url: '/api/memory/providers',
      payload: {
        name: 'OpenAI',
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'sk-test-one',
        active: false,
      },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/memory/providers',
      payload: {
        name: 'OpenAI 2',
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'sk-test-two',
        active: false,
      },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({
      error: 'RATE_LIMITED',
      message: 'Too many memory provider requests',
    });
  });

  it('PATCH active:true deactivates other embedding providers before activating target', async () => {
    const pool = createMockPool([
      makeProviderRow({ id: '22222222-2222-4222-8222-222222222222', is_active: false }),
    ]);
    app = await buildApp(pool);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/memory/providers/22222222-2222-4222-8222-222222222222',
      payload: { active: true },
    });

    expect(response.statusCode).toBe(200);
    expect(pool.client.query).toHaveBeenCalledWith(
      expect.stringContaining('SET is_active = false'),
      ['22222222-2222-4222-8222-222222222222'],
    );
    expect(response.json().provider.isActive).toBe(true);
  });

  it('POST /:id/test persists successful test metadata', async () => {
    process.env.MEMORY_OPS_SIGNING_SECRET = 'test-signing-secret';
    embeddingClientMocks.embedBatchWithUsage.mockResolvedValue({
      vectors: [[0.1, 0.2]],
      usage: { promptTokens: 1000 },
      model: 'text-embedding-3-small',
    });
    const pool = createMockPool([makeProviderRow()]);
    app = await buildApp(pool);

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/providers/11111111-1111-4111-8111-111111111111/test',
    });

    expect(response.statusCode).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE api_accounts'),
      expect.arrayContaining([
        '11111111-1111-4111-8111-111111111111',
        expect.stringContaining('"lastTestOk":true'),
      ]),
    );
    const updateCall = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE api_accounts'),
    );
    expect(String(updateCall?.[0])).toContain('credential = $2');
    expect(updateCall?.[1]).toEqual(
      expect.arrayContaining(['encrypted:sk-provider', 'iv', expect.stringContaining('"dim":2')]),
    );
  });

  it('POST /:id/test persists only safe failed test metadata', async () => {
    process.env.MEMORY_OPS_SIGNING_SECRET = 'test-signing-secret';
    embeddingClientMocks.embedBatchWithUsage.mockRejectedValue(
      new ControlPlaneError(
        'EMBEDDING_API_ERROR',
        'Embedding API returned 401: {"error":"bad key sk-live-secret"}',
        { status: 401 },
      ),
    );
    const pool = createMockPool([makeProviderRow()]);
    app = await buildApp(pool);

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/providers/11111111-1111-4111-8111-111111111111/test',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'PROVIDER_AUTH_FAILED' });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE api_accounts'),
      expect.arrayContaining([
        '11111111-1111-4111-8111-111111111111',
        expect.stringContaining('"lastTestOk":false'),
      ]),
    );
    const updateCall = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE api_accounts'),
    );
    const updateParams = updateCall?.[1] as unknown[] | undefined;
    const metadataJson = String(updateParams?.[3]);
    expect(metadataJson).toContain('"lastTestError":"Embedding provider returned HTTP 401"');
    expect(metadataJson).not.toContain('sk-live-secret');
    const auditCall = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO memory_ops_audit'),
    );
    expect(JSON.stringify(auditCall?.[1])).toContain('EMBEDDING_API_ERROR');
    expect(JSON.stringify(auditCall?.[1])).not.toContain('sk-live-secret');
  });

  it('POST /:id/test rejects stale metadata writes when the provider changed during testing', async () => {
    process.env.MEMORY_OPS_SIGNING_SECRET = 'test-signing-secret';
    embeddingClientMocks.embedBatchWithUsage.mockResolvedValue({
      vectors: [[0.1, 0.2]],
      usage: { promptTokens: 1000 },
      model: 'text-embedding-3-small',
    });
    const pool = createMockPool([makeProviderRow()]);
    const originalQuery = pool.query;
    pool.query = vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('UPDATE api_accounts') && !sql.includes('RETURNING')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return originalQuery(sql, params);
    });
    app = await buildApp(pool);

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/providers/11111111-1111-4111-8111-111111111111/test',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'PROVIDER_CHANGED_DURING_TEST' });
  });

  it('DELETE returns 409 when active jobs reference the provider', async () => {
    const pool = createMockPool();
    pool.query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('FROM memory_ops_jobs')) {
        return Promise.resolve({ rows: [{ id: 'job-1' }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    app = await buildApp(pool);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/memory/providers/11111111-1111-4111-8111-111111111111',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: 'PROVIDER_HAS_ACTIVE_JOBS',
    } satisfies Partial<ControlPlaneError>);
  });
});
