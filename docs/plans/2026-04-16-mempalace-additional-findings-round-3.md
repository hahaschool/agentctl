---
title: MemPalace Research — Round-3 Additional Findings
date: 2026-04-16
related: docs/plans/2026-04-15-mempalace-inspired-memory-evolution-plan.md
followup-to: docs/plans/2026-04-15-mempalace-additional-findings.md
status: Supplement to PR #584 (third pass)
---

# MemPalace Additional Findings — Round 3

## Intent

Rounds 1 and 2 covered the architectural and eval-discipline material. Round 3 targeted five angles that were under-examined: MCP integration shape, multi-machine implications, cold-start mechanics, scale limits, and retrieval testing patterns.

Unlike round 2, several angles came back "nothing worth stealing" — captured here for the audit trail so we don't re-research the same ground.

## Summary Table

| # | Finding | Plan target | Priority |
|---|---------|-------------|----------|
| 1 | MCP tool surface gap (29 upstream vs 6 ours) | Phase 7 or new phase | 🟡 |
| 2 | Query sanitizer middleware — proven implementation shape | Phase 4 (amends round-2 §2) | 🔴 |
| 3 | `memory-dedup-check` pre-store similarity gate | Phase 1 or 3 | 🟡 |
| 4 | `memory-traverse` hop-limited graph-walk tool | Phase 6 | 🟡 |
| 5 | Cold-start empty-state contract | Phase 0 acceptance | 🔴 |
| 6 | Planted-needle recall regression bench pattern | Phase 0 | ✅ mock bench landed; live-search wiring remains |
| 7 | `sanitize_name()` + path-traversal blocking for scope/entity fields | Security | 🟢 |
| 8 | `null arguments` hang defense (issue #394 parallel) | Phase 1 | 🟢 |
| — | Multi-machine: no MemPalace patterns port | Reassurance only | N/A |
| — | Retrieval-testing infra: our coverage dwarfs theirs | Reassurance only | N/A |
| — | Pruning/GC: we are ahead of MemPalace | Reassurance only | N/A |

---

## 1. 🟡 MCP tool surface gap (29 vs 6)

**Source:** MemPalace `mempalace/mcp_server.py` — registers 29 tools across 5 groups: palace-read (7), drawer-CRUD (5), KG (5), graph-navigation/tunnels (7), agent-diary (2), system (3).

**Plan target:** Phase 7 UI and Observability (line 938) — or a new "Phase 7.5: MCP surface expansion".

**Gap:** We expose 6 MCP worker routes. Most of MemPalace's 29 can collapse into ours, but four shapes are genuinely missing (see items 3, 4 below + diary + reconnect). Our 6 routes are correct but thin. Adopting every MemPalace tool is cargo-culting; adopting the four with clear retrieval or safety value is worth it.

### Proposed addition to Phase 7 scope

```
MCP surface expansion, informed by MemPalace's 29-tool surface:

Adopt:
  - memory-dedup-check   (see §3 below)
  - memory-traverse      (see §4 below)

Evaluate but do not adopt in first cut:
  - memory-reconnect     — a MemPalace workaround for its single-process
    cache-invalidation model. Our PG LISTEN/NOTIFY makes this unnecessary;
    revisit only if cache-staleness bug reports appear.
  - memory-diary-write / memory-diary-read — overlap with our existing
    memory-synthesis route; defer until diaries have a distinct product
    value beyond synthesis.

Reject:
  - Per-wing / per-room / per-hall CRUD endpoints (23 of MemPalace's 29).
    These are the hierarchy surface; our scope column subsumes them.
```

---

## 2. 🔴 Query sanitizer middleware — proven implementation shape

**Source:** MemPalace `tests/test_query_sanitizer.py` — 14 tests across 4 classes (passthrough, question-extraction, tail-sentence fallback, real-world prefix contamination). Specific test names: `test_mempalace_wakeup_prepended`, `test_2000_char_system_prompt_with_question`. Upstream config: `MEMORY_QUERY_MAX_CHARS = 250`.

**Plan target:** Phase 4 "Query hygiene" — this supersedes and makes concrete the round-2 §2 recommendation.

**Gap:** Round 2 said "strip prefixes, enforce length limit". Round 3 found the proven implementation shape: a **3-stage pipeline** tested against real-world contamination vectors. Without stage 2 (question extraction), legitimate long queries get rejected. Without stage 3 (tail-sentence fallback), queries with no "?" marker fall through.

### Proposed replacement for round-2 §2 "Query hygiene" block

```
Query sanitizer middleware (3-stage pipeline, mirrors MemPalace test suite):

Stage 1 — Passthrough:
  If len(query) <= MEMORY_QUERY_MAX_CHARS (default 250) AND query has no
  role markers / system-prompt smell, pass through.

Stage 2 — Question extraction:
  If query contains a trailing "?" sentence, take the minimal suffix
  ending in "?". This recovers the user's actual question from a long
  prefix.

Stage 3 — Tail-sentence fallback:
  If no "?" found, take the last sentence (split on /[.!?]\s+/) bounded
  by MEMORY_QUERY_MAX_CHARS. If still too long, hard-truncate with a
  warning log.

Emit logs at every stage: query.sanitizer_stage ∈ {'passthrough',
'question_extracted', 'tail_fallback', 'truncated'}. A ratio above 5%
falling into 'tail_fallback' or 'truncated' is a signal that a caller is
sending contaminated queries — alert.

Test fixture: mirror MemPalace's 14 contamination vectors. Minimum:
  - 2000-char system prompt prefix + single question
  - Role-tagged conversation dump
  - Code fence + question
  - Multi-question query (assert last question wins)
  - Empty / whitespace-only

Implementation file: packages/shared/src/memory/query-sanitizer.ts (shared
so both CP and worker routes use it). Both memory-search routes call
sanitizeQuery() before embedding.
```

**New env vars:**
- `MEMORY_QUERY_MAX_CHARS` (default `250`) — supersedes round-2's `MEMORY_QUERY_MAX_TOKENS`
- `MEMORY_SANITIZER_FALLBACK_WARN_RATIO` (default `0.05`)

---

## 3. 🟡 `memory-dedup-check` pre-store similarity gate

**Source:** MemPalace `mcp_server.py` — `mempalace_check_duplicate` tool, called before every store operation.

**Plan target:** Phase 1 (drawer insertion) or Phase 3 (fact insertion) — either or both.

**Gap:** Our insertion path has no pre-store gate. An agent that re-learns the same fact across sessions currently writes N rows, which inflates storage, confuses retrieval, and makes stats meaningless. MemPalace fixes this with a dedicated tool the agent is prompted to call first.

### Proposed addition

```
New MCP worker route: packages/agent-worker/src/api/routes/memory-dedup-check.ts

POST /api/mcp/memory-dedup-check
Request:  { scope, entity_type?, content_preview, embedding_precomputed? }
Response: {
  is_duplicate: boolean,
  nearest_matches: [{ fact_id, similarity, content_preview }],  // top 3
  recommendation: 'skip' | 'merge' | 'store_new',
  rationale: string
}

Logic:
  1. Compute embedding (or use precomputed).
  2. Vector-search with limit 3.
  3. If top_sim >= MEMORY_DEDUP_SKIP_THRESHOLD (default 0.92),
     recommend 'skip'.
  4. If top_sim >= MEMORY_DEDUP_MERGE_THRESHOLD (default 0.82),
     recommend 'merge'.
  5. Else 'store_new'.

The MCP prompt for memory-store is updated to call dedup-check first and
respect the recommendation — the agent can still override with a
force_store flag, but the default path gates on this.

Metric: memory.dedup.skip_total, memory.dedup.merge_total,
memory.dedup.override_total.
```

---

## 4. 🟡 `memory-traverse` hop-limited graph walk

**Source:** MemPalace `mcp_server.py` — `mempalace_traverse` / `mempalace_follow_tunnels` tools with `max_hops` parameter bounded to 1-10.

**Plan target:** Phase 6 "Temporal Entity Timeline" (line 895)

**Gap:** Our `memory_edges` table supports graph queries, but we have no MCP-exposed walk primitive. Agents currently cannot ask "what are all entities connected to John within 2 hops" — they have to do multiple recall calls and stitch manually. MemPalace's tool surface lets the agent do graph reasoning in one round-trip.

### Proposed addition

```
New MCP worker route: packages/agent-worker/src/api/routes/memory-traverse.ts

POST /mcp/memory/traverse
Request: {
  start_entity_canonical_id: uuid,
  max_hops: integer (1..MEMORY_TRAVERSE_MAX_HOPS, default 3),
  relation_types?: string[],  // filter on memory_edges.relation_type
  min_confidence?: number,
  as_of?: timestamp            // uses Phase 6 validity windows
}
Response: {
  nodes: [{ canonical_id, entity_name, hop_distance, earliest_seen }],
  edges: [{ subject_id, object_id, relation, confidence, valid_from,
            valid_until }]
}

Implementation: recursive CTE over memory_edges with WHERE on validity
window (for temporal queries). Cap result set at
MEMORY_TRAVERSE_MAX_NODES (default 100) — beyond this, return a partial
flag and a note.

Security: MEMORY_TRAVERSE_MAX_HOPS hard cap at 10 to prevent graph-walk
DoS. Log every traversal with hop_count and result_size.
```

**New env vars:** `MEMORY_TRAVERSE_MAX_HOPS` (10), `MEMORY_TRAVERSE_MAX_NODES` (100).

---

## 5. 🔴 Cold-start empty-state contract

**Source:** MemPalace `tests/test_mcp_server.py` — `test_status_cold_start_no_collection`, `test_null_arguments_does_not_hang`, `test_auto_detect_no_files`. These were added after issue #394 when the MCP server hung on `arguments: null`.

**Plan target:** Phase 0 acceptance criteria (line 629)

**Gap:** Our memory routes are well-tested for populated state but there is no explicit "empty-DB contract" test suite. When a brand-new AgentCTL instance first runs, memory-search / memory-recall should return structured empty results with HTTP 200, not 500 errors or hangs. Without explicit tests, a future refactor can regress this silently.

### Proposed addition to Phase 0

```
Phase 0 also ships an empty-DB contract test matrix:

- [x] memory-search with empty DB returns { results: [], total: 0 }, not
      an error.
- [x] memory-recall with empty DB returns { facts: [], edges: [] }.
- [x] memory-stats/report with empty DB returns { fact_count: 0,
      drawer_count: 0, ... } — all zeros, not nulls.
- [ ] memory-traverse from a nonexistent entity returns empty graph, not
      404.
- [x] Existing memory MCP routes reject { arguments: null } without hanging
      (issue-#394 parallel — mirrors MemPalace's fix).
- [x] memory-dedup-check on empty DB recommends 'store_new' with
      nearest_matches: [] (PR #681).

Current worker routes are covered in `packages/agent-worker/src/api/routes/
memory-cold-start.test.ts`; `memory-dedup-check` now has first-route coverage
in `memory-dedup-check.test.ts`, while `memory-traverse` remains planned-route
work and needs matching tests when its route file exists.

Future control-plane coverage should use an isolated test DB with zero rows
across all memory tables, shared via a helper such as `createEmptyMemoryDb()`.

This is a 🔴 priority for Phase 0 because first-run UX is load-bearing
for adoption and regressions here are invisible to populated-DB tests.
```

---

## 6. 🟡 Planted-needle recall regression bench

**Source:** MemPalace `tests/benchmarks/test_search_bench.py` — plants `NEEDLE_<id>` prefixed docs, queries each needle, measures recall. Observational (no enforced minimum), but the methodology is the adoptable part.

**Plan target:** Phase 0 — the eval harness

**Gap:** Our Phase 0 harness evaluates against an external-anchor fixture (LongMemEval-style). It does not have an internal regression bench that can be run cheaply on every PR to catch retrieval-pipeline breakage before the held-out eval runs. Planted needles fill that gap: synthetic, fast, deterministic.

### Proposed addition to Phase 0

```
Phase 0 ships two eval layers:

  Layer 1 — External anchor eval (already specified):
    LongMemEval-style fixture, held-out discipline, weekly cron.

  Layer 2 — Internal planted-needle regression (landed as mock bench):
    packages/control-plane/src/memory/memory-eval.ts
    scripts/memory-bench.ts

    1. Generate N = MEMORY_BENCH_NEEDLE_COUNT (default 100) fixture rows with
       content prefix "NEEDLE_<uuid>: <synthetic content>".
    2. Generate M = MEMORY_BENCH_NOISE_COUNT (default 2000) deterministic mock
       distractors without touching the live DB.
    3. For each needle, score the content minus the
       NEEDLE_ prefix as query.
    4. Assert recall@5 >= MEMORY_BENCH_MIN_RECALL (default 0.85).
    5. Report p50 / p95 / p99 search latency.

    Runs locally/CI without real embeddings. Unlike the external eval, this
    enforces a hard threshold — PR blocked if mock recall drops.

Unlike MemPalace's equivalent, we enforce the threshold (they just
observe). Remaining live-search wiring should reuse the same threshold shape
once drawer-aware search exists. Also bench scales: rerun at N={100, 1000,
5000} on tagged releases and publish the curve to catch sublinear-degradation
bugs.
```

**New env vars:** `MEMORY_BENCH_NEEDLE_COUNT`, `MEMORY_BENCH_NOISE_COUNT`, `MEMORY_BENCH_MIN_RECALL`.

---

## 7. 🟢 `sanitize_name()` + path-traversal blocking for scope/entity

**Source:** MemPalace `config.py` — `MAX_NAME_LENGTH = 128`, `sanitize_name()` blocks `../`, `..\`, `\x00`, control chars. Test: `test_list_rooms_rejects_invalid_wing`.

**Plan target:** Security section (line 387)

**Gap:** Our `memory_facts.entity_name`, `memory_facts.scope`, `memory_edges.subject_name` take arbitrary text. Safe against SQL injection (parameterized queries) but not length-capped or filesystem-name-safe. If we ever use these as path components for export or backup (plausible), naïve inputs become a path-traversal vector. Low probability, but the fix is a 10-line validator.

### Proposed addition to Security section

```
Name-field validator in packages/shared/src/memory/validation.ts:

  export const MEMORY_NAME_MAX_LENGTH = 128;
  export function sanitizeName(name: string): string {
    const trimmed = name.trim().slice(0, MEMORY_NAME_MAX_LENGTH);
    if (/(\.\.|\x00|[\x01-\x1f])/.test(trimmed)) {
      throw new MemoryError('INVALID_NAME', 'name contains forbidden chars');
    }
    return trimmed;
  }

Applied on insert/update paths for: memory_facts.entity_name,
memory_facts.scope, memory_edges.subject_name, memory_edges.object_name,
memory_drawers.scope.
```

---

## 8. 🟢 `null arguments` hang defense

**Source:** MemPalace issue #394 + `test_null_arguments_does_not_hang`. MCP server hung indefinitely when called with `{ arguments: null }` instead of `{ arguments: {} }`.

**Plan target:** Phase 1 (or any MCP route acceptance)

**Gap:** Worth a defensive test across our 6 MCP routes. Cheap to add, catches a real upstream bug class.

### Proposed addition

```
Acceptance test in every MCP worker route test file:

  it('rejects null arguments without hanging', async () => {
    const start = Date.now();
    const res = await fetch(url, { body: JSON.stringify({ arguments: null }) });
    expect(res.status).toBe(400);
    expect(Date.now() - start).toBeLessThan(1000);
  });
```

---

## Items explicitly NOT worth adopting (audit trail)

### Multi-machine: no MemPalace patterns port

MemPalace's cache-invalidation pattern (inode/mtime polling on ChromaDB files) only works because the process owns the file. Their `mempalace_reconnect` tool exists specifically to paper over single-process cache staleness. Their `_WAL_REDACT_KEYS` append log uses no file locking.

**None of this survives multi-machine.** Our existing `sync_capture` trigger on `memory_edges` + PG `LISTEN/NOTIFY` is the correct mesh-safe approach. This round 3 finding is reassurance, not a gap.

### Retrieval testing infrastructure

MemPalace has ~80 visible test files with standard unit tests. We have 7,255 unit tests + 143 Playwright e2e. No property-based testing, no fuzzing, no snapshot tests on their side.

**Nothing to steal in testing infrastructure.** The only adoptable piece is the planted-needle pattern (captured in §6 above). Our existing test posture is stronger than upstream's.

### Pruning / GC / compaction

MemPalace has none. Benchmarks in `tests/benchmarks/test_chromadb_stress.py` measure RSS degradation up to 10k drawers without implementing a mitigation. Issue tracker has multiple unresolved "disk keeps growing" threads.

**Our `memory-decay` and `memory-consolidation` routes are ahead of the field.** Our plan's existing retention policy (§Retention, line 434) is meaningfully better than upstream. Cite in §Current AgentCTL Baseline as supporting rationale.

---

## Landing recommendation

- Items 2 (query sanitizer shape), 5 (cold-start contract) are 🔴 — fold directly into the plan amendment at next edit pass
- Items 1, 3, 4, 6 (🟡) should ride with their owning phase
- Items 7, 8 (🟢) are one-commit additions during implementation

After three rounds, diminishing returns set in. This is a good stopping point for research unless Phase 1 implementation surfaces fresh questions.

---

## Sources re-checked in round 3

- `mempalace/mcp_server.py` (29-tool registration table, `_MAX_RESULTS=100`, query cap 250)
- `mempalace/config.py` (`MAX_NAME_LENGTH=128`, `sanitize_content` 100k cap)
- `mempalace/searcher.py` (single-process mutation assumptions)
- `tests/test_query_sanitizer.py` (14 contamination-vector tests across 4 classes)
- `tests/test_mcp_server.py` (`test_null_arguments_does_not_hang`, `test_status_cold_start_no_collection`, `TestCacheInvalidation`)
- `tests/test_onboarding.py` (cold-start wizard, 8 tests)
- `tests/benchmarks/test_search_bench.py` (planted-needle pattern; 5000-drawer ceiling)
- `tests/benchmarks/test_chromadb_stress.py` (10k pagination hard limit; no GC)
- `tests/benchmarks/test_recall_threshold.py` (observational, no assertions)
- `tests/test_readme_claims.py` (docs-claim validation pattern)
- Issue #394 (null-arguments hang fix)
