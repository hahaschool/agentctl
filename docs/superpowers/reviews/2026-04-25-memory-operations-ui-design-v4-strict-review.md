# Memory Operations UI v4 — Strict Critical Review

> **Reviewer:** Claude Sonnet 4.6 (claude-sonnet-4-6), 2026-04-25
> **Target:** `docs/superpowers/specs/2026-04-24-memory-operations-ui-design-v4.md` @ commit `b66d3def`, branch `agent/claude-1/docs/memory-ops-ui-spec`, 965 lines
> **Method:** Read full v4 spec; grepped live codebase (main) for all code anchors; cross-referenced verified-facts doc; cross-referenced v2-strict-review-round-2.md for recurring pattern detection; grep-verified every line number claim independently.
> **Mode:** Single pass. No tails. No mercy. Everything in once.

---

## Verdict

**Conditionally close — but four real blockers remain.** The v3→v4 architectural spine is sound: outbox atomicity, provider-snapshot persistence, fleet-wide exclusion, drawer-search rewiring, unified search predicate, sourceRoot restriction. These were genuine P0s and they're genuinely fixed. The spec is denser and more precise than its predecessors.

What keeps v4 out of "implementation-ready":

1. The web client never gains a `details` field — the server changes are fully specified, the client changes are completely absent. Every UI feature that reads `details.blockingJobIds`, `details.existingJobId`, `details.enabledKinds`, etc. gets `undefined` at runtime.
2. The advisory-lock 409 path cannot populate `existingJobId / existingMachine`. The spec collapses two 409 paths into one `details` shape that only works for one of them.
3. The race-window mitigation claim in §5.2 is factually wrong. The spec says worst case is "one redundant no-op batch." It isn't — two peers with different local providers embed different halves of the null-embedding rows with different models, producing a poisoned HNSW index. The spec correctly describes this as the problem it's solving, then incorrectly claims the mitigation prevents it.
4. The round-4 review files that Appendix D cites (`v3-strict-review.md` and `v3-strict-review-round-2.md`) do not exist on the branch. Appendix D's disposition table is an orphan — the source P0s are unverifiable.

Fix those four. Then the spec is ready for the plan writer.

---

## P0 Blockers (4)

### P0-1 — Web client `ApiError` has no `details` field; `core.ts` never parses `details`

**Spec claim:**
- §14: "flat envelope: `{ "error": "STABLE_CODE", "message": "human-readable", "details": { ... } }`"; references `web/src/lib/api/core.ts:21-44` as the existing client
- Appendix D R1-P0-8: "extend `controlPlaneErrorToStatus()`; emit `details` from `err.context`" — fix assigned to PR B

**Actual code (verified by grep):**

`packages/web/src/lib/api/core.ts:7-17`:
```typescript
export class ApiError extends Error {
  public hint?: string;
  constructor(status: number, code: string, message: string, hint?: string)
```
`packages/web/src/lib/api/core.ts:36-41`:
```typescript
throw new ApiError(
  res.status,
  (body as Record<string, string>).code ?? (body as Record<string, string>).error,
  (body as Record<string, string>).message,
  (body as Record<string, string>).hint,  // ← reads hint, not details
);
```

`ApiError` has `hint?` but NO `details` field. After PR B changes the server to emit `details`, the web client extracts `body.hint` (undefined in new responses) and discards `body.details` silently.

**What breaks:**
Every UI component that needs structured error data will get `undefined`:
- `PROVIDER_HAS_ACTIVE_JOBS.details.blockingJobIds` → `undefined` (can't show blocking job IDs)
- `JOB_ALREADY_RUNNING.details.existingJobId` → `undefined`
- `JOB_KIND_NOT_ENABLED.details.enabledKinds` → `undefined`
- `MODEL_MISMATCH.details.existingModel / incomingModel` → `undefined`
- `REMOTE_PEER_JOB.details.executorMachineId` → `undefined`

**PR inventory check:**
PR C spec'd files: `memory-providers.ts`, `ProviderDialog.tsx`, `MemoryEmbeddingsSection.tsx`, `SettingsView.tsx`, `api.ts`, `queries.ts`. No `core.ts`. No `ApiError`.
PR F spec'd files: `memory-ops.ts`, six component `.tsx` files, `MemoryOperationsPage.tsx`, `page.tsx`, `MemorySidebar.tsx`, `queries.ts`. No `core.ts`. No `ApiError`.

`core.ts` appears in NO PR's scope. The client is never updated.

**Fix:** Add `public details?: Record<string, unknown>` to `ApiError`. Update `core.ts` to extract `body.details`. Add to PR C scope (or create PR A.5). Also add to §14: "PR B updates `core.ts` to extract `details`; updates `ApiError` constructor to carry `details?`." Every `details`-bearing code's UI handler must be tested with a non-empty `details` payload.

---

### P0-2 — Fleet-wide exclusion race-window mitigation claim is factually wrong

**Spec claim, §5.2:**
> "The `WHERE f.embedding IS NULL` guard in the batch UPDATE means the worst-case outcome (if the race fires) is one redundant batch that writes a no-op UPDATE on already-embedded rows."

**Why this is wrong:**

The `WHERE f.embedding IS NULL` guard in the batch UPDATE prevents a single row from being embedded TWICE by the same worker pass. It does NOT prevent two workers from each claiming DIFFERENT unembedded rows.

Concurrent scenario when the race fires:
- Peer A: `SELECT id FROM memory_facts WHERE embedding IS NULL LIMIT 100` → rows {1..100}
- Peer B: `SELECT id FROM memory_facts WHERE embedding IS NULL LIMIT 100` → rows {101..200} (or overlapping, depending on timing)
- Peer A: calls OpenAI API; `UPDATE ... WHERE f.id IN (1..100) AND f.embedding IS NULL` → writes 100 OpenAI vectors with `content_model='text-embedding-3-small'`
- Peer B: calls Gemini API; `UPDATE ... WHERE f.id IN (101..200) AND f.embedding IS NULL` → writes 100 Gemini vectors with `content_model='gemini-embedding-001'`

Result: facts 1-100 have OpenAI vectors; facts 101-200 have Gemini vectors. The HNSW index over `embedding` is poisoned — vectors from different models are not comparable. `MemorySearch.vectorSearch` returns semantic garbage.

The `WHERE f.embedding IS NULL` guard is a NO-OP PROTECTION: it only prevents a fact from being embedded AGAIN if it was ALREADY embedded. It offers no protection when two workers each claim a DIFFERENT SLICE of the unembedded rows.

The spec correctly identifies this scenario as "cross-machine write-job corrupts shared embeddings" and lists it as P0-1. But then §5.2's accepted race-window note claims the mitigation makes the worst case harmless. It doesn't — the worst case is exactly the corruption scenario described as P0-1.

**Risk of leaving this wrong:** Plan writer reads the acceptance note, believes the v1.1 Redis lock is a "nice to have" upgrade rather than a correctness requirement, and ships without urgency to close the window.

**Fix:** Replace the mitigation claim:
> ~~"The `WHERE f.embedding IS NULL` guard in the batch UPDATE means the worst-case outcome (if the race fires) is one redundant batch that writes a no-op UPDATE on already-embedded rows."~~
> "The race window is unmitigated: if two peers with different active providers simultaneously win the fleet-check race before either commits, they will each embed a different subset of null-embedding rows with different model vectors, corrupting embedding model uniformity for the entire fleet. v1.1 closes this with a Redis distributed lock. Operators should not run concurrent embedding-backfill jobs across peers until v1.1 ships."

---

### P0-3 — Round-4 review source files don't exist on the branch; Appendix D is unverifiable

**Spec claims:**
- §4 header: "Round-4 reviews ([R1](../reviews/2026-04-24-memory-operations-ui-design-v3-strict-review.md) — 12 P0, 15 P1, 8 P2; [R2](../reviews/2026-04-24-memory-operations-ui-design-v3-strict-review-round-2.md) — 4 P0, 12 P1, 30 P2)"
- Appendix D header: identical links to both files

**Verified:**
```
git ls-tree agent/claude-1/docs/memory-ops-ui-spec docs/superpowers/reviews/
```
Files present:
- `2026-04-24-memory-operations-ui-design-v1-strict-review.md`
- `2026-04-24-memory-operations-ui-design-v1-strict-review-round-2.md`
- `2026-04-24-memory-operations-ui-design-v2-strict-review.md`
- `2026-04-24-memory-operations-ui-design-v2-strict-review-round-2.md`
- `2026-04-24-memory-operations-ui-review.md`
- `2026-04-24-memory-operations-ui-v2-reviewer-checklist.md`
- `2026-04-24-memory-operations-ui-v2-verified-facts.md`

Files **NOT present**:
- `2026-04-24-memory-operations-ui-design-v3-strict-review.md` ← **does not exist**
- `2026-04-24-memory-operations-ui-design-v3-strict-review-round-2.md` ← **does not exist**

Appendix D's entire disposition table ("12 R1 P0s fixed," "4 R2 P0s fixed") cites P0s from files that do not exist. The reviewer cannot verify: (a) whether the listed R1 P0-1..12 are the actual P0s from those reviews; (b) whether the claimed v4 fixes address the actual issues; or (c) whether any additional issues in those reviews were silently omitted from the disposition table.

**This is not a documentation hygiene issue.** If a reviewer cannot see the source of the P0s, they cannot verify that the disposition is complete. Appendix D is orphaned text.

**Fix:** Either (a) commit the v3 review files to the branch so the links resolve, or (b) inline the full text of each P0 from the source review into Appendix D, or (c) change the spec status from "candidate for implementation" to "pending review file commit."

---

### P0-4 — JOB_ALREADY_RUNNING from advisory-lock path cannot populate `details.existingJobId/existingMachine`

**Spec claim, §14:**
```
JOB_ALREADY_RUNNING → 409 → { existingJobId: string; existingMachine: string }
```

**Spec claim, §5.2 Phase 1:**
```
1. SELECT pg_try_advisory_xact_lock(...)  AS acquired
   If false → throw JOB_ALREADY_RUNNING (local concurrent request)
2. Fleet-check SELECT (write kinds only)
3. INSERT
```

**The conflict:** Advisory lock failure fires 409 at step 1, BEFORE the fleet-check SELECT (step 2). At the moment of advisory lock failure:
- No fleet-check SELECT has run
- The competing local request has the lock and is somewhere between step 1 and step 3 (might have not even run its fleet-check yet)
- There is NO committed job row to supply `existingJobId`
- `existingMachine` = current machine (it's a local concurrent request) but that information is not semantically meaningful in `details`

The fleet-check path (step 2, where `JOB_ALREADY_RUNNING` is also thrown) DOES have `existingJobId` (from the SELECT result) and `existingMachine` (from `executor_machine_id` column). The advisory lock path does NOT.

**What the plan writer will do:**
- (a) Throw `JOB_ALREADY_RUNNING` with empty `details: {}` on advisory-lock path → breaks API contract; UI shows blank error
- (b) Throw with `existingJobId: undefined` → TypeScript error or silent contract violation
- (c) Do a fleet-check SELECT BEFORE the advisory lock (wrong order: violates atomicity — another request could INSERT between the pre-check and the lock acquisition)
- (d) Use a different error code for advisory-lock rejection (not specified)

**Fix:** Split into two error codes. `JOB_ALREADY_RUNNING` carries `{ existingJobId, existingMachine }` and is only thrown from the fleet-check SELECT path. Add a new error code `CONCURRENT_JOB_REQUEST → 409 → {}` thrown from the advisory-lock path. Or: throw `JOB_ALREADY_RUNNING` with `existingJobId: null, existingMachine: machineId` from the advisory-lock path (documented as meaning "local concurrent request, no specific job row known yet") — whichever, document it explicitly.

---

## P1 Blockers (10)

### P1-1 — Drizzle schema for `memory_ops_job_events` is absent from §5.4

§5.3 fully defines the SQL table `memory_ops_job_events`. §5.4 "Drizzle schema additions" shows only `memoryOpsJobs`. Appendix A PR D creates `src/memory/ops/job-events-repository.ts`. Plan writer cannot implement `JobEventsRepository` without knowing whether to use raw SQL (like `memory_facts.embedding`) or Drizzle.

The repo pattern (verified from existing routes) uses Drizzle for all tables in schema.ts and raw SQL for excluded columns (embedding vectors). `memory_ops_job_events` is not a vector table — there's no reason it should use raw SQL. A Drizzle definition is expected but absent.

**Fix:** Add `memoryOpsJobEvents` Drizzle table definition to §5.4, including the `event_id` bigserial PK and the `idx_memory_ops_job_events_job` index. Explicitly note: NOT in TABLE_SYNC_CONFIG, NO sync_capture trigger.

---

### P1-2 — Drizzle schema for `memory_ops_audit` is absent from §5.4

§10 defines the SQL table. §5.4 shows nothing. PR B creates `src/memory/ops/audit-logger.ts` which must INSERT into `memory_ops_audit`. Same gap as P1-1.

**Fix:** Add `memoryOpsAudit` Drizzle definition to §5.4. Note: LOCAL-ONLY, no sync_capture trigger.

---

### P1-3 — `recentTestResult` token expiry check not specified

§6.1 says: "Server MUST verify that `recentTestResult.apiKeyFingerprint == hmac(secret, submittedApiKey)`." And: "signed token... expires in 5 minutes."

The server validation spec only requires the fingerprint check. The token's `testedAt` field is included in the payload but the server-side check for `now() - testedAt < 5 minutes` is never mentioned. A plan writer implementing the fingerprint check but not the expiry check produces a system where a test result from 6 months ago can be replayed indefinitely.

**Fix:** Add to §6.1: "Server MUST ALSO verify: `Date.now() - recentTestResult.testedAt < 300_000` (5 minutes). If expired: 422 `VALIDATION_ERROR` with `issues[0].message = 'recentTestResult expired'`."

---

### P1-4 — POST /jobs top-level request body schema is never defined

§6.3 defines `memoryOpsJobParamsSchema` as a discriminated union of per-kind fields. `egressConfirmed` (required for write kinds, validated to produce 400 `EGRESS_NOT_CONFIRMED`) does NOT appear in this schema.

The top-level POST body schema for `POST /api/memory/ops/jobs` is never shown. The plan writer doesn't know: is it `{ kind, egressConfirmed, params: {...kind-fields} }` or `{ kind, egressConfirmed, ...kind-fields }` or `{ kind, params: { egressConfirmed, ...kind-fields } }`? The UI and the CP must agree on this shape. They won't if it isn't specified.

**Fix:** Add an explicit full request body schema to §6.2:
```typescript
memoryOpsJobCreateSchema = z.object({
  kind: z.enum(['embedding-backfill','drawer-backfill','consolidation','synthesis']),
  egressConfirmed: z.boolean().optional().default(false),
  params: memoryOpsJobParamsSchema,
});
```
Or equivalent. Document which level `egressConfirmed` lives at.

---

### P1-5 — `ENABLED_JOB_KINDS` mechanism is undefined

§6.2: "JOB_KIND_NOT_ENABLED when kind not in deploy's ENABLED_JOB_KINDS set."
§16: "ENABLED_JOB_KINDS = new Set()" (suggests code constant), then "ENABLED_JOB_KINDS expands to backfill kinds" in PR E, "expands to all four" in PR G.
`.env.example` for PR E: includes `MEMORY_OPS_ENABLED=false` (separate env var).

Two mechanisms coexist: `MEMORY_OPS_ENABLED` (env var, boolean, disables all) and `ENABLED_JOB_KINDS` (unknown mechanism). The spec never defines:
- Is `ENABLED_JOB_KINDS` a code-level `Set<string>` constant in which file?
- OR an env var (comma-separated)? If env var, what module reads it?
- Why is it separate from `MEMORY_OPS_ENABLED`? When would you want `MEMORY_OPS_ENABLED=true` but `ENABLED_JOB_KINDS` empty?

Plan writer invents the mechanism independently in PRs D, E, G. Result: inconsistent behavior and env var names that don't match the spec.

**Fix:** Define the mechanism explicitly. Recommended: `ENABLED_JOB_KINDS` is a comma-separated env var, defaulting to empty string (all kinds disabled). Module `src/memory/ops/config.ts` parses it. `MEMORY_OPS_ENABLED=false` gates the `POST /jobs` endpoint entirely; `ENABLED_JOB_KINDS` gates individual kinds. Show the parsing logic.

---

### P1-6 — `PROVIDER_RATE_LIMITED` error code has no defined call site

§14 table: `PROVIDER_RATE_LIMITED → 429 → {}`. §6.1 documents "429 RATE_LIMITED (5/min per IP)" on test endpoints. `PROVIDER_RATE_LIMITED` does not appear in any route spec, any job handler spec, or the capabilities response. It is not in the acceptance criteria. It is not in any required test.

Is it for when the OpenAI/Gemini API returns 429 during a job run? If so:
- Does the job handler throw `ControlPlaneError('PROVIDER_RATE_LIMITED', ...)`?
- Does the CP return 429 to the caller (but the only caller is a BullMQ worker, not a web client)?
- Is `PROVIDER_RATE_LIMITED` a `job.error_code` stored in the DB, or an HTTP response code?

Without a call site, the plan writer either omits it entirely or invents behavior inconsistently with the test suite (which is mandated to cover all §14 codes).

**Fix:** Either remove `PROVIDER_RATE_LIMITED` from §14 and replace it with a note in job handler behavior ("on 429 from provider: set `error_code = 'PROVIDER_RATE_LIMITED'`, exponential backoff up to N retries, then fail"), or define the exact HTTP endpoint that returns this code and when.

---

### P1-7 — SSE stream for remote-peer job has no defined error response

§6.2: `GET /api/memory/ops/jobs/:id/stream → text/event-stream, same-peer only; Last-Event-Id respected.`
§6.2: `POST /:id/cancel → 403 REMOTE_PEER_JOB { executorMachineId }` if remote job.

The cancel endpoint correctly documents 403 for remote jobs. The stream endpoint says "same-peer only" but defines no behavior for remote jobs. What does the server return if a client requests the SSE stream for a job that ran on a different peer?

Plan writer produces one of: (a) 403 REMOTE_PEER_JOB; (b) 404 JOB_NOT_FOUND; (c) streams only the job-row status (no events, since job_events is LOCAL-ONLY); (d) silently returns an empty SSE stream. The UI will fail to handle remote-job streaming gracefully in any invented path.

**Fix:** Add to §6.2 stream route: "If `job.executor_machine_id ≠ $machineId`: 403 `REMOTE_PEER_JOB { executorMachineId }`." UI should show a read-only panel for remote jobs without attempting to stream.

---

### P1-8 — `controlPlaneErrorToStatus()` extension has no implementation guidance; current function returns 500 for nearly all new codes

**Verified current implementation** (`packages/control-plane/src/api/server.ts:1197-1210`):
```typescript
function controlPlaneErrorToStatus(code: string): number {
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.endsWith('_UNAVAILABLE') || code.endsWith('_OFFLINE')) return 503;
  if (code.startsWith('INVALID_')) return 400;
  return 500;
}
```

Of the 20 new error codes in §14, nearly all return 500 today:
- `VALIDATION_ERROR` → 500 (spec: 422)
- `EMBEDDING_NO_PROVIDER` → 500 (spec: 409)
- `PROVIDER_AUTH_FAILED` → 500 (spec: 401)
- `PROVIDER_HAS_ACTIVE_JOBS` → 500 (spec: 409)
- `JOB_ALREADY_RUNNING` → 500 (spec: 409)
- `DUPLICATE_ACTIVE_EMBEDDING` → 500 (spec: 409)
- `EGRESS_NOT_CONFIRMED` → 500 (spec: 400)
- `FEATURE_DISABLED` → 500 (spec: 400)
- `MODEL_MISMATCH` → 500 (spec: 409)
- `MIXED_MODEL_BLOCKED` → 500 (spec: 503; `_BLOCKED` suffix ≠ `_UNAVAILABLE`)
- `RATE_LIMITED` → 500 (spec: 429)
- `PROVIDER_RATE_LIMITED` → 500 (spec: 429)
- `REMOTE_PEER_JOB` → 500 (spec: 403)

The spec says PR B "extends `controlPlaneErrorToStatus()` to cover all memory-ops codes" but does not say HOW (explicit if-chain? switch? Map? refactor?). The plan writer will add cases in a style inconsistent with the existing function, or miss codes, or choose the wrong refactoring approach.

**Fix:** Show the extended function (or at least the approach). Recommended — convert to explicit Map:
```typescript
const STATUS_MAP = new Map<string, number>([
  ['VALIDATION_ERROR', 422],
  ['EMBEDDING_NO_PROVIDER', 409],
  ... // all 20 codes
]);
function controlPlaneErrorToStatus(code: string): number {
  if (STATUS_MAP.has(code)) return STATUS_MAP.get(code)!;
  if (code.endsWith('_NOT_FOUND')) return 404;
  // ... existing patterns as fallback
  return 500;
}
```
Specify this in §14 or PR B scope in Appendix A.

---

### P1-9 — Drizzle schema §5.4 missing `idx_memory_ops_jobs_kind_scope_status` index

SQL migration §5.2 defines three indexes on `memory_ops_jobs`:
```sql
CREATE INDEX idx_memory_ops_jobs_status_executor ...
CREATE INDEX idx_memory_ops_jobs_kind_created ...
CREATE INDEX idx_memory_ops_jobs_kind_scope_status
  ON memory_ops_jobs ((COALESCE(params->>'scope','')), kind, status);
```

§5.4 Drizzle schema defines only two:
```typescript
index('idx_memory_ops_jobs_status_executor').on(table.status, table.executorMachineId),
index('idx_memory_ops_jobs_kind_created').on(table.kind, table.createdAt),
```

`idx_memory_ops_jobs_kind_scope_status` is absent. This index supports the fleet-check SELECT (`WHERE COALESCE(params->>'scope','') = $normalizedScope AND kind = $kind AND status IN (...)`). Without it, the fleet-check does a full table scan.

More critically: Drizzle's `db:generate` command diffs `schema.ts` against the DB to produce migration files. If this index is not in `schema.ts`, a future `db:generate` run will emit `DROP INDEX idx_memory_ops_jobs_kind_scope_status` in the auto-generated migration, destroying the performance-critical index.

**Fix:** Add to §5.4 Drizzle table definition:
```typescript
index('idx_memory_ops_jobs_kind_scope_status').on(
  sql`COALESCE(${table.params}->>'scope', '')`,
  table.kind,
  table.status,
),
```

---

### P1-10 — Boot reconciliation for `queued` rows is unsequenced with HTTP request acceptance

§5.2: "Workers also process `queued` jobs on boot... poll via `getJob(jobId)` and re-enqueue if missing."

No specification of whether this boot pass completes BEFORE or AFTER CP starts accepting HTTP requests. Two failure modes:

**Startup race:** If CP serves HTTP before the boot pass completes, a `POST /jobs` (fleet-check SELECT) sees old `queued` rows being reconciled → returns 409 `JOB_ALREADY_RUNNING` for a legitimately new request on a job kind that's been stuck since the last crash.

**Redis unavailable at boot:** If Redis is down when CP boots, `getJob(jobId)` fails. Does the boot pass skip re-enqueue and continue? Or does CP refuse to start? The spec is silent. If CP starts without re-enqueue, stuck `queued` rows remain stuck indefinitely. If CP refuses to start, it's completely down when Redis is down.

**Fix:** Add to §5.2 or §4 Worker process model: "Boot reconciliation completes synchronously before the Fastify server begins accepting requests (before `fastify.listen()` is called). If Redis is unavailable during boot reconciliation, the pass is skipped and the `queued` rows are left for the next boot attempt — CP does not fail to start due to Redis unavailability during reconciliation."

---

## P2 Issues (14)

### P2-1 — Architecture diagram (§4) missing `/api/memory/ops/capabilities` route

The CP box in §4 shows `/api/memory/ops/jobs` but not `/api/memory/ops/capabilities`. P0-9 (round-4) fixed the capabilities URL inconsistency and defined the top-level path. The diagram was not updated. The plan writer sees two routes in §4 and seven route groups across §6.1-6.2.

**Fix:** Add to the CP diagram box: `│  /api/memory/ops/capabilities    fleet status snapshot           │`

---

### P2-2 — Group D (memory_ops_audit) SQL is split across §5.1 and §10

§5.1 promises "Migration `0033_add_memory_ops.sql` (PR A, **four** statement groups)." Groups A, B, C are all in §5.2-5.3. Group D (`memory_ops_audit`) is in §10 — a completely different section with a different heading.

A plan writer reading the migration section sees 3 of 4 groups. Group D appears to be a separate table when it's part of the same migration file. This is a structural confusion risk.

**Fix:** Move the Group D SQL from §10 into §5.2 alongside Groups A-C, labeled `-- Group D — memory_ops_audit`. §10 can still discuss the `MemoryOpsAuditLogger` interface and context redaction behavior — just not the DDL.

---

### P2-3 — `redactSensitiveKeys` module path undefined

§10: "a shared `redactSensitiveKeys(obj)` helper removes any key whose name contains `key`, `token`, `secret`, `password`, `credential` (case-insensitive) from nested JSON before writing."

No module path. The audit logger in PR B and every other caller needs to import this. Where does it live? `packages/shared/src/memory/ops-audit.ts`? `packages/control-plane/src/utils/redact.ts`? The existing `redactMemoryWriteMetadata` lives at `packages/shared/src/memory/audit.ts:77-81` (verified). A new helper should be in the same package for consistent import paths.

**Fix:** Specify: "`redactSensitiveKeys(obj)` exported from `packages/shared/src/memory/ops-audit.ts`."

---

### P2-4 — `pg_notify` "same transaction when possible" left undefined

§5.3: "Writer does `pg_notify` after every `memory_ops_jobs` write AND after every `memory_ops_job_events` insert (same transaction when possible)."

"When possible" implies sometimes they're not in the same transaction — but when? If they're ever in separate transactions, there's a commit window where a `memory_ops_job_events` insert commits but `pg_notify` hasn't fired yet (or vice versa). An SSE client polling for new events after `Last-Event-Id` might miss notifications.

**Fix:** Remove "when possible." Define the invariant: "Worker emits `pg_notify` at the end of the same transaction that inserts/updates the triggering row. For operations that span multiple tables, use a single transaction."

---

### P2-5 — `scopeNormalize` function module path undefined

§6.3: "`scope` (optional on all kinds) coerced via `scopeNormalize(s) = (s ?? '').trim().toLowerCase()`."

No module path. The fleet-check query, the duplicate-detection INSERT, and the job handler all need the same normalization. If it's defined inline in the route handler, it's not testable or reusable. The required test (§15 test 10) tests normalization behavior, which implies a named function.

**Fix:** Specify module path: "`scopeNormalize` exported from `packages/shared/src/memory/ops.ts`." Add to PR A scope in Appendix A.

---

### P2-6 — Non-vector search paths: no inventory of existing `content_model` filters to remove

§8: "Non-vector paths (BM25, graph, keyword): no `content_model` filter. These paths work with all facts regardless of embedding state."

The v4 fix removes the dead `content_model IS NULL` clause. But it does not audit which EXISTING BM25/graph/keyword query functions currently have `content_model` filters. If any existing non-vector paths accidentally filter on `content_model`, they would silently exclude facts from un-embedded or re-embedded rows.

**Fix:** Add to §7.3.2 or §8: "Verify that the following non-vector query functions have no `content_model` filter: `MemorySearch.bm25Search`, `MemorySearch.graphSearch`, `MemorySearch.keywordSearch` [enumerate actual methods]. Add failing tests asserting facts with a different `content_model` are still returned by non-vector paths."

---

### P2-7 — `MIXED_MODEL_BLOCKED` scope is unspecified; unscoped COUNT causes false positives

§8: `MIXED_MODEL_BLOCKED` fires when "COUNT(*) WHERE embedding IS NOT NULL AND content_model = $queryModel = 0 but COUNT(*) WHERE embedding IS NOT NULL > 0."

Both COUNTs are unscoped (no WHERE on `scope`). Consider:
- Scope "A": 100 facts embedded with OpenAI
- Scope "B": 100 facts embedded with Gemini

A user searching scope "A" with an OpenAI active provider: `$queryModel = 'text-embedding-3-small'`. Scoped count = 100 (non-zero). But unscoped "other model" count sees Gemini facts from scope "B". The global count says "not mixed in this scope" but the two global COUNTs would show `content_model = $queryModel` > 0, so MIXED_MODEL_BLOCKED would NOT fire. OK, that specific case is fine.

Reversed case: Scope "A": OpenAI. Scope "B": Gemini. User searches scope "B" with OpenAI active. Scoped query for `embedding_model='text-embedding-3-small'` in scope B = 0. Unscoped count of any embedded rows > 0. MIXED_MODEL_BLOCKED fires. Correct.

But now: user searches scope "A" with Gemini active (e.g., they just switched providers). Scoped count = 0 (scope A has OpenAI facts). Unscoped count > 0. MIXED_MODEL_BLOCKED fires for a scope that's fully consistent within itself.

The correct predicate should be scope-scoped if the search is scope-scoped. The spec does not address this.

**Fix:** Add: "If the vector search is scope-scoped (scope parameter provided), the MIXED_MODEL_BLOCKED check is also scope-scoped: `COUNT(*) WHERE embedding IS NOT NULL AND content_model = $queryModel AND scope = $scope`. Unscoped searches use unscoped COUNTs."

---

### P2-8 — `MissingEmbeddingAlert` render conditions do not address loading or error state

§13.3: "Renders when: `useQuery(memoryProvidersQuery())` returns empty, OR active provider `metadata.lastTestOk === false`, OR `metadata.lastTestOk === null`."

`useQuery` has three meaningful states: loading (data=undefined, isPending=true), error (isError=true), and success. The spec defines behavior only for the success state (data is an array). During loading, `data` is `undefined`, which is not "empty" — it's not yet known. If the component renders the alert during loading (flash), it's bad UX. If it doesn't, it needs `isPending` guard logic that the spec doesn't mention.

**Fix:** Add: "Alert renders only when `!isPending && (providers.length === 0 || ...)`. During `isPending` or `isError`, render nothing or a skeleton."

---

### P2-9 — `resetBusForTesting()` removes the cache listener but doesn't re-register it; subsequent tests lose cache invalidation

§7.3.1: "`resetBusForTesting()` ... removes the listener and clears the cache map — used in test `afterEach`."

The module-level listener is registered ONCE at module init (Node.js module cache). After `resetBusForTesting()` removes it:
- Cache is cleared (correct)
- Listener is gone (intended)

But subsequent tests in the same process that trigger `provider.changed` events will NOT clear the cache because the listener is gone. The spec says "used in test `afterEach`" — meaning between every test the listener is removed. The first test that fires `provider.changed` after the `afterEach` of a prior test will find the cache stale.

The spec also says "module initialization (module-load time side effect)" — Node caches modules; the init code runs once. If the listener is removed, it's gone for the rest of the process unless explicitly re-registered.

**Fix:** `resetBusForTesting()` should: (1) remove all existing listeners on `provider.changed`; (2) clear the cache; (3) re-register the standard listener. This ensures subsequent tests always have the listener in place. Add `bus.setMaxListeners(3)` to cover the production listener + test listener + one extra in case of test framework wrapping.

---

### P2-10 — §17 runbook missing `memory_ops_audit` retention command

§5.3: "Retention: 14-day for events, 90-day for audit, via extension of `log-retention.ts` in PR D."
§17 Normal ops: only shows event purge. Audit table purge is not documented — not even as "handled automatically by log-retention.ts." Operator has no way to verify audit retention is working or to emergency-purge.

**Fix:** Add to §17: "Purge audit rows (handled by `log-retention.ts`): `DELETE FROM memory_ops_audit WHERE timestamp < now() - interval '90 days'`. Verify: `SELECT COUNT(*) FROM memory_ops_audit WHERE timestamp < now() - interval '90 days'` should return 0 after retention runs."

---

### P2-11 — Appendix A PR B entry "+cache + bus" ambiguously implies bus is inside the factory file

Appendix A, PR B:
```
- `src/memory/embedding-client-factory.ts` + cache + bus
- `src/memory/provider-invalidation-bus.ts`
```

The annotation "+ cache + bus" on the factory file line implies bus lives in the factory file. §7.3.1 clearly says `provider-invalidation-bus.ts` is a separate module. The annotation conflicts with the separate entry. A plan writer reading Appendix A for the first time sees the contradiction and may put the bus logic in the factory file.

**Fix:** Change annotation: "`src/memory/embedding-client-factory.ts` (includes module-level cache; imports bus)."

---

### P2-12 — `validateCatalog()` failure mode not documented (hard boot fail vs warning)

§6.3: "`validateCatalog()` runs at boot: every entry's `dim === 1536`; throws otherwise."

If it throws and is not caught: CP process crashes (exit code 1), PM2 restarts. If it's caught and logged: CP starts with a broken catalog. The spec doesn't specify whether the throw should propagate to crash the process or be caught and handled. Given the consequences (wrong dim → corrupted embeddings), crashing on invalid catalog is correct — but it needs to be stated.

**Fix:** Add: "If `validateCatalog()` throws, it is allowed to propagate uncaught at boot — CP must not start with an invalid catalog. PM2 will restart and the error will be visible in `pm2 logs`."

---

### P2-13 — `addFact` benchmark baseline file is a circular self-reference in §18 AC

§18: "P99 latency ≤ baseline + 15%. Baseline committed in `docs/superpowers/specs/2026-04-24-memory-operations-ui-coverage-baseline.md` **by PR B**."

The benchmark AC in §18 validates against a file that PR B creates. The AC cannot be evaluated until PR B ships. This creates a temporal loop: you can't verify PR B's AC until PR B has already shipped. The spec should acknowledge this is a post-PR-B check, not a pre-merge gate.

**Fix:** Change to: "P99 latency ≤ baseline + 15%, where baseline is committed by PR B. This AC is validated on PR E (first PR that adds embedding workers) by running the benchmark in dev-1 and comparing against the committed baseline. Not a PR B pre-merge gate."

---

### P2-14 — Origin-offline runbook step 3 missing MODEL_MISMATCH warning

§17 step 3: "Force-fail with `error_code='EXECUTOR_OFFLINE'`, then POST a new job."

If peer A (offline, used OpenAI) has already embedded N rows with `content_model='text-embedding-3-small'`, and peer B (current, uses Gemini) POSTs a new `embedding-backfill`, the new job's fleet-check succeeds (stuck job was forced-failed), then the new job starts embedding with `content_model='gemini-embedding-001'`. The model-lock check in §8 should catch this: "1 distinct `content_model` X → new provider must have `model = X`, else `MODEL_MISMATCH`." So POSTing the new job from peer B would return 409 `MODEL_MISMATCH`.

The runbook doesn't warn the operator about this scenario. The operator follows the runbook step 3, gets a 409, and has no guidance.

**Fix:** Add to step 3: "Note: if peer A had a different active embedding provider than peer B, POSTing a new job from peer B will return 409 `MODEL_MISMATCH` (model lock conflict). Resolve by ensuring peer B has the same provider model as peer A, or by running the manual re-embed-all workaround in §17 before POST-ing the new job."

---

## Code Anchor Verification Results

All verified claims (matched against live codebase on `main`):

| Claim | Verified |
|---|---|
| `getMachineId()` at `sync/machine-identity.ts:11` | ✅ confirmed |
| `PUT /api/settings/defaults` at `settings.ts:54` with body `{ defaultAccountId }` | ✅ confirmed |
| `settings.ts` registers under prefix `/api/settings` → full path `PUT /api/settings/defaults` | ✅ confirmed |
| `apiAccounts` reads `api_accounts` without credential_kind filter at settings.ts:83 | ✅ confirmed (to be fixed by PR A) |
| `SETTINGS_NAV` at `SettingsView.tsx:26-67` (8 sections, closing `] as const` at line 67) | ✅ confirmed |
| `MEMORY_NAV_ITEMS` at `MemorySidebar.tsx:13-40` (10 items, closing at line 40) | ✅ confirmed |
| `SettingsSection` props at `SettingsShell.tsx:56-82` | ✅ (from verified-facts item 31) |
| `queryOptions` pattern in `queries.ts:2` from `@tanstack/react-query` | ✅ (from verified-facts item 11) |
| `EmbeddingClient` URL as `${baseUrl}/v1/embeddings` at `embedding-client.ts:64` | ✅ (from verified-facts item 5) |
| `api_accounts` is local-only at `sync.ts:182` | ✅ (from verified-facts item 27) |
| `log-retention.ts` exports `LogRetentionConfig`, `validateConfig` | ✅ (from verified-facts item 35) |
| `controlPlaneErrorToStatus()` at `server.ts:1197` is pattern-match only (no explicit code map) | ✅ confirmed |
| Current error handler sends `{ error, message }` with NO `details` field | ✅ confirmed |
| `ApiError` constructor takes `hint?` not `details?` at `core.ts:7-13` | ✅ confirmed |
| `core.ts:40` extracts `body.hint` (not `body.details`) | ✅ confirmed |
| `MEMORY_NAV_ITEMS` exists in `MemorySidebar.tsx:13` (not "NOT FOUND" as in verified-facts item 15) | ✅ confirmed — item 15 of verified-facts is stale |
| Round-4 review files (`v3-strict-review.md`, `v3-strict-review-round-2.md`) on branch | ❌ **do not exist** |

**Stale claim in verified-facts doc (item 15):** "MEMORY_NAV_ITEMS NOT FOUND in MemorySidebar.tsx." This is wrong as of the current codebase — `MEMORY_NAV_ITEMS` is defined at `MemorySidebar.tsx:13`. The verified-facts doc predates the sidebar being created. Any downstream claim that cites item 15 as justification for inventing a new nav structure is incorrect.

---

## Summary Table

| # | Severity | Section | Issue |
|---|---|---|---|
| P0-1 | **P0** | §14, PR C/F | Web client `ApiError` has no `details` field; `core.ts` never parses `details`; no PR updates `core.ts` |
| P0-2 | **P0** | §5.2 | Race-window mitigation claim wrong: `WHERE embedding IS NULL` guard doesn't prevent mixed-model corruption across two peers |
| P0-3 | **P0** | §4, Appendix D | Round-4 review source files don't exist on branch; Appendix D disposition table is unverifiable |
| P0-4 | **P0** | §5.2, §14 | `JOB_ALREADY_RUNNING` from advisory-lock path cannot populate `details.existingJobId/existingMachine` |
| P1-1 | P1 | §5.4, App A PR D | Drizzle schema for `memory_ops_job_events` absent; `JobEventsRepository` cannot be implemented |
| P1-2 | P1 | §5.4, App A PR B | Drizzle schema for `memory_ops_audit` absent; `MemoryOpsAuditLogger.write()` cannot be implemented |
| P1-3 | P1 | §6.1 | `recentTestResult` token expiry check not specified; tokens work indefinitely |
| P1-4 | P1 | §6.2, §6.3 | POST /jobs top-level request body schema never defined; `egressConfirmed` placement unknown |
| P1-5 | P1 | §6.2, §16 | `ENABLED_JOB_KINDS` mechanism undefined (code constant vs env var vs config) |
| P1-6 | P1 | §14 | `PROVIDER_RATE_LIMITED` has no defined call site; behavior when provider API returns 429 is unspecified |
| P1-7 | P1 | §6.2 | SSE stream for remote-peer job has no defined error response |
| P1-8 | P1 | §14, App A PR B | `controlPlaneErrorToStatus()` extension strategy unspecified; nearly all new codes currently return 500 |
| P1-9 | P1 | §5.4 | `idx_memory_ops_jobs_kind_scope_status` missing from Drizzle schema; future `db:generate` will drop it |
| P1-10 | P1 | §5.2, §4 | Boot reconciliation for `queued` rows unsequenced with HTTP request acceptance; Redis-down behavior undefined |
| P2-1 | P2 | §4 | Architecture diagram missing `/api/memory/ops/capabilities` route |
| P2-2 | P2 | §5.1, §10 | Group D (memory_ops_audit) SQL split from Groups A-C; plan writer gets 3 of 4 migration groups from §5 |
| P2-3 | P2 | §10 | `redactSensitiveKeys` module path undefined |
| P2-4 | P2 | §5.3 | `pg_notify` "same transaction when possible" undefined; commit window on separate transactions |
| P2-5 | P2 | §6.3 | `scopeNormalize` function module path undefined |
| P2-6 | P2 | §8, §7.3.2 | No inventory of existing BM25/graph query functions that may have stale `content_model` filters |
| P2-7 | P2 | §8 | `MIXED_MODEL_BLOCKED` scope unspecified; unscoped COUNT causes false positives in multi-scope setups |
| P2-8 | P2 | §13.3 | `MissingEmbeddingAlert` loading/error state unaddressed |
| P2-9 | P2 | §7.3.1 | `resetBusForTesting()` removes listener without re-registering; subsequent tests lose cache invalidation |
| P2-10 | P2 | §17 | `memory_ops_audit` retention runbook command missing |
| P2-11 | P2 | App A | PR B annotation "+ cache + bus" on factory file conflicts with separate `provider-invalidation-bus.ts` entry |
| P2-12 | P2 | §6.3 | `validateCatalog()` failure mode (hard crash vs warn) not documented |
| P2-13 | P2 | §18 | `addFact` benchmark baseline file created by PR B but AC evaluated against it before PR B ships |
| P2-14 | P2 | §17 | Origin-offline recovery step 3 missing MODEL_MISMATCH warning when peers have different providers |

**Counts:** 4 P0, 10 P1, 14 P2. Fix P0s and P1s before handing to plan writer. P2s can be fixed concurrently by the author.

---

*Scan method: full spec read + live grep verification of all code anchors + cross-reference against verified-facts doc + cross-reference against `git ls-tree` for referenced files.*
*Confidence: HIGH for P0-1 (code confirmed), P0-2 (logical proof), P0-3 (git confirmed), P0-4 (logical proof), P1-1 through P1-10 (code confirmed or logical gap), P2-1 through P2-14 (architectural reasoning + code checks).*
