# Claude-Mem → Unified Memory Layer Migration Plan

**Date:** 2026-03-11
**Status:** Draft
**Priority:** P1 (blocks unified memory layer completion)
**Depends on:** Unified Memory Layer core (Chunks 1-2 done, Chunk 3 in progress)

## 1. Problem Statement

AgentCTL currently operates three disconnected memory systems:

| System | Storage | Access | Scope |
|--------|---------|--------|-------|
| **claude-mem** | SQLite (`~/.claude-mem/claude-mem.db`) | Read-only API + MCP plugin | Per-machine, rich structured observations |
| **Mem0** | External HTTP service | Read/write API | Centralized vector search |
| **MEMORY.md** | Flat markdown in git | Claude Code auto-load | Per-project, 200-line cap |

This fragmentation causes:
- **Data silos**: Facts in claude-mem are invisible to hybrid search
- **No cross-machine access**: claude-mem is local SQLite, unreachable from other machines
- **Duplicate maintenance**: Two separate query paths, two APIs, two UI panels
- **Stale imports**: Current import script targets Mem0 (to be deprecated), not PostgreSQL

The user currently relies on claude-mem as their primary knowledge base. **Zero data loss** is a hard requirement.

## 2. Current Claude-Mem Data Model

### 2.1 Actual SQLite Schema

The claude-mem database has a richer schema than the import script currently handles:

```sql
-- observations table (primary knowledge store)
CREATE TABLE observations (
  id                  INTEGER PRIMARY KEY,
  type                TEXT,           -- 'decision' | 'bugfix' | 'feature' | 'refactor' | 'discovery' | 'change'
  title               TEXT,           -- Short summary (primary display text)
  subtitle            TEXT,           -- Optional secondary description
  facts               TEXT,           -- JSON array of individual facts
  narrative           TEXT,           -- Longer narrative description
  files_modified      TEXT,           -- JSON array of file paths
  project             TEXT,           -- Project scope identifier
  created_at          TEXT,           -- ISO timestamp
  created_at_epoch    INTEGER,        -- Unix timestamp (for sorting)
  memory_session_id   TEXT,           -- Internal session link
  -- possibly more columns depending on claude-mem version
);

-- session_summaries table
CREATE TABLE session_summaries (
  id                  INTEGER,
  session_id          TEXT,
  summary             TEXT,
  created_at          TEXT
);

-- sdk_sessions table (optional, version-dependent)
CREATE TABLE sdk_sessions (
  memory_session_id   TEXT,
  content_session_id  TEXT            -- Maps to Claude Code session ID
);
```

### 2.2 Current Integration Points

| Component | File | Function |
|-----------|------|----------|
| Import script | `scripts/import-claude-mem.ts` | SQLite → Mem0 (only reads 7 of 12+ fields) |
| CP API routes | `packages/control-plane/src/api/routes/claude-mem.ts` | 3 read-only endpoints: search, get, timeline |
| Web UI | `packages/web/src/components/context-picker/MemoryPanel.tsx` | Renders observations with type colors |
| Web API client | `packages/web/src/lib/api.ts` | `searchMemory`, `getMemoryObservation`, `getMemoryTimeline` |
| Shared types | `packages/shared/src/types/memory.ts` | `MemoryObservation` (7 fields — incomplete) |
| MCP plugin | `claude-mem` MCP server | `search`, `get_observations`, `timeline` tools |

### 2.3 Data Volume Estimate

Typical claude-mem database for an active user:
- **Observations**: 500-5,000 records (50-500 per month)
- **Session summaries**: 200-2,000 records
- **Average observation size**: ~500 bytes (title + facts + narrative)
- **Total data**: 1-5 MB (small, migration is fast)

## 3. Target Architecture

After migration, all memory flows through PostgreSQL:

```
                    ┌─────────────────────────────────┐
                    │         Unified Memory API       │
                    │     /api/memory/* (REST)          │
                    │                                   │
                    │  Hybrid Search (vec+BM25+graph)  │
                    │  ┌───────────────────────────┐   │
                    │  │      memory_facts          │   │
                    │  │  ┌──────────────────────┐  │   │
                    │  │  │ source: claude-mem   │◄─┼───┼── Imported observations
                    │  │  │ source: mem0-import  │◄─┼───┼── Imported Mem0 data
                    │  │  │ source: llm-extract  │◄─┼───┼── Real-time extraction
                    │  │  │ source: manual       │◄─┼───┼── Agent MCP tools
                    │  │  └──────────────────────┘  │   │
                    │  └───────────────────────────┘   │
                    └─────────────────────────────────┘
                           ▲              ▲
                    Web UI (unified)    MCP Server (unified)
                    /api/memory/*      memory_search / memory_store
```

**Key principle**: claude-mem data becomes first-class `MemoryFact` rows, fully searchable via hybrid search, with complete provenance tracking back to the original observation IDs.

## 4. Data Mapping

### 4.1 Observation → MemoryFact Field Mapping

| claude-mem field | MemoryFact field | Transformation |
|------------------|------------------|----------------|
| `id` | `source_json.source_id` | Preserved as provenance |
| `type` | `entity_type` | Mapped via §4.2 |
| `title` | `content` (primary) | Used as main searchable text |
| `subtitle` | `content` (appended) | `"{title}\n{subtitle}"` if present |
| `facts` | Split into child facts | Each JSON array element → separate `MemoryFact` with `summarizes` edge to parent |
| `narrative` | `content` (enriched) | Appended if title alone is insufficient |
| `files_modified` | `source_json.files_modified` | Preserved as structured metadata |
| `project` | `scope` | `"project:{project}"` or `"global"` if null |
| `created_at` | `valid_from`, `created_at` | Preserve original timestamp |
| `created_at_epoch` | (derived) | Used for ordering during import |
| `memory_session_id` | `source_json.session_id` | Cross-referenced via `sdk_sessions` if available |

### 4.2 Type → EntityType Mapping

| claude-mem `type` | `EntityType` | Rationale |
|-------------------|--------------|-----------|
| `decision` | `decision` | Direct 1:1 |
| `bugfix` | `error` | Bug fixes document error patterns |
| `feature` | `code_artifact` | Feature implementations produce artifacts |
| `refactor` | `pattern` | Refactoring documents patterns/conventions |
| `discovery` | `concept` | Discoveries are conceptual insights |
| `change` | `code_artifact` | Generic code changes |
| (unknown/null) | `concept` | Safe fallback |

### 4.3 Content Assembly Strategy

Each observation produces **one parent fact** with an optional set of **child facts**:

```
Parent fact:
  content = "{title}"
  content += "\n{subtitle}" if subtitle exists
  content += "\n\nContext: {narrative}" if narrative is long and adds information

Child facts (from `facts` JSON array):
  For each fact string in the array:
    content = fact_string
    entity_type = same as parent
    edge: child --[summarizes]--> parent
```

**Why split facts?** Each individual fact from the JSON array is atomic and independently searchable. The parent provides context grouping. This matches the Knowledge Engineering principle of atomicity from §6 of the design doc.

### 4.4 Confidence Assignment

Imported claude-mem observations receive **high confidence** because they were already curated:

| Condition | Confidence |
|-----------|------------|
| Has `narrative` + `facts` array | 0.95 (well-documented) |
| Has `facts` array only | 0.90 (structured) |
| Title-only observation | 0.80 (minimal context) |
| Empty/sparse observation | 0.60 (low quality) |

All imported facts start with `strength: 1.0` (fresh).

### 4.5 Session Summary → MemoryFact

| Field | Mapping |
|-------|---------|
| `summary` | `content` |
| `entity_type` | `concept` |
| `scope` | `global` (summaries are cross-cutting) |
| `confidence` | 0.85 |
| `source_json.source_table` | `'session_summaries'` |

## 5. Migration Phases

### Phase 0: Pre-Migration Audit (Day 0)

**Goal**: Validate source data quality and estimate work.

Tasks:
- [ ] Run schema discovery against actual `~/.claude-mem/claude-mem.db`
- [ ] Count rows per table, identify null/empty fields
- [ ] List all unique `type` values (verify mapping completeness)
- [ ] List all unique `project` values (verify scope mapping)
- [ ] Check `sdk_sessions` table existence and content
- [ ] Snapshot the SQLite DB (backup copy)
- [ ] Output audit report: row counts, field coverage, quality issues

**Deliverable**: `scripts/audit-claude-mem.ts` — Run once, prints summary.

### Phase 1: Import Script Rewrite (Days 1-3)

**Goal**: New `scripts/import-claude-mem-to-pg.ts` that writes directly to PostgreSQL.

Key changes from existing `import-claude-mem.ts`:
1. **Target**: PostgreSQL via `MemoryStore.addFact()` instead of Mem0 HTTP
2. **Full schema**: Read all 12+ fields, not just 7
3. **Fact splitting**: Parse `facts` JSON array → individual child facts + edges
4. **Dedup**: Check embedding cosine similarity > 0.92 before inserting
5. **Idempotent**: Track imported source IDs in `source_json`, skip on re-run
6. **Dry-run mode**: `--dry-run` flag to preview without writing
7. **Resume support**: Record last imported ID, allow restart from checkpoint

```typescript
// Usage:
pnpm tsx scripts/import-claude-mem-to-pg.ts ~/.claude-mem/claude-mem.db \
  --database-url postgresql://... \
  --dry-run           # Preview only
  --skip-dedup        # Fast mode (trust no duplicates)
  --batch-size 50     # Embedding API batch size
  --project agentctl  # Override project scope
```

**Implementation outline**:

```typescript
type ImportStats = {
  total_observations: number;
  imported_facts: number;     // Parent facts
  imported_children: number;  // Child facts from facts[] arrays
  imported_edges: number;     // summarizes edges
  imported_summaries: number;
  skipped_empty: number;
  skipped_dedup: number;
  failed: number;
  elapsed_ms: number;
};

async function importObservation(
  obs: FullObservation,
  store: MemoryStore,
  options: ImportOptions,
): Promise<void> {
  // 1. Assemble parent content
  const content = assembleContent(obs);

  // 2. Dedup check (unless --skip-dedup)
  if (!options.skipDedup) {
    const existing = await store.findSimilar(content, 0.92);
    if (existing) { stats.skipped_dedup++; return; }
  }

  // 3. Map type → EntityType
  const entityType = mapObsType(obs.type);

  // 4. Determine scope
  const scope = obs.project ? `project:${obs.project}` : 'global';

  // 5. Build source provenance
  const source: FactSource = {
    session_id: resolveSessionId(obs.memory_session_id),
    agent_id: null,
    machine_id: options.machineId ?? null,
    turn_index: null,
    extraction_method: 'import',
  };

  // 6. Insert parent fact
  const parent = await store.addFact({
    scope, content, entity_type: entityType,
    source, confidence: computeConfidence(obs),
  });

  // 7. Split facts[] into children
  if (obs.facts) {
    const factArray = JSON.parse(obs.facts) as string[];
    for (const factText of factArray) {
      if (!factText.trim()) continue;
      const child = await store.addFact({
        scope, content: factText, entity_type: entityType,
        source, confidence: computeConfidence(obs) - 0.05,
      });
      await store.addEdge({
        source_fact_id: child.id,
        target_fact_id: parent.id,
        relation: 'summarizes',
        weight: 0.8,
      });
    }
  }
}
```

**Test plan**:
- Unit tests: type mapping, content assembly, confidence calculation, dedup logic
- Integration test: Import 10 sample observations → verify PostgreSQL rows + edges
- Idempotency test: Run import twice → no duplicates
- Resume test: Import 5, interrupt, resume from checkpoint → complete without gaps

### Phase 2: Dual-Read API Layer (Days 4-6)

**Goal**: Unified `/api/memory/*` routes serve both PostgreSQL facts and legacy claude-mem data.

Strategy: **Adapter pattern** — wrap claude-mem queries in the unified memory search interface.

```
GET /api/memory/search?q=...&scope=...&source=claude-mem
  → Hybrid search on memory_facts WHERE source_json->>'source' = 'claude-mem'

GET /api/memory/search?q=...  (no source filter)
  → Hybrid search across ALL facts (imported + native)
```

Tasks:
- [ ] Add `source` filter parameter to `/api/memory/search`
- [ ] Add `imported_from` field to search results for UI provenance display
- [ ] Keep `/api/claude-mem/*` routes as **read-only fallback** (unchanged)
- [ ] Web UI: Update `MemoryPanel` to optionally use unified API
- [ ] Feature flag: `MEMORY_SOURCE=unified|legacy|both` (default: `both`)

### Phase 3: Web UI Migration (Days 7-9)

**Goal**: `MemoryPanel` and context picker use unified memory API exclusively.

Changes to `packages/web/`:

| Component | Current | After |
|-----------|---------|-------|
| `MemoryPanel.tsx` | Renders `MemoryObservation[]` from `/api/claude-mem/search` | Renders `MemoryFact[]` from `/api/memory/search` |
| `api.ts` | `searchMemory()` → `/api/claude-mem/search` | `searchMemoryFacts()` → `/api/memory/search` |
| `api.ts` | `getMemoryTimeline()` → `/api/claude-mem/timeline` | `searchMemoryFacts({session_id})` → `/api/memory/search` |
| Type colors | Keyed by `obs.type` (decision, bugfix, etc.) | Keyed by `fact.entity_type` (decision, error, etc.) |

**Type color mapping update**:

```typescript
// Before (claude-mem types)
const TYPE_COLORS = {
  decision: 'text-amber-600 ...',
  bugfix: 'text-red-600 ...',
  feature: 'text-green-600 ...',
  ...
};

// After (EntityType)
const ENTITY_TYPE_COLORS = {
  decision: 'text-amber-600 ...',
  error: 'text-red-600 ...',         // was: bugfix
  code_artifact: 'text-green-600 ...', // was: feature + change
  pattern: 'text-blue-600 ...',       // was: refactor
  concept: 'text-purple-600 ...',     // was: discovery
  person: 'text-cyan-600 ...',
  preference: 'text-orange-600 ...',
};
```

### Phase 4: MCP Plugin Transition (Days 10-12)

**Goal**: Replace claude-mem MCP tools with unified memory MCP tools.

Current claude-mem MCP tools:
- `search` → `/api/claude-mem/search`
- `get_observations` → `/api/claude-mem/observations/:id`
- `timeline` → `/api/claude-mem/timeline`

New unified MCP tools (from design doc):
- `memory_search` → `/api/memory/search` (replaces `search`)
- `memory_store` → `/api/memory/facts` (new: write capability)
- `memory_recall` → `/api/memory/recall` (replaces `get_observations` + graph traversal)
- `memory_report` → `/api/memory/report` (replaces `timeline`, richer output)
- `memory_promote` → `/api/memory/promote` (new: scope escalation)
- `memory_feedback` → `/api/memory/feedback` (new: relevance signals)

Tasks:
- [ ] Implement MCP server at `packages/agent-worker/src/runtime/memory-mcp-server.ts`
- [ ] Register as MCP server in agent worker configuration
- [ ] Update `.claude/settings.json` to swap claude-mem → unified memory MCP
- [ ] Deprecation period: Both MCP servers active for 2 weeks
- [ ] Remove claude-mem MCP registration after validation

### Phase 5: Cutover & Cleanup (Days 13-15)

**Goal**: Remove all legacy code paths.

Tasks:
- [ ] Remove `/api/claude-mem/*` routes from control plane
- [ ] Remove `MemoryObservation` type from shared (replaced by `MemoryFact`)
- [ ] Remove `mem0-client.ts` (Mem0 dependency fully eliminated)
- [ ] Remove old `scripts/import-claude-mem.ts` (replaced by PG version)
- [ ] Update `packages/control-plane/src/index.ts` — remove Mem0 client initialization
- [ ] Remove `MEM0_URL` environment variable
- [ ] Update CLAUDE.md and docs to reflect unified memory
- [ ] Archive claude-mem SQLite as `~/.claude-mem/claude-mem.db.archived`

## 6. Deduplication Strategy

### 6.1 During Import

```
For each observation to import:
  1. Generate embedding for assembled content
  2. Query: SELECT id, content FROM memory_facts
            WHERE embedding <=> $vec < 0.08  -- cosine distance < 0.08 = similarity > 0.92
            AND source_json->>'source' != 'claude-mem'  -- only check against non-imported facts
            LIMIT 1
  3. If match found:
     - Skip import
     - Log: "Dedup: obs #{id} similar to fact #{existing_id}"
  4. If no match:
     - Insert as new fact
```

### 6.2 Post-Import Cleanup

After all imports, run a one-time dedup pass:

```
For each pair of imported facts with cosine similarity > 0.95:
  - Keep the one with higher confidence
  - Set the other's valid_until = now()
  - Add supersedes edge
```

## 7. Rollback Strategy

### 7.1 Data Rollback

All imported facts have `source_json->>'source' = 'claude-mem'`. Full rollback:

```sql
-- Nuclear rollback: delete all imported data
DELETE FROM memory_edges
WHERE source_fact_id IN (
  SELECT id FROM memory_facts WHERE source_json->>'source' = 'claude-mem'
) OR target_fact_id IN (
  SELECT id FROM memory_facts WHERE source_json->>'source' = 'claude-mem'
);

DELETE FROM memory_facts WHERE source_json->>'source' = 'claude-mem';
```

### 7.2 API Rollback

Feature flag `MEMORY_SOURCE`:
- `unified` — Only PostgreSQL (post-migration)
- `legacy` — Only claude-mem routes (rollback)
- `both` — Both active, UI shows unified with fallback (transition)

### 7.3 SQLite Preservation

The original `~/.claude-mem/claude-mem.db` is **never modified** (opened read-only). Even after migration:
- Archived copy at `~/.claude-mem/claude-mem.db.archived`
- Can be re-imported at any time with idempotent script

## 8. Validation & Quality Checks

### 8.1 Pre-Import Validation

```typescript
function validateObservation(obs: FullObservation): ValidationResult {
  const issues: string[] = [];

  if (!obs.title?.trim()) issues.push('empty title');
  if (obs.facts) {
    try { JSON.parse(obs.facts); }
    catch { issues.push('malformed facts JSON'); }
  }
  if (obs.files_modified) {
    try { JSON.parse(obs.files_modified); }
    catch { issues.push('malformed files_modified JSON'); }
  }
  if (!OBS_TYPE_MAP[obs.type]) issues.push(`unknown type: ${obs.type}`);

  return { valid: issues.length === 0, issues };
}
```

### 8.2 Post-Import Verification

```typescript
async function verifyImport(db: SQLiteDB, pool: PgPool): Promise<VerifyResult> {
  // 1. Row count match
  const sqliteCount = db.prepare('SELECT COUNT(*) as n FROM observations').get().n;
  const pgCount = await pool.query(
    "SELECT COUNT(*) FROM memory_facts WHERE source_json->>'source' = 'claude-mem' AND source_json->>'source_table' = 'observations'"
  );

  // 2. Spot-check: random sample of 20 observations
  const sample = db.prepare('SELECT * FROM observations ORDER BY RANDOM() LIMIT 20').all();
  for (const obs of sample) {
    const fact = await pool.query(
      "SELECT * FROM memory_facts WHERE source_json->>'source_id' = $1",
      [String(obs.id)]
    );
    assert(fact.rows.length > 0, `Missing fact for observation #${obs.id}`);
    assert(fact.rows[0].content.includes(obs.title), `Content mismatch for #${obs.id}`);
  }

  // 3. Search quality: top 5 claude-mem searches should return similar results
  const testQueries = ['database migration', 'CI failure', 'TypeScript error', 'session management', 'memory injection'];
  for (const q of testQueries) {
    const legacyResults = claudeMemSearch(db, q);
    const unifiedResults = await memorySearch(pool, q, { source: 'claude-mem' });
    // Verify >= 80% overlap in top-5 results
  }

  return { counts_match, sample_verified, search_quality };
}
```

## 9. Observability

### 9.1 Import Metrics

```
claude_mem_import.total              — Total observations processed
claude_mem_import.imported           — Successfully imported
claude_mem_import.children           — Child facts created from facts[] arrays
claude_mem_import.edges              — Edges created
claude_mem_import.skipped_empty      — Skipped (empty content)
claude_mem_import.skipped_dedup      — Skipped (duplicate detected)
claude_mem_import.failed             — Failed (embedding/DB error)
claude_mem_import.elapsed_ms         — Total import duration
claude_mem_import.embedding_latency  — Per-fact embedding generation time
```

### 9.2 Runtime Metrics (Post-Migration)

```
memory.search.source_distribution    — Counter per source (claude-mem, llm, manual)
memory.search.claude_mem_hit_rate    — % of searches that return claude-mem facts
memory.inject.claude_mem_facts       — Imported facts that appear in injections
```

## 10. Impact on Existing Features

### 10.1 Context Picker / Fork

The context picker's `MemoryPanel` currently fetches observations via `/api/claude-mem/search`. After migration:
- Same UI, different data source
- Richer results (hybrid search vs LIKE query)
- Cross-source results (claude-mem + native facts in one list)

### 10.2 Memory Injection (Agent Prompts)

Currently: `MemoryInjector` queries Mem0 only. Imported claude-mem facts are invisible.

After: `MemoryInjector` queries PostgreSQL hybrid search. All imported observations participate in prompt injection with proper ranking.

### 10.3 Session Timeline

Currently: `/api/claude-mem/timeline` joins observations with `sdk_sessions`.

After: `memory_search` with session_id filter achieves the same, plus includes real-time extracted facts from the same session.

## 11. Cost & Performance

### 11.1 One-Time Import Cost

| Operation | Estimate |
|-----------|----------|
| Embedding generation (5,000 obs × 500 tokens avg) | 2.5M tokens → $0.25 |
| Dedup search (5,000 vector queries) | ~30 seconds |
| PostgreSQL inserts (5,000 + children) | ~10 seconds |
| **Total import time** | **~5 minutes** |
| **Total import cost** | **~$0.25** |

### 11.2 Ongoing Cost Delta

Zero — imported facts are stored in the existing PostgreSQL instance. They participate in existing search, decay, and consolidation crons at no additional infrastructure cost.

## 12. Checklist Summary

### Pre-Migration
- [ ] Audit script (`scripts/audit-claude-mem.ts`)
- [ ] SQLite backup copy
- [ ] Verify unified memory layer Chunks 1-2 deployed

### Migration
- [ ] Import script rewrite (`scripts/import-claude-mem-to-pg.ts`)
- [ ] Unit + integration tests for import
- [ ] Dry-run on real data
- [ ] Full import execution
- [ ] Post-import verification

### API Transition
- [ ] Add `source` filter to `/api/memory/search`
- [ ] Feature flag `MEMORY_SOURCE`
- [ ] Dual-read period (2 weeks)

### UI Migration
- [ ] Update `MemoryPanel` to use unified API
- [ ] Update type color mapping (obs type → entity type)
- [ ] Update `api.ts` client methods

### MCP Transition
- [ ] Implement unified memory MCP server
- [ ] Register in agent worker config
- [ ] Deprecation period (both MCP servers active)
- [ ] Remove claude-mem MCP registration

### Cleanup
- [ ] Remove `/api/claude-mem/*` routes
- [ ] Remove `MemoryObservation` type
- [ ] Remove `mem0-client.ts`
- [ ] Remove old import script
- [ ] Archive SQLite DB
- [ ] Update documentation

## 13. Timeline

| Week | Phase | Deliverables |
|------|-------|--------------|
| Week 1 | Phase 0 + 1 | Audit + import script + tests |
| Week 2 | Phase 2 + 3 | API dual-read + Web UI migration |
| Week 3 | Phase 4 | MCP plugin transition |
| Week 4 | Phase 5 | Cutover + cleanup |

**Total**: 4 weeks from start. Can begin immediately — no blocking dependencies (Chunks 1-2 of unified memory already on main).

## 14. References

- [Unified Memory Layer Design](./2026-03-10-unified-memory-layer-design.md) — Full architecture spec
- [Unified Memory Layer Impl Plan](./2026-03-10-unified-memory-layer-impl-plan.md) — Implementation chunks
- [ROADMAP.md §3.6](../ROADMAP.md) — Memory layer priority and checklist
- [LESSONS_LEARNED.md](../LESSONS_LEARNED.md) — claude-mem AGPL license restriction, JSONL streaming requirement
