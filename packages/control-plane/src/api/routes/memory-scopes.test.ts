import type { MemoryFact } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemorySearch } from '../../memory/memory-search.js';
import type { MemoryStore } from '../../memory/memory-store.js';
import { createServer } from '../server.js';
import { createMockLogger } from './test-helpers.js';

const logger = createMockLogger();

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'fact-1',
    scope: 'global',
    content: 'Test fact',
    content_model: 'text-embedding-3-small',
    entity_type: 'concept',
    confidence: 0.8,
    strength: 1.0,
    source: {
      session_id: null,
      agent_id: null,
      machine_id: null,
      turn_index: null,
      extraction_method: 'manual',
    },
    valid_from: '2026-03-11T10:00:00.000Z',
    valid_until: null,
    created_at: '2026-03-11T10:00:00.000Z',
    accessed_at: '2026-03-11T10:00:00.000Z',
    ...overrides,
  };
}

function createMockMemorySearch(): MemorySearch {
  return { search: vi.fn().mockResolvedValue([]) } as unknown as MemorySearch;
}

function createMockMemoryStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    addFact: vi.fn(),
    listFacts: vi.fn().mockResolvedValue([]),
    deleteFact: vi.fn().mockResolvedValue(undefined),
    getFact: vi.fn().mockResolvedValue(null),
    updateFact: vi.fn().mockResolvedValue(null),
    invalidateFact: vi.fn().mockResolvedValue(undefined),
    listEdges: vi.fn().mockResolvedValue([]),
    addEdge: vi.fn(),
    deleteEdge: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn(),
    ...overrides,
  } as unknown as MemoryStore;
}

describe('memory scope routes', () => {
  let app: FastifyInstance;
  let memorySearch: MemorySearch;
  let memoryStore: MemoryStore;

  beforeEach(async () => {
    memorySearch = createMockMemorySearch();
    memoryStore = createMockMemoryStore();
    app = await createServer({ logger, memorySearch, memoryStore });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // GET /api/memory/scopes
  // ---------------------------------------------------------------------------

  describe('GET /api/memory/scopes', () => {
    it('returns empty list with global scope when no facts exist', async () => {
      vi.mocked(memoryStore.listFacts).mockResolvedValueOnce([]);

      const response = await app.inject({ method: 'GET', url: '/api/memory/scopes' });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ ok: boolean; scopes: unknown[] }>();
      expect(body.ok).toBe(true);
      expect(body.scopes).toHaveLength(1);
      expect(body.scopes[0]).toMatchObject({ id: 'global', type: 'global', factCount: 0 });
    });

    it('aggregates facts by scope and returns sorted records', async () => {
      vi.mocked(memoryStore.listFacts).mockResolvedValueOnce([
        makeFact({ scope: 'global' }),
        makeFact({ scope: 'project:agentctl', id: 'fact-2' }),
        makeFact({ scope: 'project:agentctl', id: 'fact-3' }),
        makeFact({ scope: 'agent:worker-1', id: 'fact-4' }),
      ]);

      const response = await app.inject({ method: 'GET', url: '/api/memory/scopes' });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ ok: boolean; scopes: Array<{ id: string; factCount: number; type: string }> }>();
      expect(body.ok).toBe(true);
      expect(body.scopes).toHaveLength(3);

      // First scope should be global
      expect(body.scopes[0]).toMatchObject({ id: 'global', type: 'global', factCount: 1 });
      // Then project
      expect(body.scopes[1]).toMatchObject({ id: 'project:agentctl', type: 'project', factCount: 2 });
      // Then agent
      expect(body.scopes[2]).toMatchObject({ id: 'agent:worker-1', type: 'agent', factCount: 1 });
    });

    it('returns 500 when memoryStore throws', async () => {
      vi.mocked(memoryStore.listFacts).mockRejectedValueOnce(new Error('DB down'));

      const response = await app.inject({ method: 'GET', url: '/api/memory/scopes' });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ error: 'LIST_SCOPES_FAILED' });
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/memory/scopes
  // ---------------------------------------------------------------------------

  describe('POST /api/memory/scopes', () => {
    it('creates a new project scope when it does not exist', async () => {
      vi.mocked(memoryStore.listFacts).mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/scopes',
        payload: { name: 'my-project', type: 'project' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<{ ok: boolean; scope: { id: string; type: string } }>();
      expect(body.ok).toBe(true);
      expect(body.scope.id).toBe('project:my-project');
      expect(body.scope.type).toBe('project');
    });

    it('returns 400 when name is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/scopes',
        payload: { name: '', type: 'project' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_SCOPE_NAME' });
    });

    it('returns 400 when type is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/scopes',
        payload: { name: 'test', type: 'invalid-type' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_SCOPE_TYPE' });
    });

    it('returns 409 when scope already exists', async () => {
      vi.mocked(memoryStore.listFacts).mockResolvedValueOnce([
        makeFact({ scope: 'project:existing' }),
      ]);

      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/scopes',
        payload: { name: 'existing', type: 'project' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: 'SCOPE_EXISTS' });
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/memory/scopes/:id
  // ---------------------------------------------------------------------------

  describe('PATCH /api/memory/scopes/:id', () => {
    it('renames a project scope', async () => {
      vi.mocked(memoryStore.listFacts)
        .mockResolvedValueOnce([]) // check new name doesn't exist
        .mockResolvedValueOnce([makeFact({ scope: 'project:old-name' })]); // get current facts

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/memory/scopes/project%3Aold-name',
        payload: { name: 'new-name' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ ok: boolean; scope: { id: string; name: string } }>();
      expect(body.ok).toBe(true);
      expect(body.scope.id).toBe('project:new-name');
      expect(body.scope.name).toBe('new-name');
    });

    it('returns 400 when trying to rename global scope', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/memory/scopes/global',
        payload: { name: 'new-name' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'CANNOT_RENAME_GLOBAL' });
    });

    it('returns 400 when name is empty', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/memory/scopes/project%3Atest',
        payload: { name: '' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_SCOPE_NAME' });
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/memory/scopes/:id
  // ---------------------------------------------------------------------------

  describe('DELETE /api/memory/scopes/:id', () => {
    it('deletes an empty scope', async () => {
      vi.mocked(memoryStore.listFacts).mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/memory/scopes/project%3Aempty',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ok: true, id: 'project:empty', deleted: 0 });
    });

    it('returns 409 for non-empty scope without cascade', async () => {
      vi.mocked(memoryStore.listFacts).mockResolvedValueOnce([
        makeFact({ scope: 'project:has-facts' }),
      ]);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/memory/scopes/project%3Ahas-facts',
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: 'SCOPE_NOT_EMPTY' });
    });

    it('deletes non-empty scope with cascade=true', async () => {
      vi.mocked(memoryStore.listFacts).mockResolvedValueOnce([
        makeFact({ scope: 'project:has-facts' }),
        makeFact({ scope: 'project:has-facts', id: 'fact-2' }),
      ]);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/memory/scopes/project%3Ahas-facts?cascade=true',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ok: true, deleted: 2 });
    });

    it('returns 400 when trying to delete global scope', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/memory/scopes/global',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'CANNOT_DELETE_GLOBAL' });
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/memory/scopes/:id/promote
  // ---------------------------------------------------------------------------

  describe('POST /api/memory/scopes/:id/promote', () => {
    it('promotes facts from project scope to global', async () => {
      vi.mocked(memoryStore.listFacts).mockResolvedValueOnce([
        makeFact({ scope: 'project:agentctl' }),
        makeFact({ scope: 'project:agentctl', id: 'fact-2' }),
      ]);

      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/scopes/project%3Aagentctl/promote',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
        promoted: 2,
        fromScope: 'project:agentctl',
        toScope: 'global',
      });
    });

    it('returns 400 when trying to promote from global', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/scopes/global/promote',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'NO_PARENT_SCOPE' });
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/memory/scopes/:id/merge
  // ---------------------------------------------------------------------------

  describe('POST /api/memory/scopes/:id/merge', () => {
    it('merges source scope into target scope', async () => {
      vi.mocked(memoryStore.listFacts).mockResolvedValueOnce([
        makeFact({ scope: 'project:source' }),
        makeFact({ scope: 'project:source', id: 'fact-2' }),
      ]);

      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/scopes/project%3Asource/merge',
        payload: { targetId: 'project:target' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
        merged: 2,
        fromScope: 'project:source',
        toScope: 'project:target',
      });
    });

    it('returns 400 when merging scope into itself', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/scopes/project%3Atest/merge',
        payload: { targetId: 'project:test' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'SAME_SCOPE' });
    });

    it('returns 400 when targetId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/scopes/project%3Atest/merge',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_TARGET' });
    });
  });
});
