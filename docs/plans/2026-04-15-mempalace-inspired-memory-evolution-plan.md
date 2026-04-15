# MemPalace-Inspired Memory Evolution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade AgentCTL memory from extracted fact recall into a source-grounded memory palace that keeps verbatim evidence, scoped navigation, agent diaries, temporal truth, and measurable recall quality.

**Architecture:** Keep AgentCTL's PostgreSQL-native memory core instead of adopting ChromaDB. Add a verbatim drawer layer underneath existing `memory_facts`, link extracted facts back to raw session/code chunks, fuse drawer/fact/graph retrieval, and add periodic checkpoint capture plus benchmark gates so recall improvements are measured before broad rollout.

**Tech Stack:** PostgreSQL + pgvector + tsvector, Fastify, existing `MemoryStore` / `MemorySearch`, worker MCP routes, Next.js memory UI, Vitest, Playwright, optional LiteLLM rerank behind a feature flag.

---

## Research Summary

This plan is based on a source review of the current MemPalace repository and the current AgentCTL memory implementation.

MemPalace sources reviewed:

- [README](https://github.com/MemPalace/mempalace/blob/develop/README.md)
- [benchmarks/BENCHMARKS.md](https://github.com/MemPalace/mempalace/blob/develop/benchmarks/BENCHMARKS.md)
- [benchmarks/HYBRID_MODE.md](https://github.com/MemPalace/mempalace/blob/develop/benchmarks/HYBRID_MODE.md)
- [website/concepts/the-palace.md](https://github.com/MemPalace/mempalace/blob/develop/website/concepts/the-palace.md)
- [website/concepts/knowledge-graph.md](https://github.com/MemPalace/mempalace/blob/develop/website/concepts/knowledge-graph.md)
- [website/reference/mcp-tools.md](https://github.com/MemPalace/mempalace/blob/develop/website/reference/mcp-tools.md)
- [website/guide/hooks.md](https://github.com/MemPalace/mempalace/blob/develop/website/guide/hooks.md)
- [mempalace/searcher.py](https://github.com/MemPalace/mempalace/blob/develop/mempalace/searcher.py)
- [mempalace/backends/base.py](https://github.com/MemPalace/mempalace/blob/develop/mempalace/backends/base.py)
- [mempalace/knowledge_graph.py](https://github.com/MemPalace/mempalace/blob/develop/mempalace/knowledge_graph.py)

AgentCTL sources reviewed:

- `docs/plans/2026-03-10-unified-memory-layer-design.md`
- `docs/plans/2026-03-10-unified-memory-layer-impl-plan.md`
- `docs/plans/2026-03-11-memory-ui-design.md`
- `docs/plans/2026-03-11-memory-ui-implementation.md`
- `packages/control-plane/src/memory/memory-store.ts`
- `packages/control-plane/src/memory/memory-search.ts`
- `packages/control-plane/src/memory/memory-injector.ts`
- `packages/control-plane/src/memory/knowledge-synthesis.ts`
- `packages/control-plane/src/memory/knowledge-maintenance.ts`
- `packages/agent-worker/src/hooks/experience-extraction-hook.ts`
- `packages/agent-worker/src/hooks/experience-extractor.ts`
- `packages/agent-worker/src/api/routes/memory-*.ts`
- `packages/shared/src/types/memory.ts`

## What MemPalace Gets Right

| Idea | MemPalace shape | AgentCTL status | Recommendation |
| --- | --- | --- | --- |
| Verbatim storage | Store original conversation text as drawers; extraction is not the source of truth. | AgentCTL stores extracted facts and session summaries; raw transcript is available during extraction but not retained as first-class searchable memory. | Adopt. This is the highest-value gap. |
| Scoped navigation | Wings for people/projects, rooms for topics, drawers for original chunks. | AgentCTL has scopes, entity types, tags, and graph edges, but no stable wing/room taxonomy. | Adapt onto existing scopes/tags instead of copying naming blindly. |
| Hybrid retrieval | Raw semantic retrieval plus BM25, closet/source boosts, neighbor hydration, temporal boosts, optional LLM rerank. | AgentCTL already has vector + BM25 + graph RRF over facts. It lacks raw drawer retrieval, temporal query parsing, assistant-reference search, and source-neighbor hydration. | Adopt as incremental search improvements. |
| Temporal KG | Entity triples with valid windows and timeline queries. | Facts have `valid_from` / `valid_until`; edges do not. No entity-first triple/timeline API. | Adapt by extending edges and adding entity indexes. |
| Agent diaries | Named agent wings with diary entries. | Agent scopes exist, but there is no diary stream separate from durable facts. | Adopt. It maps well to multi-agent operations. |
| Auto-save hooks | Periodic save and PreCompact emergency save. | AgentCTL has post-session experience extraction, not periodic or pre-compact checkpoints. | Adopt carefully with nonblocking, bounded capture. |
| Benchmarks | Repository includes benchmark methodology and per-question result files. | AgentCTL has many unit/e2e tests but no recall benchmark for memory quality. | Adopt immediately before changing retrieval ranking. |
| Backend abstraction | ChromaDB backend is behind a narrow collection interface. | AgentCTL is intentionally PostgreSQL-native. | Keep Postgres, but add a narrow retrieval backend interface for tests and future search engines. |
| AAAK compression | Experimental lossy token compression. | No equivalent. | Do not adopt now. It regresses in MemPalace's own framing and should only be revisited after raw recall is measured. |

## Current AgentCTL Baseline

AgentCTL already has a strong memory system:

- `memory_facts` stores atomic facts with pgvector embeddings, tsvector, confidence, strength, scope, source metadata, and validity windows.
- `memory_edges` stores typed relations and supports graph traversal.
- `MemorySearch` fuses vector, BM25, and graph results with Reciprocal Rank Fusion and boosts by recency, strength, scope, and role affinity.
- `MemoryInjector` supports 3-tier context budgeting: pinned, on-demand, triggered.
- Worker routes expose `memory_search`, `memory_store`, `memory_recall`, `memory_feedback`, `memory_report`, and `memory_promote`.
- Web UI covers browser, graph, dashboard, consolidation, reports, import, scopes, synthesis, maintenance, decay, provenance filters, and contextual session/agent/machine memory views.
- Post-session `ExperienceExtractor` mines decisions, patterns, errors, and experiences from completed transcripts.

The main gap is not "more memory UI" or "another vector database". The gap is evidence preservation and measured retrieval quality:

- Extracted facts can lose the reasoning, alternatives, quote, and local sequence that made a decision useful.
- Search operates on extracted facts, so a missed extraction means the memory is gone from recall.
- The graph has relations between facts, but there is no raw source layer to prove why a fact exists.
- Auto-capture happens after a session, not at periodic checkpoints or before context compaction.
- There is no project-specific recall benchmark to prevent ranking changes from feeling good but hurting retrieval.

## Target Architecture

```text
Runtime transcript / session events / imported JSONL / docs
        |
        v
memory_drawers
  - raw chunks, source metadata, chunk order, scope, wing, room
  - embedding + tsvector
  - retention/redaction metadata
        |
        +--> memory_facts
        |      - extracted durable facts
        |      - existing confidence, strength, validity
        |
        +--> memory_fact_sources
        |      - fact -> drawer provenance
        |      - quote/char offsets when available
        |
        +--> memory_edges / memory_entities
               - fact relations, room tunnels, temporal triples

Search query
  |
  +--> fact vector/BM25/graph RRF
  +--> drawer vector/BM25 source search
  +--> temporal/entity boosts
  +--> optional rerank on top N
  |
  v
grounded results: fact + supporting drawer snippets + source trail
```

## Design Principles

1. Keep raw evidence local and searchable.
2. Treat summaries and extracted facts as indexes, not as the only memory.
3. Search should never gate on a weak classifier. Every advanced signal can boost or rerank; raw drawer search remains the floor.
4. Every extracted fact should have provenance back to source chunks.
5. Every ranking improvement needs an eval before and after.
6. Raw storage needs stricter privacy controls than extracted facts: redaction, retention, scoped visibility, and explicit export/delete paths.
7. Do not add ChromaDB unless PostgreSQL cannot meet measured recall or latency goals.

## Proposed Data Model

### `memory_drawers`

Raw source chunks, analogous to MemPalace drawers.

```sql
CREATE TABLE memory_drawers (
  id text PRIMARY KEY,
  scope text NOT NULL,
  wing text NOT NULL,
  room text NOT NULL,
  source_type text NOT NULL,
  source_id text,
  source_uri text,
  chunk_index integer NOT NULL DEFAULT 0,
  content text NOT NULL,
  content_sha256 text NOT NULL,
  embedding vector(1536),
  content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  token_count integer NOT NULL DEFAULT 0,
  metadata_json jsonb NOT NULL DEFAULT '{}',
  redaction_status text NOT NULL DEFAULT 'unreviewed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, chunk_index)
);
```

Recommended indexes:

- HNSW on `embedding`
- GIN on `content_tsv`
- btree on `(scope, wing, room)`
- btree on `(source_type, source_id, chunk_index)`
- unique btree on `content_sha256` for exact dedup

### `memory_fact_sources`

Many-to-many provenance from extracted facts to raw chunks.

```sql
CREATE TABLE memory_fact_sources (
  fact_id text NOT NULL REFERENCES memory_facts(id) ON DELETE CASCADE,
  drawer_id text NOT NULL REFERENCES memory_drawers(id) ON DELETE CASCADE,
  quote text,
  char_start integer,
  char_end integer,
  confidence real NOT NULL DEFAULT 1.0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fact_id, drawer_id)
);
```

### Edge Temporal Extensions

Extend existing `memory_edges` instead of replacing it:

```sql
ALTER TABLE memory_edges
  ADD COLUMN IF NOT EXISTS valid_from timestamptz,
  ADD COLUMN IF NOT EXISTS valid_until timestamptz,
  ADD COLUMN IF NOT EXISTS source_drawer_id text REFERENCES memory_drawers(id),
  ADD COLUMN IF NOT EXISTS confidence real NOT NULL DEFAULT 1.0;
```

### `memory_agent_diary_entries`

Agent diary stream, separate from durable facts.

```sql
CREATE TABLE memory_agent_diary_entries (
  id text PRIMARY KEY,
  agent_id text NOT NULL,
  scope text NOT NULL,
  topic text NOT NULL DEFAULT 'general',
  entry text NOT NULL,
  source_session_id text,
  source_drawer_id text REFERENCES memory_drawers(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Diary entries can be searchable through the drawer layer, but they should remain clearly labeled so they do not masquerade as verified facts.

## Retrieval Plan

### Baseline Search Paths

Keep the current `MemorySearch` fact paths:

- fact vector search
- fact BM25 search
- fact graph search

Add drawer paths:

- drawer vector search
- drawer BM25 search
- source-neighbor hydration: if a drawer matches, fetch `chunk_index - 1`, `chunk_index`, and `chunk_index + 1` from the same source when within budget.

### Ranking Signals

Add the following signals one at a time, each behind a config flag and measured against the eval harness:

1. **Exact keyword / BM25 boost**: MemPalace's failure analysis shows specific nouns are underweighted by embeddings. AgentCTL's current BM25 path uses `to_tsquery` joined by `&`, which can be too strict. Add `websearch_to_tsquery` or candidate-set BM25 fallback.
2. **Temporal boost**: Parse phrases like "yesterday", "last week", "four weeks ago", "before PR #563", and "after the mesh migration". Boost drawers/facts near the inferred date or source event.
3. **Assistant-reference two-pass**: If query refers to "you suggested", "the agent said", "Codex recommended", or "Claude explained", search assistant/tool-output drawers in addition to user-authored facts.
4. **Source boost**: If fact and drawer agree, boost both. If a drawer is strong but no fact exists, still return it as evidence.
5. **Optional LLM rerank**: Only after top-20 retrieval, behind `MEMORY_RERANK_ENABLED`. It should never be required for core recall or local mode.

### Result Shape

Extend `MemorySearchResult` with source grounding:

```typescript
type GroundedMemorySearchResult = {
  fact?: MemoryFact;
  drawer?: MemoryDrawer;
  supportingDrawers: MemoryDrawerSnippet[];
  score: number;
  sourcePath: 'fact-vector' | 'fact-bm25' | 'fact-graph' | 'drawer-vector' | 'drawer-bm25' | 'rerank';
  matchedVia: Array<'fact' | 'drawer' | 'graph' | 'temporal' | 'source-boost'>;
};
```

## Implementation Phases

### Phase 0: Eval Harness First

**Goal:** Make retrieval quality measurable before ranking changes.

**Files:**

- Create: `packages/control-plane/src/memory/memory-eval.ts`
- Create: `packages/control-plane/src/memory/memory-eval.test.ts`
- Create: `docs/fixtures/memory-eval/agentctl-memory-eval.json`
- Add: `scripts/memory-eval.ts`
- Modify: `package.json`

**Work:**

1. Define a local eval format:

   ```json
   {
     "id": "mesh-update-why-rate-limit",
     "query": "Why does peer update need rate limiting before auth?",
     "expectedFactIds": [],
     "expectedSourceIds": [],
     "answerHint": "CodeQL missing-rate-limiting on signed peer update route"
   }
   ```

2. Seed 30-50 cases from recent AgentCTL work:
   - memory UI decisions
   - mesh registration decisions
   - security/rate-limit fixes
   - CI/Docker action migrations
   - context bridge decisions

3. Implement metrics:
   - R@5
   - R@10
   - MRR
   - NDCG@10
   - source-grounding coverage: percent of fact hits with a supporting drawer

4. Add command:

   ```bash
   pnpm memory:eval -- --fixture docs/fixtures/memory-eval/agentctl-memory-eval.json
   ```

5. Expected first target:
   - facts-only baseline recorded, not necessarily optimized.
   - later PRs must compare against this baseline.

### Phase 1: Verbatim Drawer Storage

**Goal:** Preserve raw session/code evidence without replacing existing facts.

**Files:**

- Create: `packages/control-plane/drizzle/0027_add_memory_drawers.sql` or next available migration
- Modify: `packages/control-plane/drizzle/meta/_journal.json`
- Modify: `packages/shared/src/types/memory.ts`
- Create: `packages/control-plane/src/memory/memory-drawer-store.ts`
- Create: `packages/control-plane/src/memory/memory-drawer-store.test.ts`
- Modify: `packages/control-plane/src/memory/index.ts`

**Work:**

1. Add `MemoryDrawer`, `MemoryDrawerSourceType`, `MemoryFactSource`, and snippet types.
2. Add table and indexes.
3. Implement deterministic drawer IDs:
   - `drw_${sourceType}_${sourceId}_${chunkIndex}_${sha256.slice(0,12)}`
4. Add exact dedup using `content_sha256`.
5. Chunk transcripts by turn windows and code/docs by paragraph/heading boundaries.
6. Reuse existing memory security sanitizers before raw content is stored.
7. Tests:
   - exact duplicate skipped
   - chunk order stable
   - embeddings can fail without blocking storage
   - source metadata is preserved
   - unsafe/raw secret-like content is redacted or flagged according to policy

### Phase 2: Fact Provenance

**Goal:** Every extracted fact can point back to the evidence that created it.

**Files:**

- Create: `packages/control-plane/drizzle/0028_add_memory_fact_sources.sql` or next available migration
- Modify: `packages/control-plane/src/memory/memory-store.ts`
- Modify: `packages/agent-worker/src/hooks/experience-extractor.ts`
- Modify: `packages/agent-worker/src/hooks/experience-extraction-prompt.ts`
- Modify: `packages/control-plane/src/api/routes/memory-facts.ts`
- Modify: `packages/web/src/components/memory/FactDetailPanel.tsx`

**Work:**

1. Add optional `sourceDrawerIds` and `quotes` to `AddFactInput`.
2. Update the extraction prompt to ask for short source quotes when available.
3. Store fact-source links in `memory_fact_sources`.
4. Return supporting snippets from fact detail APIs.
5. Show "Evidence" in the Memory Browser detail panel:
   - source session
   - turn/chunk
   - quote
   - "open source chunk" action
6. Tests:
   - fact creation links to drawer
   - fact deletion cascades provenance
   - route response includes supporting snippets
   - UI renders evidence without breaking existing facts that lack provenance

### Phase 3: Drawer-Aware Search Fusion

**Goal:** Search raw memories and extracted facts together.

**Files:**

- Modify: `packages/control-plane/src/memory/memory-search.ts`
- Create: `packages/control-plane/src/memory/memory-drawer-search.ts`
- Create: `packages/control-plane/src/memory/memory-drawer-search.test.ts`
- Modify: `packages/control-plane/src/api/routes/memory-facts.ts`
- Modify: `packages/agent-worker/src/api/routes/memory-search.ts`
- Modify: `packages/shared/src/types/memory.ts`

**Work:**

1. Add drawer vector and drawer BM25 search.
2. Add source-neighbor hydration for chunked drawers.
3. Fuse fact and drawer paths with RRF.
4. Add config flags:
   - `MEMORY_DRAWER_SEARCH_ENABLED`
   - `MEMORY_TEMPORAL_BOOST_ENABLED`
   - `MEMORY_ASSISTANT_REFERENCE_SEARCH_ENABLED`
5. Relax BM25 fallback for query terms:
   - keep current `to_tsquery` path
   - add `websearch_to_tsquery` or candidate-set BM25 when strict AND query returns zero
6. Add temporal parser for common relative date phrases and PR/commit/source timestamps where known.
7. Add assistant-reference detection to search assistant/tool-output drawers.
8. Tests:
   - facts-only behavior unchanged when feature flag disabled
   - drawer-only hit returned when extraction missed it
   - fact with matching drawer gets source boost
   - neighbor hydration includes adjacent chunks and respects char/token cap
   - strict BM25 zero-result path falls back cleanly
   - temporal boost changes ranking only when temporal signal exists

### Phase 4: Auto-Save Checkpoints

**Goal:** Reduce memory loss from long-running sessions and context compaction.

**Files:**

- Create: `packages/agent-worker/src/hooks/memory-checkpoint-hook.ts`
- Create: `packages/agent-worker/src/hooks/memory-checkpoint-hook.test.ts`
- Modify: `packages/agent-worker/src/runtime/sdk-runner.ts`
- Modify: `packages/agent-worker/src/runtime/agent-instance.ts`
- Modify: `packages/agent-worker/src/hooks/index.ts`
- Add docs: `docs/MEMORY_CHECKPOINTS.md`

**Work:**

1. Add a nonblocking checkpoint hook triggered by:
   - every N human turns, default 15
   - stop/session end
   - pre-compaction event when runtime exposes it
2. Store raw drawer chunks first.
3. Run fact extraction asynchronously after raw storage.
4. Keep checkpoint state per runtime session to avoid duplicate writes.
5. Add config:
   - `MEMORY_CHECKPOINT_ENABLED`
   - `MEMORY_CHECKPOINT_TURN_INTERVAL`
   - `MEMORY_CHECKPOINT_MAX_CHARS`
6. Tests:
   - under interval does nothing
   - at interval stores raw drawer
   - repeated hook does not duplicate same transcript chunk
   - extractor failure does not lose raw drawer
   - hook errors do not block session teardown

### Phase 5: Agent Diaries

**Goal:** Give specialist agents lightweight continuity without polluting durable fact memory.

**Files:**

- Create migration for `memory_agent_diary_entries`
- Create: `packages/control-plane/src/memory/agent-diary-store.ts`
- Create: `packages/control-plane/src/api/routes/memory-diaries.ts`
- Create: `packages/agent-worker/src/api/routes/memory-diary-write.ts`
- Create: `packages/agent-worker/src/api/routes/memory-diary-read.ts`
- Modify: `packages/web/src/components/memory/MemorySidebar.tsx`
- Create: `packages/web/src/app/memory/diaries/page.tsx`

**Work:**

1. Add `memory_diary_write` and `memory_diary_read` worker routes.
2. Store entries under `agent:${agentId}` with a topic.
3. Return recent diary entries separately from verified facts.
4. Add a Memory Diaries page:
   - agent filter
   - topic filter
   - recent entries
   - promote-to-fact action
5. Tests:
   - diary writes are scoped to agent
   - reads default to last 10
   - diary entries do not appear in default fact search unless explicitly included
   - promote-to-fact creates a normal `memory_fact` with provenance

### Phase 6: Temporal Entity Timeline

**Goal:** Make "what was true then?" and "what changed?" first-class queries.

**Files:**

- Modify: `packages/control-plane/drizzle/*memory_edges*` migration or add next migration
- Create: `packages/control-plane/src/memory/entity-timeline.ts`
- Create: `packages/control-plane/src/api/routes/memory-timeline.ts`
- Create: `packages/agent-worker/src/api/routes/memory-timeline.ts`
- Modify: `packages/web/src/app/memory/graph/page.tsx`
- Modify: `packages/web/src/components/memory/GraphTableView.tsx`

**Work:**

1. Add valid windows and source drawer reference to edges.
2. Add entity extraction index from facts/drawers:
   - people
   - agents
   - machines
   - files
   - projects
   - PRs/issues
3. Add APIs:
   - `GET /api/memory/timeline?entity=...&asOf=...`
   - `POST /api/memory/edges/:id/invalidate`
4. Add worker MCP-style route:
   - `memory_timeline`
5. UI:
   - graph timeline tab can show current vs historical facts
   - fact detail shows superseded/contradicted lineage
6. Tests:
   - as-of query excludes future and expired edges
   - invalidation preserves history
   - timeline orders events deterministically

### Phase 7: UI Polish for Evidence-Based Memory

**Goal:** Make the new source-grounded model usable rather than just stored.

**Files:**

- Modify: `packages/web/src/views/MemoryBrowserView.tsx`
- Modify: `packages/web/src/components/memory/FactDetailPanel.tsx`
- Modify: `packages/web/src/components/memory/BrowserFilterSidebar.tsx`
- Modify: `packages/web/src/components/context-picker/MemoryPanel.tsx`
- Add/modify Playwright specs under `packages/web/e2e/memory-browser.spec.ts`

**Work:**

1. Add result type badges:
   - Fact
   - Drawer
   - Diary
   - Timeline
2. Add evidence snippets in fact details.
3. Add raw source filters:
   - source type
   - wing
   - room
   - has evidence
4. Add "include raw drawers" toggle to context picker memory panel.
5. Add "why this matched" row:
   - vector
   - keyword
   - graph
   - temporal
   - source boost
6. Tests:
   - backend-independent browser spec for raw drawer result
   - evidence panel render
   - include-raw toggle changes query params
   - empty/no-provenance facts still render

## Suggested PR Slices

1. **PR A: Eval Harness**
   - Adds fixtures and baseline command.
   - No product behavior change.

2. **PR B: Drawer Schema + Store**
   - Adds raw storage tables and store service.
   - No retrieval behavior change.

3. **PR C: Post-Session Drawer Capture + Provenance**
   - Stores raw transcript drawers before fact extraction.
   - Links extracted facts to drawers.

4. **PR D: Drawer-Aware Search**
   - Adds drawer search behind feature flag.
   - Includes eval comparison.

5. **PR E: Checkpoint Capture**
   - Adds periodic/pre-compact checkpoint logic.
   - Keeps failures nonblocking.

6. **PR F: Agent Diaries**
   - Adds diary storage, routes, and basic UI.

7. **PR G: Temporal Timeline**
   - Extends edges with validity windows and timeline APIs/UI.

## Risks and Guardrails

| Risk | Mitigation |
| --- | --- |
| Raw transcripts can contain secrets. | Redact before storage, label redaction status, add retention/delete path, never expose raw drawers across scopes. |
| Storage growth. | Chunk dedup by SHA-256, retention settings per scope, archive old drawers separately from facts. |
| Ranking regressions. | Eval harness first; every search PR reports before/after R@5/R@10/MRR. |
| LLM extraction/rerank cost. | Raw storage and local retrieval are baseline; extraction/rerank are async or feature-flagged. |
| UI overload. | Hide advanced evidence details behind the fact detail panel and search result explanation row. |
| Duplicate memory surfaces. | Diary entries, drawers, and facts must be visually distinct and have different default search inclusion rules. |

## Out of Scope for Now

- Replacing PostgreSQL with ChromaDB.
- Adopting AAAK or any custom compression dialect.
- Perfect benchmark parity with LongMemEval.
- Cloud memory providers.
- Auto-writing durable facts without provenance or review path.

## Acceptance Criteria

- AgentCTL can store raw transcript chunks as local `memory_drawers`.
- Extracted facts link to supporting drawer snippets.
- Memory search can return drawer-only evidence when no fact exists.
- Memory Browser can show why a result matched and where it came from.
- At least 30 local recall eval questions run in CI or a documented local command.
- Drawer-aware search shows equal or better R@5 than facts-only on the local eval before default enablement.
- Periodic checkpoint capture cannot block or fail an agent run.
- Agent diaries are searchable/readable by agent but not mixed into verified fact search by default.

## First Implementation Choice

Start with Phase 0 and Phase 1. The eval harness and drawer store are low-conflict, measurable, and do not change live behavior. They also unblock all later work without forcing a ranking decision too early.
