# Unified Memory Layer Design

## Goal

Replace the external Mem0 HTTP dependency with a PostgreSQL-native hybrid memory system that provides cross-agent, cross-project searchable knowledge with vector + BM25 + graph retrieval, 4-scope isolation, automatic extraction from session JSONL, and MCP-based agent access.

## Context

AgentCTL currently has three disconnected memory sources:

1. **Mem0** (external HTTP service) — vector search via `mem0-client.ts`, injected into agent prompts via `memory-injector.ts`
2. **claude-mem SQLite** — read-only observation timeline via `claude-mem.ts` route
3. **MEMORY.md** — Claude Code's built-in auto-memory, 200-line flat markdown, not controlled by us

None supports cross-project knowledge sharing, hybrid search, knowledge graphs, or automatic consolidation. The Mem0 dependency adds operational complexity (separate service, separate storage, separate monitoring) for single-method vector search.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Agent Runtime (Worker)                     │
│                                                              │
│  ┌─────────────┐    ┌──────────────────────────────────┐    │
│  │ Claude Code │    │ Memory MCP Server (thin proxy)   │    │
│  │ / Codex     │───→│ memory_search / memory_store     │    │
│  │             │    │ memory_recall / memory_report     │    │
│  └─────────────┘    └──────────────┬───────────────────┘    │
│                                     │ HTTP                   │
│  ┌─────────────┐                    │                        │
│  │ MEMORY.md   │ (untouched,        │                        │
│  │ auto-loaded │  Claude Code's)    │                        │
│  └─────────────┘                    │                        │
└─────────────────────────────────────┼────────────────────────┘
                                      │
┌─────────────────────────────────────┼────────────────────────┐
│                    Control Plane     │                        │
│                                     ▼                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  Memory Module                        │   │
│  │                                                       │   │
│  │  memory-store.ts     CRUD + embedding generation     │   │
│  │  memory-search.ts    Hybrid search (vec+BM25+graph)  │   │
│  │  memory-extract.ts   JSONL → facts via LLM           │   │
│  │  memory-decay.ts     Strength decay cron             │   │
│  │  memory-injector.ts  EXISTING: refactored for PG     │   │
│  │  memory-security.ts  EXISTING: extended              │   │
│  │                                                       │   │
│  └────────────────────────┬─────────────────────────────┘   │
│                            │                                  │
│  ┌─────────────────────────┼────────────────────────────┐   │
│  │              PostgreSQL  │                             │   │
│  │                          ▼                             │   │
│  │  memory_facts   (content + vector(1536) + tsvector)  │   │
│  │  memory_edges   (graph relationships)                 │   │
│  │  memory_scopes  (hierarchy + config)                  │   │
│  │                                                       │   │
│  │  pgvector HNSW + GIN tsvector + btree scope/strength │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  REST API: /api/memory/*  (refactored from Mem0)     │   │
│  │  REST API: /api/claude-mem/*  (unchanged, read-only) │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

## Data Model

### MemoryFact (atomic unit of knowledge)

```typescript
type MemoryFact = {
  id: string;                    // ULID (time-sortable)
  scope: MemoryScope;            // Isolation boundary
  content: string;               // Human-readable fact text
  embedding: Float32Array;       // Full 1536D vector
  content_model: string;         // Embedding model used
  entity_type: EntityType;       // Classification
  confidence: number;            // 0-1, from extraction LLM
  strength: number;              // 0-1, decays over time
  source: FactSource;            // Provenance
  valid_from: Date;              // When this fact became true
  valid_until: Date | null;      // null = still valid
  created_at: Date;
  accessed_at: Date;
};

type MemoryScope =
  | 'global'
  | `project:${string}`
  | `agent:${string}`
  | `session:${string}`;

type EntityType =
  | 'code_artifact'    // file, function, class, API endpoint
  | 'decision'         // architectural choice + rationale
  | 'pattern'          // recurring code pattern or convention
  | 'error'            // bug, exception, failure mode + resolution
  | 'person'           // developer, reviewer
  | 'concept'          // abstract pattern, design principle
  | 'preference';      // user/agent preference

type FactSource = {
  session_id: string | null;     // Links to rcSessions table
  agent_id: string | null;       // Links to agents table
  machine_id: string | null;     // Links to machines table
  turn_index: number | null;     // Position in JSONL for provenance
  extraction_method: 'llm' | 'rule' | 'manual' | 'import';
};
```

### MemoryEdge (graph relationship)

```typescript
type MemoryEdge = {
  id: string;
  source_fact_id: string;
  target_fact_id: string;
  relation: RelationType;
  weight: number;                // 0-1, strengthened on co-retrieval
  created_at: Date;
};

type RelationType =
  | 'modifies'       // Agent/person changed a code artifact
  | 'depends_on'     // Code/project dependency
  | 'caused_by'      // Error caused by code change
  | 'resolves'       // Code change resolves an error/issue
  | 'supersedes'     // New fact replaces old one (temporal)
  | 'related_to'     // Semantic similarity
  | 'summarizes';    // Consolidation summary → originals
```

## Database Schema

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE memory_facts (
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

CREATE INDEX idx_facts_embedding ON memory_facts
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 256);
CREATE INDEX idx_facts_content_tsv ON memory_facts USING gin (content_tsv);
CREATE INDEX idx_facts_scope ON memory_facts (scope);
CREATE INDEX idx_facts_entity_type ON memory_facts (entity_type);
CREATE INDEX idx_facts_strength ON memory_facts (strength) WHERE strength > 0.05;
CREATE INDEX idx_facts_valid ON memory_facts (valid_until) WHERE valid_until IS NULL;

CREATE TABLE memory_edges (
  id              TEXT PRIMARY KEY,
  source_fact_id  TEXT NOT NULL REFERENCES memory_facts(id) ON DELETE CASCADE,
  target_fact_id  TEXT NOT NULL REFERENCES memory_facts(id) ON DELETE CASCADE,
  relation        TEXT NOT NULL,
  weight          REAL NOT NULL DEFAULT 0.5,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_fact_id, target_fact_id, relation)
);

CREATE INDEX idx_edges_source ON memory_edges (source_fact_id);
CREATE INDEX idx_edges_target ON memory_edges (target_fact_id);

CREATE TABLE memory_scopes (
  scope         TEXT PRIMARY KEY,
  parent_scope  TEXT REFERENCES memory_scopes(scope),
  display_name  TEXT,
  config_json   JSONB NOT NULL DEFAULT '{}'
);
```

### Storage Projections

| Scale | Facts | Vector Data | HNSW Index | Total |
|-------|-------|-------------|------------|-------|
| 6 months | ~10K | ~60 MB | ~80 MB | ~150 MB |
| 1 year | ~30K | ~180 MB | ~240 MB | ~450 MB |
| 3 years | ~100K | ~600 MB | ~800 MB | ~1.5 GB |

pgvector comfortable ceiling: ~10M vectors. We won't approach this for years.

## Hybrid Search

Three retrieval paths fused via Reciprocal Rank Fusion:

```
Query
  │
  ├──→ Vector Search (pgvector HNSW, cosine similarity)
  │    SELECT id, 1 - (embedding <=> $query_vec) AS score
  │    FROM memory_facts
  │    WHERE scope IN ($visible_scopes) AND valid_until IS NULL AND strength > 0.05
  │    ORDER BY embedding <=> $query_vec LIMIT 40
  │
  ├──→ BM25 Search (tsvector + ts_rank)
  │    SELECT id, ts_rank(content_tsv, to_tsquery($query)) AS score
  │    FROM memory_facts
  │    WHERE content_tsv @@ to_tsquery($query)
  │      AND scope IN ($visible_scopes) AND valid_until IS NULL AND strength > 0.05
  │    ORDER BY score DESC LIMIT 40
  │
  └──→ Graph Traversal (recursive CTE, 2-hop BFS)
       WITH RECURSIVE graph AS (
         SELECT target_fact_id, 1 AS depth FROM memory_edges
         WHERE source_fact_id IN ($seed_entity_ids)
         UNION ALL
         SELECT e.target_fact_id, g.depth + 1
         FROM memory_edges e JOIN graph g ON e.source_fact_id = g.target_fact_id
         WHERE g.depth < 2
       )
       SELECT DISTINCT target_fact_id FROM graph
       → up to 40 candidates
  │
  ▼
Reciprocal Rank Fusion: score = Σ 1/(60 + rank_i)
  │
  ▼
Strength-weighted reranking:
  final = rrf_score × strength × recency_boost(accessed_at) × scope_boost(scope)
  │
  ▼
Top 10 results with provenance
```

### Scope Visibility

When agent `worker-1` on project `agentctl` queries, visible scopes are:
- `agent:worker-1` (own agent facts)
- `project:agentctl` (project facts)
- `global` (fleet-wide facts)

Agent `worker-2`'s facts are NOT visible.

### Scope Boost

- Same agent scope: 1.2x
- Same project scope: 1.1x
- Global scope: 1.0x

## Memory Lifecycle

### Extraction (dual-path)

**Real-time** (during session): Every N turns (default 5), lightweight LLM call extracts key entities/facts from recent turns. Available for search immediately. Non-blocking — runs async, does not add latency to agent loop.

**Batch** (after session): Full session JSONL review via LLM. Extracts all facts, entities, and relationships. Deduplication against existing facts (embedding cosine > 0.92). Conflict detection and supersession.

### Decay (daily cron)

```
strength *= 0.95 ^ days_since_last_access
```

- Facts accessed during retrieval get `strength` reset to 1.0
- Below 0.05 threshold: archived (excluded from default search, still queryable with explicit flag)

### Consolidation (weekly cron)

- Cluster related facts via graph community detection
- Generate summary facts for each cluster
- Cold-tier originals (>90 days, strength < 0.1): compressed to summary + archived originals

### Conflict Resolution

- New fact with embedding similarity > 0.85 to existing but different content:
  - Set old fact's `valid_until` to now
  - Store new fact with `supersedes` edge to old
  - Both remain queryable; search prefers `valid_until IS NULL`

## Context Window Budget

```typescript
type InjectionBudget = {
  maxTokens: number;        // Default: 2000
  maxFacts: number;         // Default: 15
  priorityWeights: {
    relevance: number;      // 0.5
    recency: number;        // 0.2
    strength: number;       // 0.2
    scopeProximity: number; // 0.1
  };
};
```

Injection flow:
1. Hybrid search → top 40 candidates
2. Score each with weighted priorities
3. Greedily add facts until maxTokens or maxFacts
4. Format as markdown section
5. Inject via `--append-system-prompt` (existing flow)

## MCP Interface

Thin MCP server on worker, proxies to control-plane memory API:

| Tool | Description | Parameters |
|------|-------------|------------|
| `memory_search` | Hybrid vector+keyword+graph search | `query`, `scope?`, `entity_type?`, `limit?` |
| `memory_store` | Store a new fact | `content`, `scope`, `entity_type`, `related_to?[]` |
| `memory_recall` | Graph traversal from entity | `entity_id`, `depth?`, `relation_type?` |
| `memory_report` | Generate scoped markdown report | `scope`, `period: daily\|weekly\|monthly` |
| `memory_promote` | Promote fact to broader scope | `fact_id`, `target_scope` |

## MEMORY.md Coexistence

Claude Code auto-loads MEMORY.md into every session. We do NOT replace or modify this. Our memory layer provides *additional* context via `--append-system-prompt`. The two coexist:
- MEMORY.md: Claude Code's built-in memory (flat, local, 200-line cap)
- Unified memory: cross-agent, cross-project, searchable, graph-aware

## Security

Extends existing `memory-security.ts`:
- **Content sanitization**: Existing blocked/sensitive pattern detection runs before embedding generation
- **Scope enforcement**: SQL WHERE clauses filter by visible scopes; potential future RLS
- **Audit trail**: Every memory write logged to ClickHouse via existing Vector pipeline
- **No secrets in embeddings**: Content passes through `validate()` before embedding API call

## Graceful Degradation

Memory is always an enhancement, never a blocker:

| Failure | Behavior |
|---------|----------|
| PG down | Agent starts without memory context. Logs warning. |
| Embedding API down | Store fact without embedding. Mark for backfill. BM25+graph still work. |
| Extraction LLM fails | Raw session archived. Batch retry on next cron cycle. |
| Search timeout (>500ms) | Return partial results from completed retrieval paths. |
| MCP server unreachable | Agent runs without memory tools. Core functionality unaffected. |

## Package Layout

No new package. Lives in existing packages:

```
packages/shared/src/types/memory.ts        ← Extend with new types
packages/control-plane/src/memory/
  ├── memory-store.ts                       ← NEW: PG CRUD + embeddings
  ├── memory-search.ts                      ← NEW: Hybrid search + RRF
  ├── memory-extract.ts                     ← NEW: JSONL → facts
  ├── memory-decay.ts                       ← NEW: Cron jobs
  ├── memory-injector.ts                    ← REFACTOR: Mem0 → PG
  ├── memory-security.ts                    ← EXTEND
  ├── mem0-client.ts                        ← DEPRECATE after migration
  └── index.ts                              ← Update exports
packages/control-plane/src/api/routes/
  ├── memory.ts                             ← REFACTOR: Mem0 → PG
  └── claude-mem.ts                         ← UNCHANGED
packages/control-plane/src/db/migrations/
  └── 0009_memory_layer.sql                 ← NEW
packages/agent-worker/src/runtime/
  └── memory-mcp-server.ts                  ← NEW: Thin proxy
```

## Embedding Strategy

**MVP**: text-embedding-3-small (1536D, $0.02/M tokens) via LiteLLM proxy.
- Single vector space for all content (code + conversation)
- $1/month at current scale
- `content_model` column tracks which model generated each embedding

**Upgrade path**: Swap to voyage-code-3 when code retrieval becomes the bottleneck. Re-embed all facts (batch job). Matryoshka truncated indexing (store 1536D, index 512D) when facts exceed 100K.

## Migration from Mem0

| Phase | Duration | Action |
|-------|----------|--------|
| 1: Dual-write | Week 1-2 | New facts → both Mem0 and PG. Search from PG. |
| 2: Import | Week 3-4 | Migrate Mem0 memories → PG. Import claude-mem observations. Batch-extract recent JSONL. |
| 3: Cutover | Week 5 | Remove Mem0 dependency. Feature flag: `MEMORY_BACKEND=pg` (default) vs `mem0` (rollback). |

## Observability

| Metric | Type |
|--------|------|
| `memory.search.latency_ms` | histogram |
| `memory.search.results_count` | histogram |
| `memory.search.retrieval_paths` | counter per path |
| `memory.extract.facts_per_session` | histogram |
| `memory.extract.duplicates_detected` | counter |
| `memory.inject.tokens_used` | histogram |
| `memory.inject.skipped` | counter |
| `memory.facts.total` | gauge per scope |
| `memory.facts.decayed` | counter |

## Cost Estimate

| Component | Monthly Cost |
|-----------|-------------|
| Embeddings (text-embedding-3-small, ~50M tokens) | $1.00 |
| Extraction LLM (Claude Haiku, ~15M tokens) | $3.75 |
| PG storage (incremental) | ~$0 (existing instance) |
| LiteLLM proxy (existing) | $0 |
| **Total** | **~$5/month** |

## Deferred Items

| Item | Trigger to Revisit |
|------|-------------------|
| Voyage-code-3 embeddings | Code retrieval misses obvious matches |
| Matryoshka 2-phase search | >100K facts |
| CRDT multi-machine sync | 2+ workers writing simultaneously |
| Graph visualization (react-force-graph) | User requests knowledge graph view |
| ParadeDB pg_search (BM25 upgrade) | Keyword search returns irrelevant results |
| Auto-promotion rules | 3+ agents on same project |
| Report generation | Core search works, user asks for reports |

## Research Sources

### Memory Frameworks
- Mem0: Hybrid vector+graph+KV, 26% accuracy improvement, 91% lower p95 latency
- Zep/Graphiti: Bi-temporal knowledge graph, 94.8% DMR benchmark
- Letta/MemGPT: OS-like memory hierarchy, self-editing agents
- LangMem: LangGraph-native, high latency (17.99s p50)
- Cognee: 14 search modes, 0.93 HotPotQA, pre-v1.0

### Knowledge Graphs
- GraphRAG (Microsoft): Leiden algorithm + hierarchical summarization
- LightRAG: Flat graph, incremental updates, 50% faster than GraphRAG
- Graphiti: Bi-temporal, conflict resolution, custom entity types

### Search Patterns
- Hybrid (vector + BM25 + graph + RRF): 20-40% improvement over vector-only
- Matryoshka embeddings: Store full, search truncated 512D, rerank on full
- pgvector HNSW: 15ms p50 at 1M vectors, comfortable to ~10M

### Production Systems
- Claude Code: Flat markdown MEMORY.md, 200-line cap, no semantic search
- ChatGPT: 4-layer architecture, pre-computed summaries, skip RAG
- Cursor: Sidecar model suggests memories, 73% auto-converted controversy
- CRDT sync: Automerge/Yjs/Loro for eventual consistency without coordination
