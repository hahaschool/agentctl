import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { oauthRoutes } from './oauth.js';

// ---------------------------------------------------------------------------
// Test encryption key — 32 bytes (64 hex chars) for AES-256
// ---------------------------------------------------------------------------

const TEST_ENCRYPTION_KEY = 'a'.repeat(64);

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
// App builder
// ---------------------------------------------------------------------------

async function buildApp(mockDb: ReturnType<typeof createMockDb>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(oauthRoutes, {
    prefix: '/api/oauth',
    db: mockDb.db as never,
    encryptionKey: TEST_ENCRYPTION_KEY,
  });
  await app.ready();
  return app;
}

// =============================================================================
// Tests
// =============================================================================

describe('OAuth PKCE routes — /api/oauth', () => {
  let app: FastifyInstance;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeAll(async () => {
    mockDb = createMockDb();
    app = await buildApp(mockDb);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // POST /api/oauth/initiate — start a PKCE OAuth flow
  // ---------------------------------------------------------------------------

  describe('POST /api/oauth/initiate', () => {
    it('returns authorizationUrl and state for claude_max provider', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/oauth/initiate',
        payload: {
          provider: 'claude_max',
          accountName: 'My Claude Max',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.authorizationUrl).toBeDefined();
      expect(body.state).toBeDefined();
      expect(typeof body.authorizationUrl).toBe('string');
      expect(typeof body.state).toBe('string');

      // The URL should point to the Anthropic OAuth authorize endpoint
      const url = new URL(body.authorizationUrl);
      expect(url.origin).toBe('https://auth.anthropic.com');
      expect(url.pathname).toBe('/oauth/authorize');

      // PKCE params must be present
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('code_challenge')).toBeDefined();
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('state')).toBe(body.state);
      expect(url.searchParams.get('scope')).toBe('user:inference');
    });

    it('returns authorizationUrl and state for claude_team provider', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/oauth/initiate',
        payload: {
          provider: 'claude_team',
          accountName: 'My Claude Team',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.authorizationUrl).toBeDefined();
      expect(body.state).toBeDefined();

      const url = new URL(body.authorizationUrl);
      expect(url.origin).toBe('https://auth.anthropic.com');
      expect(url.pathname).toBe('/oauth/authorize');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('rejects unsupported providers with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/oauth/initiate',
        payload: {
          provider: 'bedrock',
          accountName: 'My Bedrock',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('UNSUPPORTED_PROVIDER');
      expect(body.message).toContain('bedrock');
    });

    it('rejects unknown provider names with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/oauth/initiate',
        payload: {
          provider: 'totally_made_up',
          accountName: 'Fake',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('UNSUPPORTED_PROVIDER');
    });

    it('returns 400 when provider is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/oauth/initiate',
        payload: {
          accountName: 'My Account',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_BODY');
      expect(body.message).toContain('provider');
    });

    it('returns 400 when accountName is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/oauth/initiate',
        payload: {
          provider: 'claude_max',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_BODY');
      expect(body.message).toContain('accountName');
    });

    it('returns 400 when body is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/oauth/initiate',
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_BODY');
    });

    it('generates unique state values across multiple initiations', async () => {
      const response1 = await app.inject({
        method: 'POST',
        url: '/api/oauth/initiate',
        payload: { provider: 'claude_max', accountName: 'Account A' },
      });

      const response2 = await app.inject({
        method: 'POST',
        url: '/api/oauth/initiate',
        payload: { provider: 'claude_max', accountName: 'Account B' },
      });

      const state1 = response1.json().state;
      const state2 = response2.json().state;

      expect(state1).not.toBe(state2);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/oauth/callback — handle the OAuth redirect
  // ---------------------------------------------------------------------------

  describe('GET /api/oauth/callback', () => {
    it('returns error HTML when state is unknown', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback?code=auth-code-123&state=unknown-state-value',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');

      const html = response.body;
      expect(html).toContain('Unknown or expired OAuth state');
      expect(html).toContain('oauth_error');
    });

    it('returns error HTML when OAuth error params are present', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback?error=access_denied&error_description=User%20denied%20access',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');

      const html = response.body;
      expect(html).toContain('User denied access');
      expect(html).toContain('oauth_error');
    });

    it('returns error HTML with error code when error_description is absent', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback?error=server_error',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');

      const html = response.body;
      expect(html).toContain('server_error');
      expect(html).toContain('oauth_error');
    });

    it('returns error HTML when code is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback?state=some-state',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');

      const html = response.body;
      expect(html).toContain('Missing state or code parameter');
      expect(html).toContain('oauth_error');
    });

    it('returns error HTML when state is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback?code=auth-code-123',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');

      const html = response.body;
      expect(html).toContain('Missing state or code parameter');
      expect(html).toContain('oauth_error');
    });

    it('returns error HTML when both code and state are missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');

      const html = response.body;
      expect(html).toContain('Missing state or code parameter');
    });

    it('returns HTML that posts message to opener window', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback?error=access_denied',
      });

      const html = response.body;
      // The callback page should use postMessage to notify the opener window
      expect(html).toContain('window.opener');
      expect(html).toContain('postMessage');
      expect(html).toContain('window.close');
    });
  });
});
