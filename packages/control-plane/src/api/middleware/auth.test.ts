import { createHash, createHmac } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthConfig,
  type AuthenticatedRequest,
  createAuthHook,
  generateBearerToken,
  hashApiKey,
  validateBearerToken,
} from './auth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SECRET = 'test-hmac-secret-for-tokens';
const TEST_API_KEY = 'agentctl_key_abcdef1234567890';
const TEST_API_KEY_HASH = hashApiKey(TEST_API_KEY);

function buildApp(config: AuthConfig): FastifyInstance {
  const app = Fastify({ logger: false });

  app.addHook('onRequest', createAuthHook(config));

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/metrics', async () => ({ metrics: [] }));
  app.get('/api/agents', async (request) => {
    const auth = (request as typeof request & { auth: AuthenticatedRequest }).auth;
    return { agents: [], auth };
  });
  app.post('/api/agents', async (request) => {
    const auth = (request as typeof request & { auth: AuthenticatedRequest }).auth;
    return { created: true, auth };
  });

  return app;
}

// =========================================================================
// hashApiKey
// =========================================================================

describe('hashApiKey', () => {
  it('returns a scrypt hash with algorithm, salt, and derived-key segments', () => {
    const hash = hashApiKey('some-key');
    expect(hash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  });

  it('produces different output for the same input because it uses a random salt', () => {
    const hash1 = hashApiKey('deterministic');
    const hash2 = hashApiKey('deterministic');
    expect(hash1).not.toBe(hash2);
  });

  it('produces different output for different inputs', () => {
    const hash1 = hashApiKey('key-a');
    const hash2 = hashApiKey('key-b');
    expect(hash1).not.toBe(hash2);
  });

  it('does not return a raw SHA-256 digest', () => {
    const key = 'verify-against-native';
    const sha256 = createHash('sha256').update(key).digest('hex');
    expect(hashApiKey(key)).not.toBe(sha256);
  });
});

// =========================================================================
// generateBearerToken
// =========================================================================

describe('generateBearerToken', () => {
  it('returns a token in <timestamp>.<signature> format', () => {
    const token = generateBearerToken(TEST_SECRET);
    const parts = token.split('.');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^\d+$/);
    expect(parts[1]).toMatch(/^[0-9a-f]+$/);
  });

  it('uses the current epoch seconds as the timestamp', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = generateBearerToken(TEST_SECRET);
    const after = Math.floor(Date.now() / 1000);

    const timestamp = Number.parseInt(token.split('.')[0], 10);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it('produces a valid HMAC-SHA256 signature', () => {
    const token = generateBearerToken(TEST_SECRET);
    const [timestamp, signature] = token.split('.');
    const expected = createHmac('sha256', TEST_SECRET).update(timestamp).digest('hex');
    expect(signature).toBe(expected);
  });

  it('produces different tokens with different secrets', () => {
    const t1 = generateBearerToken('secret-a');
    const t2 = generateBearerToken('secret-b');
    const sig1 = t1.split('.')[1];
    const sig2 = t2.split('.')[1];
    expect(sig1).not.toBe(sig2);
  });
});

// =========================================================================
// validateBearerToken
// =========================================================================

describe('validateBearerToken', () => {
  it('validates a freshly generated token', () => {
    const token = generateBearerToken(TEST_SECRET);
    expect(validateBearerToken(token, TEST_SECRET)).toBe(true);
  });

  it('rejects a token signed with a different secret', () => {
    const token = generateBearerToken('wrong-secret');
    expect(validateBearerToken(token, TEST_SECRET)).toBe(false);
  });

  it('rejects an expired token (beyond maxAgeSeconds)', () => {
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
    const signature = createHmac('sha256', TEST_SECRET).update(oldTimestamp).digest('hex');
    const token = `${oldTimestamp}.${signature}`;
    expect(validateBearerToken(token, TEST_SECRET, 300)).toBe(false);
  });

  it('accepts a token within custom maxAgeSeconds', () => {
    const recentTimestamp = (Math.floor(Date.now() / 1000) - 10).toString();
    const signature = createHmac('sha256', TEST_SECRET).update(recentTimestamp).digest('hex');
    const token = `${recentTimestamp}.${signature}`;
    expect(validateBearerToken(token, TEST_SECRET, 60)).toBe(true);
  });

  it('rejects a token with no dot separator', () => {
    expect(validateBearerToken('notokenformat', TEST_SECRET)).toBe(false);
  });

  it('rejects a token with empty timestamp', () => {
    expect(validateBearerToken('.abcdef1234', TEST_SECRET)).toBe(false);
  });

  it('rejects a token with non-numeric timestamp', () => {
    expect(validateBearerToken('abc.def1234', TEST_SECRET)).toBe(false);
  });

  it('rejects a token with empty signature', () => {
    expect(validateBearerToken('12345.', TEST_SECRET)).toBe(false);
  });

  it('rejects a token with tampered signature', () => {
    const token = generateBearerToken(TEST_SECRET);
    const [timestamp] = token.split('.');
    const tampered = `${timestamp}.${'a'.repeat(64)}`;
    expect(validateBearerToken(tampered, TEST_SECRET)).toBe(false);
  });

  it('uses 300 seconds as default maxAgeSeconds', () => {
    // Token 4 minutes old — within 300s
    const ts4min = (Math.floor(Date.now() / 1000) - 240).toString();
    const sig4min = createHmac('sha256', TEST_SECRET).update(ts4min).digest('hex');
    expect(validateBearerToken(`${ts4min}.${sig4min}`, TEST_SECRET)).toBe(true);

    // Token 6 minutes old — beyond 300s
    const ts6min = (Math.floor(Date.now() / 1000) - 360).toString();
    const sig6min = createHmac('sha256', TEST_SECRET).update(ts6min).digest('hex');
    expect(validateBearerToken(`${ts6min}.${sig6min}`, TEST_SECRET)).toBe(false);
  });
});

// =========================================================================
// createAuthHook — auth disabled
// =========================================================================

describe('createAuthHook — auth disabled', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({
      enabled: false,
      apiKeys: [TEST_API_KEY_HASH],
      bearerTokenSecret: TEST_SECRET,
      skipPaths: ['/health', '/metrics'],
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows requests without any auth header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.auth.authMethod).toBe('none');
  });

  it('allows requests with an invalid auth header when disabled', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: 'Bearer totally-invalid' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().auth.authMethod).toBe('none');
  });
});

// =========================================================================
// createAuthHook — skip paths
// =========================================================================

describe('createAuthHook — skip paths', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({
      enabled: true,
      apiKeys: [TEST_API_KEY_HASH],
      bearerTokenSecret: TEST_SECRET,
      skipPaths: ['/health', '/metrics'],
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('skips auth for /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('skips auth for /metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
  });

  it('skips auth for /health with query string', async () => {
    const res = await app.inject({ method: 'GET', url: '/health?detail=true' });
    expect(res.statusCode).toBe(200);
  });

  it('does NOT skip auth for non-skip paths', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(res.statusCode).toBe(401);
  });
});

// =========================================================================
// createAuthHook — API key authentication
// =========================================================================

describe('createAuthHook — API key authentication', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({
      enabled: true,
      apiKeys: [TEST_API_KEY_HASH],
      bearerTokenSecret: TEST_SECRET,
      skipPaths: ['/health'],
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('authenticates with a valid API key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `ApiKey ${TEST_API_KEY}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.auth.authMethod).toBe('api-key');
  });

  it('sets authKeyId to last 4 chars of the raw key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `ApiKey ${TEST_API_KEY}` },
    });
    const body = res.json();
    expect(body.auth.authKeyId).toBe(TEST_API_KEY.slice(-4));
  });

  it('rejects an invalid API key with 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: 'ApiKey wrong-key-entirely' },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe('AUTH_INVALID');
  });

  it('handles case-insensitive scheme: apikey', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `apikey ${TEST_API_KEY}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().auth.authMethod).toBe('api-key');
  });

  it('handles case-insensitive scheme: APIKEY', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `APIKEY ${TEST_API_KEY}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().auth.authMethod).toBe('api-key');
  });

  it('supports multiple configured API keys', async () => {
    const secondKey = 'second-api-key-xyz';
    const multiApp = buildApp({
      enabled: true,
      apiKeys: [TEST_API_KEY_HASH, hashApiKey(secondKey)],
      skipPaths: [],
    });
    await multiApp.ready();

    const res1 = await multiApp.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `ApiKey ${TEST_API_KEY}` },
    });
    expect(res1.statusCode).toBe(200);

    const res2 = await multiApp.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `ApiKey ${secondKey}` },
    });
    expect(res2.statusCode).toBe(200);

    await multiApp.close();
  });
});

// =========================================================================
// createAuthHook — bearer token authentication
// =========================================================================

describe('createAuthHook — bearer token authentication', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({
      enabled: true,
      apiKeys: [TEST_API_KEY_HASH],
      bearerTokenSecret: TEST_SECRET,
      skipPaths: ['/health'],
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('authenticates with a valid bearer token', async () => {
    const token = generateBearerToken(TEST_SECRET);
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.auth.authMethod).toBe('bearer-token');
  });

  it('sets authKeyId to last 4 chars of the token', async () => {
    const token = generateBearerToken(TEST_SECRET);
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `Bearer ${token}` },
    });
    const body = res.json();
    expect(body.auth.authKeyId).toBe(token.slice(-4));
  });

  it('rejects a bearer token with wrong secret', async () => {
    const token = generateBearerToken('wrong-secret');
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('AUTH_INVALID');
  });

  it('rejects an expired bearer token', async () => {
    const oldTs = (Math.floor(Date.now() / 1000) - 600).toString();
    const sig = createHmac('sha256', TEST_SECRET).update(oldTs).digest('hex');
    const expired = `${oldTs}.${sig}`;

    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `Bearer ${expired}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('AUTH_INVALID');
  });

  it('rejects a bearer token with bad format', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: 'Bearer not-a-valid-token' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('handles case-insensitive scheme: bearer', async () => {
    const token = generateBearerToken(TEST_SECRET);
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().auth.authMethod).toBe('bearer-token');
  });

  it('handles case-insensitive scheme: BEARER', async () => {
    const token = generateBearerToken(TEST_SECRET);
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `BEARER ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().auth.authMethod).toBe('bearer-token');
  });

  it('rejects bearer token when bearerTokenSecret is not configured', async () => {
    const noSecretApp = buildApp({
      enabled: true,
      apiKeys: [TEST_API_KEY_HASH],
      skipPaths: [],
    });
    await noSecretApp.ready();

    const token = generateBearerToken(TEST_SECRET);
    const res = await noSecretApp.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('AUTH_INVALID');

    await noSecretApp.close();
  });
});

// =========================================================================
// createAuthHook — missing / invalid authorization header
// =========================================================================

describe('createAuthHook — missing / malformed auth', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({
      enabled: true,
      apiKeys: [TEST_API_KEY_HASH],
      bearerTokenSecret: TEST_SECRET,
      skipPaths: ['/health'],
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.code).toBe('AUTH_REQUIRED');
    expect(body.error).toBe('Authentication required');
  });

  it('returns 401 when Authorization header has no space separator', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: 'BearerNoSpace' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_REQUIRED');
  });

  it('returns 401 for unrecognized auth scheme', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_REQUIRED');
  });

  it('returns 401 for empty Authorization header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: '' },
    });
    expect(res.statusCode).toBe(401);
  });
});

// =========================================================================
// createAuthHook — mixed auth scenarios
// =========================================================================

describe('createAuthHook — mixed scenarios', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({
      enabled: true,
      apiKeys: [TEST_API_KEY_HASH],
      bearerTokenSecret: TEST_SECRET,
      skipPaths: ['/health', '/metrics'],
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('API key works on POST routes too', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      headers: { authorization: `ApiKey ${TEST_API_KEY}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().auth.authMethod).toBe('api-key');
  });

  it('bearer token works on POST routes too', async () => {
    const token = generateBearerToken(TEST_SECRET);
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().auth.authMethod).toBe('bearer-token');
  });

  it('skip paths bypass auth even with an invalid header present', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: 'Bearer garbage' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('protected path fails then succeeds with correct key', async () => {
    const fail = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: 'ApiKey wrong' },
    });
    expect(fail.statusCode).toBe(403);

    const success = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `ApiKey ${TEST_API_KEY}` },
    });
    expect(success.statusCode).toBe(200);
  });

  it('authKeyId never exposes the full key (only last 4 chars)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `ApiKey ${TEST_API_KEY}` },
    });
    const body = res.json();
    expect(body.auth.authKeyId).toHaveLength(4);
    expect(TEST_API_KEY).toContain(body.auth.authKeyId);
    expect(body.auth.authKeyId).not.toBe(TEST_API_KEY);
  });

  it('different auth methods coexist on the same endpoint', async () => {
    const tokenRes = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `Bearer ${generateBearerToken(TEST_SECRET)}` },
    });
    expect(tokenRes.json().auth.authMethod).toBe('bearer-token');

    const keyRes = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `ApiKey ${TEST_API_KEY}` },
    });
    expect(keyRes.json().auth.authMethod).toBe('api-key');
  });
});
