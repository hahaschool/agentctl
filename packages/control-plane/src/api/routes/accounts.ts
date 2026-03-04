import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../db/index.js';
import { apiAccounts } from '../../db/schema.js';
import {
  decryptCredential,
  encryptCredential,
  maskCredential,
} from '../../utils/credential-crypto.js';

export type AccountRoutesOptions = {
  db: Database;
  encryptionKey: string;
};

export const accountRoutes: FastifyPluginAsync<AccountRoutesOptions> = async (app, opts) => {
  const { db, encryptionKey } = opts;

  // ---------------------------------------------------------------------------
  // GET / — list all accounts (masked credentials)
  // ---------------------------------------------------------------------------

  app.get('/', async (_request, reply) => {
    const rows = await db.select().from(apiAccounts).orderBy(apiAccounts.priority);
    const masked = rows.map((r) => ({
      id: r.id,
      name: r.name,
      provider: r.provider,
      credentialMasked: maskCredential(
        decryptCredential(r.credential, r.credentialIv, encryptionKey),
      ),
      priority: r.priority,
      rateLimit: r.rateLimit,
      isActive: r.isActive,
      metadata: r.metadata,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    return reply.send(masked);
  });

  // ---------------------------------------------------------------------------
  // GET /:id — get a single account
  // ---------------------------------------------------------------------------

  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const [row] = await db.select().from(apiAccounts).where(eq(apiAccounts.id, request.params.id));
    if (!row) {
      return reply.code(404).send({ error: 'ACCOUNT_NOT_FOUND', message: 'Account not found' });
    }
    return reply.send({
      id: row.id,
      name: row.name,
      provider: row.provider,
      credentialMasked: maskCredential(
        decryptCredential(row.credential, row.credentialIv, encryptionKey),
      ),
      priority: row.priority,
      rateLimit: row.rateLimit,
      isActive: row.isActive,
      metadata: row.metadata,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  });

  // ---------------------------------------------------------------------------
  // POST / — create account
  // ---------------------------------------------------------------------------

  app.post<{
    Body: {
      name: string;
      provider: string;
      credential: string;
      priority?: number;
      metadata?: Record<string, unknown>;
    };
  }>('/', async (request, reply) => {
    const { name, provider, credential, priority = 0, metadata = {} } = request.body;
    if (!name || !provider || !credential) {
      return reply
        .code(400)
        .send({ error: 'INVALID_BODY', message: 'name, provider, and credential are required' });
    }
    const { encrypted, iv } = encryptCredential(credential, encryptionKey);
    const [inserted] = await db
      .insert(apiAccounts)
      .values({
        name,
        provider,
        credential: encrypted,
        credentialIv: iv,
        priority,
        metadata,
      })
      .returning();
    return reply.code(201).send({
      id: inserted.id,
      name: inserted.name,
      provider: inserted.provider,
      credentialMasked: maskCredential(credential),
      priority: inserted.priority,
      rateLimit: inserted.rateLimit,
      isActive: inserted.isActive,
      metadata: inserted.metadata,
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt,
    });
  });

  // ---------------------------------------------------------------------------
  // PUT /:id — update account
  // ---------------------------------------------------------------------------

  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      provider?: string;
      credential?: string;
      priority?: number;
      isActive?: boolean;
      rateLimit?: { itpm?: number; otpm?: number };
      metadata?: Record<string, unknown>;
    };
  }>('/:id', async (request, reply) => {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const { name, provider, credential, priority, isActive, rateLimit, metadata } = request.body;
    if (name !== undefined) updates.name = name;
    if (provider !== undefined) updates.provider = provider;
    if (priority !== undefined) updates.priority = priority;
    if (isActive !== undefined) updates.isActive = isActive;
    if (rateLimit !== undefined) updates.rateLimit = rateLimit;
    if (metadata !== undefined) updates.metadata = metadata;
    if (credential) {
      const { encrypted, iv } = encryptCredential(credential, encryptionKey);
      updates.credential = encrypted;
      updates.credentialIv = iv;
    }
    const [updated] = await db
      .update(apiAccounts)
      .set(updates)
      .where(eq(apiAccounts.id, request.params.id))
      .returning();
    if (!updated) {
      return reply.code(404).send({ error: 'ACCOUNT_NOT_FOUND', message: 'Account not found' });
    }
    return reply.send({
      id: updated.id,
      name: updated.name,
      provider: updated.provider,
      credentialMasked: maskCredential(
        decryptCredential(updated.credential, updated.credentialIv, encryptionKey),
      ),
      priority: updated.priority,
      rateLimit: updated.rateLimit,
      isActive: updated.isActive,
      metadata: updated.metadata,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /:id — delete account
  // ---------------------------------------------------------------------------

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const [deleted] = await db
      .delete(apiAccounts)
      .where(eq(apiAccounts.id, request.params.id))
      .returning();
    if (!deleted) {
      return reply.code(404).send({ error: 'ACCOUNT_NOT_FOUND', message: 'Account not found' });
    }
    return reply.send({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // POST /:id/test — test connectivity by making a minimal API call
  // ---------------------------------------------------------------------------

  app.post<{ Params: { id: string } }>('/:id/test', async (request, reply) => {
    const [row] = await db.select().from(apiAccounts).where(eq(apiAccounts.id, request.params.id));
    if (!row) {
      return reply.code(404).send({ error: 'ACCOUNT_NOT_FOUND', message: 'Account not found' });
    }
    const key = decryptCredential(row.credential, row.credentialIv, encryptionKey);
    try {
      const start = Date.now();
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return reply.send({ ok: true, latencyMs });
      }
      const body = await res.json().catch(() => ({}));
      return reply.code(400).send({
        error: 'ACCOUNT_TEST_FAILED',
        message:
          (body as Record<string, unknown>).error &&
          typeof (body as Record<string, unknown>).error === 'object'
            ? (((body as Record<string, Record<string, unknown>>).error.message as string) ??
              `HTTP ${String(res.status)}`)
            : `HTTP ${String(res.status)}`,
      });
    } catch (err) {
      return reply.code(500).send({
        error: 'ACCOUNT_TEST_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
};
