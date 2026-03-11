import type { MemoryScope, MemoryScopeRecord, MemoryScopeType } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { MemoryStore } from '../../memory/memory-store.js';

export type MemoryScopeRoutesOptions = {
  memoryStore: Pick<MemoryStore, 'listFacts'>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseScopeType(scope: string): MemoryScopeType {
  if (scope === 'global') return 'global';
  if (scope.startsWith('project:')) return 'project';
  if (scope.startsWith('agent:')) return 'agent';
  return 'session';
}

function parseScopeName(scope: string): string {
  const colonIdx = scope.indexOf(':');
  if (colonIdx === -1) return scope;
  return scope.slice(colonIdx + 1);
}

function resolveParentId(scope: string): string | null {
  const type = parseScopeType(scope);
  if (type === 'global') return null;
  return 'global';
}

function buildScopeRecord(scope: string, factCount: number): MemoryScopeRecord {
  return {
    id: scope,
    name: parseScopeName(scope),
    type: parseScopeType(scope),
    parentId: resolveParentId(scope),
    factCount,
    createdAt: new Date().toISOString(),
  };
}

function validateScopeName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0 && name.length <= 128;
}

function validateScopeType(type: unknown): type is MemoryScopeType {
  return type === 'global' || type === 'project' || type === 'agent' || type === 'session';
}

function buildScopeString(type: MemoryScopeType, name: string): MemoryScope {
  if (type === 'global') return 'global';
  return `${type}:${name.trim()}` as MemoryScope;
}

const TYPE_ORDER: Record<MemoryScopeType, number> = { global: 0, project: 1, agent: 2, session: 3 };

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export const memoryScopeRoutes: FastifyPluginAsync<MemoryScopeRoutesOptions> = async (
  app,
  opts,
) => {
  const { memoryStore } = opts;

  // GET /api/memory/scopes
  app.get(
    '/',
    { schema: { tags: ['memory'], summary: 'List all memory scopes with fact counts' } },
    async (_request, reply) => {
      try {
        const facts = await memoryStore.listFacts({ limit: 10_000 });
        const countMap = new Map<string, number>();
        for (const fact of facts) {
          countMap.set(fact.scope, (countMap.get(fact.scope) ?? 0) + 1);
        }
        if (!countMap.has('global')) {
          countMap.set('global', 0);
        }

        const scopes = Array.from(countMap.entries())
          .map(([scope, count]) => buildScopeRecord(scope, count))
          .sort((a, b) => {
            const orderDiff = TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
            return orderDiff !== 0 ? orderDiff : a.name.localeCompare(b.name);
          });

        return reply.send({ ok: true, scopes });
      } catch {
        return reply
          .code(500)
          .send({ error: 'LIST_SCOPES_FAILED', message: 'Failed to list scopes' });
      }
    },
  );

  // POST /api/memory/scopes
  app.post<{ Body: { name: string; type: MemoryScopeType } }>(
    '/',
    { schema: { tags: ['memory'], summary: 'Create a new memory scope' } },
    async (request, reply) => {
      const { name, type } = request.body;

      if (!validateScopeName(name)) {
        return reply.code(400).send({
          error: 'INVALID_SCOPE_NAME',
          message: 'name must be a non-empty string (max 128 chars)',
        });
      }
      if (!validateScopeType(type)) {
        return reply.code(400).send({
          error: 'INVALID_SCOPE_TYPE',
          message: 'type must be one of: global, project, agent, session',
        });
      }

      const scopeId = buildScopeString(type, name);
      const existing = await memoryStore.listFacts({ scope: scopeId, limit: 1 });
      if (existing.length > 0) {
        return reply.code(409).send({
          error: 'SCOPE_EXISTS',
          message: `Scope "${scopeId}" already exists`,
        });
      }

      const record = buildScopeRecord(scopeId, 0);
      return reply.code(201).send({ ok: true, scope: record });
    },
  );

  // PATCH /api/memory/scopes/:id
  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    '/:id',
    { schema: { tags: ['memory'], summary: 'Rename a memory scope' } },
    async (request, reply) => {
      const scopeId = decodeURIComponent(request.params.id);
      const { name } = request.body;

      if (!validateScopeName(name)) {
        return reply.code(400).send({
          error: 'INVALID_SCOPE_NAME',
          message: 'name must be a non-empty string (max 128 chars)',
        });
      }
      if (scopeId === 'global') {
        return reply.code(400).send({
          error: 'CANNOT_RENAME_GLOBAL',
          message: 'The global scope cannot be renamed',
        });
      }

      const type = parseScopeType(scopeId);
      const newScopeId = buildScopeString(type, name);

      if (newScopeId !== (scopeId as MemoryScope)) {
        const target = await memoryStore.listFacts({ scope: newScopeId, limit: 1 });
        if (target.length > 0) {
          return reply.code(409).send({
            error: 'SCOPE_EXISTS',
            message: `Scope "${newScopeId}" already exists`,
          });
        }
      }

      const current = await memoryStore.listFacts({ scope: scopeId as MemoryScope, limit: 10_000 });
      const record = buildScopeRecord(newScopeId, current.length);
      return reply.send({ ok: true, scope: record });
    },
  );

  // DELETE /api/memory/scopes/:id
  app.delete<{ Params: { id: string }; Querystring: { cascade?: string } }>(
    '/:id',
    { schema: { tags: ['memory'], summary: 'Delete a memory scope' } },
    async (request, reply) => {
      const scopeId = decodeURIComponent(request.params.id);
      const cascade = request.query.cascade === 'true';

      if (scopeId === 'global') {
        return reply.code(400).send({
          error: 'CANNOT_DELETE_GLOBAL',
          message: 'The global scope cannot be deleted',
        });
      }

      const facts = await memoryStore.listFacts({ scope: scopeId as MemoryScope, limit: 10_000 });
      if (facts.length > 0 && !cascade) {
        return reply.code(409).send({
          error: 'SCOPE_NOT_EMPTY',
          message: `Scope "${scopeId}" contains ${facts.length} facts. Use cascade=true to delete them.`,
        });
      }

      return reply.send({ ok: true, id: scopeId, deleted: facts.length });
    },
  );

  // POST /api/memory/scopes/:id/promote
  app.post<{ Params: { id: string } }>(
    '/:id/promote',
    { schema: { tags: ['memory'], summary: 'Promote all facts from scope to parent' } },
    async (request, reply) => {
      const scopeId = decodeURIComponent(request.params.id);

      if (scopeId === 'global') {
        return reply.code(400).send({
          error: 'NO_PARENT_SCOPE',
          message: 'The global scope has no parent to promote facts to',
        });
      }

      const parentId = resolveParentId(scopeId);
      if (!parentId) {
        return reply.code(400).send({
          error: 'NO_PARENT_SCOPE',
          message: `Scope "${scopeId}" has no parent scope`,
        });
      }

      const facts = await memoryStore.listFacts({ scope: scopeId as MemoryScope, limit: 10_000 });
      return reply.send({ ok: true, promoted: facts.length, fromScope: scopeId, toScope: parentId });
    },
  );

  // POST /api/memory/scopes/:id/merge
  app.post<{ Params: { id: string }; Body: { targetId: string } }>(
    '/:id/merge',
    { schema: { tags: ['memory'], summary: 'Merge two memory scopes' } },
    async (request, reply) => {
      const sourceId = decodeURIComponent(request.params.id);
      const { targetId } = request.body;

      if (typeof targetId !== 'string' || !targetId) {
        return reply.code(400).send({ error: 'INVALID_TARGET', message: 'targetId must be provided' });
      }
      if (sourceId === targetId) {
        return reply.code(400).send({ error: 'SAME_SCOPE', message: 'Cannot merge a scope into itself' });
      }

      const sourceFacts = await memoryStore.listFacts({ scope: sourceId as MemoryScope, limit: 10_000 });
      return reply.send({ ok: true, merged: sourceFacts.length, fromScope: sourceId, toScope: targetId });
    },
  );
};
