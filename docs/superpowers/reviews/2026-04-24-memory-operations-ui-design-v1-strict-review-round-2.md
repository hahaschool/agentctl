# Memory Operations UI v1 Spec — Strict Review, Round 2

> **Target:** `docs/superpowers/specs/2026-04-24-memory-operations-ui-design-v1.md` @ commit `3a790475`, branch `agent/claude-1/docs/memory-ops-ui-spec`, 742 lines.
> **Cross-references:** Reviewer 1 (`2026-04-24-memory-operations-ui-spec-plan-strict-review.md`, 45 items), Reviewer 2 (`2026-04-24-memory-operations-ui-review.md`, 10 sections), prior round-1 review (`2026-04-24-memory-operations-ui-design-v1-strict-review.md`, 251 lines).
> **Codebase anchor set:** verified against working tree at `/Users/hahaschool/agentctl/.trees/memory-ops-spec` on 2026-04-24.
> **Mode:** adversarial. Everything in one pass, no hedging, no sequels.

## Verdict

**Do not hand this spec to the plan writer. It has moved from "falsified by the codebase" (v0) to "superficially sourced but still self-contradicting". The v1 rewrite absorbs the headline corrections (`api_accounts` is local-only; partial unique index; batch UPDATE; `content_model` lock; audit injection; egress confirmation; SSE event table; cost accounting tied to `embedBatchWithUsage`) and that improvement is real — but the spec introduces a crop of fresh P0 bugs (the PR 0 filter references a column that doesn't exist until PR A; the advisory lock snippet doesn't compile; the Playwright path is wrong; a whole Memory view is dropped from alert coverage) and ships undefined surfaces in at least a dozen places (actor identity, scope normalization, session-scope for egress confirm, log-event redaction, worker crash recovery, cross-peer SSE ordering, MemoryOpsAuditLogger signature).** Ship it to a coding agent as-is and you get a plan that writes speculative glue and calls it "per spec".

Every issue is raised exactly once, graded P0 / P1 / P2, with a concrete fix or a concrete question. All "good" deltas from v0 are acknowledged in §A before the teardown so the writer can see what to keep.

---

## §A — What v1 Got Right (keep these)

1. **PR 0 precursor recognised.** Putting the runtime-filter + `EmbeddingClient` additive work ahead of the migration is the only correct ordering, even though the spec then botches the ordering internally (see P0 #1).
2. **`api_accounts` as local-only is accepted** (spec §3 non-goals, §5.4 opaque credential_id). This is the single biggest v0 correction and the architecture now matches `packages/shared/src/types/sync.ts:182` (verified: line 182 says `api_accounts: 'local-only', // encrypted credentials must not auto-replicate`).
3. **Partial unique index** (`api_accounts_one_active_embedding`) replaces API-layer race on single-active — fixes Reviewer 2 §2.2.
4. **`credential_last4` column** eliminates the per-GET decrypt hot path — fixes Reviewer 2 §2.10.
5. **Batch UPDATE via `jsonb_to_recordset`** replaces per-fact N+1 — fixes Reviewer 2 §2.9. The `::vector` cast mirrors `memory-store.ts:231` and `:606`.
6. **`content_model` lock** stops the HNSW index pollution scenario — fixes Reviewer 2 §2.4. Column name matches reality (verified: `memory_facts.content_model` at `drizzle/0010_add_memory_layer.sql:24`, Drizzle mapping `contentModel: text('content_model')` at `schema.ts:360`).
7. **`EmbeddingClient` changes are additive** via optional `apiKey` / `extraBody` / `embeddingsPath` / new `embedBatchWithUsage` method — fixes Reviewer 1 #10 and Reviewer 2 §1.2-A/§2.1.
8. **Typed `context.status === 401`** replaces the `err.message.includes('401')` string sniff — fixes Reviewer 1 #18 and Reviewer 2 §2.6.
9. **Audit logger is injected, not optional.** The interface reuse idea matches `MemoryWriteAuditLogger` (verified: `memory-drawer-store.ts:28` — `writeMemoryWrite(input: MemoryWriteAuditInput): Promise<void>`).
10. **Egress confirmation as a product requirement** — fixes Reviewer 1 #7.
11. **PR F/G acknowledged as post-critical-path** and PR D explicitly depends on PR B — fixes Reviewer 1 #19/#30.
12. **Mesh behaviour documented, not claimed.** §5.4 admits `credential_id` is opaque on peers and the UI renders "(provider: not visible on this machine)" — fixes Reviewer 2 §1.1 without changing the mesh security model.
13. **SSE `Last-Event-Id` replay now has a backing table** (`memory_ops_job_events`) — fixes Reviewer 1 #13. (Incorrect *across* peers, see P0 #6, but single-peer replay is now tractable.)
14. **`ConfirmDialog` precedent is usable** for `EgressConfirmationDialog` (verified at `packages/web/src/components/ui/confirm-dialog.tsx`).

These are real improvements. The rest of this document is the cost.

---

## §B — P0 Blockers (fix before ANY plan is written)

### P0-1 — PR 0 references a column that does not exist until PR A. The spec is self-contradicting.

- Spec §16 rollout table: "**PR 0 (precursor)** | `credential_kind` runtime filter in accounts/sessions/task-worker/oauth".
- Spec §5.1: "**Migration 0033a (PR A):** additive only. `ALTER TABLE api_accounts ADD COLUMN credential_kind text NOT NULL DEFAULT 'runtime'`".
- Codebase verification: there is no `credential_kind` column today. The column is introduced in PR A. PR 0, by the spec's own ordering, ships first.
- Consequence: PR 0's Drizzle schema addition and route `WHERE credentialKind = 'runtime'` predicate will not compile (Drizzle throws at boot) and the SQL predicate will fail at query time.
- Reviewer 1 #2 raised exactly this ordering hazard against v0. v1 thinks it fixed it by inventing "PR 0", but the migration stayed in PR A.

**Fix:** Move migration `0033a` (the `credential_kind` + `credential_last4` ADD COLUMNs + partial unique index) into PR 0, or split PR 0 into PR 0-schema and PR 0-filters. Update §16 and Appendix A accordingly. **PR 0's "additive only" claim requires the migration to land in the same PR as the filter code.**

### P0-2 — The Appendix A file list contradicts the §5 migration structure. There is no single source of truth for what migrations PR A creates.

- Spec §5.1 "Migration 0033a". §5.2 "Migration 0033b". §5.3 "Migration 0033c". (Three migrations; five explicit references at lines 104 / 133 / 186 / 614 / 683.)
- Spec Appendix A, PR A: `A: packages/control-plane/drizzle/0033_add_memory_ops.sql` (one file).
- Which is it? Drizzle journal entries are one-per-file. If 0033a/b/c are separate files, `_journal.json` needs three entries, not one.
- **Fix:** Decide. If you are shipping one file with three statement groups, rename the in-text labels and stop calling them "0033a/0033b/0033c". If you are shipping three files, update Appendix A. Each interpretation has different Drizzle-kit journal semantics — this is not a naming nit.

### P0-3 — The advisory lock SQL in §6.2 will not execute.

- Spec §6.2: `hashtext('memory-ops:' || kind || ':' || scope_normalized)` passed to "a PostgreSQL advisory lock".
- `pg_advisory_xact_lock` / `pg_advisory_lock` take `bigint`. `hashtext(text)` returns `int4`. Postgres will raise `function pg_advisory_xact_lock(integer) does not exist` (the integer overload was removed in PG 16+) OR silently pick a different overload with implicit cast rules that mask same-hash collisions for long-running operations.
- Codebase precedent disagrees with the spec: `packages/control-plane/src/sync/apply-change.ts:180` explicitly casts — `SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`.
- **Fix:** `hashtext(...)::bigint`, identical to the existing precedent. Cite `apply-change.ts:180` in the spec so the plan can't regress.

### P0-4 — `scope_normalized` in §6.2 is undefined; mixes with §18 semantics that require it.

- §6.2 says the lock key is `hashtext('memory-ops:' || kind || ':' || scope_normalized)` and that this "gives cross-peer protection even across separate BullMQ workers".
- §6.2 also promises `409 JOB_ALREADY_RUNNING if a job of the same (kind, normalized scope) is active`.
- But the spec defines *neither* `scope_normalized` nor `MemoryOpsJobParams` — the normalization rule is referenced four times and never specified.
- Consequence: a client sending `scope=""`, another sending `scope=null`, and a third sending `scope=undefined` hit three different locks. The user-visible "only one backfill at a time" guarantee silently fails for common input shapes.
- **Fix:** In §5.2 or §6.2, write the normalization function inline: `scope_normalized := lower(coalesce(trim(scope), ''))`. Same function must be used by the lock-key compute, the 409 detection SELECT, and `MemoryOpsJobParams`'s Zod schema.

### P0-5 — `<MissingEmbeddingAlert />` coverage misses `ConsolidationBoardView`.

- Spec §13.4 enumerates 7 mount points and 2 exempt views (9 total). The actual Memory-view count is **10**: `ConsolidationBoardView.tsx` also exists (`packages/web/src/views/ConsolidationBoardView.tsx`, plus its `.test.tsx`). It backs the `/memory/consolidation` route (verified: `MemorySidebar.tsx:18` `href: '/memory/consolidation'`).
- Reviewer 1 #9 / Reviewer 2 §1.2-E explicitly flagged this against v0. v1 fixed several of those paths (and even mentions the "Consolidation" sidebar entry implicitly by listing KnowledgeGraphView), but `ConsolidationBoardView` is still absent from both the mount list and the exempt list.
- Consequence: a user with no provider opens `/memory/consolidation`, sees an empty consolidation board, and no alert guides them to Settings. This is exactly the problem this spec was commissioned to solve.
- **Fix:** Add `ConsolidationBoardView.tsx` to §13.4 (mount). Update Appendix A PR F file list. Also sanity-check the full ls: `ls packages/web/src/views/ | grep -E '^(Memory|Knowledge|Consolidation)'` — you have 10, not 7.

### P0-6 — Cross-peer SSE `Last-Event-Id` replay is unsound because `event_id` is a per-peer `bigserial`.

- Spec §5.3: `event_id bigserial PRIMARY KEY`, `sync_id uuid NOT NULL DEFAULT gen_random_uuid()`, `TABLE_PK_COLUMN: 'sync_id'`, append-only mesh-synced.
- Spec §6.2: `Last-Event-Id` "resumes from the persisted sequence".
- But `bigserial` sequences are **per-database**. On peer A, event #7 for a job lands at `event_id=7`. When that row mesh-syncs to peer B, B's `event_id` for that row depends on B's local sequence — likely a different integer. Client `Last-Event-Id: 7` addressed to peer B selects unrelated rows.
- Acceptance criterion in §18: "SSE reconnect with `Last-Event-Id: <N>` replays events starting at N+1 from `memory_ops_job_events`". True only if reconnection is same-peer. The spec doesn't say that.
- **Fix pick-one:**
  1. State explicitly that SSE is *same-peer* (client must reconnect to the same CP instance, or the queue is machine-local). Then `memory_ops_job_events` need not be mesh-synced — drop the sync trigger, remove `sync_id`, keep `bigserial`. Much simpler and matches the actual operational model (one CP per machine).
  2. Keep mesh sync but replace `Last-Event-Id` with `(created_at_sort_key, sync_id)` ordering. SSE id becomes a string like `${created_at_ms}-${sync_id}`, and the query is `WHERE job_id = X AND (created_at, sync_id) > (:ts, :sync_id)`. Significantly more work; don't pay for it unless cross-peer replay is a real requirement.
  - Current wording picks neither.

### P0-7 — `test-ephemeral` endpoint is referenced by §13.1 but is absent from the §6.1 contract.

- Spec §13.1: "Add/Edit dialog: **Test-before-save** supported — dialog posts to `/api/memory/providers/test-ephemeral` (new endpoint, in PR B)".
- Spec §6.1 route inventory: only `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id`, `POST /:id/test`. No `/test-ephemeral`.
- Consequence: the API contract is incomplete. PR B implementer cannot tell whether `/test-ephemeral` takes the `EmbeddingProviderInput` schema, returns the same envelope as `/:id/test`, what its rate-limit bucket is, or which status codes it emits.
- **Fix:** Add `POST /api/memory/providers/test-ephemeral` to §6.1 with full payload, response, status-code coverage, rate-limit bucket (per-IP makes sense; there is no `:id`), and auth/encryption-key gating. Note that `/test-ephemeral` means a fresh plaintext `apiKey` arrives in the request body and is never persisted — spec must explicitly say so (a write-only "fire once" endpoint).

### P0-8 — Error code `DUPLICATE_ACTIVE_EMBEDDING` appears in acceptance (§18) but is missing from the §14 error-code table.

- §18: "With two concurrent `POST /providers {active:true}` requests, at most one succeeds; the other returns 409 `DUPLICATE_ACTIVE_EMBEDDING`."
- §14 table: no such code. Closest match is `JOB_ALREADY_RUNNING` (unrelated) or `PROVIDER_HAS_ACTIVE_JOBS` (different semantics).
- The partial unique index will raise Postgres SQLSTATE `23505` (unique_violation). The Fastify route must translate that to a stable error envelope. The spec doesn't say to, and `VALIDATION_ERROR` isn't right because the input was valid.
- **Fix:** Add a row to §14: `Unique-violation on single-active provider | 409 | DUPLICATE_ACTIVE_EMBEDDING`. Then write (in §6.1) the translation step the route must perform: `if (err.code === '23505' && err.constraint === 'api_accounts_one_active_embedding') throw new ControlPlaneError('DUPLICATE_ACTIVE_EMBEDDING', ...)`. Same thing applies to PATCH when flipping another row to active.

### P0-9 — `BASEURL_NOT_ALLOWED` in §14 is unreachable dead code.

- §14 row: `baseUrl customization attempt | 400 | BASEURL_NOT_ALLOWED`.
- §6.1: "The API does **not** accept a user-provided `baseUrl`. It is derived on the server from `EMBEDDING_MODEL_CATALOG` using the `provider` key."
- With no `baseUrl` in the schema, Zod will reject unknown properties (or strip them, depending on `.strict()` / `.passthrough()` — and the spec doesn't say). The `BASEURL_NOT_ALLOWED` branch can never fire.
- **Fix (pick one):**
  1. Drop the row from §14. Clean.
  2. If you intend `{ baseUrl: string }` to produce a specific code, state in §6.3 that Zod schemas use `.strict()` and add explicit `.refine()` to emit `BASEURL_NOT_ALLOWED` for this field. Don't leave both specified.

### P0-10 — `UNSUPPORTED_MODEL` and `VALIDATION_ERROR` overlap with no arbitration rule.

- §14: `Model not in catalog | 422 | UNSUPPORTED_MODEL`.
- §14: `Zod input invalid | 422 | VALIDATION_ERROR`.
- §6.3: the schema validates via `.superRefine((val, ctx) => { if (!catalogEntry(val)) ctx.addIssue(...); })`. `.addIssue` produces a `ZodIssue` — this is a `VALIDATION_ERROR`, not an `UNSUPPORTED_MODEL`.
- A client hitting the unsupported-model path gets `VALIDATION_ERROR` (not `UNSUPPORTED_MODEL`) because Zod is the gate.
- **Fix (pick one):**
  1. Replace `.superRefine` with a handler-layer check that throws a `ControlPlaneError('UNSUPPORTED_MODEL', ...)` *before* Zod. Then document in §6.3 that the order is `(handler-level catalog check) → (Zod) → (handler logic)`.
  2. Drop `UNSUPPORTED_MODEL` from §14 and accept that catalog-failure surfaces as `VALIDATION_ERROR` with `context.issues[0].message === 'model not in catalog'`. Update §18 and the UI copy accordingly.

### P0-11 — `queue:pause` runbook command does not exist.

- §17 Operational Runbook: `pnpm --filter control-plane queue:pause memory-ops`.
- Verified: `packages/control-plane/package.json` scripts are exactly `dev`, `build`, `start`, `test`, `test:coverage`, `db:generate`, `db:migrate`, `db:studio`. No `queue:pause`. The spec has invented a command.
- Appendix A does not list `packages/control-plane/package.json` as a modified file in any PR. So the runbook is a lie of omission.
- **Fix:** Either add a new file `packages/control-plane/scripts/queue-pause.ts` + a `queue:pause` npm script in a specific PR (almost certainly PR D, beside the queue plumbing) and list it in Appendix A, or replace §17's bullet with a real instruction that works today (e.g., `pm2 stop agentctl-cp-beta; redis-cli -n <db> keys 'bull:memory-ops:*' | xargs redis-cli -n <db> del`). Do not ship a runbook that invokes non-existent commands.

### P0-12 — Playwright spec paths in Appendix A PR G are wrong.

- Spec Appendix A PR G:
  - `A: packages/web/tests/e2e/memory-ops/openai-happy.spec.ts`
  - `A: packages/web/tests/e2e/memory-ops/gemini-happy.spec.ts`
  - `A: packages/web/tests/e2e/memory-ops/missing-embedding-alert.spec.ts`
- Verified: the real directory is `packages/web/e2e/` (flat, no `tests/` parent; 49 existing `*.spec.ts` files there). `packages/web/tests/e2e/` does not exist.
- **Fix:** Rename to `packages/web/e2e/memory-ops/*.spec.ts`. Same error pattern as Reviewer 2 §1.2-D ("Plan 连文件路径都错"); the spec had a chance to fix it and didn't.

### P0-13 — Versioning strategy in §16 contradicts the project's own dev-flow rule.

- §16: "PRs 0 and A-F bump **patch** only (no user-visible feature). PR G bumps **minor**."
- PR C introduces a new Settings section and `ProviderDialog.tsx` — user-visible UI. PR F introduces the `/memory/operations` page, sidebar entry, alerts on 7 views, and the egress dialog — user-visible UI.
- Project rule (`.claude/rules/development-flow.md`, "When to Use Which Bump"):
  - `patch` → "Bug fixes, minor adjustments"
  - `minor` → "New features, UI changes"
  - `major` → "Breaking changes, major refactors"
- Bumping patch seven times for what is explicitly feature work breaks semver and the beta changelog narrative. The user saw the first draft of this exact pattern and memory rule 9 is explicit: "VERSION BUMP before promote".
- **Fix:** PR C and PR F must be `minor`. PR 0/A/B/D/E can be `patch` if each truly changes no user-visible surface (note: PR E ships the backfill worker; if it is reachable via CLI/API it is arguably user-visible — honest choice is `minor` there too). Collapse the "consolidated minor at PR G" plan: you can keep the final PR G as `minor` if there's real new surface, or as `patch` if it's just e2e and runbook.

### P0-14 — `memory_drawers.embedding_model` is not covered by §8's content-model lock.

- §8 (content_model lock) scopes its rule to `memory_facts.embedding`: "every write to `memory_facts.embedding` **must** set `content_model = <provider.model>`".
- The `drawer-backfill` job writes to `memory_drawers`, not `memory_facts`. That table has its own `embedding_model` column (verified: `drizzle/0030_add_memory_drawers.sql:22` and `schema.ts:311` `embeddingModel: text('embedding_model')`). **Two separate columns, two separate tables.** The spec doesn't acknowledge this.
- Consequence: drawer-backfill could set embeddings without updating `memory_drawers.embedding_model`, repeating the same HNSW-pollution bug the content_model lock was supposed to eliminate, but on drawers instead of facts.
- **Fix:** Expand §8 to say "every write to `memory_facts.embedding` sets `content_model`; every write to `memory_drawers.embedding` sets `embedding_model`". The Ops "Model distribution" pill must sum over both columns (or show two pills). Update §9.2 batch-UPDATE snippet to show the drawer equivalent.

### P0-15 — Cost tracking is only defined for `embedding-backfill`. Three of four job kinds are uncovered.

- §7.4: "`embedding-backfill` handler accumulates per batch: `costUsd += usage.promptTokens / 1e6 * catalogEntry.priceUsdPerMtoken`".
- `consolidation` (wraps `KnowledgeMaintenance.run` — verified: `knowledge-maintenance.ts:190`) performs synthesis passes that can invoke embedding queries. `synthesis` (wraps `KnowledgeSynthesis.runSynthesis` — verified: `knowledge-synthesis.ts:78`) is also embedding-adjacent. `drawer-backfill` also writes embeddings into `memory_drawers`.
- Yet `progress.costUsd` is declared a single shared field on `MemoryOpsProgress` in §5.2, and §18 Acceptance implies cost accumulates on all runs.
- Either these other three handlers feed into `progress.costUsd` (not specified anywhere) or `costUsd` is non-zero only for `embedding-backfill` and user-visible totals will lie for the other three.
- **Fix:** Decide and document. If only embedding-backfill tracks cost, rename the Progress field or explicitly mark it "embedding-backfill only". If the other handlers should accumulate cost, specify how they propagate `usage.promptTokens` from the inner embedding calls — this means plumbing `embedBatchWithUsage` return values through `KnowledgeMaintenance` / `KnowledgeSynthesis`, which is a non-trivial change NOT listed in any PR's file set.

### P0-16 — `useQuery` is not imported in `queries.ts`; the spec gives no migration path.

- Spec §13.5: "New hooks in `packages/web/src/lib/queries.ts` under the existing `queryKeys.memory.*` namespace pattern."
- Verified: `packages/web/src/lib/queries.ts:2` — `import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';` (no `useQuery`). Every existing hook in the file returns `queryOptions(...)` (lines 190, 204, 213, 222, 231, 268, 278, 287), intended for `useQuery(providersQuery())` at the call site.
- The spec uses Reviewer-1-style naming `useMemoryProvidersQuery` and `useMemoryProvidersQuery` in §13.1 and §13.3 ("when `useMemoryProvidersQuery` returns an empty list") — implying a hook returning query state, not query options.
- This repeats Reviewer 1 P0 #9 exactly: v0 assumed `useQuery` was re-exported; v1 adopts the same fiction.
- **Fix:** Either (a) change §13.1/13.3 to the codebase's `queryOptions(...)` pattern — `const { data } = useQuery(memoryProvidersQuery())` — and drop the hook names, or (b) say explicitly "PR C adds `useQuery` to the `queries.ts` import list" and list `packages/web/src/lib/queries.ts` for that modification in Appendix A PR C (it is listed but the import addition is invisible).

### P0-17 — The "worker is in-process with CP for v1" decision has no crash-recovery story.

- §4 architecture: "memory-ops BullMQ Worker (**in-process with CP for v1**)".
- A 19k-fact backfill runs ~2.5s × 192 batches ≈ 8 minutes at best. During those 8 minutes, any `pnpm dev` restart, `pm2 restart`, or OS kill loses the BullMQ job. The DB row stays at `status='running'` forever.
- Spec §17's operator workaround is a direct SQL UPDATE: `UPDATE memory_ops_jobs SET status='failed', error='manual_intervention' WHERE status='running'`. That's a data-level lie — the job may not actually be failed; it is unrecoverable.
- Spec §18 Acceptance makes no restart-survival claim, but the user will hit this the first time CP restarts mid-job.
- **Fix:** Specify a boot-time reconciliation step in §4 or §8: on CP startup, `UPDATE memory_ops_jobs SET status='failed', error='CP_RESTART_DURING_RUN' WHERE status='running'` — or, better, re-enqueue the BullMQ job keyed by `id` so the worker resumes from the next un-embedded batch. Either is real work. Do not punt it to §17 runbook.

### P0-18 — `MemoryOpsAuditLogger` interface is named but not defined. §11 is a promise without a contract.

- §11: "v1 extends or mirrors this into a `MemoryOpsAuditLogger` (same injection idiom) emitting entries for: provider create/update/delete/rotate-key/test; job create/cancel/complete/fail. Every entry includes `{ actor, action, target, tag: 'memory-ops', timestamp, hashChain }`."
- The existing interface is `MemoryWriteAuditLogger { writeMemoryWrite(input: MemoryWriteAuditInput): Promise<void> }` — scoped to memory-fact writes. Provider-CRUD audit entries are not memory-writes.
- Questions the spec doesn't answer:
  1. Is this a new interface with a different method (`writeProviderAudit` / `writeJobAudit`)? Or does it reuse `writeMemoryWrite`?
  2. `MemoryWriteAuditInput` has a specific shape (sessionId, agentId, machineId — verified at `memory-drawer-store.ts:269`). What's the provider/job equivalent shape?
  3. What produces `actor`? There is no auth layer in the Fastify route plugins; `req.ip` is available but that's not an identity.
  4. What produces `hashChain`? No existing surface in `MemoryWriteAuditLogger` exposes it.
- Appendix A PR D lists `packages/control-plane/src/memory/ops/audit-logger.ts` as a new file. PR A lists only "MemoryOpsAuditLogger interface" with no location.
- **Fix:** Define the interface in PR A (shared types file + control-plane adapter), specify `actor` source (e.g. `X-AgentCTL-Actor` header fallback to `local:${hostname}`), specify `hashChain` semantics (a pointer to the existing chain logic or a new chain scoped to this logger), and place the interface file explicitly in Appendix A.

---

## §C — P1: Major design or implementation problems (fix before or during plan writing)

### P1-19 — `created_by text` is on the schema with no writer. Every row will be NULL.

- §5.2: `memory_ops_jobs.created_by text`. `TABLE_SYNC_CONFIG` syncs the full row, so peers receive NULL.
- Spec never defines where `created_by` comes from. Same "no auth identity" problem as the audit logger.
- **Fix:** Either drop the column from §5.2 (audit table carries provenance; the job row doesn't need to duplicate), or specify the source header + default fallback and carry it through the POST handler.

### P1-20 — `lastTestOk` state transitions after test-before-save are unspecified.

- §13.1: dialog runs `/test-ephemeral`, Save is enabled on success. The ephemeral test result is not persisted.
- §13.3: `MissingEmbeddingAlert` renders when `lastTestOk === null`.
- Timeline: user tests successfully in dialog → saves → row is created. If POST `/providers` doesn't carry over the ephemeral result, `metadata.last_test_ok` is NULL → `lastTestOk === null` → alert fires IMMEDIATELY on the freshly-saved provider, even though the user tested 3 seconds ago.
- **Fix:** The POST payload for `/providers` should optionally carry a `recentTestResult: { ok: boolean, model: string, costUsd: number }` (returned from `/test-ephemeral` with a signed/short-lived token so it cannot be forged). Saving merges it into `metadata.last_test_ok` / `last_test_model` / `last_test_cost_usd`. Or: after POST success, the client immediately re-POSTs `/:id/test` to populate metadata. Either works; one must be chosen.

### P1-21 — Log events are mesh-synced; no redaction is defined for `error` / `message` / `progress`.

- §5.3 syncs `memory_ops_job_events` to peers. The rows carry `message text` (worker logs), `progress jsonb` snapshots, and implicitly `error` via the `failed` event type.
- §12 says "existing `redactMemoryWriteMetadata` + sanitizer paths… already redact known secret patterns before any write". That's for memory *facts* and *drawer content*. Job event messages go through no such pipe.
- Reviewer 2 §3.7 raised this. v1 does not address it.
- Consequence: A provider returns a verbose 400 body that echoes part of the request. The error is stored in `memory_ops_job_events.message`, synced to peers, and visible to all machines.
- **Fix:** PR D must include an event-write-path redactor. Either reuse `redactMemoryWriteMetadata` (if its rules are generic enough) or add a new `redactJobEventFields({ message, progress, error })`. Add a unit test that a seeded `sk-...` string in an error body is redacted before insert. List the module in Appendix A PR D.

### P1-22 — §17 runbook SQL violates the terminal-transition invariant the spec promises in §18.

- §18: "Cancelling a running job mid-batch… writes `status='cancelled'`, and does **NOT** transition to `completed` even if the handler returns naturally."
- §17: "How to force-fail all running jobs: `UPDATE memory_ops_jobs SET status='failed', error='manual_intervention' WHERE status='running'`."
- The invariant in §18 has to be enforced in SQL via something like `UPDATE … WHERE status IN ('queued','running')` in the complete/fail/cancel repos. The runbook SQL bypasses that and immediately sets status='failed', but the worker may still be running and will try to `complete` when its batch ends. Whichever write lands last wins — the runbook SQL can be silently overwritten to `completed`.
- **Fix:** Either make the runbook SQL use a CTE that also acknowledges the worker (write to `memory_ops_job_events` with `event_type='cancelled'` and have the worker check before `complete`), or document that the runbook SQL must be preceded by killing/pausing the worker process. The current runbook is a footgun.

### P1-23 — Versioning `credential_last4` on PATCH is underspecified; `updated_at` ditto.

- §5.1: "`credential_last4` is populated on INSERT/PATCH from the plaintext before encryption".
- But PATCH may or may not change the API key. If PATCH only flips `active` or updates `name`, there's no plaintext to hash. Do we keep the old `last4`, or NULL it out? Spec doesn't say.
- Relatedly, `last_test_ok` handling on rotate-key (§18 acceptance: "Rotating a provider's key resets `lastTestOk=null` and clears `lastTestError`") is specified, but the same is not specified for `updatedAt`. Reviewer 1 #39 flagged this against v0.
- **Fix:** In §6.1 PATCH, enumerate the update rule per field: `apiKey provided → re-encrypt + recompute last4 + reset last_test_ok=null + set updated_at=now()`; `apiKey not provided → leave credential/iv/last4, other fields update + updated_at=now()`. Make §6.1 a reference, not a gesture.

### P1-24 — Provider `GET /` returns an unordered list; §6.1 doesn't specify sort.

- §6.1 shows the read-shape but not the ordering. Existing `accountRoutes` orders by priority (verified: `accounts.ts:89` — `orderBy(apiAccounts.priority)`).
- UIs that rely on stable ordering will flicker as rows are inserted; tests that assert list shape will fail nondeterministically.
- **Fix:** "GET / returns `providers` sorted by `(active DESC, priority ASC, created_at ASC)`" — or whatever matches the product intent. State it once.

### P1-25 — PATCH conflict 409 in §6.1 is ambiguous ("name/key conflicts with running job").

- "409 if name/key conflicts with running job" — what does "name conflicts" mean here? Names aren't DB-unique. "Key conflicts" — key rotation while a job is running?
- The spec conflates two protections: (a) don't change credential content while a job uses it (§6.1 DELETE does this; PATCH should too when `apiKey` is being rotated), and (b) don't deactivate/delete a provider if running jobs reference it.
- **Fix:** Rewrite as: "PATCH returns 409 `PROVIDER_HAS_ACTIVE_JOBS` with `blockingJobIds` when (a) the incoming patch includes a new `apiKey`, or (b) flips `active=false`, AND any job of status `queued|running` has `credential_id = :id`."

### P1-26 — Rate-limit `429` has no project-internal code; §14 table only catches the *upstream* provider 429.

- §6.1: "Write endpoints: 30/min per IP (matches existing `accountRoutes`). `/:id/test`: 5/min per `(ip, credentialId)` tuple."
- §14: only `PROVIDER_RATE_LIMITED` exists (upstream).
- What does a client that hits OUR rate limit get? Fastify's rate-limit plugin defaults to `429 Too Many Requests` with its own body. Without a §14 entry, the frontend can't reliably discriminate "we rate-limited you" from "OpenAI rate-limited us".
- **Fix:** Add `Our rate limit exceeded | 429 | RATE_LIMITED` to §14. Map the Fastify plugin's response body via `setErrorHandler` to the project envelope.

### P1-27 — `memory_ops_job_events.job_id` foreign-key with `ON DELETE CASCADE` across mesh-applied rows is a replay-order trap.

- §5.3: `job_id uuid NOT NULL REFERENCES memory_ops_jobs(id) ON DELETE CASCADE`.
- Both tables mesh-sync. Mesh apply does not guarantee parent-before-child ordering across replays. A child-event row can arrive at a peer before its parent job row; the INSERT fails FK check; the mesh apply rejects the row; the event is lost on that peer.
- Existing mesh tables avoid cross-table FKs exactly for this reason (verified: e.g. `agent_actions` syncs without FKs to the actions' target session table).
- **Fix:** Drop `REFERENCES memory_ops_jobs(id) ON DELETE CASCADE`. Keep `job_id uuid NOT NULL` with an application-level cleanup when a job is deleted. Alternatively, make `memory_ops_job_events` local-only (see P0-6 pick-1) and keep the FK — either solution is internally consistent. The current definition is not.

### P1-28 — pg-mem is incompatible with pgvector; §15's test strategy is unimplementable as written.

- §15: "Integration tests against real Postgres (via `pg-mem` or a Docker-backed test instance)…"
- `pg-mem` is a pure-JS Postgres reimplementation that does NOT implement `pgvector`. Any `::vector` cast fails; any `embedding vector(1536)` column fails to create.
- The single concrete integration-test claim in §15 — "Batch UPDATE writes all facts in one round trip and correctly updates `content_model`" — requires pgvector.
- **Fix:** Commit to Docker Postgres with pgvector for integration tests (Drizzle already ships `vector1536`-backed tests in the repo; check `packages/control-plane/src/memory/*.test.ts` for the existing pattern). Drop pg-mem. Update Appendix A PR E's e2e test note.

### P1-29 — Worker boot location conflicts with §18 concurrency claims under multiple CP processes.

- §4 architecture places the worker in-process with CP. Spec §3 Non-Goals forbids "multiple simultaneously active providers" but doesn't forbid multiple CP processes on the same machine (dev-1 and dev-2 tiers coexist — verified memory rule 9 lists dev-1 at 8180 and dev-2 would be separate).
- Two CP processes on the same Redis DB both subscribe to the `memory-ops` queue, each with BullMQ `concurrency=1`. Total concurrency = 2 per machine. Combine with mesh: many CP processes across the fleet.
- The advisory lock (§6.2) blocks *enqueue-time* duplication. It does not block two workers that already claimed jobs with different IDs from running concurrently.
- **Fix:** Either (a) state explicitly that the BullMQ queue uses Redis DB namespacing per-tier (dev-1 uses DB 1, dev-2 uses DB 2, beta uses DB 0 — matches existing memory rule about Redis), so at most one CP per tier competes; or (b) move the advisory lock from enqueue-time to claim-time (wrap the worker's processor in `pg_try_advisory_xact_lock` and requeue on fail). §17 Operational Runbook must document which.

### P1-30 — `MemoryOpsJobParams` discriminated union is referenced in §6.3 but never written.

- §6.3: "`MemoryOpsJobParams` (discriminated union per kind, Zod-validated)".
- Four kinds (`embedding-backfill`, `drawer-backfill`, `consolidation`, `synthesis`) — what's the `scope` shape, the `dryRun` boolean, the `batchSize`, the `rateLimitOverride`? Spec gives zero.
- Without this, PR D cannot implement routes, PR E cannot implement handlers, and PR F/G cannot render the JobCard's "Run" dialog.
- **Fix:** Define all four variants in §5 or §7. At minimum: `embedding-backfill { scope?, batchSize?, dryRun? }`; `drawer-backfill { sourceType?, scope?, dryRun? }`; `consolidation { scope? }`; `synthesis { scope? }`. Explicitly state whether `scope` is exact-match or prefix-match and settle it (Reviewer 2 §9.7 flagged this ambiguity in v0; v1 inherits it).

### P1-31 — Migration rollback story is missing entirely.

- Spec defines three migration bodies (0033a/b/c or one combined) but no "down" migration.
- Reviewer 2 §7.4 raised this; v1 ignores it.
- Drizzle does not auto-generate down migrations. The spec's additive framing (ADD COLUMN, ADD CONSTRAINT, CREATE INDEX, CREATE TABLE, CREATE TRIGGER) is reversible by design, but the *sequence* must be reverse-applied. If PR A ships and needs to be reverted hot, there is no script.
- **Fix:** §5.6 (new): "Migration rollback", with the reverse DDL inline. List it in Appendix A PR A as an accompanying `0033_down.sql` (project doesn't auto-run downs; this is for manual recovery) or as a shell script.

### P1-32 — PR E "19k backfill unblocked" with no UI still ships a pay-for-compute surface via CLI.

- §16 rollout: PR E is marked `Yes — **19k backfill unblocked**`, but PR F is the first UI. Between PR E merge-to-beta and PR F merge-to-beta, operators can enqueue jobs via `curl` against CP. That costs real money on OpenAI.
- No feature flag is mentioned for the queue endpoint; §14 has no `FEATURE_DISABLED` code.
- Reviewer 1 #30 raised this.
- **Fix:** Add an env-var gate `MEMORY_OPS_ENABLED` (defaulting to `false`) applied at route registration. Un-gate in PR F. Document in §6.2.

### P1-33 — Rate-limit key `(ip, credentialId)` for `/:id/test` is fine for solo users but degraded for shared-NAT scenarios.

- §6.1: `/:id/test` rate-limit bucket = `(ip, credentialId)`. In the primary-user context (independent developer behind a home NAT) this is OK. But `credentialId` is in the URL path — an attacker probing `/:id/test` with rotating `:id` values trivially bypasses the bucket per-id.
- Reviewer 2 §3.5 raised this. v1 "fixed" it by adding `credentialId` to the key — but that makes the attack easier, not harder, because the attacker controls `:id`.
- **Fix:** Switch to pure `ip`-bucket at 5/min for `/:id/test` globally (not per-id). Mention the degradation in §6.1 ("per-account rate limit deferred to auth layer").

### P1-34 — Session-scoped egress confirmation is not defined.

- §12: "Confirmation is **session-scoped (not persisted)**; subsequent runs within the same session skip it."
- What is a session? Browser tab? React Context? `sessionStorage`? `sessionId` from `/me`? Spec names "session" four times without anchor.
- Consequence: PR F implementer must guess. If they pick React state, any tab reload re-confirms. If they pick `sessionStorage`, cross-tab behaviour diverges. If they pick server-persisted + timestamped, `session-scoped` no longer means what it says.
- **Fix:** Explicit: "Egress confirmation acknowledgment is stored in `sessionStorage` under key `memory-ops-egress-ack:<credentialId>` with no expiry; cleared on browser/tab close." Or pick otherwise, but pick.

### P1-35 — `SYNCED_TABLES` extension claim is mechanically true but operationally sparse.

- §5.2/5.3: "`SYNCED_TABLES` is derived, so it picks up automatically."
- Verified: `packages/shared/src/types/sync.ts` lines 190-192 — `SYNCED_TABLES = Object.entries(TABLE_SYNC_CONFIG).filter(([, type]) => type !== 'local-only').map(([name]) => name)`. Claim true.
- But the surrounding apply-change code (`packages/control-plane/src/sync/apply-change.ts`) has table-specific branches for `agent_actions` (because it uses `sync_id`) and possibly others. Adding `memory_ops_job_events` with `TABLE_PK_COLUMN: 'sync_id'` requires the apply code to respect that mapping. §5.3 doesn't claim or test that.
- **Fix:** Appendix A PR A must list `packages/control-plane/src/sync/apply-change.ts` if any branching must be added. At minimum, add a test to PR A that `applyChange({ table: 'memory_ops_job_events' })` reads the PK column from `TABLE_PK_COLUMN`.

### P1-36 — `§4 architecture diagram` lists `Anthropic-routed` providers as Non-Goal, but the ops page's cost accounting will silently undercharge if provider pricing drifts.

- §7.2 catalog is a hard-coded `.ts` constant: `priceUsdPerMtoken: 0.02` for OpenAI, `0.15` for Gemini.
- OpenAI drops prices; Gemini prices shift around. The UI will show stale costs.
- **Fix:** Either (a) source pricing from the provider's response (OpenAI returns `usage.prompt_tokens` but not price; they don't currently return price) — not feasible; or (b) document in §7.2 that pricing is a snapshot and state the refresh cadence (e.g., "review quarterly, bump spec"); or (c) store pricing in DB per-row so historical cost stays correct even if future catalog updates. Pick (b) for v1 simplicity, note it in §19 Risks.

---

## §D — P2: Smaller but real corrections

### P2-37 — The `sync_capture` trigger on `memory_ops_jobs` fires `AFTER UPDATE`, which will ping the mesh on every `progress` jsonb change.

- §5.2 trigger: `AFTER INSERT OR UPDATE OR DELETE`. Progress updates happen per batch (~192 times for a 19k run).
- Mesh change-log volume: 192 rows per job, all syncing the full row snapshot (~1-2 KB each) to every peer. For a fleet of 4 machines, ~800 change-log rows per job.
- Existing `agent_actions` is append-only (insert-only); the mesh sync overhead is bounded. `memory_ops_jobs` is the first high-update-rate mesh-synced row the spec introduces.
- **Fix:** Either (a) trigger on `UPDATE OF status, result, finished_at` only (PostgreSQL supports column-level triggers: `AFTER UPDATE OF col1, col2`), skipping progress updates — progress is in the events table anyway; or (b) explicit Risks entry with volume estimate.

### P2-38 — `created_by` sits next to `credential_id`; naming drift.

- §5.2: `credential_id uuid` (with a comment), `created_by text`. Inconsistent nullability style: one gets a comment, the other doesn't.
- **Fix:** Style consistency. Minor.

### P2-39 — `EMBEDDING_MODEL_CATALOG` has two models with `dim=1536` and no downstream dimension assertion.

- §7.2: both catalog entries have `dim: 1536`.
- If a future entry has `dim: 768`, the `memory_facts.embedding` column (`vector(1536)` — verified via Drizzle `vector1536`) cannot store it. The spec's Non-Goals explicitly forbids schema migration, but there's no catalog-level guard that future entries match.
- **Fix:** Add a validator: the catalog entry's `dim` must equal the column's declared dimension (1536 for `memory_facts`; also check `memory_drawers.embedding` if we're writing there). Emit an error at boot or at catalog-validation time.

### P2-40 — `result jsonb` on `memory_ops_jobs` has no size cap mentioned.

- Reviewer 2 §2.3 raised this. v1 added `memory_ops_job_events` for logs but said nothing about bounding `result`.
- A synthesis or consolidation run may return a large jsonb (sample clusters, sample facts, counters). The mesh `sync_change_log` captures `to_jsonb(NEW)` — large `result` rows inflate change-log payloads.
- **Fix:** Document a soft cap (e.g., "`result` max 16 KB; overflow moves to `memory_ops_job_events` with `event_type='log'`"). Enforce in the repo writer.

### P2-41 — §19 Risks under-specifies "log-retention worker add an entry to its config".

- §19: "7-day retention via existing `log-retention` worker (add an entry to its config)."
- Verified: `packages/control-plane/src/audit/log-retention.ts` exists; uses `checkpointRetentionDays: 7`. Adding `memory_ops_job_events` to it means either (a) extending `log-retention.ts` with a new `memoryOpsEventRetentionDays` field and DELETE query, or (b) calling it from elsewhere.
- Neither is listed in Appendix A.
- **Fix:** List `packages/control-plane/src/audit/log-retention.ts` as a modified file in PR D.

### P2-42 — Drizzle `default({})` semantics.

- §5.5: `params: jsonb('params').notNull().default({})`.
- Drizzle serializes object literals to jsonb correctly at runtime, but `.default(obj)` shares the same object reference across inserts — not a bug for jsonb (Drizzle re-serializes), but noteworthy.
- **Fix:** Minor. Use `.default(sql\`'{}'::jsonb\`)` or leave as-is and add a test.

### P2-43 — `/stream` SSE endpoint is specified in §6.2 but the `LISTEN`/`NOTIFY` plumbing is implicit.

- SSE delivery requires the CP process to subscribe to a Postgres channel (for push) or poll (for pull). `pg_notify` is mentioned in §19 but never wired: which channel? How many dedicated connections? What's the reconnect behaviour for the listener?
- **Fix:** §6.2 should say "CP opens a single dedicated `pg` Client on boot, `LISTEN memory_ops_job_channel`, and fans out to connected SSE clients keyed by `job_id`. The channel payload is the `job_id` only; the SSE route reads fresh event rows from `memory_ops_job_events`."

### P2-44 — `§15 Testing` target "80% coverage per `.claude/rules/common/testing.md`" references a rule file not in the project.

- `.claude/rules/common/testing.md` is a user-global rule (per the spec framing — it's referenced in the user's memory). The project has `.claude/rules/code-style.md`, `development-flow.md`, `git-discipline.md`, `security.md`, `error-handling.md` — none mandate 80% coverage.
- **Fix:** Either state "per repo-root user rules" (acknowledge cross-boundary sourcing) or drop the specific number and say "maintain or exceed existing per-package coverage".

### P2-45 — Appendix A PR F path: "find the real file in PR F planning step".

- > `M: Memory sidebar config (find the real file in PR F planning step — `grep -n 'maintenance|synthesis' packages/web/src/components/layout/ packages/web/src/config/`)`
- Real file is `packages/web/src/components/memory/MemorySidebar.tsx` (verified, 10 `MEMORY_NAV_ITEMS` entries). The spec punts on this despite the file being one `find` away.
- Also the suggested grep directories don't match reality — `packages/web/src/components/layout/` and `packages/web/src/config/` are not the sidebar's home.
- **Fix:** Replace with: `M: packages/web/src/components/memory/MemorySidebar.tsx`. Reviewer 2 appendix A already anchored the file; v1 could have copied the path.

### P2-46 — `§8` "Model distribution" pill's "disable search until reconciled" behaviour is a sharp UI move with no rollout gate.

- §8: "If more than one `content_model` value appears, the UI shows a warning and **disables search until reconciled**."
- Disabling the primary search capability of the memory UI because two rows have different `content_model` values is a nuclear response. Users may have legitimately cross-embedded rows (import, older data). The "reconciliation" process isn't defined.
- **Fix:** Downgrade to a persistent warning banner with a "Re-embed all" CTA (linking to v2). Do not disable search.

### P2-47 — Sidebar entry addition missing from Appendix A PR F's "Add `Operations` under the Memory submenu".

- §13.2 says the sidebar gains an entry. §13.4 enumerates view mounts. Appendix A PR F lists `M: Memory sidebar config (find the real file…)`. Good.
- But PR F also needs to register the new route in any layout/container that indexes Memory views — verify there isn't a `MemoryLayout.tsx` or similar that hard-codes the tab list. The existing `packages/web/src/app/memory/layout.tsx` may be it.
- **Fix:** In PR F planning, grep `packages/web/src/app/memory/layout.tsx` and all imports of `MEMORY_NAV_ITEMS`; list every file needing a new entry.

### P2-48 — `§19 Risks` "3rd-party provider changes OpenAI-compat URL" is a risk mitigation, not a risk.

- "Catalog is the single source of truth" is a design choice, not a mitigation. The real risk is "Google/OpenAI changes the endpoint; spec catalog lags; all embedding jobs fail until a catalog PR ships".
- **Fix:** Rephrase. The mitigation should be "Add a catalog-integrity test that hits each provider's `/models` endpoint on CP boot (behind `MEMORY_OPS_CATALOG_SMOKE_TEST=1`) and alerts on mismatch."

### P2-49 — `§18` "Peer mesh" acceptance doesn't specify how a job triggered on peer A without a local provider fails on peer B.

- §18: "Creating a job on A is visible on B with `credentialId` rendered as 'provider: not visible on this machine'."
- What if a user opens Ops UI on peer B and clicks "Run now" for an `embedding-backfill`? Peer B has no provider. Per §14 they get `409 EMBEDDING_NO_PROVIDER`. But UX-wise the JobCard should be disabled on peer B in the first place.
- **Fix:** §13.2 JobCard state: "When the local peer has no active embedding provider AND the job kind is embedding-backfill, the Run button is disabled with tooltip 'configure a provider on this machine'."

### P2-50 — `§7.3 resolveEmbeddingClient` signature takes `pool: Pool` but Drizzle is in use elsewhere.

- The rest of the CP layer uses Drizzle (`db: Database`). Mixing raw `pg.Pool` vs Drizzle adds surface. Current `EmbeddingClient` uses fetch, not a pool.
- **Fix:** Pass the raw pool only if the factory performs raw SQL (to look up the credential row with explicit casting). Otherwise use Drizzle. Pick one.

### P2-51 — `§6.1` lists no 404 response for PATCH/DELETE/`/:id/test`.

- Standard behaviour, but §14 only enumerates 400/401/409/422/429/500. A request to `/api/memory/providers/<nonexistent-uuid>/test` should be 404 with a stable code.
- **Fix:** Add `Provider not found | 404 | PROVIDER_NOT_FOUND` to §14.

### P2-52 — `§18` Acceptance doesn't test the partial unique index on migration.

- §15 integration test list covers concurrency but not the "ADD COLUMN on populated table" case. The 19,226-row table already has rows; `ALTER TABLE api_accounts ADD COLUMN credential_kind text NOT NULL DEFAULT 'runtime'` will rewrite the table (briefly).
- **Fix:** One acceptance bullet: "After 0033a, every pre-existing row has `credential_kind='runtime'`; the partial unique index does not fire on runtime rows."

### P2-53 — Spec does not declare whether `/test-ephemeral` is allowed when an active provider already exists.

- Test-before-save makes sense on create. What about on edit? The dialog's behaviour when editing an existing row is unspecified: does Test go to `/:id/test` (against persisted creds) or `/test-ephemeral` (against the form's unsaved apiKey)?
- **Fix:** §13.1 should state: "In edit mode, if the apiKey field is untouched, Test calls `/:id/test`. If the apiKey was changed, Test calls `/test-ephemeral` with the new plaintext."

### P2-54 — `§11 audit log` scope drift.

- §11 says audit covers "provider create/update/delete/rotate-key/test" and "job create/cancel/complete/fail". It does not list `job progress` — consistent with not wanting progress to produce audit spam. But it does not list `provider-test-failed`, which is security-relevant (possible key-fishing).
- **Fix:** Add `provider-test-failed` (distinct from `provider-test`).

### P2-55 — `§16 rollout` table doesn't address partial-rollback between PRs.

- If PR E is bad and must be reverted, the surface it added (queue consumer) goes away but the schema and routes from PR D remain. Routes can enqueue jobs that no worker processes — the UI's `Run` becomes a soft hang.
- **Fix:** State the rollback order explicitly: "Reverting PR E without PR D is a valid operation iff the queue is drained first and the route is feature-flagged off (see P1-32)."

### P2-56 — `§18` Acceptance "With an active provider and ≥ 1 fact having `embedding IS NULL`, triggering `embedding-backfill`… ends in `status='completed'`" — excludes the common case of partial-failure completion.

- §19: "retry budget = 3 per batch, total errors do not fail the job" — so a job with 200 failed facts still completes. §18 should explicitly permit `progress.failed > 0` on completion.
- **Fix:** Soften the clause: "`status='completed'` with `progress.failed <= progress.processed * 0.01`" (or some agreed threshold) — and if the threshold is exceeded, `status='failed'`. Currently unreasoned.

### P2-57 — `§14` has no `CANCEL_IN_PROGRESS` code.

- Cancelling a job sends `POST /:id/cancel`. The worker may take time to acknowledge. During the window, a second cancel is a no-op but the UI can't distinguish. A 202-Accepted-like path would help.
- **Fix:** Add `Cancel already in progress | 202 | CANCEL_ACCEPTED` or accept the current no-op (202 is friendlier; the Ops UI already expects async state).

### P2-58 — `§13.2 <JobCard /> disabled while running` behaviour is stated (good) but multi-kind concurrency unspoken.

- §13.2: "disabled Run button while any job of that kind is running" — good. But no mention of cross-kind concurrency. May a `consolidation` run while `embedding-backfill` runs?
- §19 "memory-ops BullMQ Worker (in-process with CP for v1)" + implied `concurrency=1` (Reviewer 2 §3.8 cite) means the answer is no. But `concurrency=1` is not stated in the spec.
- **Fix:** Declare worker concurrency explicitly in §4 or §7. Declare cross-kind concurrency policy in §13.2.

---

## §E — Summary of required pre-plan edits

Before the plan writer is dispatched, the spec MUST be updated to address:

1. **Move the `credential_kind` migration into PR 0** (or rename PR 0 to PR 0-schema + PR 0-filters). Fix §16 and Appendix A.
2. **Collapse `0033a/b/c` vs `0033_add_memory_ops.sql` to one notation**. Commit to multi-file OR single-file; Drizzle journal semantics differ.
3. **Fix the advisory lock SQL** to include `::bigint` per the `apply-change.ts:180` precedent.
4. **Define `scope_normalized`** inline. Same function in lock key, duplicate-run check, and Zod schema.
5. **Mount `<MissingEmbeddingAlert />` on `ConsolidationBoardView.tsx`** or add it to the exempt list. Update Appendix A PR F.
6. **Resolve the cross-peer SSE `Last-Event-Id` ambiguity**: either state SSE is same-peer-only and drop mesh sync for `memory_ops_job_events`, or switch to sort-key-based resume.
7. **Add `POST /api/memory/providers/test-ephemeral` to §6.1** with full payload/response/error coverage.
8. **Add `DUPLICATE_ACTIVE_EMBEDDING` (or pick a different code) to §14** with the 23505 translation rule.
9. **Drop or activate `BASEURL_NOT_ALLOWED`**.
10. **Pick one of `VALIDATION_ERROR` or `UNSUPPORTED_MODEL`** and update §6.3 to match.
11. **Replace the `queue:pause` runbook line** with a real command, or add the script in a specific PR with an Appendix A entry.
12. **Correct the Playwright e2e path** to `packages/web/e2e/memory-ops/*.spec.ts`.
13. **Mark PR C and PR F as `minor` bumps** per `.claude/rules/development-flow.md`.
14. **Expand §8 to cover `memory_drawers.embedding_model`**, not just `memory_facts.content_model`.
15. **Decide cost-tracking scope** (embedding-backfill only, or all four handlers) and specify.
16. **Fix `queries.ts` import** by either switching to `queryOptions` pattern in §13.1/13.3 or adding `useQuery` to the import list in a specific PR.
17. **Specify worker crash recovery** at CP boot (reconciliation UPDATE + optional re-enqueue).
18. **Define `MemoryOpsAuditLogger`**: interface shape, `actor` source, `hashChain` semantics, file location, injection site. PR A must ship the interface.
19. **Specify `created_by` source or remove the column.**
20. **Specify `lastTestOk` lifecycle across test-ephemeral → save**.
21. **Add event-payload redactor for mesh-synced `memory_ops_job_events`**; list the module in PR D Appendix A.
22. **Harmonize §17 runbook SQL with the §18 terminal-transition invariant** (either worker-aware SQL or precondition "pause worker first").
23. **Flesh out PATCH rules on `/api/memory/providers/:id`** (which fields re-compute which metadata, when `updated_at` changes).
24. **Add `GET /` ordering** to §6.1.
25. **Clarify PATCH 409 semantics** — split "api key change while jobs running" from "deactivate while jobs running".
26. **Add `RATE_LIMITED` (our own) and `PROVIDER_NOT_FOUND` to §14.**
27. **Drop the FK from `memory_ops_job_events.job_id` if the table is mesh-synced** (or make the table local-only and keep the FK).
28. **Commit §15 integration tests to Docker Postgres**, drop pg-mem.
29. **Define worker concurrency + per-tier Redis DB namespacing** in §4.
30. **Write `MemoryOpsJobParams` discriminated union in full** per kind, including `scope` semantics.
31. **Add migration rollback (down) SQL** for 0033.
32. **Gate PR E's queue behind `MEMORY_OPS_ENABLED` feature flag**; un-gate in PR F.
33. **Refine `/:id/test` rate-limit key** (drop `credentialId` from the bucket; keep ip-only).
34. **Anchor the session-scope for egress-confirmation** (`sessionStorage` + key format).
35. **List `sync/apply-change.ts` in Appendix A PR A** if any branching is needed for the new `TABLE_PK_COLUMN: 'sync_id'` entry.
36. **Address catalog price drift** with a stated review cadence or provider-response-based pricing.
37. **Column-level trigger on `memory_ops_jobs`** (`AFTER UPDATE OF status, result, finished_at`) to avoid 192× change-log writes per job.
38. **Downgrade §8's "disable search"** to a banner + CTA.
39. **Add `provider-test-failed` audit action**.
40. **Specify PR E revert semantics** (drain queue + feature-flag off).
41. **Soften §18 acceptance** to admit partial-failure completion per the retry-budget semantics.

Stopping at 41 fixes. There are more minor ones that will surface once the plan writer tries to execute.

---

## §F — Bottom line

v1 is a material improvement over v0: the architectural foundation (`api_accounts` local-only, partial unique index, content_model lock, batch UPDATE, additive EmbeddingClient) is sound, and the two reviewers' high-signal feedback is visibly absorbed. But the spec passed self-review without catching:

- a self-contradiction in its PR-ordering that invalidates PR 0;
- a non-compiling advisory-lock SQL snippet;
- a mis-counted view list that reintroduces the exact Reviewer-1 bug;
- a runbook command that doesn't exist;
- a Playwright path that doesn't exist;
- a versioning strategy that violates the project's own `.claude/rules/development-flow.md`;
- and about a dozen places where a required behaviour is named but not defined (`scope_normalized`, `actor`, `created_by`, session scope, MemoryOpsAuditLogger shape, cross-peer SSE semantics, cost scope, content_model for drawers).

**Gate:** do not accept this spec as "locked". Revise against §E first (at least the P0s). A plan written against the current text will either drift silently or ship with the bugs baked in.

---

## Appendix A — Codebase anchors used in this review

| Claim | File:line |
|---|---|
| `api_accounts` is local-only | `packages/shared/src/types/sync.ts:182` |
| `agent_actions` sync_id PK precedent | `packages/shared/src/types/sync.ts:159-164` |
| `apiAccounts` table (+credential_iv column) | `packages/control-plane/src/db/schema.ts:443,450` |
| `memory_facts.content_model` Drizzle mapping | `packages/control-plane/src/db/schema.ts:360` |
| `memory_drawers.embedding_model` Drizzle mapping | `packages/control-plane/src/db/schema.ts:311` |
| `memory_facts` `content_model` default | `packages/control-plane/drizzle/0010_add_memory_layer.sql:24` |
| `memory_drawers` `embedding_model` default | `packages/control-plane/drizzle/0030_add_memory_drawers.sql:22` |
| `::vector` cast precedent | `packages/control-plane/src/memory/memory-store.ts:231,606` |
| Advisory lock precedent with `::bigint` | `packages/control-plane/src/sync/apply-change.ts:180` |
| `accountRoutes` registration guard (db + encryptionKey) | `packages/control-plane/src/api/server.ts:828-847` |
| `accounts.ts` GET — no credential_kind filter today | `packages/control-plane/src/api/routes/accounts.ts:89-92` |
| `sessions.ts` failover query — no credential_kind filter today | `packages/control-plane/src/api/routes/sessions.ts:1597-1601` |
| `task-worker.ts` runtime credential resolution — no credential_kind filter today | `packages/control-plane/src/scheduler/task-worker.ts:301-312` |
| `MemoryWriteAuditLogger` interface | `packages/control-plane/src/memory/memory-drawer-store.ts:28` |
| `EmbeddingClient` constructor + `/v1/embeddings` suffix | `packages/control-plane/src/memory/embedding-client.ts:40-64` |
| `embedding-client.test.ts` URL assertion | `packages/control-plane/src/memory/embedding-client.test.ts:47` |
| `KnowledgeMaintenance.run(scope?)` | `packages/control-plane/src/memory/knowledge-maintenance.ts:190` |
| `KnowledgeSynthesis.runSynthesis(scope?)` | `packages/control-plane/src/memory/knowledge-synthesis.ts:78` |
| `ConsolidationBoardView.tsx` (missing from §13.4) | `packages/web/src/views/ConsolidationBoardView.tsx` |
| `MemorySidebar.tsx` (the real "find the file") | `packages/web/src/components/memory/MemorySidebar.tsx:13-40` |
| `queryKeys.memory` namespace | `packages/web/src/lib/queries.ts:159-181` |
| `queries.ts` import list (no `useQuery`) | `packages/web/src/lib/queries.ts:2` |
| `packages/web/e2e/` (not `tests/e2e/`) | `packages/web/e2e/` |
| `api/core.ts:request<T>` | `packages/web/src/lib/api/core.ts:21` |
| `api.ts` barrel | `packages/web/src/lib/api.ts` |
| `SettingsSection` | `packages/web/src/views/settings/SettingsShell.tsx:56-82` |
| `SettingsView.tsx` nav array | `packages/web/src/views/SettingsView.tsx:26-67` |
| `log-retention.ts` | `packages/control-plane/src/audit/log-retention.ts` |
| `ConfirmDialog` precedent | `packages/web/src/components/ui/confirm-dialog.tsx` |
| `SYNCED_TABLES` derivation | `packages/shared/src/types/sync.ts:190-192` |
| `sync_capture_change()` trigger function | `packages/control-plane/drizzle/0021_mesh_change_log.sql:70-100` |
| `TABLE_PK_COLUMN['agent_actions']='sync_id'` pattern | `packages/shared/src/types/sync.ts` (confirmed) |
| `bullmq` dependency | `packages/control-plane/package.json:24` |
| `credential-crypto.ts:decryptCredential` | `packages/control-plane/src/utils/credential-crypto.ts:22-35` |
| `readRateLimitEnv` | `packages/control-plane/src/api/rate-limit.ts:31-35` |
| 0027 schema-ahead rejection migration | `packages/control-plane/drizzle/0027_sync_nodes_schema_ahead_rejection.sql` |
| Highest existing migration (0033 is free) | `packages/control-plane/drizzle/0032_add_memory_drawer_backfill_state.sql` |
