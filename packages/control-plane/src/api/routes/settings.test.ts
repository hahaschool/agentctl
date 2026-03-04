import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { settingsRoutes } from './settings.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-03-04T12:00:00Z');

function makeMapping(overrides: Record<string, unknown> = {}) {
  return {
    id: 'map-001',
    projectPath: '/home/user/project-alpha',
    accountId: 'acct-001',
    createdAt: NOW,
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
// App builder
// ---------------------------------------------------------------------------

async function buildApp(mockDb: ReturnType<typeof createMockDb>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(settingsRoutes, {
    prefix: '/api/settings',
    db: mockDb.db as never,
  });
  await app.ready();
  return app;
}

// =============================================================================
// Tests
// =============================================================================

describe('Settings routes — /api/settings', () => {
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
  // GET /api/settings/defaults — retrieve default settings
  // ---------------------------------------------------------------------------

  describe('GET /api/settings/defaults', () => {
    it('returns defaults when settings exist', async () => {
      // The route makes two separate queries — one for default_account_id,
      // one for failover_policy. Our mock returns the same rows for all chains,
      // so we configure it to exercise the "found" path by returning a row.
      // However, because both queries share the same mock, we use a different
      // approach: we set the rows to return a setting-like row and verify the
      // route constructs the correct response shape.
      mockDb.setRows([{ key: 'default_account_id', value: { value: 'acct-123' }, updatedAt: NOW }]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/settings/defaults',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('defaultAccountId');
      expect(body).toHaveProperty('failoverPolicy');
    });

    it('returns fallbacks when no settings exist', async () => {
      mockDb.setRows([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/settings/defaults',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.defaultAccountId).toBeNull();
      expect(body.failoverPolicy).toBe('none');
    });
  });

  // ---------------------------------------------------------------------------
  // PUT /api/settings/defaults — upsert default settings
  // ---------------------------------------------------------------------------

  describe('PUT /api/settings/defaults', () => {
    it('upserts default_account_id setting', async () => {
      mockDb.setRows([]);

      const response = await app.inject({
        method: 'PUT',
        url: '/api/settings/defaults',
        payload: {
          defaultAccountId: 'acct-456',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });

    it('upserts failover_policy setting', async () => {
      mockDb.setRows([]);

      const response = await app.inject({
        method: 'PUT',
        url: '/api/settings/defaults',
        payload: {
          failoverPolicy: 'priority',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });

    it('upserts both settings at once', async () => {
      mockDb.setRows([]);

      const response = await app.inject({
        method: 'PUT',
        url: '/api/settings/defaults',
        payload: {
          defaultAccountId: 'acct-789',
          failoverPolicy: 'round_robin',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });

    it('returns 400 when body is empty', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/settings/defaults',
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_BODY');
    });

    it('returns 400 for invalid failover_policy value', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/settings/defaults',
        payload: {
          failoverPolicy: 'invalid_policy',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_FAILOVER_POLICY');
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/settings/project-accounts — list project→account mappings
  // ---------------------------------------------------------------------------

  describe('GET /api/settings/project-accounts', () => {
    it('returns list of project account mappings', async () => {
      const mappings = [
        makeMapping(),
        makeMapping({
          id: 'map-002',
          projectPath: '/home/user/project-beta',
          accountId: 'acct-002',
        }),
      ];
      mockDb.setRows(mappings);

      const response = await app.inject({
        method: 'GET',
        url: '/api/settings/project-accounts',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(2);
      expect(body[0].projectPath).toBe('/home/user/project-alpha');
      expect(body[1].projectPath).toBe('/home/user/project-beta');
    });

    it('returns empty array when no mappings exist', async () => {
      mockDb.setRows([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/settings/project-accounts',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // PUT /api/settings/project-accounts — upsert a project→account mapping
  // ---------------------------------------------------------------------------

  describe('PUT /api/settings/project-accounts', () => {
    it('upserts a new mapping and returns it', async () => {
      const inserted = makeMapping();
      mockDb.setRows([inserted]);

      const response = await app.inject({
        method: 'PUT',
        url: '/api/settings/project-accounts',
        payload: {
          projectPath: '/home/user/project-alpha',
          accountId: 'acct-001',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.id).toBe('map-001');
      expect(body.projectPath).toBe('/home/user/project-alpha');
      expect(body.accountId).toBe('acct-001');
    });

    it('returns 400 when projectPath is missing', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/settings/project-accounts',
        payload: {
          accountId: 'acct-001',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_BODY');
    });

    it('returns 400 when accountId is missing', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/settings/project-accounts',
        payload: {
          projectPath: '/home/user/project-alpha',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_BODY');
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/settings/project-accounts/:id — delete a mapping
  // ---------------------------------------------------------------------------

  describe('DELETE /api/settings/project-accounts/:id', () => {
    it('deletes a mapping and returns ok', async () => {
      const deleted = makeMapping();
      mockDb.setRows([deleted]);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/settings/project-accounts/map-001',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });

    it('returns 404 when mapping does not exist', async () => {
      mockDb.setRows([]);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/settings/project-accounts/nonexistent',
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('MAPPING_NOT_FOUND');
    });
  });
});
