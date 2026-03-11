import { ControlPlaneError } from '@agentctl/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockLogger } from '../api/routes/test-helpers.js';
import type { Mem0Client, MemoryEntry } from './mem0-client.js';
import { MemoryInjector } from './memory-injector.js';
import type { MemorySearch } from './memory-search.js';
import type { MemoryStore } from './memory-store.js';

const logger = createMockLogger();

function createMockMem0Client(overrides: Partial<Mem0Client> = {}): Mem0Client {
  return {
    add: vi.fn().mockResolvedValue({ results: [] }),
    search: vi.fn().mockResolvedValue({ results: [] }),
    getAll: vi.fn().mockResolvedValue({ results: [] }),
    get: vi.fn(),
    delete: vi.fn(),
    deleteAll: vi.fn(),
    health: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as Mem0Client;
}

function makeMemoryEntry(memory: string): MemoryEntry {
  return {
    id: `mem-${Math.random().toString(36).slice(2, 8)}`,
    memory,
    userId: 'user-1',
    agentId: 'agent-1',
    metadata: {},
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

function createMockMemorySearch(overrides: Partial<MemorySearch> = {}): MemorySearch {
  return {
    search: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as MemorySearch;
}

function createMockMemoryStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    addFact: vi.fn(),
    listFacts: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as MemoryStore;
}

describe('MemoryInjector', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildMemoryContext()', () => {
    it('returns formatted memory section', async () => {
      const mem0Client = createMockMem0Client({
        search: vi.fn().mockResolvedValue({
          results: [
            makeMemoryEntry('User prefers TypeScript'),
            makeMemoryEntry('Project uses pnpm workspaces'),
          ],
        }),
      });

      const injector = new MemoryInjector({ mem0Client, logger });
      const context = await injector.buildMemoryContext('agent-1', 'Set up the project');

      expect(context).toBe(
        '## Relevant Memories\n- User prefers TypeScript\n- Project uses pnpm workspaces',
      );

      expect(mem0Client.search).toHaveBeenCalledWith({
        query: 'Set up the project',
        agentId: 'agent-1',
        limit: 10,
      });
    });

    it('returns empty string when no memories found', async () => {
      const mem0Client = createMockMem0Client({
        search: vi.fn().mockResolvedValue({ results: [] }),
      });

      const injector = new MemoryInjector({ mem0Client, logger });
      const context = await injector.buildMemoryContext('agent-1', 'Some prompt');

      expect(context).toBe('');
    });

    it('returns empty string when Mem0 is down (graceful degradation)', async () => {
      const mem0Client = createMockMem0Client({
        search: vi
          .fn()
          .mockRejectedValue(
            new ControlPlaneError('MEM0_CONNECTION_ERROR', 'Connection refused', {}),
          ),
      });

      const injector = new MemoryInjector({ mem0Client, logger });
      const context = await injector.buildMemoryContext('agent-1', 'Some prompt');

      expect(context).toBe('');
    });
  });

  describe('syncAfterRun()', () => {
    it('calls mem0Client.add() with correct args', async () => {
      const mem0Client = createMockMem0Client();

      const injector = new MemoryInjector({ mem0Client, logger });
      await injector.syncAfterRun('agent-1', 'Completed feature X', { taskId: 'task-42' });

      expect(mem0Client.add).toHaveBeenCalledOnce();
      const callArgs = vi.mocked(mem0Client.add).mock.calls[0][0];
      expect(callArgs.messages).toEqual([{ role: 'assistant', content: 'Completed feature X' }]);
      expect(callArgs.agentId).toBe('agent-1');
      expect(callArgs.metadata).toMatchObject({
        source: 'agent-run',
        taskId: 'task-42',
      });
      expect(callArgs.metadata?.syncedAt).toBeDefined();
    });

    it('swallows ControlPlaneError (does not throw)', async () => {
      const mem0Client = createMockMem0Client({
        add: vi
          .fn()
          .mockRejectedValue(
            new ControlPlaneError('MEM0_CONNECTION_ERROR', 'Connection refused', {}),
          ),
      });

      const injector = new MemoryInjector({ mem0Client, logger });

      // Should not throw
      await expect(injector.syncAfterRun('agent-1', 'Summary')).resolves.toBeUndefined();
    });
  });

  describe('PostgreSQL backend', () => {
    it('builds injected context from PG search results', async () => {
      const fact1 = {
        id: 'fact-1',
        scope: 'agent:agent-1',
        content: 'Use pnpm workspaces for monorepo installs',
        content_model: 'text-embedding-3-small',
        entity_type: 'pattern',
        confidence: 0.91,
        strength: 1,
        source: {
          session_id: null,
          agent_id: 'agent-1',
          machine_id: null,
          turn_index: null,
          extraction_method: 'manual',
        },
        valid_from: '2026-03-11T00:00:00.000Z',
        valid_until: null,
        created_at: '2026-03-11T00:00:00.000Z',
        accessed_at: '2026-03-11T00:00:00.000Z',
      };
      const fact2 = {
        id: 'fact-2',
        scope: 'global',
        content: 'Project uses Biome for formatting and linting',
        content_model: 'text-embedding-3-small',
        entity_type: 'decision',
        confidence: 0.89,
        strength: 0.95,
        source: {
          session_id: null,
          agent_id: null,
          machine_id: null,
          turn_index: null,
          extraction_method: 'manual',
        },
        valid_from: '2026-03-11T00:00:00.000Z',
        valid_until: null,
        created_at: '2026-03-11T00:00:00.000Z',
        accessed_at: '2026-03-11T00:00:00.000Z',
      };

      const memorySearch = createMockMemorySearch({
        search: vi.fn().mockResolvedValue([
          { fact: fact1, score: 0.92, source_path: 'vector' },
          { fact: fact2, score: 0.81, source_path: 'bm25' },
        ]),
      });

      const memoryStore = createMockMemoryStore({
        listFacts: vi.fn().mockResolvedValue([fact1, fact2]),
      });

      const injector = new MemoryInjector({
        backend: 'postgres',
        memorySearch,
        memoryStore,
        logger,
      });

      const context = await injector.buildMemoryContext('agent-1', 'Set up project tooling');

      expect(context).toBe(
        '## Relevant Memories\n- Use pnpm workspaces for monorepo installs\n- Project uses Biome for formatting and linting',
      );
      expect(memorySearch.search).toHaveBeenCalledWith({
        query: 'Set up project tooling',
        visibleScopes: ['agent:agent-1', 'global'],
        limit: 20,
      });
    });

    it('stores a PG fact when syncing a successful run summary', async () => {
      const memoryStore = createMockMemoryStore({
        addFact: vi.fn().mockResolvedValue({
          id: 'fact-summary-1',
          scope: 'agent:agent-1',
          content: 'Completed feature X',
          content_model: 'text-embedding-3-small',
          entity_type: 'decision',
          confidence: 0.8,
          strength: 1,
          source: {
            session_id: 'run-42',
            agent_id: 'agent-1',
            machine_id: 'machine-7',
            turn_index: null,
            extraction_method: 'rule',
          },
          valid_from: '2026-03-11T00:00:00.000Z',
          valid_until: null,
          created_at: '2026-03-11T00:00:00.000Z',
          accessed_at: '2026-03-11T00:00:00.000Z',
        }),
      });

      const injector = new MemoryInjector({
        backend: 'postgres',
        memorySearch: createMockMemorySearch(),
        memoryStore,
        logger,
      });

      await injector.syncAfterRun('agent-1', 'Completed feature X', {
        runId: 'run-42',
        machineId: 'machine-7',
      });

      expect(memoryStore.addFact).toHaveBeenCalledWith({
        scope: 'agent:agent-1',
        content: 'Completed feature X',
        entity_type: 'decision',
        source: {
          session_id: 'run-42',
          agent_id: 'agent-1',
          machine_id: 'machine-7',
          turn_index: null,
          extraction_method: 'rule',
        },
        confidence: 0.8,
      });
    });

    it('uses 3-tier context budget with pinned, on-demand, and triggered facts', async () => {
      const pinnedFact = {
        id: 'pinned-1',
        scope: 'global',
        content: 'Never commit secrets',
        content_model: 'text-embedding-3-small',
        entity_type: 'decision',
        confidence: 1.0,
        strength: 1.0,
        source: {
          session_id: null,
          agent_id: null,
          machine_id: null,
          turn_index: null,
          extraction_method: 'manual',
        },
        valid_from: '2026-03-11T00:00:00.000Z',
        valid_until: null,
        created_at: '2026-03-11T00:00:00.000Z',
        accessed_at: '2026-03-11T00:00:00.000Z',
        pinned: true,
      };

      const onDemandFact = {
        id: 'on-demand-1',
        scope: 'agent:agent-1',
        content: 'Use Biome for linting',
        content_model: 'text-embedding-3-small',
        entity_type: 'pattern',
        confidence: 0.9,
        strength: 1.0,
        source: {
          session_id: null,
          agent_id: 'agent-1',
          machine_id: null,
          turn_index: null,
          extraction_method: 'manual',
        },
        valid_from: '2026-03-11T00:00:00.000Z',
        valid_until: null,
        created_at: '2026-03-11T00:00:00.000Z',
        accessed_at: '2026-03-11T00:00:00.000Z',
      };

      const triggeredFact = {
        id: 'triggered-1',
        scope: 'global',
        content: 'Use --cap-drop=ALL in Docker',
        content_model: 'text-embedding-3-small',
        entity_type: 'pattern',
        confidence: 0.95,
        strength: 1.0,
        source: {
          session_id: null,
          agent_id: null,
          machine_id: null,
          turn_index: null,
          extraction_method: 'manual',
        },
        valid_from: '2026-03-11T00:00:00.000Z',
        valid_until: null,
        created_at: '2026-03-11T00:00:00.000Z',
        accessed_at: '2026-03-11T00:00:00.000Z',
        trigger_spec: { keyword: 'docker' },
      };

      const memorySearch = createMockMemorySearch({
        search: vi
          .fn()
          .mockResolvedValue([{ fact: onDemandFact, score: 0.9, source_path: 'vector' }]),
      });

      const memoryStore = createMockMemoryStore({
        listFacts: vi.fn().mockResolvedValue([pinnedFact, onDemandFact, triggeredFact]),
      });

      const injector = new MemoryInjector({
        backend: 'postgres',
        memorySearch,
        memoryStore,
        logger,
      });

      const context = await injector.buildMemoryContext('agent-1', 'Set up Docker container', {
        keywords: ['docker', 'container'],
      });

      expect(context).toContain('Never commit secrets');
      expect(context).toContain('Use Biome for linting');
      expect(context).toContain('Use --cap-drop=ALL in Docker');
    });

    it('prioritises pinned principle facts above on-demand skill and experience facts', async () => {
      const principleSource = {
        session_id: null,
        agent_id: null,
        machine_id: null,
        turn_index: null,
        extraction_method: 'manual' as const,
      };

      const principleFact = {
        id: 'principle-1',
        scope: 'global',
        content: 'Always write tests before implementation (TDD)',
        content_model: 'text-embedding-3-small',
        entity_type: 'principle',
        confidence: 1.0,
        strength: 1.0,
        source: principleSource,
        valid_from: '2026-03-11T00:00:00.000Z',
        valid_until: null,
        created_at: '2026-03-11T00:00:00.000Z',
        accessed_at: '2026-03-11T00:00:00.000Z',
        pinned: true,
      };

      const skillFact = {
        id: 'skill-1',
        scope: 'agent:agent-1',
        content: 'Proficient in TypeScript generics and discriminated unions',
        content_model: 'text-embedding-3-small',
        entity_type: 'skill',
        confidence: 0.85,
        strength: 0.9,
        source: { ...principleSource, agent_id: 'agent-1' },
        valid_from: '2026-03-11T00:00:00.000Z',
        valid_until: null,
        created_at: '2026-03-11T00:00:00.000Z',
        accessed_at: '2026-03-11T00:00:00.000Z',
      };

      const experienceFact = {
        id: 'experience-1',
        scope: 'agent:agent-1',
        content: 'Migrated control-plane from Express to Fastify in March 2026',
        content_model: 'text-embedding-3-small',
        entity_type: 'experience',
        confidence: 0.9,
        strength: 1.0,
        source: { ...principleSource, agent_id: 'agent-1' },
        valid_from: '2026-03-11T00:00:00.000Z',
        valid_until: null,
        created_at: '2026-03-11T00:00:00.000Z',
        accessed_at: '2026-03-11T00:00:00.000Z',
      };

      const memorySearch = createMockMemorySearch({
        search: vi.fn().mockResolvedValue([
          { fact: skillFact, score: 0.91, source_path: 'vector' },
          { fact: experienceFact, score: 0.85, source_path: 'bm25' },
        ]),
      });

      const memoryStore = createMockMemoryStore({
        listFacts: vi.fn().mockResolvedValue([principleFact, skillFact, experienceFact]),
      });

      const injector = new MemoryInjector({
        backend: 'postgres',
        memorySearch,
        memoryStore,
        logger,
      });

      const context = await injector.buildMemoryContext('agent-1', 'Implement a new feature');

      // Principle fact (pinned) must appear before skill/experience facts
      const principleIndex = context.indexOf('Always write tests before implementation');
      const skillIndex = context.indexOf('Proficient in TypeScript generics');
      const experienceIndex = context.indexOf('Migrated control-plane');

      expect(principleIndex).toBeGreaterThanOrEqual(0);
      expect(skillIndex).toBeGreaterThanOrEqual(0);
      expect(experienceIndex).toBeGreaterThanOrEqual(0);
      expect(principleIndex).toBeLessThan(skillIndex);
      expect(principleIndex).toBeLessThan(experienceIndex);
    });
  });
});
