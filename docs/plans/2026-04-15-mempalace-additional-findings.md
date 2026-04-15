---
title: MemPalace Research — Round-2 Additional Findings
date: 2026-04-15
related: docs/plans/2026-04-15-mempalace-inspired-memory-evolution-plan.md
status: Supplement to PR #584 (after commit fdde0ab3 addressed round-1 review)
author: Claude — second-round deep research
---

# MemPalace Additional Findings — Round 2

## Intent

Round-1 review of PR #584 was addressed in commit `fdde0ab3` (plan grew 592 → 1089 lines — thank you). This is a second-round research pass specifically looking for anything we missed.

Everything below cites a concrete MemPalace source and maps to a target section in the current plan. Priority markers:

- 🔴 **Critical** — land before the owning phase starts
- 🟡 **High** — land with the owning phase
- 🟢 **Nice-to-have** — fold into adjacent PRs or accept as-is

Issue-number citations below are from the round-2 research reports; Codex should re-verify on the MemPalace tracker before merging since upstream issues sometimes get renumbered.

## Summary Table

| # | Finding | Plan target | Priority |
|---|---------|-------------|----------|
| 1 | PreCompact hook deadlock precedent | Phase 2 | 🔴 |
| 2 | Query-prefix contamination collapses retrieval | Phase 4 + `memory-search` route | 🔴 |
| 3 | Dev / held-out split + seed discipline | Phase 0 | 🔴 |
| 4 | Rank-bucket boosts (not distance-based) | Ranking Signals | 🟡 |
| 5 | Per-category reporting + five known failure modes | Phase 0 acceptance | 🟡 |
| 6 | KG entity canonicalization must ship with Phase 6 | Phase 6 | 🟡 |
| 7 | `SAVE_INTERVAL = 15` message cadence as default | Phase 2 | 🟢 |
| 8 | Shared `MEMORY_REDACT_KEYS` key-list | Security/Audit | 🟢 |
| 9 | AAAK was formally retracted upstream | Out of Scope | 🟢 |
| 10 | Embedding-rotation + vector-store-version migration playbook | Risks | 🟢 |

---

## 1. 🔴 PreCompact hook deadlock precedent

**Source:** MemPalace issue tracker — PreCompact hook hang reports. Root cause: synchronous ChromaDB writes inside a hook that Claude Code waits on before compaction.

**Plan target:** Phase 2 "Nonblocking Checkpoint Capture" (line 741)

**Gap:** Phase 2 says "Adopt as nonblocking checkpoint capture" but does not prescribe the contract that makes it nonblocking. MemPalace's bug is a live warning for exactly the hook we are adding.

### Proposed addition to Phase 2 — "Hook contract"

```
All SessionStart / Stop / PreCompact hooks MUST:

1. Return within a bounded wall-clock time (default 2s, env-tunable
   MEMORY_HOOK_TIMEOUT_MS).
2. Never await a DB write. Drawer captures enqueue onto the same BullMQ
   queue used by the backfill path; the hook returns with the job id.
3. Use an AbortSignal wired to setTimeout(abort, MEMORY_HOOK_TIMEOUT_MS).
   On abort, emit metric memory.checkpoint.hook_timeout_total and return
   a structured "deferred" result.
4. Lose the checkpoint before losing the user's session. A dropped
   checkpoint is an incident with severity "warn"; a blocked PreCompact
   is severity "page".

Acceptance test:
- Fixture stalls the drawer-queue worker for 30s.
- PreCompact hook still returns within 2.5s.
- Drawer row lands once the queue unblocks.
- memory.checkpoint.hook_timeout_total increments exactly once.
```

**New env var:** `MEMORY_HOOK_TIMEOUT_MS` (default `2000`), add to §Env Var Inventory.

---

## 2. 🔴 Query-prefix contamination collapses retrieval

**Source:** MemPalace README eval table — a misconfigured run prefixed queries with the full system prompt (~2000 tokens) and R@10 fell from 89.8% to 1.0%.

**Plan target:** Phase 4 "Drawer-Aware Search Fusion" (line 822) and `packages/agent-worker/src/api/routes/memory-search.ts`.

**Gap:** The plan's query contract is implicit. The MCP worker's memory-search route accepts whatever text the agent passes. If a caller (now or in a later refactor) hands it a rendered conversation prefix, retrieval silently collapses and the eval won't catch it because eval fixtures ship clean queries.

### Proposed addition to Phase 4 — "Query hygiene"

```
Query hygiene is part of the search contract, not a downstream caller
concern:

1. Embedding input is bare query text only. Strip leading whitespace,
   role tags (User:, Assistant:, etc.), code fences, and any content
   before the last user-turn marker.
2. Reject queries with token count > MEMORY_QUERY_MAX_TOKENS (default
   256) with HTTP 400 query_too_long. Long queries are a smell —
   usually indicates the caller sent the entire conversation.
3. Log on every search: query.token_count, query.has_prefix_smell
   (true if input contains "\n\n" role markers or "<<SYSTEM>>"-ish
   strings).
4. CI eval must include a "contamination test": prepend every fixture
   query with a 2000-token lorem-ipsum block. Assert held-out NDCG@10
   drop is < 5 points. If it drops more, retrieval is input-contaminated
   somewhere.

Implementation file: packages/agent-worker/src/api/routes/memory-search.ts
validates before calling MemorySearch. packages/control-plane/src/memory/
memory-search.ts also validates (defense in depth — neither surface
trusts the other).
```

**New env vars:** `MEMORY_QUERY_MAX_TOKENS` (default `256`).

---

## 3. 🔴 Dev / held-out split + seed discipline

**Source:** MemPalace `evals/` — a 50 dev / 450 held-out split with deterministic `seed = 42`. Ranker tuning uses dev only; held-out is locked until release tags. This is how they cite honest progression from 96.6% raw → 98.4% hybrid → 100% rerank without the numbers being training-set overfit.

**Plan target:** Phase 0 "Eval Harness First" (line 629)

**Gap:** Plan defines the fixture schema and the metrics but does not prescribe a split, a seed, or a tuning-discipline rule. Without it, the first ranker-tweak PR can (innocently) measure against the full fixture, and R@10 becomes decorative.

### Proposed addition to Phase 0 — "Eval discipline rules (non-negotiable)"

```
1. Split: 10% dev / 90% held-out. Deterministic with EVAL_SPLIT_SEED = 42
   checked into packages/control-plane/src/memory/eval/splits.ts.
2. Dev-only during tuning: any PR that changes ranker weights, feature-
   flag defaults, or boost constants runs CI against dev only. Held-out
   CI runs only on release tags and on a weekly cron.
3. Regression budget: a drop > 2 points NDCG@10 on held-out between
   releases is a release blocker. CI fails the release job.
4. Baseline progression targets (mirror MemPalace so we know we're in
   the right ballpark):
     - Raw vector only:     R@10 >= 90%
     - Hybrid (vec+BM25+boosts):  R@10 >= 95%
     - Hybrid + LLM rerank: R@10 >= 98%
   Miss on any tier is a plan-level finding (not a release blocker) —
   file an issue, don't silently retune.
5. Held-out is immutable after the first tag. To remove a bad row, set
   excluded: true and record the reason in fixtures/CHANGELOG.md. Never
   delete rows; never edit expected-answer fields after a release.

API surface:
  getDevSet(): Fixture[]         // 50 rows, stable
  getHeldOutSet(): Fixture[]     // 450 rows, immutable
  getFullSet(): Fixture[]        // 500 rows, only callable in release-eval job
```

---

## 4. 🟡 Rank-bucket boosts, not distance-based

**Source:** MemPalace `search/rank.py` — `CLOSET_RANK_BOOSTS = [0.40, 0.25, 0.15, 0.08, 0.04]`, applied by position in the result list, not multiplied into cosine distances.

**Plan target:** §Retrieval and Injection Plan → Ranking Signals (line 513)

**Gap:** The plan lists signals ("recency, strength, scope, role affinity") but does not say whether boosts apply by rank position or by score magnitude. Distance-based boosts interact badly with embedding-model swaps — cosine distribution shifts and boost weights silently re-tune themselves. Rank-based boosts are model-invariant.

### Proposed addition to "Ranking Signals"

```
Boost application is rank-based, not distance-based.

For every additive signal (closet/source match, scope hit, role affinity,
recency bucket):

  1. Run the fused base score.
  2. Take the top-K candidates that satisfy the signal's condition.
  3. Add fixed rank-position boosts:
       MEMORY_RANK_BOOSTS = [0.40, 0.25, 0.15, 0.08, 0.04]
     (tunable via env; mirrors MemPalace defaults).
  4. Re-sort.

Do NOT multiply boosts into (1 - cosine_dist). Do NOT scale boosts by raw
score. Boosts are additive, position-scoped, model-invariant.

This makes embedding-model rotation safe: swap ada-002 → text-embedding-
3-small and the boost behavior is identical.
```

---

## 5. 🟡 Per-category reporting + five known failure modes

**Source:** LongMemEval category taxonomy + MemPalace's per-category results in README and their documented failure-mode notes.

**Plan target:** Phase 0 acceptance criteria + fixture schema

**Gap:** Current plan reports aggregate metrics. Aggregate hides uneven performance across the categories that actually matter to real usage.

### Known failure-mode buckets (copy into fixture-coverage checklist)

| Failure mode | Cause | Minimum fixture coverage |
|--------------|-------|-------------------------|
| Vocabulary gap | Synonyms miss BM25 ("backup" vs "snapshot") | ≥5 pairs with differing surface forms |
| Temporal ambiguity | Relative time ("last week", "a few months ago") | ≥5 queries with relative time markers |
| Assistant-reference | "you mentioned", "as we discussed" | ≥5 queries keying on assistant turns |
| Person-name underweighting | Repeated names deflate via IDF | ≥5 queries keying on person names |
| Noisy distractor rejection | Near-duplicate facts | ≥5 queries that must reject a look-alike |

### Proposed addition to Phase 0 acceptance

```
- [ ] Eval report prints per-category R@5, R@10, NDCG@10 (six LongMemEval
      categories + an "AgentCTL-internal" category for our own memory
      shapes).
- [ ] No category drops below 85% R@10 on held-out.
- [ ] Fixture contains ≥5 rows in each of the five failure-mode buckets
      above; failure-mode coverage is asserted in a Vitest test that reads
      fixture tags.
- [ ] Per-category numbers are printed on every CI run and posted to PRs
      as a markdown table via the eval bot.
```

---

## 6. 🟡 KG canonicalization must ship with Phase 6

**Source:** MemPalace `kg/entities.py` — `upsert_entity(name)` does `name.strip().lower()` and nothing else. Users routinely report that "John", "John Smith", and "john" end up as three separate entity nodes.

**Plan target:** Phase 6 "Temporal Entity Timeline" (line 895)

**Gap:** Our `memory_facts.entity_name` has the same shape. Phase 6 wires timeline joins on entity identity — without canonicalization, every "John"/"John Smith" collision becomes a dropped edge. This is a correctness bug, not a polish issue, and shipping Phase 6 without it means rewriting the timeline queries later.

### Proposed addition to Phase 6

```
Entity canonicalization is in scope for Phase 6 (not deferred).

Schema additions (0031_add_memory_edge_temporal_fields.sql or a sibling
migration):
  - memory_facts.entity_canonical_id  uuid  NULL
  - memory_edges.subject_canonical_id uuid  NULL
  - memory_edges.object_canonical_id  uuid  NULL
  - memory_entity_aliases(canonical_id uuid, alias text, confidence numeric)

Canonicalization pass on insert:
  1. Lowercase + strip whitespace.
  2. If entity_type = 'person':
       - Split on whitespace.
       - Match first+last and last-only against memory_entity_aliases.
       - If single match, reuse canonical_id.
       - If ambiguous (multiple matches), log
         memory.canonicalization.ambiguous; leave canonical_id NULL and
         surface in the UI as "needs review".
  3. For non-person entities: exact-match on the canonicalized string;
     fall back to NULL + review.

Backfill: a dry-run script emits a CSV of proposed merges; human runs
apply after review. Never auto-merge historical rows.

Test: fixture rows {"John", "John Smith", "john smith"} all resolve to
one canonical_id after backfill; "John Doe" stays separate.

Fallback path: if Phase 6 is time-boxed and canonicalization is too
heavy, defer to a separate post-Phase-6 PR, and ship Phase 6 with a
banner on the timeline UI warning that same-name entities may appear as
distinct nodes.
```

---

## 7. 🟢 `SAVE_INTERVAL = 15` message cadence

**Source:** MemPalace `hooks/session.py` — `SAVE_INTERVAL_MESSAGES = 15`.

**Plan target:** Phase 2

**Gap:** Plan says "periodic" without a number. MemPalace tuned this by hand over a few release cycles — below 15 churns, above 15 loses too much on crash.

### Proposed addition

```
Default cadence: capture a drawer checkpoint every
MEMORY_CHECKPOINT_MESSAGE_INTERVAL = 15 user messages (tunable via env).
Forced capture on Stop and PreCompact remains (still nonblocking per §1).
```

Add env var to §Env Var Inventory.

---

## 8. 🟢 Shared `MEMORY_REDACT_KEYS` key-list

**Source:** MemPalace `wal.py` — `_WAL_REDACT_KEYS = {"api_key", "password", "token", "authorization", "secret", "openai_api_key"}` applied before every WAL write.

**Plan target:** §Security, Audit, and Retention (line 387) + Phase 1 sanitizer

**Gap:** Plan's raw-transcript sanitizer is strong, but the audit-log path (kind `memory_write`) is separate and can leak keys in `context` objects. One shared key-list used by both surfaces closes the gap.

### Proposed addition

```
Add packages/shared/src/memory/redaction.ts:

  export const MEMORY_REDACT_KEYS: ReadonlySet<string> = new Set([
    'api_key', 'apikey', 'password', 'token', 'authorization',
    'secret', 'openai_api_key', 'anthropic_api_key',
    'aws_secret_access_key', 'bearer', 'cookie', 'x-api-key',
    'stripe_api_key', 'slack_webhook_url',
  ]);

  export function redactKeys<T extends object>(obj: T, keys = MEMORY_REDACT_KEYS): T;

Both the Phase 1 raw-transcript sanitizer and Phase 2 AuditLogger import
from this module. Any new audit surface added later is required to run
values through redactKeys() before write. Enforced by a Vitest suite
that greps for AuditLogger call sites and asserts redactKeys is on the
path.
```

---

## 9. 🟢 AAAK was formally retracted upstream

**Source:** MemPalace PR that removed AAAK after an eval regression (round-2 research flagged this; re-verify the PR number before merging).

**Plan target:** Out of Scope (line 1056)

**Gap:** Our line already says "Do not adopt now. Revisit only after raw recall and token budgets are measured." Citing the upstream retraction strengthens this from a judgment call into a confirmed-upstream decision.

### Proposed edit to Out of Scope table

```
| Adopting AAAK or custom compression dialect | Lossy; upstream MemPalace
  removed the AAAK code path after eval regressions. Revisit only if a
  future eval shows raw-storage token budget is the binding constraint. |
```

---

## 10. 🟢 Schema-migration lessons: embedding rotation and vector-store versioning

**Source:** MemPalace issues on ChromaDB point-release breakage and on quality regression after swapping embedding models without re-indexing.

**Plan target:** Risks and Guardrails (line 1041)

**Gap:** Plan's "Embedding Version Contract" section (line 473) already captures the column `content_model`. The Risks section does not surface the migration playbook — or the supporting argument for the PostgreSQL-native decision.

### Proposed additions to Risks and Guardrails

```
| Silent quality regression during embedding-model rotation. |
  memory_facts.content_model already tracks origin. Rotation playbook:
    1. Write new rows under the new content_model value.
    2. Build a second HNSW index filtered to new model.
    3. Dual-query during transition (union + dedup by fact id).
    4. Delete old rows only after held-out eval matches or beats prior
       baseline (per §3 discipline).
  Never mix models in the same HNSW index. |

| Vector-store point-release breakage (MemPalace precedent with
  ChromaDB). | Supports §Design Principles "stay on PostgreSQL" decision.
  Cite in §Current AgentCTL Baseline as an additional "why PG" for the
  rationale audit trail. |
```

---

## What we looked at and explicitly did NOT recommend adopting

Round-2 research touched these; none are worth the weight:

1. **MemPalace's `~/.mempalace/identity.txt`** — single-file hand-curated user identity. Our Claude Code auto-memory (`MEMORY.md` under `~/.claude/projects/...`) already plays this role. Design takeaway only: identity is hand-curated, never auto-extracted. Our Surface A direction is right.

2. **Palace / Wing / Room / Hall / Drawer hierarchy** — reads well in the README but the levels carry no retrieval signal beyond our existing `scope` column. Adopting the vocabulary without the schema is cargo-culting.

3. **ChromaDB-specific boost surfaces ("closet", "room-adjacent")** — translated onto our schema they collapse into `scope + source_type + topic`. No new columns needed beyond Phase 1.

4. **MemPalace's entity contradiction detection** — it does not have one. Don't assume MemPalace's KG solves the "fact A contradicts fact B" problem; it doesn't. Ours won't either in Phase 6; that's fine, but don't market it as solved.

---

## Open question for Codex — how to land these

- Items 1–3 (🔴) block Phase 0 / Phase 2 / Phase 4 landing honestly. They should land before the owning phase starts.
- Items 4–6 (🟡) should land with the owning phase.
- Items 7–10 (🟢) can fold into adjacent PRs or stay as forward-looking notes.

Two defensible paths:

- **(A) Amend the plan now.** Fold items 1–3 into PR #584 as plan edits, re-request review, then start Phase 0. Keeps the plan a complete source of truth.
- **(B) Keep plan as-is, track these as phase entry criteria.** Add items 1–3 to Phase-0 / Phase-2 / Phase-4 acceptance checklists. Items 4–10 become implementation-PR concerns. Keeps PR #584 small.

Either is fine. (A) is my preference because the eval discipline rule in §3 changes how we read every subsequent number, and hiding that in a phase-entry checklist reduces its visibility. But Codex owns the plan — pick whichever is easier to execute.

---

## Sources re-checked in round 2 (for the audit trail)

- MemPalace README (eval tables, architecture diagram, failure-mode notes)
- `search/rank.py`, `search/retrieval.py` (boost constants, hybrid fusion)
- `hooks/session.py`, `hooks/precompact.py` (save cadence + deadlock precedent)
- `kg/entities.py`, `kg/triples.py` (canonicalization gap)
- `wal.py` (`_WAL_REDACT_KEYS`)
- `evals/` (split, seed, per-category metrics)
- Issue tracker hot spots: PreCompact deadlock, Chroma breakage, embedding-mismatch quality regression, AAAK removal PR

Numbers for specific issues/PRs were captured in the round-2 research output; Codex should re-verify on `github.com/MemPalace/mempalace` before citing in the merged plan.
