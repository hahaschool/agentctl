import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { webhookRoutes } from './webhooks.js';

// ---------------------------------------------------------------------------
// Mock database helper — simulates db.execute() for webhook tables
// ---------------------------------------------------------------------------

type MockRow = Record<string, unknown>;

/**
 * Recursively flattens a Drizzle SQL tagged template object into { sql, params }.
 *
 * Drizzle's `sql` tagged template produces an object with a `queryChunks` array
 * that alternates between StringChunk objects ({ value: string[] }) and either
 * raw parameter values or nested SQL objects (for sql.join, etc.).
 */
function flattenDrizzleSql(chunks: unknown[]): { sql: string; params: unknown[] } {
  let sqlStr = '';
  const params: unknown[] = [];

  for (const chunk of chunks) {
    if (chunk && typeof chunk === 'object' && 'queryChunks' in chunk) {
      // Nested SQL object (e.g. from sql.join)
      const nested = flattenDrizzleSql((chunk as { queryChunks: unknown[] }).queryChunks);
      sqlStr += nested.sql;
      params.push(...nested.params);
    } else if (chunk && typeof chunk === 'object' && 'value' in chunk) {
      // StringChunk — literal SQL text
      sqlStr += (chunk as { value: string[] }).value.join('');
    } else {
      // Raw parameter value
      params.push(chunk);
      sqlStr += `$${params.length}`;
    }
  }

  return { sql: sqlStr, params };
}

function extractQuery(query: unknown): { sql: string; params: unknown[] } {
  // Drizzle ORM sql tagged templates produce objects with a queryChunks array
  if (query && typeof query === 'object' && 'queryChunks' in query) {
    return flattenDrizzleSql((query as { queryChunks: unknown[] }).queryChunks);
  }
  // Fallback for plain objects
  if (query && typeof query === 'object' && 'sql' in query) {
    return query as { sql: string; params: unknown[] };
  }
  return { sql: '', params: [] };
}

function createMockDb() {
  const subscriptions = new Map<string, MockRow>();
  const deliveries = new Map<string, MockRow>();

  const db = {
    execute: vi.fn(async (query: unknown) => {
      const { sql, params } = extractQuery(query);
      const normalised = sql.replace(/\s+/g, ' ').trim();

      // INSERT INTO webhook_subscriptions
      if (normalised.startsWith('INSERT INTO webhook_subscriptions')) {
        const [id, url, provider, secret, eventTypes, agentFilter, active, createdAt, updatedAt] =
          params as [
            string,
            string,
            string,
            string | null,
            string[],
            string[] | null,
            boolean,
            Date,
            Date,
          ];
        const row: MockRow = {
          id,
          url,
          provider,
          secret,
          event_types: eventTypes,
          agent_filter: agentFilter,
          active,
          created_at: createdAt,
          updated_at: updatedAt,
        };
        subscriptions.set(id, row);
        return { rows: [] };
      }

      // SELECT * FROM webhook_subscriptions ORDER BY created_at
      if (normalised.startsWith('SELECT * FROM webhook_subscriptions ORDER')) {
        const rows = [...subscriptions.values()].sort(
          (a, b) =>
            new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime(),
        );
        return { rows };
      }

      // SELECT * FROM webhook_subscriptions WHERE id = $1
      if (normalised.startsWith('SELECT * FROM webhook_subscriptions WHERE id')) {
        const row = subscriptions.get(params[0] as string);
        return { rows: row ? [row] : [] };
      }

      // SELECT id FROM webhook_subscriptions WHERE id = $1
      if (normalised.startsWith('SELECT id FROM webhook_subscriptions WHERE id')) {
        const row = subscriptions.get(params[0] as string);
        return { rows: row ? [{ id: row.id }] : [] };
      }

      // UPDATE webhook_subscriptions
      if (normalised.startsWith('UPDATE webhook_subscriptions')) {
        // The last param is the id (WHERE id = $N)
        const id = params[params.length - 1] as string;
        const existing = subscriptions.get(id);
        if (existing) {
          // Parse SET clause to apply updates
          const setMatch = normalised.match(/SET (.+) WHERE/);
          if (setMatch) {
            const assignments = setMatch[1].split(',').map((s) => s.trim());
            let paramIdx = 0;
            for (const assignment of assignments) {
              const colMatch = assignment.match(/^(\w+)\s*=/);
              if (colMatch) {
                existing[colMatch[1]] = params[paramIdx];
              }
              paramIdx++;
            }
          }
        }
        return { rows: [] };
      }

      // DELETE FROM webhook_deliveries WHERE subscription_id = $1
      if (normalised.startsWith('DELETE FROM webhook_deliveries')) {
        const subId = params[0] as string;
        for (const [key, row] of deliveries) {
          if (row.subscription_id === subId) {
            deliveries.delete(key);
          }
        }
        return { rows: [] };
      }

      // DELETE FROM webhook_subscriptions WHERE id = $1
      if (normalised.startsWith('DELETE FROM webhook_subscriptions')) {
        subscriptions.delete(params[0] as string);
        return { rows: [] };
      }

      // SELECT * FROM webhook_deliveries WHERE subscription_id = $1
      if (normalised.startsWith('SELECT * FROM webhook_deliveries')) {
        const subId = params[0] as string;
        const rows = [...deliveries.values()]
          .filter((d) => d.subscription_id === subId)
          .sort(
            (a, b) =>
              new Date(b.created_at as string).getTime() -
              new Date(a.created_at as string).getTime(),
          )
          .slice(0, 50);
        return { rows };
      }

      // INSERT INTO webhook_deliveries
      if (normalised.startsWith('INSERT INTO webhook_deliveries')) {
        const [
          id,
          subscriptionId,
          eventType,
          payload,
          status,
          statusCode,
          responseBody,
          attempts,
          createdAt,
          deliveredAt,
        ] = params as [
          string,
          string,
          string,
          Record<string, unknown>,
          string,
          number | null,
          string | null,
          number,
          Date,
          Date | null,
        ];
        const row: MockRow = {
          id,
          subscription_id: subscriptionId,
          event_type: eventType,
          payload,
          status,
          status_code: statusCode,
          response_body: responseBody,
          attempts,
          next_retry_at: null,
          created_at: createdAt,
          delivered_at: deliveredAt,
        };
        deliveries.set(id, row);
        return { rows: [] };
      }

      return { rows: [] };
    }),

    // Expose internal stores for test assertions
    _subscriptions: subscriptions,
    _deliveries: deliveries,
  };

  return db;
}

// ---------------------------------------------------------------------------
// Helper to create a standalone Fastify app with webhook routes registered.
// This avoids modifying server.ts while still testing the routes in isolation.
// ---------------------------------------------------------------------------

async function buildApp(mockDb: ReturnType<typeof createMockDb>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(webhookRoutes, { prefix: '/api/webhooks', db: mockDb as never });
  await app.ready();
  return app;
}

// =============================================================================
// Webhook CRUD routes
// =============================================================================

describe('Webhook routes — /api/webhooks', () => {
  let app: FastifyInstance;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeAll(async () => {
    mockDb = createMockDb();
    app = await buildApp(mockDb);
  });

  beforeEach(() => {
    mockDb._subscriptions.clear();
    mockDb._deliveries.clear();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // POST /api/webhooks — Create subscription
  // ---------------------------------------------------------------------------

  describe('POST /api/webhooks — create subscription', () => {
    it('creates a new webhook subscription and returns 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://hooks.slack.com/services/T00/B00/xxx',
          provider: 'slack',
          eventTypes: ['agent.started', 'agent.stopped'],
        },
      });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.subscription.url).toBe('https://hooks.slack.com/services/T00/B00/xxx');
      expect(body.subscription.provider).toBe('slack');
      expect(body.subscription.eventTypes).toEqual(['agent.started', 'agent.stopped']);
      expect(body.subscription.active).toBe(true);
      expect(body.subscription.id).toBeDefined();
    });

    it('defaults provider to "generic" when not specified', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['deploy.success'],
        },
      });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.subscription.provider).toBe('generic');
    });

    it('masks secret in the response', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          secret: 'super-secret-key',
          eventTypes: ['agent.error'],
        },
      });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.subscription.secret).toBe('****');
    });

    it('returns null secret when no secret is provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['agent.error'],
        },
      });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.subscription.secret).toBeNull();
    });

    it('accepts an agentFilter array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['agent.started'],
          agentFilter: ['agent-1', 'agent-2'],
        },
      });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.subscription.agentFilter).toEqual(['agent-1', 'agent-2']);
    });

    it('sets agentFilter to null when not provided (all agents)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['agent.started'],
        },
      });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.subscription.agentFilter).toBeNull();
    });

    it('stores the subscription in the database', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/stored',
          provider: 'discord',
          eventTypes: ['deploy.failure'],
        },
      });

      expect(response.statusCode).toBe(201);

      const { id } = response.json().subscription;
      expect(mockDb._subscriptions.has(id)).toBe(true);

      const stored = mockDb._subscriptions.get(id);
      expect(stored?.url).toBe('https://example.com/stored');
      expect(stored?.provider).toBe('discord');
    });

    // --- Validation errors ---

    it('returns 400 when URL is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          eventTypes: ['agent.started'],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_URL');
    });

    it('returns 400 when URL is empty string', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: '',
          eventTypes: ['agent.started'],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_URL');
    });

    it('returns 400 when URL is not a valid HTTP/HTTPS URL', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'ftp://example.com/webhook',
          eventTypes: ['agent.started'],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_URL');
    });

    it('returns 400 for a completely malformed URL', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'not-a-url-at-all',
          eventTypes: ['agent.started'],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_URL');
    });

    it('returns 400 for an invalid provider', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          provider: 'teams',
          eventTypes: ['agent.started'],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_PROVIDER');
    });

    it('returns 400 when eventTypes is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_EVENT_TYPES');
    });

    it('returns 400 when eventTypes is empty array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: [],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_EVENT_TYPES');
    });

    it('returns 400 for an invalid event type in the array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['agent.started', 'agent.exploded'],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_EVENT_TYPES');
      expect(body.message).toContain('agent.exploded');
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/webhooks — List subscriptions
  // ---------------------------------------------------------------------------

  describe('GET /api/webhooks — list subscriptions', () => {
    it('returns empty array when no subscriptions exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/webhooks',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.subscriptions).toEqual([]);
    });

    it('returns all subscriptions after creating them', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://hooks.slack.com/first',
          provider: 'slack',
          eventTypes: ['agent.started'],
        },
      });

      await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://discord.com/api/webhooks/second',
          provider: 'discord',
          eventTypes: ['agent.error'],
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/webhooks',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.subscriptions).toHaveLength(2);
    });

    it('masks secrets in the list response', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          secret: 'my-secret',
          eventTypes: ['agent.started'],
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/webhooks',
      });

      const body = response.json();
      expect(body.subscriptions[0].secret).toBe('****');
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/webhooks/:id — Get subscription details
  // ---------------------------------------------------------------------------

  describe('GET /api/webhooks/:id — get subscription', () => {
    it('returns a subscription by ID', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['deploy.success'],
        },
      });

      const { id } = createRes.json().subscription;

      const response = await app.inject({
        method: 'GET',
        url: `/api/webhooks/${id}`,
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.subscription.id).toBe(id);
      expect(body.subscription.url).toBe('https://example.com/webhook');
    });

    it('returns 404 for a non-existent subscription', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/webhooks/non-existent-id',
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('WEBHOOK_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/webhooks/:id — Update subscription
  // ---------------------------------------------------------------------------

  describe('PATCH /api/webhooks/:id — update subscription', () => {
    it('updates the URL of an existing subscription', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/old-url',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/webhooks/${id}`,
        payload: { url: 'https://example.com/new-url' },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.subscription.url).toBe('https://example.com/new-url');
    });

    it('toggles active to false (deactivate)', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/webhooks/${id}`,
        payload: { active: false },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.subscription.active).toBe(false);
    });

    it('toggles active back to true (reactivate)', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      // Deactivate
      await app.inject({
        method: 'PATCH',
        url: `/api/webhooks/${id}`,
        payload: { active: false },
      });

      // Reactivate
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/webhooks/${id}`,
        payload: { active: true },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.subscription.active).toBe(true);
    });

    it('updates eventTypes', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/webhooks/${id}`,
        payload: { eventTypes: ['agent.started', 'agent.error', 'deploy.failure'] },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });

    it('updates provider', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          provider: 'generic',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/webhooks/${id}`,
        payload: { provider: 'discord' },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.subscription.provider).toBe('discord');
    });

    it('clears secret by setting it to null', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          secret: 'old-secret',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/webhooks/${id}`,
        payload: { secret: null },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.subscription.secret).toBeNull();
    });

    it('returns 404 for a non-existent subscription', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/webhooks/non-existent-id',
        payload: { active: false },
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('WEBHOOK_NOT_FOUND');
    });

    it('returns 400 when no fields are provided', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/webhooks/${id}`,
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('EMPTY_UPDATE');
    });

    it('returns 400 for an invalid URL in update', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/webhooks/${id}`,
        payload: { url: 'not-a-url' },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_URL');
    });

    it('returns 400 for an invalid provider in update', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/webhooks/${id}`,
        payload: { provider: 'msteams' },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_PROVIDER');
    });

    it('returns 400 for empty eventTypes in update', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/webhooks/${id}`,
        payload: { eventTypes: [] },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_EVENT_TYPES');
    });

    it('returns 400 for invalid event type in update', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/webhooks/${id}`,
        payload: { eventTypes: ['agent.destroyed'] },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_EVENT_TYPES');
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/webhooks/:id — Delete subscription
  // ---------------------------------------------------------------------------

  describe('DELETE /api/webhooks/:id — delete subscription', () => {
    it('deletes an existing subscription and returns deletedId', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/webhooks/${id}`,
      });

      expect(deleteRes.statusCode).toBe(200);

      const body = deleteRes.json();
      expect(body.ok).toBe(true);
      expect(body.deletedId).toBe(id);
    });

    it('subscription is no longer retrievable after deletion', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      await app.inject({
        method: 'DELETE',
        url: `/api/webhooks/${id}`,
      });

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/webhooks/${id}`,
      });

      expect(getRes.statusCode).toBe(404);
    });

    it('returns 404 when deleting a non-existent subscription', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/webhooks/non-existent-id',
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('WEBHOOK_NOT_FOUND');
    });

    it('removes the subscription from the list', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      await app.inject({
        method: 'DELETE',
        url: `/api/webhooks/${id}`,
      });

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/webhooks',
      });

      const body = listRes.json();
      const ids = body.subscriptions.map((s: { id: string }) => s.id);
      expect(ids).not.toContain(id);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/webhooks/:id/deliveries — List deliveries
  // ---------------------------------------------------------------------------

  describe('GET /api/webhooks/:id/deliveries — list deliveries', () => {
    it('returns empty deliveries for a subscription with no deliveries', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      const response = await app.inject({
        method: 'GET',
        url: `/api/webhooks/${id}/deliveries`,
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.deliveries).toEqual([]);
    });

    it('returns 404 for deliveries of a non-existent subscription', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/webhooks/non-existent-id/deliveries',
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('WEBHOOK_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/webhooks/:id/test — Test delivery
  // ---------------------------------------------------------------------------

  describe('POST /api/webhooks/:id/test — test delivery', () => {
    it('returns 404 when testing a non-existent subscription', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks/non-existent-id/test',
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('WEBHOOK_NOT_FOUND');
    });

    it('sends a test delivery and records it (URL is unreachable so status is failed)', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://localhost:19999/unreachable-test-endpoint',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      const response = await app.inject({
        method: 'POST',
        url: `/api/webhooks/${id}/test`,
      });

      // The endpoint itself returns 200 even when the delivery fails
      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.delivery).toBeDefined();
      expect(body.delivery.subscriptionId).toBe(id);
      expect(body.delivery.eventType).toBe('agent.started');
      expect(body.delivery.status).toBe('failed');
    });

    it('test delivery includes delivery ID and timestamps', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://localhost:19999/unreachable',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      const response = await app.inject({
        method: 'POST',
        url: `/api/webhooks/${id}/test`,
      });

      const body = response.json();
      expect(body.delivery.id).toBeDefined();
      expect(typeof body.delivery.id).toBe('string');
      expect(body.delivery.createdAt).toBeDefined();
    });

    it('records the test delivery so it appears in deliveries list', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://localhost:19999/unreachable',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      // Send test delivery
      await app.inject({
        method: 'POST',
        url: `/api/webhooks/${id}/test`,
      });

      // Check deliveries
      const deliveriesRes = await app.inject({
        method: 'GET',
        url: `/api/webhooks/${id}/deliveries`,
      });

      expect(deliveriesRes.statusCode).toBe(200);

      const body = deliveriesRes.json();
      expect(body.deliveries).toHaveLength(1);
      expect(body.deliveries[0].subscriptionId).toBe(id);
      expect(body.deliveries[0].eventType).toBe('agent.started');
    });

    it('ok is false when delivery to target URL fails', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://localhost:19999/unreachable',
          eventTypes: ['agent.started'],
        },
      });

      const { id } = createRes.json().subscription;

      const response = await app.inject({
        method: 'POST',
        url: `/api/webhooks/${id}/test`,
      });

      const body = response.json();
      expect(body.ok).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Database error handling
  // ---------------------------------------------------------------------------

  describe('database error handling', () => {
    it('returns 500 when db.execute throws on list', async () => {
      mockDb.execute.mockRejectedValueOnce(new Error('connection reset'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/webhooks',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('WEBHOOK_LIST_FAILED');
    });

    it('returns 500 when db.execute throws on create', async () => {
      mockDb.execute.mockRejectedValueOnce(new Error('unique constraint violation'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['agent.started'],
        },
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('WEBHOOK_CREATE_FAILED');
    });

    it('returns 500 when db.execute throws on get by ID', async () => {
      mockDb.execute.mockRejectedValueOnce(new Error('query timeout'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/webhooks/some-id',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('WEBHOOK_GET_FAILED');
    });

    it('returns 500 when db.execute throws on delete', async () => {
      // First, create a subscription so the existence check passes
      await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
          eventTypes: ['agent.started'],
        },
      });

      // Make the second db call (DELETE FROM webhook_deliveries) fail
      const originalImpl = mockDb.execute.getMockImplementation();
      let callCount = 0;
      mockDb.execute.mockImplementation(async (query: unknown) => {
        callCount++;
        // First call is the SELECT id check (let it pass), then fail on the next
        if (callCount === 2) {
          throw new Error('delete failed');
        }
        if (originalImpl) {
          return originalImpl(query);
        }
        return { rows: [] };
      });

      // Trigger a list query so the mock db refreshes — result intentionally unused
      await app.inject({
        method: 'GET',
        url: '/api/webhooks',
      });

      // Reset for the actual delete test
      callCount = 0;
      const subscriptions = [...mockDb._subscriptions.keys()];
      if (subscriptions.length > 0) {
        const response = await app.inject({
          method: 'DELETE',
          url: `/api/webhooks/${subscriptions[0]}`,
        });

        expect(response.statusCode).toBe(500);
      }
    });
  });
});
