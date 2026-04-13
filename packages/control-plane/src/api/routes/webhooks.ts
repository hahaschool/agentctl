import crypto from 'node:crypto';
import type { WebhookEventType, WebhookProvider } from '@agentctl/shared';
import { ControlPlaneError, WEBHOOK_EVENT_TYPES, WEBHOOK_PROVIDERS } from '@agentctl/shared';
import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { type Database, extractRows } from '../../db/index.js';
import { clampLimit, PAGINATION } from '../constants.js';
import { readRateLimitEnv } from '../rate-limit.js';

// Webhook write payloads are stored verbatim and used for outbound fetches.
// Caps prevent oversized URLs (log/store bloat), arbitrary-size secrets
// (memory exhaustion via the subscription table), and ballooning event/filter
// arrays. 64 event types + 256 agent filter entries is generous for real UIs.
const MAX_WEBHOOK_URL_LENGTH = 2_048;
const MAX_WEBHOOK_SECRET_LENGTH = 512;
const MAX_WEBHOOK_EVENT_TYPES = 64;
const MAX_WEBHOOK_AGENT_FILTER = 256;
const MAX_WEBHOOK_AGENT_FILTER_ITEM_LENGTH = 128;

// Rate-limit webhook write paths + the test delivery endpoint: creates persist
// provider secrets, updates/deletes touch the subscription store, and /test
// issues an outbound HTTP call to an arbitrary URL. A flood could be used as
// an outbound-traffic amplifier (SSRF-style abuse of stored URLs) or to
// exhaust the subscription / delivery store.
const WEBHOOKS_RATE_LIMIT = {
  max: 20,
  timeWindow: 60_000,
} as const;

// NOTE: This module uses the existing WebhookProvider and WebhookEventType
// types from @agentctl/shared (packages/shared/src/types/webhook.ts).

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebhookRoutesOptions = {
  db: Database;
};

type WebhookSubscriptionRow = {
  id: string;
  url: string;
  provider: string;
  secret: string | null;
  event_types: string[];
  agent_filter: string[] | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

type WebhookDeliveryRow = {
  id: string;
  subscription_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: string;
  status_code: number | null;
  response_body: string | null;
  attempts: number;
  next_retry_at: Date | null;
  created_at: Date;
  delivered_at: Date | null;
};

type CreateWebhookBody = {
  url: string;
  provider?: string;
  secret?: string;
  eventTypes: string[];
  agentFilter?: string[];
};

type UpdateWebhookBody = {
  url?: string;
  provider?: string;
  secret?: string | null;
  eventTypes?: string[];
  agentFilter?: string[] | null;
  active?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidProvider(value: string): value is WebhookProvider {
  return (WEBHOOK_PROVIDERS as readonly string[]).includes(value);
}

function isValidEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

// Shared Zod primitives for webhook schemas. Using a single definition keeps
// POST (create) and PATCH (update) validation aligned as new bounds are added.
const urlSchema = z
  .string()
  .min(1)
  .max(MAX_WEBHOOK_URL_LENGTH)
  .refine(isValidUrl, { message: '"url" must be a valid HTTP or HTTPS URL' });

const providerSchema = z.string().refine(isValidProvider, { message: 'invalid provider' });

const eventTypesSchema = z
  .array(z.string().refine(isValidEventType, { message: 'invalid event type' }))
  .min(1)
  .max(MAX_WEBHOOK_EVENT_TYPES);

const agentFilterSchema = z
  .array(z.string().min(1).max(MAX_WEBHOOK_AGENT_FILTER_ITEM_LENGTH))
  .max(MAX_WEBHOOK_AGENT_FILTER);

const createWebhookBodySchema = z.object({
  url: urlSchema,
  provider: providerSchema.optional(),
  secret: z.string().max(MAX_WEBHOOK_SECRET_LENGTH).optional(),
  eventTypes: eventTypesSchema,
  agentFilter: agentFilterSchema.optional(),
});

const updateWebhookBodySchema = z.object({
  url: urlSchema.optional(),
  provider: providerSchema.optional(),
  secret: z.string().max(MAX_WEBHOOK_SECRET_LENGTH).nullable().optional(),
  eventTypes: eventTypesSchema.optional(),
  agentFilter: agentFilterSchema.nullable().optional(),
  active: z.boolean().optional(),
});

// Map Zod issues for webhook bodies back to the stable per-field error codes
// existing clients already handle, so tightening schemas doesn't change the
// wire-level error vocabulary. `rawBody` is the original (pre-parse) body so
// we can surface the offending array entry for error types that embed it
// (e.g. which eventType string was rejected).
function mapWebhookIssue(
  issue: z.ZodIssue | undefined,
  rawBody?: unknown,
): { error: string; message: string } {
  const pickFromRaw = (): unknown => {
    if (!issue || !rawBody || typeof rawBody !== 'object') {
      return undefined;
    }
    let current: unknown = rawBody;
    for (const segment of issue.path) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = (current as Record<string | number, unknown>)[segment as string | number];
    }
    return current;
  };
  const field = issue?.path[0];
  switch (field) {
    case 'url':
      if (issue?.code === 'too_big') {
        return {
          error: 'URL_TOO_LONG',
          message: `URL must be under ${MAX_WEBHOOK_URL_LENGTH} characters`,
        };
      }
      return {
        error: 'INVALID_URL',
        message: '"url" must be a valid HTTP or HTTPS URL',
      };
    case 'provider': {
      const bad = pickFromRaw();
      const badStr = typeof bad === 'string' ? ` "${bad}"` : '';
      return {
        error: 'INVALID_PROVIDER',
        message: `Invalid provider${badStr}. Must be one of: ${WEBHOOK_PROVIDERS.join(', ')}`,
      };
    }
    case 'secret':
      return {
        error: 'INVALID_SECRET',
        message: `"secret" must be a string of at most ${MAX_WEBHOOK_SECRET_LENGTH} characters`,
      };
    case 'eventTypes':
      if (issue?.code === 'too_big') {
        return {
          error: 'INVALID_EVENT_TYPES',
          message: `"eventTypes" must contain at most ${MAX_WEBHOOK_EVENT_TYPES} entries`,
        };
      }
      if (issue?.code === 'too_small') {
        return {
          error: 'INVALID_EVENT_TYPES',
          message: 'A non-empty "eventTypes" array is required',
        };
      }
      {
        const bad = pickFromRaw();
        const badStr = typeof bad === 'string' ? ` "${bad}"` : '';
        return {
          error: 'INVALID_EVENT_TYPES',
          message: `Invalid event type${badStr}. Must be one of: ${WEBHOOK_EVENT_TYPES.join(', ')}`,
        };
      }
    case 'agentFilter':
      return {
        error: 'INVALID_AGENT_FILTER',
        message: `"agentFilter" must be an array of up to ${MAX_WEBHOOK_AGENT_FILTER} agent IDs (each ≤ ${MAX_WEBHOOK_AGENT_FILTER_ITEM_LENGTH} chars)`,
      };
    case 'active':
      return {
        error: 'INVALID_ACTIVE',
        message: '"active" must be a boolean',
      };
    default:
      return {
        error: 'INVALID_WEBHOOK_BODY',
        message: 'Invalid webhook body',
      };
  }
}

function formatSubscription(row: WebhookSubscriptionRow): Record<string, unknown> {
  return {
    id: row.id,
    url: row.url,
    provider: row.provider,
    secret: row.secret ? '****' : null,
    eventTypes: row.event_types,
    agentFilter: row.agent_filter,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatDelivery(row: WebhookDeliveryRow): Record<string, unknown> {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    eventType: row.event_type,
    payload: row.payload,
    status: row.status,
    statusCode: row.status_code,
    responseBody: row.response_body,
    attempts: row.attempts,
    nextRetryAt: row.next_retry_at,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const webhookRoutes: FastifyPluginAsync<WebhookRoutesOptions> = async (app, opts) => {
  const { db } = opts;

  const webhooksRateLimitMax = readRateLimitEnv('WEBHOOKS_RATE_LIMIT_MAX', WEBHOOKS_RATE_LIMIT.max);
  const webhooksRateLimitWindowMs = readRateLimitEnv(
    'WEBHOOKS_RATE_LIMIT_WINDOW_MS',
    WEBHOOKS_RATE_LIMIT.timeWindow,
  );
  const webhooksRateLimitError = () => ({
    statusCode: 429,
    error: 'RATE_LIMITED',
    message: 'Too many webhook requests',
  });
  const webhooksFastifyRateLimit = {
    max: webhooksRateLimitMax,
    timeWindow: webhooksRateLimitWindowMs,
    errorResponseBuilder: webhooksRateLimitError,
  } as const;

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) =>
      request.ip ??
      (typeof request.headers['x-forwarded-for'] === 'string'
        ? request.headers['x-forwarded-for']
        : 'unknown'),
    errorResponseBuilder: webhooksRateLimitError,
  });

  // ---------------------------------------------------------------------------
  // POST / — Create a new webhook subscription
  // ---------------------------------------------------------------------------

  app.post<{ Body: CreateWebhookBody }>(
    '/',
    {
      schema: { tags: ['webhooks'], summary: 'Create a new webhook subscription' },
      config: { rateLimit: webhooksFastifyRateLimit },
      preHandler: [app.rateLimit(webhooksFastifyRateLimit)],
    },
    async (request, reply) => {
      const parsed = createWebhookBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(mapWebhookIssue(parsed.error.issues[0], request.body));
      }
      const { url, provider = 'generic', secret, eventTypes, agentFilter } = parsed.data;

      const id = crypto.randomUUID();
      const now = new Date();

      try {
        await db.execute(
          sql`INSERT INTO webhook_subscriptions (id, url, provider, secret, event_types, agent_filter, active, created_at, updated_at)
            VALUES (${id}, ${url}, ${provider}, ${secret ?? null}, ${eventTypes}, ${agentFilter ?? null}, ${true}, ${now}, ${now})`,
        );

        return reply.code(201).send({
          ok: true,
          subscription: {
            id,
            url,
            provider,
            secret: secret ? '****' : null,
            eventTypes,
            agentFilter: agentFilter ?? null,
            active: true,
            createdAt: now,
            updatedAt: now,
          },
        });
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(500).send({
          error: 'WEBHOOK_CREATE_FAILED',
          message: `Failed to create webhook subscription: ${message}`,
        });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET / — List all webhook subscriptions
  // ---------------------------------------------------------------------------

  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/',
    { schema: { tags: ['webhooks'], summary: 'List all webhook subscriptions' } },
    async (request, reply) => {
      let limit = PAGINATION.webhooks.defaultLimit;
      if (request.query.limit !== undefined) {
        const parsed = Number(request.query.limit);
        if (!Number.isFinite(parsed) || parsed < 1) {
          return reply.code(400).send({
            error: 'INVALID_LIMIT',
            message: '"limit" must be a positive integer',
          });
        }
        limit = clampLimit(parsed, PAGINATION.webhooks);
      }

      let offset = 0;
      if (request.query.offset !== undefined) {
        const parsed = Number(request.query.offset);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return reply.code(400).send({
            error: 'INVALID_OFFSET',
            message: '"offset" must be a non-negative integer',
          });
        }
        offset = Math.floor(parsed);
      }

      try {
        const result = await db.execute(
          sql`SELECT * FROM webhook_subscriptions ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        );

        const subscriptions = extractRows<WebhookSubscriptionRow>(result).map(formatSubscription);

        return { subscriptions, limit, offset };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({
          error: 'WEBHOOK_LIST_FAILED',
          message: 'Failed to list webhook subscriptions',
        });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /:id — Get a single webhook subscription
  // ---------------------------------------------------------------------------

  app.get<{ Params: { id: string } }>(
    '/:id',
    { schema: { tags: ['webhooks'], summary: 'Get a webhook subscription by ID' } },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const result = await db.execute(sql`SELECT * FROM webhook_subscriptions WHERE id = ${id}`);

        if (result.rows.length === 0) {
          throw new ControlPlaneError(
            'WEBHOOK_NOT_FOUND',
            `Webhook subscription '${id}' not found`,
            {
              webhookId: id,
            },
          );
        }

        const row = extractRows<WebhookSubscriptionRow>(result)[0];
        return { subscription: formatSubscription(row) };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          if (error.code === 'WEBHOOK_NOT_FOUND') {
            return reply.code(404).send({ error: error.code, message: error.message });
          }
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({
          error: 'WEBHOOK_GET_FAILED',
          message: 'Failed to get webhook subscription',
        });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // PATCH /:id — Update a webhook subscription
  // ---------------------------------------------------------------------------

  app.patch<{ Params: { id: string }; Body: UpdateWebhookBody }>(
    '/:id',
    {
      schema: { tags: ['webhooks'], summary: 'Update a webhook subscription' },
      config: { rateLimit: webhooksFastifyRateLimit },
      preHandler: [app.rateLimit(webhooksFastifyRateLimit)],
    },
    async (request, reply) => {
      const { id } = request.params;
      const parsedBody = updateWebhookBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send(mapWebhookIssue(parsedBody.error.issues[0], request.body));
      }
      const { url, provider, secret, eventTypes, agentFilter, active } = parsedBody.data;

      try {
        const existing = await db.execute(
          sql`SELECT * FROM webhook_subscriptions WHERE id = ${id}`,
        );

        if (existing.rows.length === 0) {
          throw new ControlPlaneError(
            'WEBHOOK_NOT_FOUND',
            `Webhook subscription '${id}' not found`,
            {
              webhookId: id,
            },
          );
        }

        // Build dynamic SET clause fragments
        const setParts: ReturnType<typeof sql>[] = [];

        if (url !== undefined) {
          setParts.push(sql`url = ${url}`);
        }
        if (provider !== undefined) {
          setParts.push(sql`provider = ${provider}`);
        }
        if (secret !== undefined) {
          setParts.push(sql`secret = ${secret}`);
        }
        if (eventTypes !== undefined) {
          setParts.push(sql`event_types = ${eventTypes}`);
        }
        if (agentFilter !== undefined) {
          setParts.push(sql`agent_filter = ${agentFilter}`);
        }
        if (active !== undefined) {
          setParts.push(sql`active = ${active}`);
        }

        if (setParts.length === 0) {
          return reply.code(400).send({
            error: 'EMPTY_UPDATE',
            message: 'No fields to update',
          });
        }

        const now = new Date();
        setParts.push(sql`updated_at = ${now}`);

        // Join SET clauses with commas using sql.join
        const setClause = sql.join(setParts, sql`, `);

        await db.execute(sql`UPDATE webhook_subscriptions SET ${setClause} WHERE id = ${id}`);

        const updated = await db.execute(sql`SELECT * FROM webhook_subscriptions WHERE id = ${id}`);

        const row = extractRows<WebhookSubscriptionRow>(updated)[0];
        return { ok: true, subscription: formatSubscription(row) };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          if (error.code === 'WEBHOOK_NOT_FOUND') {
            return reply.code(404).send({ error: error.code, message: error.message });
          }
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({
          error: 'WEBHOOK_UPDATE_FAILED',
          message: 'Failed to update webhook subscription',
        });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // DELETE /:id — Delete a webhook subscription
  // ---------------------------------------------------------------------------

  app.delete<{ Params: { id: string } }>(
    '/:id',
    {
      schema: { tags: ['webhooks'], summary: 'Delete a webhook subscription' },
      config: { rateLimit: webhooksFastifyRateLimit },
      preHandler: [app.rateLimit(webhooksFastifyRateLimit)],
    },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const existing = await db.execute(
          sql`SELECT id FROM webhook_subscriptions WHERE id = ${id}`,
        );

        if (existing.rows.length === 0) {
          throw new ControlPlaneError(
            'WEBHOOK_NOT_FOUND',
            `Webhook subscription '${id}' not found`,
            {
              webhookId: id,
            },
          );
        }

        await db.execute(sql`DELETE FROM webhook_deliveries WHERE subscription_id = ${id}`);
        await db.execute(sql`DELETE FROM webhook_subscriptions WHERE id = ${id}`);

        return { ok: true, deletedId: id };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          if (error.code === 'WEBHOOK_NOT_FOUND') {
            return reply.code(404).send({ error: error.code, message: error.message });
          }
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({
          error: 'WEBHOOK_DELETE_FAILED',
          message: 'Failed to delete webhook subscription',
        });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /:id/deliveries — List recent deliveries for a subscription
  // ---------------------------------------------------------------------------

  app.get<{ Params: { id: string } }>(
    '/:id/deliveries',
    { schema: { tags: ['webhooks'], summary: 'List recent deliveries for a subscription' } },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const existing = await db.execute(
          sql`SELECT id FROM webhook_subscriptions WHERE id = ${id}`,
        );

        if (existing.rows.length === 0) {
          throw new ControlPlaneError(
            'WEBHOOK_NOT_FOUND',
            `Webhook subscription '${id}' not found`,
            {
              webhookId: id,
            },
          );
        }

        const result = await db.execute(
          sql`SELECT * FROM webhook_deliveries
            WHERE subscription_id = ${id}
            ORDER BY created_at DESC
            LIMIT 50`,
        );

        const deliveries = extractRows<WebhookDeliveryRow>(result).map(formatDelivery);

        return { deliveries };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          if (error.code === 'WEBHOOK_NOT_FOUND') {
            return reply.code(404).send({ error: error.code, message: error.message });
          }
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({
          error: 'WEBHOOK_DELIVERIES_FAILED',
          message: 'Failed to list webhook deliveries',
        });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // POST /:id/test — Send a test webhook delivery
  // ---------------------------------------------------------------------------

  app.post<{ Params: { id: string } }>(
    '/:id/test',
    {
      schema: { tags: ['webhooks'], summary: 'Send a test webhook delivery' },
      config: { rateLimit: webhooksFastifyRateLimit },
      preHandler: [app.rateLimit(webhooksFastifyRateLimit)],
    },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const existing = await db.execute(
          sql`SELECT * FROM webhook_subscriptions WHERE id = ${id}`,
        );

        if (existing.rows.length === 0) {
          throw new ControlPlaneError(
            'WEBHOOK_NOT_FOUND',
            `Webhook subscription '${id}' not found`,
            {
              webhookId: id,
            },
          );
        }

        const subscription = extractRows<WebhookSubscriptionRow>(existing)[0];

        const deliveryId = crypto.randomUUID();
        const now = new Date();

        const testPayload = {
          event: 'agent.started' as const,
          timestamp: now.toISOString(),
          data: {
            test: true,
            subscriptionId: id,
            message: 'This is a test webhook delivery from AgentCTL',
          },
        };

        let deliveryStatus = 'pending';
        let statusCode: number | null = null;
        let responseBody: string | null = null;
        let deliveredAt: Date | null = null;

        try {
          const response = await fetch(subscription.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testPayload),
            signal: AbortSignal.timeout(10_000),
          });

          statusCode = response.status;
          responseBody = await response.text().catch(() => null);

          if (response.ok) {
            deliveryStatus = 'delivered';
            deliveredAt = new Date();
          } else {
            deliveryStatus = 'failed';
          }
        } catch (fetchError: unknown) {
          deliveryStatus = 'failed';
          responseBody = fetchError instanceof Error ? fetchError.message : 'Delivery failed';
        }

        await db.execute(
          sql`INSERT INTO webhook_deliveries (id, subscription_id, event_type, payload, status, status_code, response_body, attempts, created_at, delivered_at)
            VALUES (${deliveryId}, ${id}, ${'agent.started'}, ${JSON.stringify(testPayload)}, ${deliveryStatus}, ${statusCode}, ${responseBody}, ${1}, ${now}, ${deliveredAt})`,
        );

        return {
          ok: deliveryStatus === 'delivered',
          delivery: {
            id: deliveryId,
            subscriptionId: id,
            eventType: 'agent.started',
            status: deliveryStatus,
            statusCode,
            responseBody,
            createdAt: now,
            deliveredAt,
          },
        };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          if (error.code === 'WEBHOOK_NOT_FOUND') {
            return reply.code(404).send({ error: error.code, message: error.message });
          }
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({
          error: 'WEBHOOK_TEST_FAILED',
          message: 'Failed to send test webhook',
        });
      }
    },
  );
};
