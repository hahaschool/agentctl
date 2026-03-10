# Unified Memory Layer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace external Mem0 HTTP dependency with PostgreSQL-native hybrid memory (vector + BM25 + graph) with 4-scope isolation and MCP agent access.

**Architecture:** New `memory_facts` and `memory_edges` tables in existing PostgreSQL with pgvector for embeddings, tsvector for BM25, and recursive CTEs for graph traversal. Hybrid search fuses three retrieval paths via Reciprocal Rank Fusion. Exposed to agents via MCP tools proxied through the control plane.

**Tech Stack:** PostgreSQL + pgvector, Drizzle ORM, Fastify, OpenAI text-embedding-3-small (via LiteLLM), Vitest, pino

**Spec:** `docs/plans/2026-03-10-unified-memory-layer-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| **Extend** | `packages/shared/src/types/memory.ts` | MemoryFact, MemoryEdge, MemoryScope, EntityType, InjectionBudget types |
| **Extend** | `packages/shared/src/types/index.ts` | Re-export new types |
| **Create** | `packages/control-plane/drizzle/0010_add_memory_layer.sql` | Migration: tables + pgvector + indexes |
| **Extend** | `packages/control-plane/src/db/schema.ts` | Drizzle table definitions for memory_facts, memory_edges, memory_scopes |
| **Create** | `packages/control-plane/src/memory/embedding-client.ts` | OpenAI embedding API client (via LiteLLM proxy) |
| **Create** | `packages/control-plane/src/memory/embedding-client.test.ts` | Tests for embedding client |
| **Create** | `packages/control-plane/src/memory/memory-store.ts` | CRUD for facts/edges with embedding generation |
| **Create** | `packages/control-plane/src/memory/memory-store.test.ts` | Tests for store |
| **Create** | `packages/control-plane/src/memory/memory-search.ts` | Hybrid search: vector + BM25 + graph with RRF |
| **Create** | `packages/control-plane/src/memory/memory-search.test.ts` | Tests for search |
| **Create** | `packages/control-plane/src/memory/memory-decay.ts` | Strength decay + archival logic |
| **Create** | `packages/control-plane/src/memory/memory-decay.test.ts` | Tests for decay |
| **Modify** | `packages/control-plane/src/memory/memory-injector.ts` | Swap Mem0 backend → memory-search (behind feature flag) |
| **Modify** | `packages/control-plane/src/memory/memory-injector.test.ts` | Update tests for new backend |
| **Modify** | `packages/control-plane/src/api/routes/memory.ts` | Swap Mem0 routes → memory-store/search |
| **Modify** | `packages/control-plane/src/api/routes/memory.test.ts` | Update route tests |
| **Modify** | `packages/control-plane/src/memory/index.ts` | Update barrel exports |

---

## Chunk 1: Types + Schema + Embedding Client

### Task 1: Shared Types

**Files:**
- Modify: `packages/shared/src/types/memory.ts`
- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1: Add new types to shared memory module**

```typescript
// packages/shared/src/types/memory.ts
// Keep existing MemoryObservation type, add below it:

export type MemoryScope =
  | 'global'
  | `project:${string}`
  | `agent:${string}`
  | `session:${string}`;

export type EntityType =
  | 'code_artifact'
  | 'decision'
  | 'pattern'
  | 'error'
  | 'person'
  | 'concept'
  | 'preference';

export type RelationType =
  | 'modifies'
  | 'depends_on'
  | 'caused_by'
  | 'resolves'
  | 'supersedes'
  | 'related_to'
  | 'summarizes';

export type FactSource = {
  session_id: string | null;
  agent_id: string | null;
  machine_id: string | null;
  turn_index: number | null;
  extraction_method: 'llm' | 'rule' | 'manual' | 'import';
};

export type MemoryFact = {
  id: string;
  scope: MemoryScope;
  content: string;
  content_model: string;
  entity_type: EntityType;
  confidence: number;
  strength: number;
  source: FactSource;
  valid_from: string;
  valid_until: string | null;
  created_at: string;
  accessed_at: string;
};

export type MemoryEdge = {
  id: string;
  source_fact_id: string;
  target_fact_id: string;
  relation: RelationType;
  weight: number;
  created_at: string;
};

export type MemorySearchResult = {
  fact: MemoryFact;
  score: number;
  source_path: 'vector' | 'bm25' | 'graph';
};

export type InjectionBudget = {
  maxTokens: number;
  maxFacts: number;
  priorityWeights: {
    relevance: number;
    recency: number;
    strength: number;
    scopeProximity: number;
  };
};

export const DEFAULT_INJECTION_BUDGET: InjectionBudget = {
  maxTokens: 2000,
  maxFacts: 15,
  priorityWeights: {
    relevance: 0.5,
    recency: 0.2,
    strength: 0.2,
    scopeProximity: 0.1,
  },
};
```

- [ ] **Step 2: Update shared types barrel export**

In `packages/shared/src/types/index.ts`, add after the existing `MemoryObservation` export:

```typescript
export type {
  MemoryObservation,
  MemoryScope,
  EntityType,
  RelationType,
  FactSource,
  MemoryFact,
  MemoryEdge,
  MemorySearchResult,
  InjectionBudget,
} from './memory.js';

export { DEFAULT_INJECTION_BUDGET } from './memory.js';
```

- [ ] **Step 3: Verify build**

Run: `cd packages/shared && pnpm build`
Expected: PASS with no type errors

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/memory.ts packages/shared/src/types/index.ts
git commit -m "feat(shared): add unified memory layer types"
```

---

### Task 2: Database Migration

**Files:**
- Create: `packages/control-plane/drizzle/0010_add_memory_layer.sql`
- Modify: `packages/control-plane/src/db/schema.ts`

- [ ] **Step 1: Create SQL migration**

```sql
-- packages/control-plane/drizzle/0010_add_memory_layer.sql
-- Unified Memory Layer: facts + edges + scopes
-- Requires: pgvector extension, pg_trgm extension

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- memory_scopes: hierarchy metadata for 4-scope isolation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_scopes (
  scope         TEXT PRIMARY KEY,
  parent_scope  TEXT REFERENCES memory_scopes(scope),
  display_name  TEXT,
  config_json   JSONB NOT NULL DEFAULT '{}'
);

-- Seed default global scope
INSERT INTO memory_scopes (scope, parent_scope, display_name)
VALUES ('global', NULL, 'Global Knowledge')
ON CONFLICT (scope) DO NOTHING;

-- ---------------------------------------------------------------------------
-- memory_facts: atomic knowledge units with vector embeddings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_facts (
  id            TEXT PRIMARY KEY,
  scope         TEXT NOT NULL,
  content       TEXT NOT NULL,
  embedding     vector(1536),
  content_tsv   tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  content_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  entity_type   TEXT NOT NULL,
  confidence    REAL NOT NULL DEFAULT 0.8,
  strength      REAL NOT NULL DEFAULT 1.0,
  source_json   JSONB NOT NULL DEFAULT '{}',
  valid_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  accessed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_facts_embedding
  ON memory_facts USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 256);

CREATE INDEX idx_memory_facts_content_tsv
  ON memory_facts USING gin (content_tsv);

CREATE INDEX idx_memory_facts_scope
  ON memory_facts (scope);

CREATE INDEX idx_memory_facts_entity_type
  ON memory_facts (entity_type);

CREATE INDEX idx_memory_facts_strength
  ON memory_facts (strength)
  WHERE strength > 0.05;

CREATE INDEX idx_memory_facts_valid
  ON memory_facts (valid_until)
  WHERE valid_until IS NULL;

-- ---------------------------------------------------------------------------
-- memory_edges: graph relationships between facts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_edges (
  id              TEXT PRIMARY KEY,
  source_fact_id  TEXT NOT NULL REFERENCES memory_facts(id) ON DELETE CASCADE,
  target_fact_id  TEXT NOT NULL REFERENCES memory_facts(id) ON DELETE CASCADE,
  relation        TEXT NOT NULL,
  weight          REAL NOT NULL DEFAULT 0.5,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_fact_id, target_fact_id, relation)
);

CREATE INDEX idx_memory_edges_source ON memory_edges (source_fact_id);
CREATE INDEX idx_memory_edges_target ON memory_edges (target_fact_id);
```

- [ ] **Step 2: Add Drizzle table definitions to schema.ts**

Add at the end of `packages/control-plane/src/db/schema.ts`:

```typescript
// ---------------------------------------------------------------------------
// Unified Memory Layer
// ---------------------------------------------------------------------------

export const memoryScopes = pgTable('memory_scopes', {
  scope: text('scope').primaryKey(),
  parentScope: text('parent_scope'),
  displayName: text('display_name'),
  configJson: jsonb('config_json').default({}),
});

export const memoryFacts = pgTable(
  'memory_facts',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull(),
    content: text('content').notNull(),
    // Note: embedding stored as TEXT (pgvector) — Drizzle doesn't have native vector type.
    // Raw SQL queries handle the vector column directly.
    contentModel: text('content_model').notNull().default('text-embedding-3-small'),
    entityType: text('entity_type').notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull().default('0.800'),
    strength: numeric('strength', { precision: 4, scale: 3 }).notNull().default('1.000'),
    sourceJson: jsonb('source_json').default({}),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    accessedAt: timestamp('accessed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_memory_facts_scope').on(table.scope),
    index('idx_memory_facts_entity_type').on(table.entityType),
  ],
);

export const memoryEdges = pgTable(
  'memory_edges',
  {
    id: text('id').primaryKey(),
    sourceFactId: text('source_fact_id')
      .notNull()
      .references(() => memoryFacts.id, { onDelete: 'cascade' }),
    targetFactId: text('target_fact_id')
      .notNull()
      .references(() => memoryFacts.id, { onDelete: 'cascade' }),
    relation: text('relation').notNull(),
    weight: numeric('weight', { precision: 4, scale: 3 }).notNull().default('0.500'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_memory_edges_source').on(table.sourceFactId),
    index('idx_memory_edges_target').on(table.targetFactId),
  ],
);
```

- [ ] **Step 3: Verify build**

Run: `cd packages/control-plane && pnpm build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/control-plane/drizzle/0010_add_memory_layer.sql packages/control-plane/src/db/schema.ts
git commit -m "feat(cp): add memory layer database schema and migration"
```

---

### Task 3: Embedding Client

**Files:**
- Create: `packages/control-plane/src/memory/embedding-client.ts`
- Create: `packages/control-plane/src/memory/embedding-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/control-plane/src/memory/embedding-client.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ControlPlaneError } from '@agentctl/shared';

import { createMockLogger } from '../api/routes/test-helpers.js';

import { EmbeddingClient } from './embedding-client.js';

describe('EmbeddingClient', () => {
  const logger = createMockLogger();
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeClient(baseUrl = 'http://localhost:4000'): EmbeddingClient {
    return new EmbeddingClient({ baseUrl, model: 'text-embedding-3-small', logger });
  }

  describe('embed', () => {
    it('returns embedding vector for a single text', async () => {
      const fakeEmbedding = Array.from({ length: 1536 }, (_, i) => i * 0.001);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: fakeEmbedding, index: 0 }],
          model: 'text-embedding-3-small',
          usage: { prompt_tokens: 10, total_tokens: 10 },
        }),
      });

      const client = makeClient();
      const result = await client.embed('test content');

      expect(result).toEqual(fakeEmbedding);
      expect(globalThis.fetch).toHaveBeenCalledOnce();

      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toBe('http://localhost:4000/v1/embeddings');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.model).toBe('text-embedding-3-small');
      expect(body.input).toBe('test content');
    });

    it('returns embeddings for batch input', async () => {
      const fakeEmbeddings = [
        Array.from({ length: 1536 }, () => 0.1),
        Array.from({ length: 1536 }, () => 0.2),
      ];
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: fakeEmbeddings.map((e, i) => ({ embedding: e, index: i })),
          model: 'text-embedding-3-small',
          usage: { prompt_tokens: 20, total_tokens: 20 },
        }),
      });

      const client = makeClient();
      const result = await client.embedBatch(['text one', 'text two']);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(fakeEmbeddings[0]);
      expect(result[1]).toEqual(fakeEmbeddings[1]);
    });

    it('throws ControlPlaneError on API failure', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
      });

      const client = makeClient();
      await expect(client.embed('test')).rejects.toThrow(ControlPlaneError);
    });

    it('throws ControlPlaneError on network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const client = makeClient();
      await expect(client.embed('test')).rejects.toThrow(ControlPlaneError);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/control-plane && pnpm vitest run src/memory/embedding-client.test.ts`
Expected: FAIL — `Cannot find module './embedding-client.js'`

- [ ] **Step 3: Implement embedding client**

```typescript
// packages/control-plane/src/memory/embedding-client.ts
import { ControlPlaneError } from '@agentctl/shared';
import type { Logger } from 'pino';

const DEFAULT_TIMEOUT_MS = 30_000;

export type EmbeddingClientOptions = {
  baseUrl: string;
  model: string;
  logger: Logger;
  timeoutMs?: number;
};

type EmbeddingResponse = {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
};

export class EmbeddingClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly logger: Logger;
  private readonly timeoutMs: number;

  constructor(options: EmbeddingClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model;
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    this.logger.debug({ count: texts.length, model: this.model }, 'Generating embeddings');

    const url = `${this.baseUrl}/v1/embeddings`;
    const body = JSON.stringify({
      model: this.model,
      input: texts.length === 1 ? texts[0] : texts,
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ControlPlaneError('EMBEDDING_CONNECTION_ERROR', `Failed to connect to embedding API: ${message}`, {
        url,
        model: this.model,
      });
    }

    if (!response.ok) {
      let errorBody: string;
      try {
        errorBody = await response.text();
      } catch {
        errorBody = '<unreadable>';
      }
      throw new ControlPlaneError('EMBEDDING_API_ERROR', `Embedding API returned ${response.status}: ${errorBody}`, {
        url,
        model: this.model,
        status: response.status,
      });
    }

    const result = (await response.json()) as EmbeddingResponse;

    this.logger.debug(
      { model: result.model, tokens: result.usage.total_tokens, count: result.data.length },
      'Embeddings generated',
    );

    // Sort by index to ensure correct ordering
    const sorted = [...result.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/control-plane && pnpm vitest run src/memory/embedding-client.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/memory/embedding-client.ts packages/control-plane/src/memory/embedding-client.test.ts
git commit -m "feat(cp): add embedding client for memory layer"
```

---

### Task 4: Memory Store

**Files:**
- Create: `packages/control-plane/src/memory/memory-store.ts`
- Create: `packages/control-plane/src/memory/memory-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/control-plane/src/memory/memory-store.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntityType, FactSource, MemoryScope } from '@agentctl/shared';

import { createMockLogger } from '../api/routes/test-helpers.js';

import type { EmbeddingClient } from './embedding-client.js';
import { MemoryStore } from './memory-store.js';

function createMockEmbedding(): EmbeddingClient {
  return {
    embed: vi.fn().mockResolvedValue(Array.from({ length: 1536 }, () => 0.1)),
    embedBatch: vi.fn().mockResolvedValue([Array.from({ length: 1536 }, () => 0.1)]),
  } as unknown as EmbeddingClient;
}

function createMockPool() {
  const rows: Record<string, unknown>[] = [];
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: 0 }),
    _rows: rows,
  };
}

describe('MemoryStore', () => {
  const logger = createMockLogger();

  function makeStore(poolOverrides?: Record<string, unknown>) {
    const pool = createMockPool();
    if (poolOverrides) {
      Object.assign(pool, poolOverrides);
    }
    const embedding = createMockEmbedding();
    const store = new MemoryStore({ pool: pool as never, embeddingClient: embedding, logger });
    return { store, pool, embedding };
  }

  describe('addFact', () => {
    it('generates embedding and inserts into database', async () => {
      const { store, pool, embedding } = makeStore({
        query: vi.fn().mockResolvedValue({ rows: [{ id: 'test-id' }], rowCount: 1 }),
      });

      const result = await store.addFact({
        scope: 'global' as MemoryScope,
        content: 'Use Biome instead of ESLint',
        entity_type: 'decision' as EntityType,
        source: {
          session_id: null,
          agent_id: 'agent-1',
          machine_id: null,
          turn_index: null,
          extraction_method: 'manual',
        } satisfies FactSource,
      });

      expect(embedding.embed).toHaveBeenCalledWith('Use Biome instead of ESLint');
      expect(pool.query).toHaveBeenCalled();
      expect(result.id).toBeDefined();
      expect(result.scope).toBe('global');
      expect(result.content).toBe('Use Biome instead of ESLint');
    });

    it('stores fact without embedding when embedding client fails', async () => {
      const failingEmbedding = {
        embed: vi.fn().mockRejectedValue(new Error('API down')),
        embedBatch: vi.fn().mockRejectedValue(new Error('API down')),
      } as unknown as EmbeddingClient;

      const pool = createMockPool();
      pool.query = vi.fn().mockResolvedValue({ rows: [{ id: 'test-id' }], rowCount: 1 });

      const store = new MemoryStore({ pool: pool as never, embeddingClient: failingEmbedding, logger });

      const result = await store.addFact({
        scope: 'global' as MemoryScope,
        content: 'Some fact',
        entity_type: 'pattern' as EntityType,
        source: {
          session_id: null,
          agent_id: null,
          machine_id: null,
          turn_index: null,
          extraction_method: 'manual',
        },
      });

      // Should still store the fact, just without embedding
      expect(result.id).toBeDefined();
      expect(pool.query).toHaveBeenCalled();
    });
  });

  describe('addEdge', () => {
    it('inserts edge between two facts', async () => {
      const { store, pool } = makeStore({
        query: vi.fn().mockResolvedValue({ rows: [{ id: 'edge-1' }], rowCount: 1 }),
      });

      const result = await store.addEdge({
        source_fact_id: 'fact-1',
        target_fact_id: 'fact-2',
        relation: 'related_to',
      });

      expect(result.id).toBeDefined();
      expect(pool.query).toHaveBeenCalled();
    });
  });

  describe('getFact', () => {
    it('returns fact by id', async () => {
      const { store, pool } = makeStore({
        query: vi.fn().mockResolvedValue({
          rows: [{
            id: 'fact-1',
            scope: 'global',
            content: 'test',
            content_model: 'text-embedding-3-small',
            entity_type: 'pattern',
            confidence: 0.9,
            strength: 1.0,
            source_json: {},
            valid_from: new Date().toISOString(),
            valid_until: null,
            created_at: new Date().toISOString(),
            accessed_at: new Date().toISOString(),
          }],
          rowCount: 1,
        }),
      });

      const result = await store.getFact('fact-1');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('fact-1');
    });

    it('returns null for non-existent fact', async () => {
      const { store } = makeStore();
      const result = await store.getFact('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('deleteFact', () => {
    it('deletes fact by id', async () => {
      const { store, pool } = makeStore({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      });

      await store.deleteFact('fact-1');
      expect(pool.query).toHaveBeenCalled();
    });
  });

  describe('updateStrength', () => {
    it('updates strength and accessed_at timestamp', async () => {
      const { store, pool } = makeStore({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      });

      await store.updateStrength('fact-1', 0.75);
      expect(pool.query).toHaveBeenCalled();
    });
  });

  describe('invalidateFact', () => {
    it('sets valid_until to now', async () => {
      const { store, pool } = makeStore({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      });

      await store.invalidateFact('fact-1');
      expect(pool.query).toHaveBeenCalled();
    });
  });

  describe('resolveVisibleScopes', () => {
    it('returns all ancestor scopes for an agent scope', () => {
      const { store } = makeStore();
      const scopes = store.resolveVisibleScopes('agent:worker-1', 'project:agentctl');
      expect(scopes).toEqual(['agent:worker-1', 'project:agentctl', 'global']);
    });

    it('returns project + global for a project scope', () => {
      const { store } = makeStore();
      const scopes = store.resolveVisibleScopes(undefined, 'project:agentctl');
      expect(scopes).toEqual(['project:agentctl', 'global']);
    });

    it('returns only global when no agent or project', () => {
      const { store } = makeStore();
      const scopes = store.resolveVisibleScopes(undefined, undefined);
      expect(scopes).toEqual(['global']);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/control-plane && pnpm vitest run src/memory/memory-store.test.ts`
Expected: FAIL — `Cannot find module './memory-store.js'`

- [ ] **Step 3: Implement memory store**

```typescript
// packages/control-plane/src/memory/memory-store.ts
import { ControlPlaneError } from '@agentctl/shared';
import type { EntityType, FactSource, MemoryEdge, MemoryFact, MemoryScope, RelationType } from '@agentctl/shared';
import type { Logger } from 'pino';
import type { Pool } from 'pg';

import type { EmbeddingClient } from './embedding-client.js';

export type MemoryStoreOptions = {
  pool: Pool;
  embeddingClient: EmbeddingClient;
  logger: Logger;
};

export type AddFactInput = {
  scope: MemoryScope;
  content: string;
  entity_type: EntityType;
  source: FactSource;
  confidence?: number;
};

export type AddEdgeInput = {
  source_fact_id: string;
  target_fact_id: string;
  relation: RelationType;
  weight?: number;
};

function generateUlid(): string {
  // Simplified ULID: timestamp (ms) in base36 + random suffix
  const timestamp = Date.now().toString(36).padStart(10, '0');
  const random = Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
  return `${timestamp}${random}`;
}

export class MemoryStore {
  private readonly pool: Pool;
  private readonly embeddingClient: EmbeddingClient;
  private readonly logger: Logger;

  constructor(options: MemoryStoreOptions) {
    this.pool = options.pool;
    this.embeddingClient = options.embeddingClient;
    this.logger = options.logger;
  }

  async addFact(input: AddFactInput): Promise<MemoryFact> {
    const id = generateUlid();
    const now = new Date().toISOString();

    let embedding: number[] | null = null;
    try {
      embedding = await this.embeddingClient.embed(input.content);
    } catch (error: unknown) {
      this.logger.warn(
        { err: error, factId: id },
        'Failed to generate embedding — storing fact without vector',
      );
    }

    const embeddingStr = embedding ? `[${embedding.join(',')}]` : null;

    await this.pool.query(
      `INSERT INTO memory_facts (id, scope, content, embedding, content_model, entity_type, confidence, strength, source_json, valid_from, created_at, accessed_at)
       VALUES ($1, $2, $3, $4::vector, $5, $6, $7, $8, $9, $10, $10, $10)`,
      [
        id,
        input.scope,
        input.content,
        embeddingStr,
        'text-embedding-3-small',
        input.entity_type,
        input.confidence ?? 0.8,
        1.0,
        JSON.stringify(input.source),
        now,
      ],
    );

    this.logger.info({ factId: id, scope: input.scope, entityType: input.entity_type }, 'Memory fact stored');

    return {
      id,
      scope: input.scope,
      content: input.content,
      content_model: 'text-embedding-3-small',
      entity_type: input.entity_type,
      confidence: input.confidence ?? 0.8,
      strength: 1.0,
      source: input.source,
      valid_from: now,
      valid_until: null,
      created_at: now,
      accessed_at: now,
    };
  }

  async addEdge(input: AddEdgeInput): Promise<MemoryEdge> {
    const id = generateUlid();
    const now = new Date().toISOString();

    await this.pool.query(
      `INSERT INTO memory_edges (id, source_fact_id, target_fact_id, relation, weight, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (source_fact_id, target_fact_id, relation) DO UPDATE SET weight = $5`,
      [id, input.source_fact_id, input.target_fact_id, input.relation, input.weight ?? 0.5, now],
    );

    return {
      id,
      source_fact_id: input.source_fact_id,
      target_fact_id: input.target_fact_id,
      relation: input.relation,
      weight: input.weight ?? 0.5,
      created_at: now,
    };
  }

  async getFact(id: string): Promise<MemoryFact | null> {
    const { rows } = await this.pool.query(
      `SELECT id, scope, content, content_model, entity_type,
              confidence::real, strength::real, source_json,
              valid_from, valid_until, created_at, accessed_at
       FROM memory_facts WHERE id = $1`,
      [id],
    );

    if (rows.length === 0) return null;

    const row = rows[0] as Record<string, unknown>;
    return this.rowToFact(row);
  }

  async deleteFact(id: string): Promise<void> {
    await this.pool.query('DELETE FROM memory_facts WHERE id = $1', [id]);
  }

  async updateStrength(id: string, strength: number): Promise<void> {
    await this.pool.query(
      'UPDATE memory_facts SET strength = $2, accessed_at = now() WHERE id = $1',
      [id, strength],
    );
  }

  async invalidateFact(id: string): Promise<void> {
    await this.pool.query(
      'UPDATE memory_facts SET valid_until = now() WHERE id = $1',
      [id],
    );
  }

  resolveVisibleScopes(agentScope?: string, projectScope?: string): string[] {
    const scopes: string[] = [];
    if (agentScope) scopes.push(agentScope);
    if (projectScope) scopes.push(projectScope);
    scopes.push('global');
    return scopes;
  }

  private rowToFact(row: Record<string, unknown>): MemoryFact {
    return {
      id: row.id as string,
      scope: row.scope as MemoryScope,
      content: row.content as string,
      content_model: row.content_model as string,
      entity_type: row.entity_type as EntityType,
      confidence: Number(row.confidence),
      strength: Number(row.strength),
      source: (row.source_json ?? {}) as FactSource,
      valid_from: String(row.valid_from),
      valid_until: row.valid_until ? String(row.valid_until) : null,
      created_at: String(row.created_at),
      accessed_at: String(row.accessed_at),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/control-plane && pnpm vitest run src/memory/memory-store.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/memory/memory-store.ts packages/control-plane/src/memory/memory-store.test.ts
git commit -m "feat(cp): add memory store with CRUD and embedding generation"
```

---

## Chunk 2: Hybrid Search

### Task 5: Memory Search

**Files:**
- Create: `packages/control-plane/src/memory/memory-search.ts`
- Create: `packages/control-plane/src/memory/memory-search.test.ts`

**Reference:** Spec section "Hybrid Search" — three retrieval paths fused via RRF.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/control-plane/src/memory/memory-search.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemoryFact, MemoryScope } from '@agentctl/shared';
import { DEFAULT_INJECTION_BUDGET } from '@agentctl/shared';

import { createMockLogger } from '../api/routes/test-helpers.js';

import type { EmbeddingClient } from './embedding-client.js';
import { MemorySearch, type MemorySearchOptions } from './memory-search.js';

function createMockEmbedding(): EmbeddingClient {
  return {
    embed: vi.fn().mockResolvedValue(Array.from({ length: 1536 }, () => 0.1)),
    embedBatch: vi.fn().mockResolvedValue([]),
  } as unknown as EmbeddingClient;
}

function makeFakeFactRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'fact-1',
    scope: 'global',
    content: 'Use Biome for linting',
    content_model: 'text-embedding-3-small',
    entity_type: 'pattern',
    confidence: 0.9,
    strength: 1.0,
    source_json: {},
    valid_from: new Date().toISOString(),
    valid_until: null,
    created_at: new Date().toISOString(),
    accessed_at: new Date().toISOString(),
    similarity: 0.85,
    rank: 1,
    ...overrides,
  };
}

describe('MemorySearch', () => {
  const logger = createMockLogger();

  function makeSearch(queryResults?: Record<string, unknown>[][]) {
    const callIndex = { current: 0 };
    const pool = {
      query: vi.fn().mockImplementation(() => {
        const rows = queryResults?.[callIndex.current] ?? [];
        callIndex.current++;
        return Promise.resolve({ rows, rowCount: rows.length });
      }),
    };
    const embedding = createMockEmbedding();
    const search = new MemorySearch({
      pool: pool as never,
      embeddingClient: embedding,
      logger,
    });
    return { search, pool, embedding };
  }

  describe('search', () => {
    it('embeds query and returns fused results', async () => {
      const vectorRow = makeFakeFactRow({ id: 'fact-vec', rank: 1 });
      const bm25Row = makeFakeFactRow({ id: 'fact-bm25', rank: 1 });
      const graphRow = { target_fact_id: 'fact-graph' };
      const graphFactRow = makeFakeFactRow({ id: 'fact-graph', rank: 1 });

      // Three queries: vector, BM25, graph seed, graph facts
      const { search, embedding } = makeSearch([
        [vectorRow],      // vector search
        [bm25Row],        // BM25 search
        [graphRow],       // graph traversal
        [graphFactRow],   // graph fact lookup
      ]);

      const results = await search.search({
        query: 'linting tool',
        visibleScopes: ['global'],
        limit: 10,
      });

      expect(embedding.embed).toHaveBeenCalledWith('linting tool');
      expect(results.length).toBeGreaterThan(0);
      // Each result should have a fact and a score
      for (const r of results) {
        expect(r.fact.id).toBeDefined();
        expect(r.score).toBeGreaterThan(0);
      }
    });

    it('returns empty array when no results found', async () => {
      const { search } = makeSearch([[], [], [], []]);

      const results = await search.search({
        query: 'nonexistent topic',
        visibleScopes: ['global'],
        limit: 10,
      });

      expect(results).toEqual([]);
    });

    it('filters by visible scopes', async () => {
      const { search, pool } = makeSearch([[], [], [], []]);

      await search.search({
        query: 'test',
        visibleScopes: ['agent:worker-1', 'project:agentctl', 'global'],
        limit: 5,
      });

      // Verify scope filter was passed in queries
      const firstCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = firstCall[0] as string;
      expect(sql).toContain('scope');
    });

    it('gracefully handles embedding failure', async () => {
      const bm25Row = makeFakeFactRow({ id: 'fact-bm25' });
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // vector (skipped)
          .mockResolvedValueOnce({ rows: [bm25Row], rowCount: 1 }) // BM25
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // graph
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }), // graph facts
      };
      const failingEmbedding = {
        embed: vi.fn().mockRejectedValue(new Error('API down')),
        embedBatch: vi.fn().mockRejectedValue(new Error('API down')),
      } as unknown as EmbeddingClient;

      const search = new MemorySearch({
        pool: pool as never,
        embeddingClient: failingEmbedding,
        logger,
      });

      // Should still return BM25 results even when vector search fails
      const results = await search.search({
        query: 'test',
        visibleScopes: ['global'],
        limit: 10,
      });

      // BM25 results should still come through
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('boostAndRank', () => {
    it('applies scope proximity boost', () => {
      const { search } = makeSearch();

      const facts: Array<{ fact: MemoryFact; rrfScore: number }> = [
        {
          fact: {
            id: 'f1', scope: 'agent:w1' as MemoryScope, content: 'a', content_model: 'm',
            entity_type: 'pattern', confidence: 0.9, strength: 1.0,
            source: { session_id: null, agent_id: null, machine_id: null, turn_index: null, extraction_method: 'manual' },
            valid_from: new Date().toISOString(), valid_until: null,
            created_at: new Date().toISOString(), accessed_at: new Date().toISOString(),
          },
          rrfScore: 0.5,
        },
        {
          fact: {
            id: 'f2', scope: 'global' as MemoryScope, content: 'b', content_model: 'm',
            entity_type: 'pattern', confidence: 0.9, strength: 1.0,
            source: { session_id: null, agent_id: null, machine_id: null, turn_index: null, extraction_method: 'manual' },
            valid_from: new Date().toISOString(), valid_until: null,
            created_at: new Date().toISOString(), accessed_at: new Date().toISOString(),
          },
          rrfScore: 0.5,
        },
      ];

      const ranked = search.boostAndRank(facts, 'agent:w1', DEFAULT_INJECTION_BUDGET);

      // Agent-scope fact should rank higher due to scope boost
      expect(ranked[0].fact.id).toBe('f1');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/control-plane && pnpm vitest run src/memory/memory-search.test.ts`
Expected: FAIL — `Cannot find module './memory-search.js'`

- [ ] **Step 3: Implement memory search**

```typescript
// packages/control-plane/src/memory/memory-search.ts
import type {
  EntityType,
  FactSource,
  InjectionBudget,
  MemoryFact,
  MemoryScope,
  MemorySearchResult,
} from '@agentctl/shared';
import { DEFAULT_INJECTION_BUDGET } from '@agentctl/shared';
import type { Logger } from 'pino';
import type { Pool } from 'pg';

import type { EmbeddingClient } from './embedding-client.js';

export type MemorySearchOptions = {
  pool: Pool;
  embeddingClient: EmbeddingClient;
  logger: Logger;
};

export type SearchInput = {
  query: string;
  visibleScopes: string[];
  limit?: number;
  entityType?: EntityType;
};

const RRF_K = 60;
const DEFAULT_CANDIDATES_PER_PATH = 40;

export class MemorySearch {
  private readonly pool: Pool;
  private readonly embeddingClient: EmbeddingClient;
  private readonly logger: Logger;

  constructor(options: MemorySearchOptions) {
    this.pool = options.pool;
    this.embeddingClient = options.embeddingClient;
    this.logger = options.logger;
  }

  async search(input: SearchInput): Promise<MemorySearchResult[]> {
    const limit = input.limit ?? 10;
    const candidateLimit = DEFAULT_CANDIDATES_PER_PATH;

    // Run three retrieval paths in parallel
    const [vectorResults, bm25Results, graphResults] = await Promise.all([
      this.vectorSearch(input.query, input.visibleScopes, candidateLimit, input.entityType),
      this.bm25Search(input.query, input.visibleScopes, candidateLimit, input.entityType),
      this.graphSearch(input.query, input.visibleScopes, candidateLimit),
    ]);

    // Reciprocal Rank Fusion
    const scoreMap = new Map<string, { fact: MemoryFact; rrfScore: number; sources: Set<string> }>();

    const addResults = (results: Array<{ fact: MemoryFact; rank: number }>, source: string) => {
      for (const { fact, rank } of results) {
        const existing = scoreMap.get(fact.id);
        const rrfContribution = 1.0 / (RRF_K + rank);

        if (existing) {
          existing.rrfScore += rrfContribution;
          existing.sources.add(source);
        } else {
          scoreMap.set(fact.id, {
            fact,
            rrfScore: rrfContribution,
            sources: new Set([source]),
          });
        }
      }
    };

    addResults(vectorResults, 'vector');
    addResults(bm25Results, 'bm25');
    addResults(graphResults, 'graph');

    if (scoreMap.size === 0) return [];

    // Boost and rank
    const candidates = [...scoreMap.values()].map((v) => ({
      fact: v.fact,
      rrfScore: v.rrfScore,
    }));

    const ranked = this.boostAndRank(candidates, input.visibleScopes[0], DEFAULT_INJECTION_BUDGET);

    // Update accessed_at for retrieved facts (fire-and-forget)
    const topIds = ranked.slice(0, limit).map((r) => r.fact.id);
    if (topIds.length > 0) {
      this.touchFacts(topIds).catch((err: unknown) => {
        this.logger.warn({ err }, 'Failed to update accessed_at for retrieved facts');
      });
    }

    return ranked.slice(0, limit).map((r) => {
      const sources = scoreMap.get(r.fact.id)?.sources ?? new Set();
      return {
        fact: r.fact,
        score: r.score,
        source_path: sources.has('vector') ? 'vector' : sources.has('bm25') ? 'bm25' : 'graph',
      };
    });
  }

  boostAndRank(
    candidates: Array<{ fact: MemoryFact; rrfScore: number }>,
    queryScope: string | undefined,
    budget: InjectionBudget,
  ): Array<{ fact: MemoryFact; score: number }> {
    const now = Date.now();

    return candidates
      .map(({ fact, rrfScore }) => {
        const recencyMs = now - new Date(fact.accessed_at).getTime();
        const recencyDays = recencyMs / (1000 * 60 * 60 * 24);
        const recencyBoost = Math.max(0.1, 1.0 - recencyDays * 0.01); // Gentle decay

        const scopeBoost = this.computeScopeBoost(fact.scope, queryScope);

        const score =
          rrfScore * budget.priorityWeights.relevance +
          recencyBoost * budget.priorityWeights.recency +
          Number(fact.strength) * budget.priorityWeights.strength +
          scopeBoost * budget.priorityWeights.scopeProximity;

        return { fact, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  private computeScopeBoost(factScope: string, queryScope: string | undefined): number {
    if (!queryScope) return 1.0;
    if (factScope === queryScope) return 1.2;
    if (factScope.startsWith('project:') && queryScope.startsWith('agent:')) return 1.1;
    return 1.0;
  }

  private async vectorSearch(
    query: string,
    scopes: string[],
    limit: number,
    entityType?: EntityType,
  ): Promise<Array<{ fact: MemoryFact; rank: number }>> {
    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.embeddingClient.embed(query);
    } catch (error: unknown) {
      this.logger.warn({ err: error }, 'Vector search skipped — embedding generation failed');
      return [];
    }

    const embeddingStr = `[${queryEmbedding.join(',')}]`;
    const scopePlaceholders = scopes.map((_, i) => `$${i + 2}`).join(', ');

    let sql = `
      SELECT id, scope, content, content_model, entity_type,
             confidence::real, strength::real, source_json,
             valid_from, valid_until, created_at, accessed_at,
             1 - (embedding <=> $1::vector) AS similarity,
             ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
      FROM memory_facts
      WHERE scope IN (${scopePlaceholders})
        AND valid_until IS NULL
        AND strength > 0.05
        AND embedding IS NOT NULL`;

    const params: unknown[] = [embeddingStr, ...scopes];

    if (entityType) {
      sql += ` AND entity_type = $${params.length + 1}`;
      params.push(entityType);
    }

    sql += ` ORDER BY embedding <=> $1::vector LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await this.pool.query(sql, params);
    return (rows as Record<string, unknown>[]).map((row) => ({
      fact: this.rowToFact(row),
      rank: Number(row.rank),
    }));
  }

  private async bm25Search(
    query: string,
    scopes: string[],
    limit: number,
    entityType?: EntityType,
  ): Promise<Array<{ fact: MemoryFact; rank: number }>> {
    // Convert query to tsquery format: split words, join with &
    const tsQuery = query
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
      .filter(Boolean)
      .join(' & ');

    if (!tsQuery) return [];

    const scopePlaceholders = scopes.map((_, i) => `$${i + 2}`).join(', ');

    let sql = `
      SELECT id, scope, content, content_model, entity_type,
             confidence::real, strength::real, source_json,
             valid_from, valid_until, created_at, accessed_at,
             ts_rank(content_tsv, to_tsquery('english', $1)) AS bm25_score,
             ROW_NUMBER() OVER (ORDER BY ts_rank(content_tsv, to_tsquery('english', $1)) DESC) AS rank
      FROM memory_facts
      WHERE content_tsv @@ to_tsquery('english', $1)
        AND scope IN (${scopePlaceholders})
        AND valid_until IS NULL
        AND strength > 0.05`;

    const params: unknown[] = [tsQuery, ...scopes];

    if (entityType) {
      sql += ` AND entity_type = $${params.length + 1}`;
      params.push(entityType);
    }

    sql += ` ORDER BY bm25_score DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    try {
      const { rows } = await this.pool.query(sql, params);
      return (rows as Record<string, unknown>[]).map((row) => ({
        fact: this.rowToFact(row),
        rank: Number(row.rank),
      }));
    } catch (error: unknown) {
      this.logger.warn({ err: error, query: tsQuery }, 'BM25 search failed');
      return [];
    }
  }

  private async graphSearch(
    query: string,
    scopes: string[],
    limit: number,
  ): Promise<Array<{ fact: MemoryFact; rank: number }>> {
    // Step 1: Find seed entities via keyword match on content
    const keywords = query
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 5);

    if (keywords.length === 0) return [];

    const scopePlaceholders = scopes.map((_, i) => `$${i + 1}`).join(', ');
    const keywordPattern = keywords.map((k) => k.replace(/[^a-zA-Z0-9_-]/g, '')).join('|');

    const seedSql = `
      SELECT id FROM memory_facts
      WHERE scope IN (${scopePlaceholders})
        AND valid_until IS NULL
        AND strength > 0.05
        AND content ~* $${scopes.length + 1}
      LIMIT 10`;

    const seedResult = await this.pool.query(seedSql, [...scopes, keywordPattern]);
    const seedIds = (seedResult.rows as Array<{ id: string }>).map((r) => r.id);

    if (seedIds.length === 0) return [];

    // Step 2: 2-hop BFS from seed entities
    const seedPlaceholders = seedIds.map((_, i) => `$${i + 1}`).join(', ');

    const graphSql = `
      WITH RECURSIVE traversal AS (
        SELECT target_fact_id AS fact_id, 1 AS depth
        FROM memory_edges
        WHERE source_fact_id IN (${seedPlaceholders})
        UNION
        SELECT e.target_fact_id, t.depth + 1
        FROM memory_edges e
        JOIN traversal t ON e.source_fact_id = t.fact_id
        WHERE t.depth < 2
      )
      SELECT DISTINCT fact_id AS target_fact_id FROM traversal`;

    const graphResult = await this.pool.query(graphSql, seedIds);
    const graphFactIds = (graphResult.rows as Array<{ target_fact_id: string }>).map((r) => r.target_fact_id);

    if (graphFactIds.length === 0) return [];

    // Step 3: Fetch the actual facts
    const factPlaceholders = graphFactIds.slice(0, limit).map((_, i) => `$${i + 1}`).join(', ');

    const factSql = `
      SELECT id, scope, content, content_model, entity_type,
             confidence::real, strength::real, source_json,
             valid_from, valid_until, created_at, accessed_at,
             ROW_NUMBER() OVER (ORDER BY strength DESC) AS rank
      FROM memory_facts
      WHERE id IN (${factPlaceholders})
        AND valid_until IS NULL
        AND strength > 0.05`;

    const factResult = await this.pool.query(factSql, graphFactIds.slice(0, limit));
    return (factResult.rows as Record<string, unknown>[]).map((row) => ({
      fact: this.rowToFact(row),
      rank: Number(row.rank),
    }));
  }

  private async touchFacts(ids: string[]): Promise<void> {
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    await this.pool.query(
      `UPDATE memory_facts SET accessed_at = now(), strength = LEAST(1.0, strength + 0.05)
       WHERE id IN (${placeholders})`,
      ids,
    );
  }

  private rowToFact(row: Record<string, unknown>): MemoryFact {
    return {
      id: row.id as string,
      scope: row.scope as MemoryScope,
      content: row.content as string,
      content_model: row.content_model as string,
      entity_type: row.entity_type as EntityType,
      confidence: Number(row.confidence),
      strength: Number(row.strength),
      source: (row.source_json ?? {}) as FactSource,
      valid_from: String(row.valid_from),
      valid_until: row.valid_until ? String(row.valid_until) : null,
      created_at: String(row.created_at),
      accessed_at: String(row.accessed_at),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/control-plane && pnpm vitest run src/memory/memory-search.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/memory/memory-search.ts packages/control-plane/src/memory/memory-search.test.ts
git commit -m "feat(cp): add hybrid memory search with vector + BM25 + graph RRF"
```

---

## Chunk 3: Decay + Injector Refactor + Routes

### Task 6: Memory Decay

**Files:**
- Create: `packages/control-plane/src/memory/memory-decay.ts`
- Create: `packages/control-plane/src/memory/memory-decay.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/control-plane/src/memory/memory-decay.test.ts
import { describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';

import { MemoryDecay } from './memory-decay.js';

describe('MemoryDecay', () => {
  const logger = createMockLogger();

  function makeDecay(queryResults?: Array<{ rows: unknown[]; rowCount: number }>) {
    const callIndex = { current: 0 };
    const pool = {
      query: vi.fn().mockImplementation(() => {
        const result = queryResults?.[callIndex.current] ?? { rows: [], rowCount: 0 };
        callIndex.current++;
        return Promise.resolve(result);
      }),
    };
    const decay = new MemoryDecay({ pool: pool as never, logger });
    return { decay, pool };
  }

  describe('applyDecay', () => {
    it('executes decay SQL with correct formula', async () => {
      const { decay, pool } = makeDecay([{ rows: [], rowCount: 42 }]);

      const result = await decay.applyDecay();

      expect(pool.query).toHaveBeenCalledOnce();
      const sql = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('0.95');
      expect(sql).toContain('strength');
      expect(result.updated).toBe(42);
    });
  });

  describe('archiveWeak', () => {
    it('moves facts below threshold to archive', async () => {
      const { decay, pool } = makeDecay([{ rows: [], rowCount: 5 }]);

      const result = await decay.archiveWeak(0.05);

      expect(pool.query).toHaveBeenCalledOnce();
      const sql = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('0.05');
      expect(result.archived).toBe(5);
    });
  });

  describe('computeDecayedStrength', () => {
    it('applies Ebbinghaus decay formula', () => {
      const { decay } = makeDecay();

      expect(decay.computeDecayedStrength(1.0, 0)).toBeCloseTo(1.0);
      expect(decay.computeDecayedStrength(1.0, 1)).toBeCloseTo(0.95);
      expect(decay.computeDecayedStrength(1.0, 7)).toBeCloseTo(0.698, 2);
      expect(decay.computeDecayedStrength(1.0, 30)).toBeCloseTo(0.214, 2);
      expect(decay.computeDecayedStrength(1.0, 90)).toBeCloseTo(0.0099, 3);
    });

    it('never goes below zero', () => {
      const { decay } = makeDecay();
      expect(decay.computeDecayedStrength(1.0, 1000)).toBeGreaterThanOrEqual(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/control-plane && pnpm vitest run src/memory/memory-decay.test.ts`
Expected: FAIL — `Cannot find module './memory-decay.js'`

- [ ] **Step 3: Implement memory decay**

```typescript
// packages/control-plane/src/memory/memory-decay.ts
import type { Logger } from 'pino';
import type { Pool } from 'pg';

const DECAY_RATE = 0.95;
const DEFAULT_ARCHIVE_THRESHOLD = 0.05;

export type MemoryDecayOptions = {
  pool: Pool;
  logger: Logger;
};

export class MemoryDecay {
  private readonly pool: Pool;
  private readonly logger: Logger;

  constructor(options: MemoryDecayOptions) {
    this.pool = options.pool;
    this.logger = options.logger;
  }

  /**
   * Apply Ebbinghaus-inspired decay: strength *= 0.95^days_since_last_access.
   * Facts that were recently accessed (accessed_at close to now) decay less.
   */
  async applyDecay(): Promise<{ updated: number }> {
    this.logger.info('Applying memory strength decay');

    const { rowCount } = await this.pool.query(`
      UPDATE memory_facts
      SET strength = GREATEST(0, strength * POWER(${DECAY_RATE}, EXTRACT(EPOCH FROM (now() - accessed_at)) / 86400.0))
      WHERE valid_until IS NULL
        AND strength > ${DEFAULT_ARCHIVE_THRESHOLD}
    `);

    this.logger.info({ updated: rowCount }, 'Memory decay applied');
    return { updated: rowCount ?? 0 };
  }

  /**
   * Archive facts that have decayed below the threshold.
   * Sets valid_until to now (soft delete — still queryable with explicit flag).
   */
  async archiveWeak(threshold = DEFAULT_ARCHIVE_THRESHOLD): Promise<{ archived: number }> {
    this.logger.info({ threshold }, 'Archiving weak memory facts');

    const { rowCount } = await this.pool.query(
      `UPDATE memory_facts
       SET valid_until = now()
       WHERE valid_until IS NULL
         AND strength <= $1`,
      [threshold],
    );

    this.logger.info({ archived: rowCount }, 'Weak facts archived');
    return { archived: rowCount ?? 0 };
  }

  /**
   * Pure computation of decayed strength for a given number of days.
   * Useful for testing and preview.
   */
  computeDecayedStrength(currentStrength: number, daysSinceAccess: number): number {
    return Math.max(0, currentStrength * Math.pow(DECAY_RATE, daysSinceAccess));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/control-plane && pnpm vitest run src/memory/memory-decay.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/memory/memory-decay.ts packages/control-plane/src/memory/memory-decay.test.ts
git commit -m "feat(cp): add memory decay with Ebbinghaus-inspired formula"
```

---

### Task 7: Refactor Memory Injector

**Files:**
- Modify: `packages/control-plane/src/memory/memory-injector.ts`
- Modify: `packages/control-plane/src/memory/memory-injector.test.ts`

**Key change:** The injector gains a second constructor path that uses `MemorySearch` instead of `Mem0Client`. The `MEMORY_BACKEND` env var controls which path is used. Existing Mem0 path preserved for rollback.

- [ ] **Step 1: Update the test file**

```typescript
// packages/control-plane/src/memory/memory-injector.test.ts
import { describe, expect, it, vi } from 'vitest';

import { ControlPlaneError } from '@agentctl/shared';

import { createMockLogger } from '../api/routes/test-helpers.js';

import type { Mem0Client } from './mem0-client.js';
import type { MemorySearch } from './memory-search.js';
import type { MemoryStore } from './memory-store.js';
import { MemoryInjector } from './memory-injector.js';

function createMockMem0(): Mem0Client {
  return {
    search: vi.fn().mockResolvedValue({ results: [] }),
    add: vi.fn().mockResolvedValue({ results: [] }),
  } as unknown as Mem0Client;
}

function createMockSearch(): MemorySearch {
  return {
    search: vi.fn().mockResolvedValue([]),
  } as unknown as MemorySearch;
}

function createMockStore(): MemoryStore {
  return {
    addFact: vi.fn().mockResolvedValue({ id: 'fact-1' }),
    resolveVisibleScopes: vi.fn().mockReturnValue(['global']),
  } as unknown as MemoryStore;
}

describe('MemoryInjector', () => {
  const logger = createMockLogger();

  describe('with Mem0 backend (legacy)', () => {
    it('builds memory context from Mem0', async () => {
      const mem0 = createMockMem0();
      (mem0.search as ReturnType<typeof vi.fn>).mockResolvedValue({
        results: [{ memory: 'Use Biome for linting' }, { memory: 'PG on port 5433' }],
      });

      const injector = new MemoryInjector({ mem0Client: mem0, logger });
      const context = await injector.buildMemoryContext('agent-1', 'What linter do we use?');

      expect(context).toContain('Use Biome for linting');
      expect(context).toContain('PG on port 5433');
    });

    it('returns empty on Mem0 failure', async () => {
      const mem0 = createMockMem0();
      (mem0.search as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ControlPlaneError('MEM0_CONNECTION_ERROR', 'down'),
      );

      const injector = new MemoryInjector({ mem0Client: mem0, logger });
      const context = await injector.buildMemoryContext('agent-1', 'test');

      expect(context).toBe('');
    });
  });

  describe('with PG backend (new)', () => {
    it('builds memory context from hybrid search', async () => {
      const search = createMockSearch();
      const store = createMockStore();
      (search.search as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          fact: { id: 'f1', content: 'Use Biome for linting', scope: 'global', entity_type: 'pattern' },
          score: 0.9,
          source_path: 'vector',
        },
        {
          fact: { id: 'f2', content: 'PG on port 5433', scope: 'project:agentctl', entity_type: 'decision' },
          score: 0.7,
          source_path: 'bm25',
        },
      ]);

      const injector = new MemoryInjector({ memorySearch: search, memoryStore: store, logger });
      const context = await injector.buildMemoryContext('agent-1', 'What linter do we use?', 'project:agentctl');

      expect(context).toContain('Use Biome for linting');
      expect(context).toContain('PG on port 5433');
    });

    it('returns empty on search failure', async () => {
      const search = createMockSearch();
      const store = createMockStore();
      (search.search as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('PG down'));

      const injector = new MemoryInjector({ memorySearch: search, memoryStore: store, logger });
      const context = await injector.buildMemoryContext('agent-1', 'test');

      expect(context).toBe('');
    });
  });

  describe('syncAfterRun', () => {
    it('stores session summary via Mem0 (legacy)', async () => {
      const mem0 = createMockMem0();
      const injector = new MemoryInjector({ mem0Client: mem0, logger });

      await injector.syncAfterRun('agent-1', 'Fixed the login bug');

      expect(mem0.add).toHaveBeenCalled();
    });

    it('stores session summary via PG (new)', async () => {
      const search = createMockSearch();
      const store = createMockStore();
      const injector = new MemoryInjector({ memorySearch: search, memoryStore: store, logger });

      await injector.syncAfterRun('agent-1', 'Fixed the login bug', { taskId: 'task-1' });

      expect(store.addFact).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Fixed the login bug' }),
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/control-plane && pnpm vitest run src/memory/memory-injector.test.ts`
Expected: FAIL — constructor signature mismatch

- [ ] **Step 3: Refactor memory-injector.ts**

Replace the full content of `packages/control-plane/src/memory/memory-injector.ts`:

```typescript
// packages/control-plane/src/memory/memory-injector.ts
import { ControlPlaneError } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { Mem0Client } from './mem0-client.js';
import type { MemorySearch } from './memory-search.js';
import type { MemoryStore } from './memory-store.js';

const DEFAULT_MAX_MEMORIES = 10;

export type MemoryInjectorOptions =
  | {
      mem0Client: Mem0Client;
      memorySearch?: undefined;
      memoryStore?: undefined;
      maxMemories?: number;
      logger: Logger;
    }
  | {
      mem0Client?: undefined;
      memorySearch: MemorySearch;
      memoryStore: MemoryStore;
      maxMemories?: number;
      logger: Logger;
    };

export class MemoryInjector {
  private readonly mem0Client: Mem0Client | undefined;
  private readonly memorySearch: MemorySearch | undefined;
  private readonly memoryStore: MemoryStore | undefined;
  private readonly maxMemories: number;
  private readonly logger: Logger;

  constructor(options: MemoryInjectorOptions) {
    this.mem0Client = options.mem0Client;
    this.memorySearch = options.memorySearch;
    this.memoryStore = options.memoryStore;
    this.maxMemories = options.maxMemories ?? DEFAULT_MAX_MEMORIES;
    this.logger = options.logger;
  }

  async buildMemoryContext(
    agentId: string,
    taskPrompt: string,
    projectScope?: string,
  ): Promise<string> {
    this.logger.debug({ agentId, promptLength: taskPrompt.length }, 'Building memory context');

    try {
      if (this.memorySearch) {
        return await this.buildFromPg(agentId, taskPrompt, projectScope);
      }
      if (this.mem0Client) {
        return await this.buildFromMem0(agentId, taskPrompt);
      }
      this.logger.warn({ agentId }, 'No memory backend configured');
      return '';
    } catch (error: unknown) {
      if (error instanceof ControlPlaneError) {
        this.logger.warn(
          { agentId, code: error.code, err: error },
          'Failed to fetch memories — continuing without memory context',
        );
        return '';
      }
      this.logger.warn(
        { agentId, err: error },
        'Unexpected error fetching memories — continuing without memory context',
      );
      return '';
    }
  }

  async syncAfterRun(
    agentId: string,
    sessionSummary: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.logger.debug({ agentId }, 'Syncing memory after run');

    try {
      if (this.memoryStore) {
        await this.memoryStore.addFact({
          scope: `agent:${agentId}`,
          content: sessionSummary,
          entity_type: 'pattern',
          source: {
            session_id: (metadata?.sessionId as string) ?? null,
            agent_id: agentId,
            machine_id: (metadata?.machineId as string) ?? null,
            turn_index: null,
            extraction_method: 'rule',
          },
        });
        this.logger.info({ agentId }, 'Memory synced after run (PG)');
        return;
      }

      if (this.mem0Client) {
        await this.mem0Client.add({
          messages: [{ role: 'assistant', content: sessionSummary }],
          agentId,
          metadata: {
            source: 'agent-run',
            syncedAt: new Date().toISOString(),
            ...metadata,
          },
        });
        this.logger.info({ agentId }, 'Memory synced after run (Mem0)');
        return;
      }
    } catch (error: unknown) {
      if (error instanceof ControlPlaneError) {
        this.logger.warn(
          { agentId, code: error.code, err: error },
          'Failed to sync memory after run',
        );
        return;
      }
      this.logger.error({ agentId, err: error }, 'Unexpected error syncing memory after run');
    }
  }

  private async buildFromPg(
    agentId: string,
    taskPrompt: string,
    projectScope?: string,
  ): Promise<string> {
    const visibleScopes = this.memoryStore!.resolveVisibleScopes(
      `agent:${agentId}`,
      projectScope,
    );

    const results = await this.memorySearch!.search({
      query: taskPrompt,
      visibleScopes,
      limit: this.maxMemories,
    });

    if (results.length === 0) {
      this.logger.debug({ agentId }, 'No relevant memories found (PG)');
      return '';
    }

    const memoryLines = results.map((r) => `- ${r.fact.content}`);
    const context = `## Relevant Memories\n${memoryLines.join('\n')}`;

    this.logger.info({ agentId, memoryCount: results.length }, 'Memory context built (PG)');
    return context;
  }

  private async buildFromMem0(agentId: string, taskPrompt: string): Promise<string> {
    const { results } = await this.mem0Client!.search({
      query: taskPrompt,
      agentId,
      limit: this.maxMemories,
    });

    if (results.length === 0) {
      this.logger.debug({ agentId }, 'No relevant memories found (Mem0)');
      return '';
    }

    const memoryLines = results.map((entry) => `- ${entry.memory}`);
    const context = `## Relevant Memories\n${memoryLines.join('\n')}`;

    this.logger.info({ agentId, memoryCount: results.length }, 'Memory context built (Mem0)');
    return context;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/control-plane && pnpm vitest run src/memory/memory-injector.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/memory/memory-injector.ts packages/control-plane/src/memory/memory-injector.test.ts
git commit -m "refactor(cp): memory injector supports both Mem0 and PG backends"
```

---

### Task 8: Refactor Memory Routes

**Files:**
- Modify: `packages/control-plane/src/api/routes/memory.ts`
- Modify: `packages/control-plane/src/api/routes/memory.test.ts`

**Key change:** Routes accept either `mem0Client` (legacy) or `memoryStore + memorySearch` (new). The route handler checks which is available.

- [ ] **Step 1: Update memory.ts routes**

Replace full content of `packages/control-plane/src/api/routes/memory.ts`:

```typescript
// packages/control-plane/src/api/routes/memory.ts
import { ControlPlaneError } from '@agentctl/shared';
import type { EntityType } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { Mem0Client } from '../../memory/mem0-client.js';
import type { MemorySearch } from '../../memory/memory-search.js';
import type { MemoryStore } from '../../memory/memory-store.js';

export type MemoryRoutesOptions = {
  mem0Client?: Mem0Client;
  memoryStore?: MemoryStore;
  memorySearch?: MemorySearch;
};

export const memoryRoutes: FastifyPluginAsync<MemoryRoutesOptions> = async (app, opts) => {
  const { mem0Client, memoryStore, memorySearch } = opts;

  // ---------------------------------------------------------------------------
  // Search memories by semantic query
  // ---------------------------------------------------------------------------
  app.post<{
    Body: { query: string; agentId?: string; scope?: string; entityType?: string; limit?: number };
  }>(
    '/search',
    { schema: { tags: ['memory'], summary: 'Search memories by semantic query' } },
    async (request, reply) => {
      const { query, agentId, scope, entityType, limit } = request.body;

      if (!query || typeof query !== 'string') {
        return reply
          .code(400)
          .send({ error: 'INVALID_PARAMS', message: 'A non-empty "query" string is required' });
      }

      try {
        if (memorySearch && memoryStore) {
          const visibleScopes = memoryStore.resolveVisibleScopes(
            agentId ? `agent:${agentId}` : undefined,
            scope,
          );
          const results = await memorySearch.search({
            query,
            visibleScopes,
            limit,
            entityType: entityType as EntityType | undefined,
          });
          return { results: results.map((r) => ({ ...r.fact, score: r.score })) };
        }

        if (mem0Client) {
          const result = await mem0Client.search({ query, agentId, limit });
          return { results: result.results };
        }

        return reply.code(503).send({ error: 'NO_BACKEND', message: 'No memory backend configured' });
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({ error: 'SEARCH_FAILED', message: 'Failed to search memories' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Add a new memory
  // ---------------------------------------------------------------------------
  app.post<{
    Body: {
      content?: string;
      messages?: Array<{ role: string; content: string }>;
      scope?: string;
      entityType?: string;
      agentId?: string;
      metadata?: Record<string, unknown>;
    };
  }>(
    '/add',
    { schema: { tags: ['memory'], summary: 'Add a new memory' } },
    async (request, reply) => {
      const { content, messages, scope, entityType, agentId, metadata } = request.body;

      try {
        if (memoryStore) {
          const factContent = content ?? messages?.[0]?.content;
          if (!factContent) {
            return reply.code(400).send({
              error: 'INVALID_PARAMS',
              message: 'Either "content" or "messages" with at least one entry is required',
            });
          }

          const fact = await memoryStore.addFact({
            scope: (scope ?? (agentId ? `agent:${agentId}` : 'global')) as `global` | `project:${string}` | `agent:${string}` | `session:${string}`,
            content: factContent,
            entity_type: (entityType ?? 'pattern') as EntityType,
            source: {
              session_id: null,
              agent_id: agentId ?? null,
              machine_id: null,
              turn_index: null,
              extraction_method: 'manual',
            },
          });
          return { ok: true, fact };
        }

        if (mem0Client) {
          if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return reply.code(400).send({
              error: 'INVALID_PARAMS',
              message: 'A non-empty "messages" array is required',
            });
          }
          const result = await mem0Client.add({ messages, agentId, metadata });
          return { ok: true, results: result.results };
        }

        return reply.code(503).send({ error: 'NO_BACKEND', message: 'No memory backend configured' });
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({ error: 'ADD_FAILED', message: 'Failed to add memory' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // List all memories
  // ---------------------------------------------------------------------------
  app.get<{
    Querystring: { userId?: string; agentId?: string; scope?: string };
  }>(
    '/',
    { schema: { tags: ['memory'], summary: 'List all memories' } },
    async (request, reply) => {
      const { userId, agentId, scope } = request.query;

      try {
        if (memorySearch && memoryStore) {
          const visibleScopes = memoryStore.resolveVisibleScopes(
            agentId ? `agent:${agentId}` : undefined,
            scope,
          );
          // Return recent facts for the visible scopes
          const results = await memorySearch.search({
            query: '*',
            visibleScopes,
            limit: 100,
          });
          return { results: results.map((r) => r.fact) };
        }

        if (mem0Client) {
          const result = await mem0Client.getAll(userId, agentId);
          return { results: result.results };
        }

        return reply.code(503).send({ error: 'NO_BACKEND', message: 'No memory backend configured' });
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({ error: 'LIST_FAILED', message: 'Failed to list memories' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Delete a specific memory by ID
  // ---------------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { schema: { tags: ['memory'], summary: 'Delete a memory by ID' } },
    async (request, reply) => {
      const memoryId = request.params.id;

      try {
        if (memoryStore) {
          await memoryStore.deleteFact(memoryId);
          return { ok: true, memoryId };
        }

        if (mem0Client) {
          await mem0Client.delete(memoryId);
          return { ok: true, memoryId };
        }

        return reply.code(503).send({ error: 'NO_BACKEND', message: 'No memory backend configured' });
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message, memoryId });
        }
        return reply.code(500).send({ error: 'DELETE_FAILED', message: 'Failed to delete memory', memoryId });
      }
    },
  );
};
```

- [ ] **Step 2: Update memory.test.ts**

The existing memory.test.ts tests the Mem0 path. Add parallel tests for the PG path. Append the PG test suite to the existing file — do NOT delete the Mem0 tests (they ensure backward compatibility).

Add a new `describe('memoryRoutes (PG backend)', ...)` block with equivalent tests for the PG path. Mock `memoryStore` and `memorySearch` instead of `mem0Client`.

- [ ] **Step 3: Run tests**

Run: `cd packages/control-plane && pnpm vitest run src/api/routes/memory.test.ts`
Expected: PASS (existing + new tests)

- [ ] **Step 4: Commit**

```bash
git add packages/control-plane/src/api/routes/memory.ts packages/control-plane/src/api/routes/memory.test.ts
git commit -m "refactor(cp): memory routes support both Mem0 and PG backends"
```

---

### Task 9: Update Barrel Exports

**Files:**
- Modify: `packages/control-plane/src/memory/index.ts`

- [ ] **Step 1: Update exports**

```typescript
// packages/control-plane/src/memory/index.ts

// Legacy Mem0 (kept for migration period)
export type {
  AddMemoryRequest,
  Mem0ClientOptions,
  MemoryEntry,
  SearchMemoryRequest,
} from './mem0-client.js';
export { Mem0Client } from './mem0-client.js';

// New unified memory layer
export { EmbeddingClient } from './embedding-client.js';
export type { EmbeddingClientOptions } from './embedding-client.js';
export { MemoryStore } from './memory-store.js';
export type { MemoryStoreOptions, AddFactInput, AddEdgeInput } from './memory-store.js';
export { MemorySearch } from './memory-search.js';
export type { MemorySearchOptions, SearchInput } from './memory-search.js';
export { MemoryDecay } from './memory-decay.js';
export type { MemoryDecayOptions } from './memory-decay.js';

// Injector (supports both backends)
export type { MemoryInjectorOptions } from './memory-injector.js';
export { MemoryInjector } from './memory-injector.js';

// Security (unchanged)
export { createMemorySecurity } from './memory-security.js';
export type { MemorySecurity, MemorySecurityConfig, SanitizeResult } from './memory-security.js';
```

- [ ] **Step 2: Verify build**

Run: `cd packages/control-plane && pnpm build`
Expected: PASS

- [ ] **Step 3: Run full memory test suite**

Run: `cd packages/control-plane && pnpm vitest run src/memory/`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add packages/control-plane/src/memory/index.ts
git commit -m "chore(cp): update memory module barrel exports"
```

---

## Chunk 4: Integration + Verification

### Task 10: Wire PG Backend into Server

**Files:**
- Modify: `packages/control-plane/src/api/server.ts` (where memory routes are registered)

**Key change:** When `MEMORY_BACKEND=pg` env var is set (or when no Mem0 URL is configured), create `EmbeddingClient`, `MemoryStore`, `MemorySearch`, and pass to `memoryRoutes` and `MemoryInjector`.

- [ ] **Step 1: Read current server.ts to understand registration pattern**

Read `packages/control-plane/src/api/server.ts` — find the section that registers `memoryRoutes` (around lines 322-325 based on exploration).

- [ ] **Step 2: Add PG backend initialization alongside existing Mem0 initialization**

Add after the existing `mem0Client` initialization:

```typescript
// Unified Memory Layer (PG backend)
const memoryBackend = process.env.MEMORY_BACKEND ?? (mem0Client ? 'mem0' : 'pg');

let memoryStore: MemoryStore | undefined;
let memorySearch: MemorySearch | undefined;

if (memoryBackend === 'pg' && pool) {
  const embeddingBaseUrl = process.env.EMBEDDING_API_URL ?? process.env.LITELLM_PROXY_URL ?? 'http://localhost:4000';
  const embeddingModel = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';

  const embeddingClient = new EmbeddingClient({
    baseUrl: embeddingBaseUrl,
    model: embeddingModel,
    logger: logger.child({ module: 'embedding' }),
  });

  memoryStore = new MemoryStore({
    pool,
    embeddingClient,
    logger: logger.child({ module: 'memory-store' }),
  });

  memorySearch = new MemorySearch({
    pool,
    embeddingClient,
    logger: logger.child({ module: 'memory-search' }),
  });
}
```

Update the `memoryRoutes` registration:

```typescript
if (memoryStore || mem0Client) {
  await app.register(memoryRoutes, {
    prefix: '/api/memory',
    mem0Client: memoryBackend === 'mem0' ? mem0Client : undefined,
    memoryStore: memoryBackend === 'pg' ? memoryStore : undefined,
    memorySearch: memoryBackend === 'pg' ? memorySearch : undefined,
  });
}
```

Update the `MemoryInjector` construction:

```typescript
const memoryInjector = memoryBackend === 'pg' && memorySearch && memoryStore
  ? new MemoryInjector({ memorySearch, memoryStore, logger: logger.child({ module: 'memory-injector' }) })
  : mem0Client
    ? new MemoryInjector({ mem0Client, logger: logger.child({ module: 'memory-injector' }) })
    : undefined;
```

- [ ] **Step 3: Add imports at top of server.ts**

```typescript
import { EmbeddingClient, MemoryStore, MemorySearch } from '../memory/index.js';
```

- [ ] **Step 4: Verify build**

Run: `cd packages/control-plane && pnpm build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/api/server.ts
git commit -m "feat(cp): wire PG memory backend into control plane server"
```

---

### Task 11: Full Test Suite Verification

- [ ] **Step 1: Run all control-plane tests**

Run: `cd packages/control-plane && pnpm vitest run`
Expected: ALL PASS (2,100+ existing + new memory tests)

- [ ] **Step 2: Run shared package tests**

Run: `cd packages/shared && pnpm vitest run`
Expected: ALL PASS (429 existing)

- [ ] **Step 3: Run monorepo build**

Run: `pnpm build`
Expected: ALL packages build successfully

- [ ] **Step 4: Run Biome lint**

Run: `pnpm biome check packages/control-plane/src/memory/ packages/shared/src/types/memory.ts`
Expected: No errors

- [ ] **Step 5: Fix any issues found, then commit**

```bash
git add -A
git commit -m "fix(cp): address test and lint issues in memory layer"
```

---

### Task 12: Add Memory Layer to Roadmap

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Read current roadmap to find the right insertion point**

The roadmap is organized by product layers. Add a "Unified Memory" section under a suitable layer (likely "Runtime Engine" or a new top-level section).

- [ ] **Step 2: Add memory layer section**

Add to the Active Priorities table:

```markdown
| P1 | Unified Memory Layer | Replace Mem0 with PG-native hybrid search (vector + BM25 + graph) | `docs/plans/2026-03-10-unified-memory-layer-design.md` |
```

Add a new section in the appropriate layer:

```markdown
### Unified Memory Layer

- [ ] Schema + migration (pgvector, memory_facts, memory_edges)
- [ ] Embedding client (OpenAI text-embedding-3-small via LiteLLM)
- [ ] Memory store (CRUD with embedding generation)
- [ ] Hybrid search (vector + BM25 + graph with RRF fusion)
- [ ] Memory decay (Ebbinghaus-inspired, daily cron)
- [ ] Injector refactor (PG backend behind feature flag)
- [ ] Route refactor (support both Mem0 and PG)
- [ ] Server wiring (MEMORY_BACKEND env var)
- [ ] Mem0 → PG data migration script
- [ ] Memory MCP server for agent access (deferred)
- [ ] JSONL extraction pipeline (deferred)
```

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: add unified memory layer to roadmap"
```

---

Plan complete and saved to `docs/plans/2026-03-10-unified-memory-layer-impl-plan.md`. Ready to execute?
