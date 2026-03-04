import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { accountRoutes } from './accounts.js';
import { decryptCredential } from '../../utils/credential-crypto.js';

// ---------------------------------------------------------------------------
// Test encryption key — 32 bytes (64 hex chars) for AES-256
// ---------------------------------------------------------------------------

const TEST_ENCRYPTION_KEY = 'a'.repeat(64);

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-03-04T12:00:00Z');

function makeAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acct-001',
    name: 'Anthropic Direct',
    provider: 'anthropic_api',
    credential: 'encrypted-blob',
    credentialIv: 'iv-blob',
    priority: 0,
    rateLimit: {},
    isActive: true,
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Chainable Drizzle query builder mock
// ---------------------------------------------------------------------------

/**
 * Creates a mock database that simulates Drizzle's chainable query builder.
 *
 * Each method in the chain (select, from, where, orderBy, limit, offset,
 * insert, update, delete, values, set, returning) returns the chain itself so
 * that calls like `db.select().from(table).where(cond)` resolve correctly.
 *
 * The mock stores a `rows` array that is returned when the chain is awaited
 * (via a `.then` method). Call `setRows()` to configure what a query returns.
 */
function createMockDb() {
  let rows: unknown[] = [];

  const chain: Record<string, unknown> = {};

  const chainMethods = [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'offset',
    'insert',
    'update',
    'delete',
    'values',
    'set',
    'returning',
    'onConflictDoUpdate',
  ];

  for (const method of chainMethods) {
    chain[method] = vi.fn(() => chain);
  }

  // When the chain is awaited, resolve with the configured rows.
  // biome-ignore lint/suspicious/noThenProperty: Drizzle query builder mock requires a thenable
  chain.then = (resolve: (value: unknown) => void) => {
    resolve(rows);
    return chain;
  };

  return {
    db: chain,
    setRows: (newRows: unknown[]) => {
      rows = newRows;
    },
  };
}

// ---------------------------------------------------------------------------
// Mock credential-crypto module
// ---------------------------------------------------------------------------

vi.mock('../../utils/credential-crypto.js', () => ({
  encryptCredential: vi.fn((_plaintext: string, _key: string) => ({
    encrypted: 'mock-encrypted',
    iv: 'mock-iv',
  })),
  decryptCredential: vi.fn(
    (_encrypted: string, _iv: string, _key: string) => 'sk-ant-api03-decrypted-key-1234',
  ),
  maskCredential: vi.fn((credential: string) => {
    if (credential.startsWith('sk-ant-')) {
      return `sk-ant-...${credential.slice(-4)}`;
    }
    return `***${credential.slice(-4)}`;
  }),
}));

// ---------------------------------------------------------------------------
// Mock fetch — prevent real HTTP calls to Anthropic API
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

async function buildApp(mockDb: ReturnType<typeof createMockDb>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(accountRoutes, {
    prefix: '/api/settings/accounts',
    db: mockDb.db as never,
    encryptionKey: TEST_ENCRYPTION_KEY,
  });
  await app.ready();
  return app;
}

// =============================================================================
// Tests
// =============================================================================

describe('Account routes — /api/settings/accounts', () => {
  let app: FastifyInstance;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeAll(async () => {
    mockDb = createMockDb();
    app = await buildApp(mockDb);
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // GET /api/settings/accounts — list all accounts
  // ---------------------------------------------------------------------------

  describe('GET /api/settings/accounts', () => {
    it('returns 200 with an array of accounts with masked credentials', async () => {
      const accounts = [
        makeAccount(),
        makeAccount({ id: 'acct-002', name: 'Bedrock', provider: 'bedrock', priority: 1 }),
      ];
      mockDb.setRows(accounts);

      const response = await app.inject({
        method: 'GET',
        url: '/api/settings/accounts',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(2);
      // Credential should be masked, not raw
      expect(body[0].credentialMasked).toBeDefined();
      expect(body[0].credential).toBeUndefined();
      expect(body[0].credentialIv).toBeUndefined();
    });

    it('returns empty array when no accounts exist', async () => {
      mockDb.setRows([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/settings/accounts',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/settings/accounts/:id — get single account
  // ---------------------------------------------------------------------------

  describe('GET /api/settings/accounts/:id', () => {
    it('returns 200 with account details when account exists', async () => {
      const account = makeAccount();
      mockDb.setRows([account]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/settings/accounts/acct-001',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.id).toBe('acct-001');
      expect(body.name).toBe('Anthropic Direct');
      expect(body.credentialMasked).toBeDefined();
      // Raw credential and IV must not be exposed
      expect(body.credential).toBeUndefined();
      expect(body.credentialIv).toBeUndefined();
    });

    it('returns 404 when account does not exist', async () => {
      mockDb.setRows([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/settings/accounts/nonexistent',
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('ACCOUNT_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/settings/accounts — create a new account
  // ---------------------------------------------------------------------------

  describe('POST /api/settings/accounts', () => {
    it('creates an account and returns 201', async () => {
      const inserted = makeAccount({ credential: 'mock-encrypted', credentialIv: 'mock-iv' });
      mockDb.setRows([inserted]);

      const response = await app.inject({
        method: 'POST',
        url: '/api/settings/accounts',
        payload: {
          name: 'Anthropic Direct',
          provider: 'anthropic',
          credential: 'sk-ant-api03-my-secret-key-1234',
        },
      });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.id).toBe('acct-001');
      expect(body.name).toBe('Anthropic Direct');
      expect(body.credentialMasked).toBeDefined();
      // Raw credential must not be exposed
      expect(body.credential).toBeUndefined();
      expect(body.credentialIv).toBeUndefined();
    });

    it('returns 400 when name is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/settings/accounts',
        payload: {
          provider: 'anthropic',
          credential: 'sk-ant-api03-key',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_BODY');
    });

    it('returns 400 when provider is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/settings/accounts',
        payload: {
          name: 'Test',
          credential: 'sk-ant-api03-key',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_BODY');
    });

    it('returns 400 when credential is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/settings/accounts',
        payload: {
          name: 'Test',
          provider: 'anthropic',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_BODY');
    });
  });

  // ---------------------------------------------------------------------------
  // PUT /api/settings/accounts/:id — update an account
  // ---------------------------------------------------------------------------

  describe('PUT /api/settings/accounts/:id', () => {
    it('updates an account and returns 200', async () => {
      const updated = makeAccount({ name: 'Updated Name' });
      mockDb.setRows([updated]);

      const response = await app.inject({
        method: 'PUT',
        url: '/api/settings/accounts/acct-001',
        payload: {
          name: 'Updated Name',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.name).toBe('Updated Name');
    });

    it('returns 404 when account does not exist', async () => {
      mockDb.setRows([]);

      const response = await app.inject({
        method: 'PUT',
        url: '/api/settings/accounts/nonexistent',
        payload: {
          name: 'Updated Name',
        },
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('ACCOUNT_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/settings/accounts/:id — delete an account
  // ---------------------------------------------------------------------------

  describe('DELETE /api/settings/accounts/:id', () => {
    it('deletes an account and returns 200', async () => {
      const deleted = makeAccount();
      mockDb.setRows([deleted]);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/settings/accounts/acct-001',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });

    it('returns 404 when account does not exist', async () => {
      mockDb.setRows([]);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/settings/accounts/nonexistent',
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('ACCOUNT_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/settings/accounts/:id/test — test account connectivity
  // ---------------------------------------------------------------------------

  describe('POST /api/settings/accounts/:id/test', () => {
    it('returns 404 when account does not exist', async () => {
      mockDb.setRows([]);

      const response = await app.inject({
        method: 'POST',
        url: '/api/settings/accounts/nonexistent/test',
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('ACCOUNT_NOT_FOUND');
    });

    it('returns ok when API responds successfully', async () => {
      const account = makeAccount();
      mockDb.setRows([account]);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'msg_123', content: [] }),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/settings/accounts/acct-001/test',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);

      // Restore original fetch
      globalThis.fetch = originalFetch;
    });

    it('returns 400 when API responds with error', async () => {
      const account = makeAccount();
      mockDb.setRows([account]);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: { message: 'Invalid API key' },
        }),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/settings/accounts/acct-001/test',
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('ACCOUNT_TEST_FAILED');

      // Restore original fetch
      globalThis.fetch = originalFetch;
    });

    it('returns 500 when fetch throws (network error)', async () => {
      const account = makeAccount();
      mockDb.setRows([account]);

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/settings/accounts/acct-001/test',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('ACCOUNT_TEST_ERROR');

      // Restore original fetch
      globalThis.fetch = originalFetch;
    });

    // -----------------------------------------------------------------------
    // claude_max / claude_team — session token format validation
    // -----------------------------------------------------------------------

    it('claude_max: returns ok for valid token', async () => {
      const account = makeAccount({ provider: 'claude_max' });
      mockDb.setRows([account]);

      const response = await app.inject({
        method: 'POST',
        url: '/api/settings/accounts/acct-001/test',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });

    it('claude_max: returns 400 for empty/short token', async () => {
      const account = makeAccount({ provider: 'claude_max' });
      mockDb.setRows([account]);

      vi.mocked(decryptCredential).mockReturnValueOnce('');

      const response = await app.inject({
        method: 'POST',
        url: '/api/settings/accounts/acct-001/test',
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('ACCOUNT_TEST_FAILED');
      expect(body.message).toMatch(/too short or empty/);
    });

    // -----------------------------------------------------------------------
    // bedrock — KEY:SECRET:REGION format validation
    // -----------------------------------------------------------------------

    it('bedrock: returns ok for valid KEY:SECRET:REGION format', async () => {
      const account = makeAccount({ provider: 'bedrock' });
      mockDb.setRows([account]);

      vi.mocked(decryptCredential).mockReturnValueOnce('AKID:SECRET:us-west-2');

      const response = await app.inject({
        method: 'POST',
        url: '/api/settings/accounts/acct-001/test',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });

    it('bedrock: returns 400 for invalid format (missing parts)', async () => {
      const account = makeAccount({ provider: 'bedrock' });
      mockDb.setRows([account]);

      // Default mock returns 'sk-ant-api03-decrypted-key-1234' which has no colons
      const response = await app.inject({
        method: 'POST',
        url: '/api/settings/accounts/acct-001/test',
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('ACCOUNT_TEST_FAILED');
      expect(body.message).toMatch(/ACCESS_KEY_ID:SECRET_ACCESS_KEY:REGION/);
    });

    // -----------------------------------------------------------------------
    // vertex — JSON with client_email + private_key validation
    // -----------------------------------------------------------------------

    it('vertex: returns ok for valid JSON with required fields', async () => {
      const account = makeAccount({ provider: 'vertex' });
      mockDb.setRows([account]);

      vi.mocked(decryptCredential).mockReturnValueOnce(
        '{"client_email":"sa@project.iam.gserviceaccount.com","private_key":"-----BEGIN RSA PRIVATE KEY-----"}',
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/settings/accounts/acct-001/test',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });

    it('vertex: returns 400 for invalid JSON', async () => {
      const account = makeAccount({ provider: 'vertex' });
      mockDb.setRows([account]);

      // Default mock returns 'sk-ant-api03-decrypted-key-1234' which is not valid JSON
      const response = await app.inject({
        method: 'POST',
        url: '/api/settings/accounts/acct-001/test',
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('ACCOUNT_TEST_FAILED');
      expect(body.message).toMatch(/not valid JSON/);
    });

    it('vertex: returns 400 for JSON missing client_email', async () => {
      const account = makeAccount({ provider: 'vertex' });
      mockDb.setRows([account]);

      vi.mocked(decryptCredential).mockReturnValueOnce(
        '{"private_key":"-----BEGIN RSA PRIVATE KEY-----"}',
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/settings/accounts/acct-001/test',
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('ACCOUNT_TEST_FAILED');
      expect(body.message).toMatch(/client_email and private_key/);
    });
  });
});
