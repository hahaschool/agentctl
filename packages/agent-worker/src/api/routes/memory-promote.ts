// ---------------------------------------------------------------------------
// Worker-side memory_promote MCP tool route
//
// Escalates a fact from its current scope to the parent scope.
// Scope hierarchy: session → agent → project → global
//
// Implementation:
//   1. Fetch the fact from the control-plane
//   2. Compute the parent scope
//   3. Update the fact's scope via PATCH /api/memory/facts/:id
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

type MemoryPromoteRouteOptions = FastifyPluginOptions & {
  controlPlaneUrl: string;
  logger: Logger;
};

type PromoteBody = {
  factId: string;
};

type FactRecord = {
  id: string;
  scope: string;
} & Record<string, unknown>;

function resolveParentScope(scope: string): string | null {
  if (scope === 'global') return null;
  if (scope.startsWith('session:')) {
    // session:xyz → agent:xyz (reuse same suffix) or global if no agent
    return 'global';
  }
  if (scope.startsWith('agent:')) {
    const agentId = scope.slice('agent:'.length);
    return `project:${agentId}`;
  }
  if (scope.startsWith('project:')) {
    return 'global';
  }
  return 'global';
}

export async function memoryPromoteRoutes(
  app: FastifyInstance,
  opts: MemoryPromoteRouteOptions,
): Promise<void> {
  const { controlPlaneUrl, logger } = opts;

  app.post(
    '/memory-promote',
    async (request: FastifyRequest<{ Body: PromoteBody }>, reply: FastifyReply) => {
      const body = request.body as PromoteBody;
      const factId = body?.factId;

      if (!factId || typeof factId !== 'string' || factId.trim().length === 0) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'factId must be a non-empty string',
        });
      }

      // Fetch the current fact
      let factResponse: Response;
      try {
        factResponse = await fetch(
          `${controlPlaneUrl}/api/memory/facts/${encodeURIComponent(factId)}`,
          { method: 'GET', headers: { 'Content-Type': 'application/json' } },
        );
      } catch (error: unknown) {
        logger.error({ err: error, factId }, 'Failed to reach control-plane for memory promote');
        return reply.code(503).send({
          error: 'MEMORY_PROMOTE_UNREACHABLE',
          message: 'Control-plane unreachable while fetching fact for promotion',
        });
      }

      if (!factResponse.ok) {
        const responseBody = await factResponse.json().catch(() => ({}));
        return reply.code(factResponse.status).send(responseBody);
      }

      const factJson = (await factResponse.json()) as Record<string, unknown>;
      const fact = factJson.fact as FactRecord | undefined;

      if (!fact) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Memory fact not found' });
      }

      const currentScope = fact.scope as string;
      const parentScope = resolveParentScope(currentScope);

      if (!parentScope) {
        return reply.code(400).send({
          error: 'NO_PARENT_SCOPE',
          message: `Fact is already at the top-level scope "${currentScope}" — cannot promote further`,
        });
      }

      if (currentScope === parentScope) {
        return reply.code(400).send({
          error: 'NO_PARENT_SCOPE',
          message: `Fact scope "${currentScope}" has no parent scope`,
        });
      }

      // Update the fact's scope
      let patchResponse: Response;
      try {
        patchResponse = await fetch(
          `${controlPlaneUrl}/api/memory/facts/${encodeURIComponent(factId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scope: parentScope }),
          },
        );
      } catch (error: unknown) {
        logger.error(
          { err: error, factId, parentScope },
          'Failed to update fact scope for promote',
        );
        return reply.code(503).send({
          error: 'MEMORY_PROMOTE_UNREACHABLE',
          message: 'Control-plane unreachable while updating fact scope',
        });
      }

      if (!patchResponse.ok) {
        const responseBody = await patchResponse.json().catch(() => ({}));
        logger.warn(
          { factId, parentScope, status: patchResponse.status, body: responseBody },
          'Control-plane returned error for fact scope update',
        );
        return reply.code(patchResponse.status).send(responseBody);
      }

      const patchJson = (await patchResponse.json()) as Record<string, unknown>;
      const updatedFact = patchJson.fact as FactRecord | undefined;

      logger.info(
        { factId, fromScope: currentScope, toScope: parentScope },
        'Memory fact promoted to parent scope',
      );

      return {
        ok: true,
        fromScope: currentScope,
        toScope: parentScope,
        fact: updatedFact ?? { ...fact, scope: parentScope },
      };
    },
  );
}
