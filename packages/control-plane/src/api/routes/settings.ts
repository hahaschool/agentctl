import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../db/index.js';
import { projectAccountMappings, settings } from '../../db/schema.js';

export type SettingsRoutesOptions = { db: Database };

const VALID_FAILOVER_POLICIES = ['none', 'priority', 'round_robin'] as const;
type FailoverPolicy = (typeof VALID_FAILOVER_POLICIES)[number];

export const settingsRoutes: FastifyPluginAsync<SettingsRoutesOptions> = async (app, opts) => {
  const { db } = opts;

  // Scoped error handler — log + return structured 500 for unhandled DB errors
  app.setErrorHandler((error: Error, request, reply) => {
    request.log.error(error, 'Settings route error');
    return reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: error.message ?? 'An unexpected error occurred',
    });
  });

  // ---------------------------------------------------------------------------
  // GET /defaults — retrieve default settings
  // ---------------------------------------------------------------------------

  app.get('/defaults', async (_request, reply) => {
    const [accountRow] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, 'default_account_id'));

    const [failoverRow] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, 'failover_policy'));

    const defaultAccountId = accountRow
      ? ((accountRow.value as { value: string }).value ?? null)
      : null;

    const failoverPolicy: FailoverPolicy = failoverRow
      ? ((failoverRow.value as { value: FailoverPolicy }).value ?? 'none')
      : 'none';

    return reply.send({ defaultAccountId, failoverPolicy });
  });

  // ---------------------------------------------------------------------------
  // PUT /defaults — upsert default settings
  // ---------------------------------------------------------------------------

  app.put<{
    Body: {
      defaultAccountId?: string;
      failoverPolicy?: string;
    };
  }>('/defaults', async (request, reply) => {
    const { defaultAccountId, failoverPolicy } = request.body;

    if (defaultAccountId === undefined && failoverPolicy === undefined) {
      return reply.code(400).send({
        error: 'INVALID_BODY',
        message: 'At least one of defaultAccountId or failoverPolicy must be provided',
      });
    }

    if (
      failoverPolicy !== undefined &&
      !VALID_FAILOVER_POLICIES.includes(failoverPolicy as FailoverPolicy)
    ) {
      return reply.code(400).send({
        error: 'INVALID_FAILOVER_POLICY',
        message: `failoverPolicy must be one of: ${VALID_FAILOVER_POLICIES.join(', ')}`,
      });
    }

    if (defaultAccountId !== undefined) {
      await db
        .insert(settings)
        .values({ key: 'default_account_id', value: { value: defaultAccountId } })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: { value: defaultAccountId }, updatedAt: new Date() },
        });
    }

    if (failoverPolicy !== undefined) {
      await db
        .insert(settings)
        .values({ key: 'failover_policy', value: { value: failoverPolicy } })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: { value: failoverPolicy }, updatedAt: new Date() },
        });
    }

    return reply.send({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // GET /project-accounts — list all project→account mappings
  // ---------------------------------------------------------------------------

  app.get('/project-accounts', async (_request, reply) => {
    const rows = await db
      .select()
      .from(projectAccountMappings)
      .orderBy(projectAccountMappings.projectPath);
    return reply.send(rows);
  });

  // ---------------------------------------------------------------------------
  // PUT /project-accounts — upsert a project→account mapping
  // ---------------------------------------------------------------------------

  app.put<{
    Body: {
      projectPath: string;
      accountId: string;
    };
  }>('/project-accounts', async (request, reply) => {
    const { projectPath, accountId } = request.body;

    if (!projectPath || !accountId) {
      return reply.code(400).send({
        error: 'INVALID_BODY',
        message: 'projectPath and accountId are required',
      });
    }

    const [upserted] = await db
      .insert(projectAccountMappings)
      .values({ projectPath, accountId })
      .onConflictDoUpdate({
        target: projectAccountMappings.projectPath,
        set: { accountId },
      })
      .returning();

    return reply.send(upserted);
  });

  // ---------------------------------------------------------------------------
  // DELETE /project-accounts/:id — delete a project→account mapping
  // ---------------------------------------------------------------------------

  app.delete<{ Params: { id: string } }>('/project-accounts/:id', async (request, reply) => {
    const [deleted] = await db
      .delete(projectAccountMappings)
      .where(eq(projectAccountMappings.id, request.params.id))
      .returning();

    if (!deleted) {
      return reply
        .code(404)
        .send({ error: 'MAPPING_NOT_FOUND', message: 'Project account mapping not found' });
    }

    return reply.send({ ok: true });
  });
};
