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

  // Scoped error handler — log + return structured 500 for unhandled DB errors
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error, 'Accounts route error');
    return reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: error.message ?? 'An unexpected error occurred',
    });
  });

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
    const credential = decryptCredential(row.credential, row.credentialIv, encryptionKey);

    switch (row.provider) {
      case 'anthropic_api': {
        try {
          const start = Date.now();
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': credential,
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
          return reply.send({
            ok: false,
            error: await extractErrorMessage(res),
          });
        } catch (err) {
          return reply.code(500).send({
            error: 'ACCOUNT_TEST_ERROR',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      case 'claude_max':
      case 'claude_team': {
        // Session tokens cannot be API-tested — validate format only
        if (!credential || credential.length < 10) {
          return reply.send({
            ok: false,
            error: 'Session token is too short or empty',
          });
        }
        return reply.send({ ok: true });
      }

      case 'bedrock': {
        const parts = credential.split(':');
        if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
          return reply.send({
            ok: false,
            error: 'Bedrock credential must be in format ACCESS_KEY_ID:SECRET_ACCESS_KEY:REGION',
          });
        }
        return reply.send({ ok: true });
      }

      case 'vertex': {
        try {
          const parsed = JSON.parse(credential) as Record<string, unknown>;
          if (!parsed.client_email || !parsed.private_key) {
            return reply.send({
              ok: false,
              error: 'Vertex AI service account JSON must contain client_email and private_key',
            });
          }
          return reply.send({ ok: true });
        } catch {
          return reply.send({
            ok: false,
            error: 'Vertex AI credential is not valid JSON',
          });
        }
      }

      default:
        return reply.code(400).send({
          error: 'UNKNOWN_PROVIDER',
          message: `Unknown provider type: ${row.provider}`,
        });
    }
  });
};

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as Record<string, unknown>;
    if (body.error && typeof body.error === 'object') {
      const errObj = body.error as Record<string, unknown>;
      if (typeof errObj.message === 'string') return errObj.message;
    }
  } catch {
    // Fall through to default
  }
  return `HTTP ${String(res.status)}`;
}
