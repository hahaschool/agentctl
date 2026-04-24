# Memory Operations UI — v4 Design

> **Status:** SUPERSEDED by [v5](./2026-04-24-memory-operations-ui-design-v5.md). Round-5 reviews found 10 P0s (R1) and 4 P0s (R2); v5 addresses all of them. Do not implement from this version.
>
> **v3 → v4 delta:** Round-4 reviews ([R1](../reviews/2026-04-24-memory-operations-ui-design-v3-strict-review.md) — 12 P0, 15 P1, 8 P2; [R2](../reviews/2026-04-24-memory-operations-ui-design-v3-strict-review-round-2.md) — 4 P0, 12 P1, 30 P2) found architectural gaps in cross-peer exclusion, enqueue atomicity, provider-snapshot persistence, drawer search rewiring, search predicate consistency, error-responder coverage, and security. v4 addresses all P0s and P1s; Appendix D is the round-4 disposition log.
> **Companion files:**
> - Verified facts (item 37 corrected): `docs/superpowers/reviews/2026-04-24-memory-operations-ui-v2-verified-facts.md`
> - Reviewer checklist (74 items, round-2): `docs/superpowers/reviews/2026-04-24-memory-operations-ui-v2-reviewer-checklist.md`

## 1. Problem

`memory_facts` rows with `embedding IS NULL`: 19,226 on the operator's laptop as of 2026-04-24; drawers and edges not populated. **Semantic/vector-dependent** surfaces on `/memory/graph`, drawer search, `MemorySearch.vectorSearch`, and consolidation's near-duplicate detection are empty or degraded. Non-vector features of `MemoryMaintenance.run` (stale paths, deleted files, coverage gaps) and `MemorySynthesis.runSynthesis` (lint grouping) DO function without a provider; the degradation is partial, not total.

Root cause: no UI path to configure an embedding provider and no UI path to trigger the long-running maintenance jobs. CLI paths exist but require shell access.

## 2. Goals

- Configure embedding providers (OpenAI, Gemini AI Studio) from Settings. Per-machine, encrypted at rest.
- Trigger + observe memory maintenance jobs from `/memory/operations`.
- All existing memory read/write paths (`MemorySearch`, `MemoryStore.addFact`, drawer search) resolve the active embedding provider from the DB, not `LITELLM_URL` env.
- Ship critical path PR A → PR B → PR C → PR D → PR E so the 19,226-fact backfill runs after PR E.

## 3. Non-Goals (v1)

- iOS UI.
- Providers beyond OpenAI + Gemini (AI Studio). Voyage, Azure, Bedrock, Anthropic-routed, local Ollama deferred.
- Cross-peer credential replication. `api_accounts` is `local-only` per `packages/shared/src/types/sync.ts:182`.
- `memory_facts.embedding` / `memory_drawers.embedding` schema migration away from `vector(1536)`.
- User-supplied `baseUrl` (SSRF mitigation — catalog-only).
- Swapping provider model while facts exist with a different `content_model` — locked until a v1.1 `re-embed-all` job ships.
- Cost budgets / kill-switches at provider level.
- Scheduled/cron maintenance runs.
- Multiple simultaneously active embedding providers.
- Hash-chained audit log. v1 writes structured audit rows; chaining deferred.
- Resumable worker after CP crash. v1 marks in-flight jobs `failed` on reboot; resume is v1.1.
- Cross-peer job takeover. v1: jobs run only on their origin peer. v1.1 introduces takeover.
- Arbitrary `sourceRoot` paths for drawer-backfill. v1 restricts to operator-configured roots.
- Full distributed-lock exclusion. v1 uses fleet-visibility check (acknowledged race window; see §5.2).
- Egress snapshot staleness rejection. v1 stores snapshot at creation; staleness check is v1.1.

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Web (Next.js App Router)                                         │
│  Settings → Memory & Embeddings   /memory/operations             │
│  <MissingEmbeddingAlert /> on 8 views (§13.4)                    │
└──────────────┬───────────────────────────────┬───────────────────┘
               │ HTTP + SSE (same-peer only)   │
               ▼                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ Control plane (Fastify, per-machine)                             │
│                                                                  │
│  /api/memory/providers           CRUD + /test + /test-ephemeral  │
│  /api/memory/ops/jobs            CRUD + /cancel + /stream        │
│  /api/memory/ops/capabilities    fleet status snapshot           │
│             │                                                    │
│             ▼                                                    │
│  memory-ops BullMQ Worker  (in-process with CP, concurrency=1)   │
│    handlers: embedding-backfill, drawer-backfill,                │
│              consolidation, synthesis                            │
│             │                                                    │
│             ▼                                                    │
│  resolveEmbeddingClient(pool, encKey, credentialId?)             │
│  Used by: memory-ops workers, MemorySearch, MemoryStore.addFact, │
│           drawer-store writes, drawer-search  (§7.3 rewires all) │
└──────────────────────────────────────────────────┬───────────────┘
                                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│ PostgreSQL                                                       │
│  api_accounts (+ credential_kind, + credential_last4)            │
│  memory_ops_jobs (mesh-synced mutable; origin+executor columns)  │
│  memory_ops_job_events (LOCAL-ONLY)                              │
│  memory_ops_audit (LOCAL-ONLY)                                   │
│  memory_facts.embedding / content_model (raw SQL only)           │
│  memory_drawers.embedding / embedding_model                      │
└──────────────────────────────────────────────────────────────────┘
```

**Concurrency story.** BullMQ queue is namespaced per Redis DB. Each tier runs exactly one CP process with one worker at global `concurrency=1` — all four job kinds share a single queue; at most one job runs per CP at any time. Cross-peer duplicate protection for write jobs uses a fleet-visibility SELECT against the mesh-synced `memory_ops_jobs` table (§5.2).

**Worker process model.** In-process with CP for v1. Boot-time reconciliation: `UPDATE memory_ops_jobs SET status='failed', error_code='CP_RESTART_DURING_RUN', finished_at=now() WHERE status='running' AND executor_machine_id = $machineId`.

`$machineId` throughout this spec means `getMachineId()` from `packages/control-plane/src/sync/machine-identity.ts:11` — the helper that consults `MACHINE_ID` env + hostname fallback. (P2-1 fix: prior versions cited `index.ts:242-244` which is the import site, not the definition.) Never read `process.env.MACHINE_ID` directly.

## 5. Data Model

### 5.1 `api_accounts` extensions

Table: `packages/control-plane/src/db/schema.ts:443` (`apiAccounts`). Local-only per `sync.ts:182`.

Existing columns: `id uuid`, `name text`, `provider text`, `credential text`, `credential_iv text`, `priority int`, `rate_limit jsonb`, `is_active bool`, `metadata jsonb`, `created_at`, `updated_at`.

**Migration `0033_add_memory_ops.sql` (PR A, four statement groups):**

```sql
-- Group A — api_accounts extensions
ALTER TABLE api_accounts
  ADD COLUMN credential_kind text NOT NULL DEFAULT 'runtime',
  ADD CONSTRAINT api_accounts_kind_check
    CHECK (credential_kind IN ('runtime', 'embedding')),
  ADD COLUMN credential_last4 text;

CREATE UNIQUE INDEX api_accounts_one_active_embedding
  ON api_accounts (credential_kind)
  WHERE is_active = true AND credential_kind = 'embedding';

CREATE INDEX idx_api_accounts_kind ON api_accounts (credential_kind);
```

Design notes:
- `credential_last4` populated on INSERT/PATCH-with-new-key; PATCH without `apiKey` leaves it untouched.
- Partial unique index is a DB invariant for single-active-embedding — not API-layer race prevention. Loser sees Postgres `SQLSTATE 23505` → route maps to `409 DUPLICATE_ACTIVE_EMBEDDING`.
- Existing runtime rows default to `credential_kind='runtime'`; no behavior change.

### 5.2 `memory_ops_jobs` (new, mesh-synced mutable)

```sql
-- Group B — memory_ops_jobs
CREATE TABLE memory_ops_jobs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                      text NOT NULL
                            CHECK (kind IN ('embedding-backfill','drawer-backfill',
                                            'consolidation','synthesis')),
  status                    text NOT NULL
                            CHECK (status IN ('queued','running','completed',
                                              'failed','cancelled')),
  params                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress                  jsonb NOT NULL
                            DEFAULT '{"processed":0,"embedded":0,"failed":0,"total":0,
                                      "costUsd":0,"usageEstimated":false}'::jsonb,
  result                    jsonb,              -- 16 KB hard cap enforced in handler
  error                     text,
  error_code                text,               -- stable string for UI parsing
  credential_id             uuid,               -- no FK; api_accounts is local-only
  provider_kind             text,               -- 'openai'|'gemini'|null (null for SQL-only kinds)
  provider_model            text,               -- model string at job creation
  provider_host             text,               -- catalog base URL at job creation
  origin_machine_id         text NOT NULL,      -- peer that created the job
  executor_machine_id       text NOT NULL,      -- peer that runs it; always = origin in v1
  started_at                timestamptz,
  finished_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  egress_confirmed_at       timestamptz,
  egress_confirmed_by       text,
  egress_snapshot           jsonb               -- { rows, tokens, costUsd } at creation time
);

CREATE INDEX idx_memory_ops_jobs_status_executor
  ON memory_ops_jobs (status, executor_machine_id);
CREATE INDEX idx_memory_ops_jobs_kind_created
  ON memory_ops_jobs (kind, created_at DESC);
CREATE INDEX idx_memory_ops_jobs_kind_scope_status
  ON memory_ops_jobs ((COALESCE(params->>'scope','')), kind, status);

CREATE TRIGGER sync_capture
  AFTER INSERT OR UPDATE OF status, result, finished_at, error, error_code
     OR DELETE
  ON memory_ops_jobs
  FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');
```

Then update `packages/shared/src/types/sync.ts` `TABLE_SYNC_CONFIG` (line 162):

```typescript
memory_ops_jobs: 'mutable',
```

**executor_machine_id is NOT NULL (P2-5 fix):** v1 sets both `origin_machine_id` and `executor_machine_id` at INSERT time. The only valid state where they differ is v1.1 cross-peer takeover, which this spec explicitly defers. Any tooling that finds a row where both diverge without v1.1 migration should treat it as data corruption.

**Progress shape:**

```typescript
type MemoryOpsProgress = {
  processed: number;         // rows attempted (not batches)
  embedded: number;          // successfully written
  failed: number;            // per-fact failures within retry budget
  total: number;             // eligible work snapshot at job start
  costUsd: number;           // accumulated across all batches
  usageEstimated: boolean;   // true when token count is chars/4 estimate, not actual
  etaSeconds?: number;
  currentBatch?: number;
};
```

`total = 0` at job start is valid (zero eligible rows); handler completes immediately with `status='completed'` — no division by zero (P1-3 fix).

**Provider snapshot at job creation (P0-4 fix):** For write kinds (`embedding-backfill`, `drawer-backfill`), the POST handler resolves the active provider **inside the DB transaction** and persists `credential_id`, `provider_kind`, `provider_model`, `provider_host`, plus a row-count and token estimate in `egress_snapshot`. Worker MUST use the job's stored `credential_id` when calling `resolveEmbeddingClient({ credentialId: job.credentialId })`; it does NOT re-resolve the active provider. For SQL-only kinds (`consolidation`, `synthesis`), all provider columns are NULL.

**Fleet-wide write-job exclusion (P0-1 fix):**

`memory_facts.embedding` and `memory_drawers.embedding` are mesh-synced. If two peers run `embedding-backfill` simultaneously with different active providers, both can win the `WHERE f.embedding IS NULL` race within a single batch window and write conflicting model vectors to the same rows. This corrupts the fleet's embedding model uniformity.

v1 fix — for write kinds only (`embedding-backfill`, `drawer-backfill`), the POST handler checks the **fleet-visible** job table before inserting:

```sql
SELECT id, executor_machine_id
FROM memory_ops_jobs
WHERE kind = $kind
  AND COALESCE(params->>'scope', '') = $normalizedScope
  AND status IN ('queued', 'running');
```

If any row is found (on ANY machine), throw `ControlPlaneError('JOB_ALREADY_RUNNING')` with `context = { existingJobId, existingMachine }`. This check runs inside the advisory-lock transaction (preventing same-machine concurrent races). Cross-machine race window: two peers querying simultaneously before either commits. This window is acknowledged and accepted for v1; v1.1 will close it with a Redis distributed lock. The `WHERE f.embedding IS NULL` guard in the batch UPDATE means the worst-case outcome (if the race fires) is one redundant batch that writes a no-op UPDATE on already-embedded rows.

For SQL-only kinds (`consolidation`, `synthesis`), no fleet check is needed (no shared data writes). Local advisory lock is sufficient.

**Scope storage (P0-3 fix):** Always normalize scope before INSERT and store as `params.scope = normalizedScope` (never store `null` in `params.scope`). The fleet-check query uses `COALESCE(params->>'scope','') = $normalizedScope` defensively (covers any pre-v4 rows). Required collisions: omitted scope, blank scope, whitespace scope, and mixed-case scope all normalize to the same key (see tests in §15).

**Outbox enqueue pattern (P0-2 fix):**

Redis enqueue is an external side effect that cannot participate in Postgres transactions. The v3 design (enqueue inside Drizzle transaction) is false atomicity. v4 uses a two-phase approach:

```
Phase 1 — inside db.transaction():
  1. SELECT pg_try_advisory_xact_lock(hashtext('memory-ops:' || $kind || ':' || $normalizedScope)::bigint) AS acquired
     If false → throw JOB_ALREADY_RUNNING (local concurrent request)
  2. Fleet-check SELECT (write kinds only; see above)
  3. INSERT memory_ops_jobs row, status='queued'
  [commit]

Phase 2 — after commit:
  4. await bullmqQueue.add(kind, { jobId: insertedId })
     On enqueue failure → UPDATE memory_ops_jobs SET status='failed',
                           error_code='QUEUE_ENQUEUE_FAILED', finished_at=now()
                           WHERE id = $insertedId AND status='queued'
```

Workers also process `queued` jobs on boot (existing boot reconciliation handles `running`; add a pass for `queued` rows where `executor_machine_id = $machineId` that have no BullMQ job — poll via `getJob(jobId)` and re-enqueue if missing). Tests must cover both failure orders (see §15).

**Advisory lock collision note (P2-6):** `hashtext` is a 32-bit hash function. Collision probability across distinct `(kind, scope)` keys is O(N²/2³²). With ≤ 4 kinds × ≤ 10 scopes = 40 distinct keys, collision probability is negligible. A collision produces a spurious 409 that clears on retry. Accepted for v1; v1.1 can use `hashtextextended` + two-bigint advisory lock for collision-free keys.

### 5.3 `memory_ops_job_events` (new, LOCAL-ONLY)

```sql
-- Group C — memory_ops_job_events (local-only; SSE replay is same-peer)
CREATE TABLE memory_ops_job_events (
  event_id   bigserial PRIMARY KEY,
  job_id     uuid NOT NULL REFERENCES memory_ops_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL
             CHECK (event_type IN ('started','progress','log','completed',
                                   'failed','cancelled')),
  level      text CHECK (level IN ('info','warn','error')),
  message    text,              -- capped to 512 chars; application-level truncation
  progress   jsonb,             -- bounded by progress struct shape (~150 bytes)
  payload    jsonb,             -- bounded to 64 KB; for result overflow
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_ops_job_events_job ON memory_ops_job_events (job_id, event_id);
-- NO sync_capture trigger. NOT added to TABLE_SYNC_CONFIG.
```

**Size caps:** `message` ≤ 512 chars (application truncation before INSERT). `payload` ≤ 64 KB (application truncation). `memory_ops_jobs.result` ≤ 16 KB hard cap — overflow writes the truncated summary to `result` and the full payload to an `event_type='log'` row's `payload` column. (P1-4 fix: prior spec used `message` column for 16 KB overflow, which contradicts the 512-char cap.)

**SSE notification:** `pg_notify` fires after BOTH `memory_ops_jobs` row updates AND `memory_ops_job_events` inserts. The notify payload is just the `job_id`; SSE handler fetches all new events since `Last-Event-Id`. (P1-4 fix: v3 only notified on job writes, so log events wouldn't wake SSE clients.)

**Retention:** 14-day for events, 90-day for audit, via extension of `packages/control-plane/src/audit/log-retention.ts` in PR D.

### 5.4 Drizzle schema additions (PR A)

`apiAccounts` additions:

```typescript
credentialKind: text('credential_kind').notNull().default('runtime'),
credentialLast4: text('credential_last4'),
```

`memoryOpsJobs` (new table):

```typescript
export const memoryOpsJobs = pgTable(
  'memory_ops_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    params: jsonb('params').notNull().default(sql`'{}'::jsonb`),
    progress: jsonb('progress').notNull().default(
      sql`'{"processed":0,"embedded":0,"failed":0,"total":0,"costUsd":0,"usageEstimated":false}'::jsonb`,
    ),
    result: jsonb('result'),
    error: text('error'),
    errorCode: text('error_code'),
    credentialId: uuid('credential_id'),
    providerKind: text('provider_kind'),
    providerModel: text('provider_model'),
    providerHost: text('provider_host'),
    originMachineId: text('origin_machine_id').notNull(),
    executorMachineId: text('executor_machine_id').notNull(),  // NOT NULL in v1
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    egressConfirmedAt: timestamp('egress_confirmed_at', { withTimezone: true }),
    egressConfirmedBy: text('egress_confirmed_by'),
    egressSnapshot: jsonb('egress_snapshot'),
  },
  (table) => [
    index('idx_memory_ops_jobs_status_executor').on(table.status, table.executorMachineId),
    index('idx_memory_ops_jobs_kind_created').on(table.kind, table.createdAt),
  ],
);
```

### 5.5 Migration rollback (P0-12 / R2-P0-1 fix)

`0033_add_memory_ops.down.sql` — manual runbook, not auto-applied:

```sql
DROP TABLE IF EXISTS memory_ops_job_events;
DROP TABLE IF EXISTS memory_ops_jobs;
DROP TABLE IF EXISTS memory_ops_audit;      -- added in v4; was missing from v3
DROP INDEX IF EXISTS api_accounts_one_active_embedding;
DROP INDEX IF EXISTS idx_api_accounts_kind;
ALTER TABLE api_accounts
  DROP COLUMN IF EXISTS credential_last4,
  DROP CONSTRAINT IF EXISTS api_accounts_kind_check,
  DROP COLUMN IF EXISTS credential_kind;
```

Rollback verification test: assert all four table artifacts gone from `information_schema.tables` after down script runs on a populated DB.

## 6. API Contract

All routes registered in `server.ts` under the existing `db + pgPool + encryptionKey` guard. Provider routes additionally receive `pgPool` for raw SQL model-distribution queries (P1-10 fix: `memory_facts.embedding` is absent from Drizzle schema; raw SQL required). Pattern matches `accountRoutes` registration at `packages/control-plane/src/api/server.ts:828-847`.

### 6.1 `/api/memory/providers` (PR B)

```
GET    /                    -> 200 { providers: EmbeddingProvider[] }
                                order: is_active DESC, priority ASC, created_at ASC
POST   /                    -> 201 { provider: EmbeddingProvider }
                                409 DUPLICATE_ACTIVE_EMBEDDING on SQLSTATE 23505
                                422 VALIDATION_ERROR on Zod failure
POST   /test-ephemeral      -> 200 { ok, dim, model, costUsd, latencyMs, signedToken }
                                401 PROVIDER_AUTH_FAILED
                                422 VALIDATION_ERROR
                                429 RATE_LIMITED (5/min per IP; same limit as /:id/test)
PATCH  /:id                 -> 200 { provider }
                                404 PROVIDER_NOT_FOUND
                                409 PROVIDER_HAS_ACTIVE_JOBS (apiKey rotate or deactivate)
                                409 MODEL_MISMATCH
                                422 VALIDATION_ERROR
DELETE /:id                 -> 204
                                404 PROVIDER_NOT_FOUND
                                409 PROVIDER_HAS_ACTIVE_JOBS (with details.blockingJobIds)
POST   /:id/test            -> 200 { ok, dim, model, costUsd, latencyMs }
                                401 PROVIDER_AUTH_FAILED (marks metadata unhealthy; see below)
                                404 PROVIDER_NOT_FOUND
                                429 RATE_LIMITED (5/min per IP)
```

**`/test-ephemeral` — "No persistence" clarification (P2-2 fix):** No provider row or test-result row is written. An audit row IS written to `memory_ops_audit` (action: `provider.test-ephemeral`) with the key's last 4 chars; never the plaintext key.

**`/test-ephemeral` missing secret behavior (P1-6 fix):** `MEMORY_OPS_SIGNING_SECRET` is required. If absent at boot, CP logs a fatal error and exits. It does NOT fall back to `CREDENTIAL_ENCRYPTION_KEY`. The signed token carries `{ provider, model, apiKeyFingerprint: hmac(secret, apiKey), dim, ok, testedAt }` and expires in 5 minutes.

**`recentTestResult` for PATCH (P1-5 fix):** POST `/` and PATCH `/:id` both accept `recentTestResult`. Server MUST verify that `recentTestResult.apiKeyFingerprint == hmac(secret, submittedApiKey)`. A token from one key CANNOT be replayed with a different key. PATCH without a new `apiKey` field ignores `recentTestResult` (nothing to bind to).

**PATCH field matrix:**

| Field | Effect |
|---|---|
| `apiKey` provided | re-encrypt, recompute `credential_last4`, reset metadata `lastTestOk=null` and `lastTestError=null`, bump `updated_at`. Blocked by `PROVIDER_HAS_ACTIVE_JOBS` if jobs reference this credential. |
| `name` | write name, bump `updated_at` |
| `model` | server checks model-lock (§8). If existing embedded rows have a different `content_model`/`embedding_model` → 409 `MODEL_MISMATCH`. Also 409 `PROVIDER_HAS_ACTIVE_JOBS` if queued/running jobs reference this credential. |
| `active=true` | flip target row active; server runs `MODEL_MISMATCH` check. DB partial unique index blocks conflict → 409 `DUPLICATE_ACTIVE_EMBEDDING`. |
| `active=false` | 409 `PROVIDER_HAS_ACTIVE_JOBS` with `details = { blockingJobIds }` if any queued/running job references this credential; else flip. |

**Manual test deactivation (P1-9 fix):** A `401` from `POST /:id/test` sets `metadata.lastTestOk=false` and `metadata.lastTestError='...'` but does NOT flip `is_active=false`. Automatic deactivation on 401 would bypass the active-job guard. To deactivate, operator must send an explicit `PATCH /:id { active: false }` which triggers the job-guard check normally.

**409 disambiguation:** Both `DUPLICATE_ACTIVE_EMBEDDING` and `PROVIDER_HAS_ACTIVE_JOBS` return 409. Differentiate via the `error` code field in the flat envelope (not `hint`; see §14 on `details` vs `hint`).

**MODEL_MISMATCH server-side enforcement:** POST `/` and PATCH `/:id` run the model-lock check server-side. UI preflight is a convenience layer only; curl cannot bypass (R1b P1#1 fix carried from v3).

### 6.2 `/api/memory/ops/jobs` and `/api/memory/ops/capabilities` (PR D)

**Capabilities URL (P0-9 fix):** The capabilities endpoint is at `GET /api/memory/ops/capabilities` — a top-level route under `/api/memory/ops/`, NOT nested under `/api/memory/ops/jobs/`. All route inventories, Appendix A, and the web client module use this exact path.

```
GET    /api/memory/ops/capabilities  -> 200 {
                                           enabled: bool,
                                           enabledKinds: MemoryOpsJobKind[],
                                           machineId: string,
                                           hasActiveProvider: bool,
                                           activeProviderModel?: string,
                                           fleetJobsByKind: Record<MemoryOpsJobKind, {
                                             queued: number;
                                             running: number;
                                           }>
                                         }

POST   /api/memory/ops/jobs          -> 201 { job: MemoryOpsJob }
                                         400 EGRESS_NOT_CONFIRMED
                                         400 FEATURE_DISABLED (MEMORY_OPS_ENABLED=false)
                                         400 JOB_KIND_NOT_ENABLED
                                         409 EMBEDDING_NO_PROVIDER
                                         409 JOB_ALREADY_RUNNING
                                         422 VALIDATION_ERROR

GET    /api/memory/ops/jobs          -> 200 { jobs: MemoryOpsJob[] } (filter: kind, status, limit≤200)

GET    /api/memory/ops/jobs/:id      -> 200 { job }
                                         404 JOB_NOT_FOUND         ← (P1-1 / R2-P0-2 fix)

POST   /api/memory/ops/jobs/:id/cancel -> 200 { status: 'cancelled'|'cancelling', job }
                                           403 REMOTE_PEER_JOB
                                           404 JOB_NOT_FOUND        ← (P1-1 / R2-P0-2 fix)
                                           409 JOB_NOT_CANCELLABLE

GET    /api/memory/ops/jobs/:id/stream -> text/event-stream
                                         same-peer only; Last-Event-Id respected
                                         initial event: type=peer { machineId, eventSequenceStart }
```

**Per-kind `requiresProvider` matrix (P1-11 fix):**

| Kind | requiresProvider | Fleet-exclusive (write to shared tables) |
|---|---|---|
| `embedding-backfill` | yes | yes |
| `drawer-backfill` | yes | yes |
| `consolidation` | no | no |
| `synthesis` | no | no |

`EMBEDDING_NO_PROVIDER` is only raised for provider-requiring kinds. SQL-only kinds proceed even with no active provider.

**JobCard disabled predicate (P0-1 / P0-9 / R2-P0-3 fix):** This replaces the contradictory §13.2 vs §5.2 rules from v3.

| Kind | Disabled when |
|---|---|
| `embedding-backfill`, `drawer-backfill` | `!enabled` OR `!hasActiveProvider` OR `fleetJobsByKind[kind].queued > 0 OR fleetJobsByKind[kind].running > 0` |
| `consolidation`, `synthesis` | `!enabled` OR local non-terminal job of that kind exists (read from `GET /jobs?kind=X&status=queued,running&limit=1`) |

The "fleet" check for write kinds uses `fleetJobsByKind` from `GET /capabilities` (which reads mesh-synced `memory_ops_jobs`). Cross-peer "running" for SQL-only kinds is informational only; a second peer CAN run consolidation/synthesis since they touch no shared embedding columns.

**Egress snapshot (P1-7 fix):** For write kinds, server computes and persists at job creation (inside phase 1 transaction): active provider info (`credential_id`, `provider_kind`, `provider_model`, `provider_host`), row count from `SELECT COUNT(*) FROM memory_facts WHERE embedding IS NULL` (scoped by `scope` if provided), token estimate (`Math.ceil(totalChars / 4)`), and cost estimate. All stored in `egress_snapshot`. Worker uses stored `credential_id`; not re-resolved. Egress snapshot staleness rejection (if provider changes between dialog open and POST) is v1.1.

**Feature flag and ENABLED_JOB_KINDS:** same as v3 §6.2. `GET` endpoints (read-only) always enabled. `POST` disabled when `MEMORY_OPS_ENABLED=false`. `JOB_KIND_NOT_ENABLED` when kind not in deploy's `ENABLED_JOB_KINDS` set.

**Cancel semantics:** always returns 200 `{ status: 'cancelled'|'cancelling', job }` on success. No error envelope on 200.

**SSE plumbing:** CP boot opens one dedicated `pg.Client` with `LISTEN memory_ops_job_channel`. Writer does `pg_notify` after every `memory_ops_jobs` write AND after every `memory_ops_job_events` insert (same transaction when possible). Fan-out in-memory map routes `job_id` to subscribed SSE clients.

### 6.3 Shared types (PR A)

`packages/shared/src/memory/providers.ts` — exports `EmbeddingProviderKind = z.enum(['openai','gemini'])` and `EMBEDDING_MODEL_CATALOG`:

| provider | model | dim | baseUrl | embeddingsPath | extraBody | $/Mtok |
|---|---|---|---|---|---|---|
| openai | text-embedding-3-small | 1536 | `https://api.openai.com` | `/v1/embeddings` | `{}` | 0.02 |
| gemini | gemini-embedding-001 | 1536 | `https://generativelanguage.googleapis.com/v1beta/openai` | `/embeddings` | `{ output_dimensionality: 1536 }` | 0.15 |

**Gemini URL gate — split into two (P0-11 fix):**

Gate 1 (no CI secrets required, must pass before PR A merges): fire a real HTTP request to `https://generativelanguage.googleapis.com/v1beta/openai/embeddings` with a fake/invalid API key. Assert the response is `401 Unauthorized` — confirming the URL resolves and the path is correct. A `404 Not Found` or `ENOTFOUND` would indicate a wrong URL.

Gate 2 (CI secret `GEMINI_API_KEY` required, can be a separate follow-on commit): fire a real embedding request with `output_dimensionality: 1536` and assert the response vector length is exactly 1536. If the compat layer returns 3072-dim vectors (native Gemini default), the v1 catalog entry switches to `gemini-embedding-2-preview` which natively emits 1536. This gate is optional for PR A merge but must resolve before PR G ships.

`validateCatalog()` runs at boot: every entry's `dim === 1536`; throws otherwise.

`embeddingProviderCreateSchema`:
- Fields: `name` (1..80), `provider` (enum), `model` (non-empty), `apiKey` (min 8), `active` (default true), `recentTestResult?`.
- `.strict()` — unknown keys fail validation (SSRF guard: prevents user-supplied `baseUrl`).
- `.superRefine` checks `(provider, model)` in catalog; emits `VALIDATION_ERROR` with `issues[0].message === 'model not in catalog'` otherwise.

**`drawer-backfill` sourceRoot restriction (P0-10 fix):** `sourceRoot` is NOT an arbitrary string in v1. The server validates it against `MEMORY_OPS_DRAWER_SOURCE_ROOTS`, a colon-separated env var listing allowed absolute paths. Validation steps:
1. Resolve `realpath(sourceRoot)` — symlink escape check; must not throw.
2. Verify `resolvedPath` starts with one of the configured roots.
3. File-type allowlist: `.md`, `.mdx`, `.txt`, `.json` only.
4. Max tree size: 10 MB total, 1,000 files (configurable via `MEMORY_OPS_DRAWER_MAX_BYTES` / `MEMORY_OPS_DRAWER_MAX_FILES`).

If `MEMORY_OPS_DRAWER_SOURCE_ROOTS` is unset, `drawer-backfill` is not included in `ENABLED_JOB_KINDS`. Required test cases: `../`, symlink escape, absolute path outside roots, oversized tree, disallowed extension — all must return 422 `VALIDATION_ERROR` with `context.sourceRootViolation`.

`memoryOpsJobParamsSchema` (discriminated union, all per-kind fields):

| kind | extra fields | egressConfirmed required |
|---|---|---|
| `embedding-backfill` | `batchSize` (1–500, default 100), `dryRun?` | yes |
| `drawer-backfill` | `sourceType: 'claude-mem'|'jsonl'`, `sourceRoot` (non-empty, validated server-side), `batchSize` (default 50) | yes |
| `consolidation` | — | no |
| `synthesis` | — | no |

`scope` (optional on all kinds) coerced via `scopeNormalize(s) = (s ?? '').trim().toLowerCase()`.

## 7. Embedding Client + Cost Tracking

### 7.1 `EmbeddingClient` extension (PR A, additive only)

Current state (verified `packages/control-plane/src/memory/embedding-client.ts:64`): URL is `${baseUrl}/v1/embeddings`; no apiKey; no usage in return type.

PR A additive changes — default behavior preserved:
- New options: `apiKey?: string`, `extraBody?: Record<string, unknown>`, `embeddingsPath?: string` (default `/v1/embeddings`).
- New method: `embedBatchWithUsage(texts): Promise<{ vectors, usage: { promptTokens }, model }>`.
- `ControlPlaneError('EMBEDDING_API_ERROR', ...)` context gains typed `status: number`. Handlers check `err.context?.status === 401`, not string match.
- Existing callers (`index.ts:378` — LITELLM_URL path) untouched.

### 7.2 Catalog — see §6.3.

### 7.3 `resolveEmbeddingClient` factory (PR B)

```typescript
// packages/control-plane/src/memory/embedding-client-factory.ts (new in PR B)
export type ResolvedEmbeddingClient = { client: EmbeddingClient; model: string; dim: 1536 };

export async function resolveEmbeddingClient(input: {
  pool: Pool;
  db: Database;
  encryptionKey: string;
  logger: Logger;
  credentialId?: string;
}): Promise<ResolvedEmbeddingClient>;
```

**Resolution order:**
1. If `credentialId` provided, fetch that `api_accounts` row (must be `credential_kind='embedding'`).
2. Else fetch single `is_active=true AND credential_kind='embedding'` row.
3. Else if `process.env.LITELLM_URL` set, construct client against that URL with model `text-embedding-3-small` — legacy fallback, deprecated, boot-time warning.
4. Else throw `ControlPlaneError('EMBEDDING_NO_PROVIDER', ...)`.

**Cache:**

```typescript
// module-level, in embedding-client-factory.ts
const cache = new Map<string, { resolved: ResolvedEmbeddingClient; expiresAt: number }>();
const TTL_MS = 60_000;
// Key = credentialId || 'active' for the default-row path.
```

**Cache invalidation (P1-8 fix):** Every successful provider write (POST/PATCH/DELETE/test) clears BOTH the specific `credentialId` key AND the `'active'` key. This ensures that switching the active provider immediately affects all callers that use `credentialId=undefined`. Implementation: the invalidation bus handler always clears `'active'` plus any provided `credentialId`; do NOT try to be selective.

### 7.3.1 Provider invalidation bus (PR B)

New module `packages/control-plane/src/memory/provider-invalidation-bus.ts` — Node `EventEmitter` singleton. One event type: `provider.changed` carrying `{ credentialId?: string; deletedId?: string }`.

**Subscription lifecycle (P1-15 fix):** The cache module registers **exactly one listener** at module initialization (module-load time side effect). It does NOT subscribe per request or per factory call. Export a `resetBusForTesting()` function that removes the listener and clears the cache map — used in test `afterEach` to prevent listener accumulation. The module-level listener count must never exceed 1; add a `bus.setMaxListeners(2)` guard (1 cache listener + 1 test listener) to catch regressions.

`memoryProvidersRoutes` emits `provider.changed` after every successful POST/PATCH/DELETE/`/:id/test`.

### 7.3.2 Memory runtime rewiring (PR B) — full list (P0-5, P0-6 fixes)

All memory runtime surfaces switch off boot-time `LITELLM_URL` injection. **Complete file list** (v3 was missing drawer search files):

- `packages/control-plane/src/index.ts` — drop the `if (LITELLM_URL) { embeddingClient = ... }` block.
- `packages/control-plane/src/memory/memory-search.ts` — constructor takes `() => Promise<ResolvedEmbeddingClient>` getter.
- `packages/control-plane/src/memory/memory-store.ts` — `addFact` calls factory through cache; **writes `resolved.model` to `content_model`** — NOT `DEFAULT_CONTENT_MODEL`. (P0-6 fix: hardcoded default was the bug.)
- `packages/control-plane/src/memory/memory-drawer-store.ts` — `writeSource` calls factory; **writes `resolved.model` to `embedding_model`** — NOT `MEMORY_EMBEDDING_MODEL`. (P0-6 fix.)
- `packages/control-plane/src/memory/memory-drawer-search.ts` — **newly rewired in PR B** (P0-5 fix: missing from v3). Uses factory getter; applies `embedding IS NOT NULL AND embedding_model = $queryModel` to vector path.
- `packages/control-plane/src/api/routes/memory-drawers.ts` — **newly rewired in PR B** (P0-5 fix: missing from v3). Receives factory getter from `createServer`; passes to drawer search and drawer store.
- `packages/control-plane/src/api/routes/memory-facts.ts:285-290,681-690` — drawer fusion in facts routes uses factory getter (previously used boot-injected `embeddingClient`).
- `packages/control-plane/src/api/server.ts` — route registration passes factory getter, not raw `embeddingClient?`.

**Embedding write path model metadata tests (P0-6 fix):** Required tests for both `MemoryStore.addFact` and `MemoryDrawerStore.writeSource` with a non-default provider model (e.g., `gemini-embedding-001`): assert the written `content_model`/`embedding_model` equals `resolved.model`, not the hardcoded constant.

### 7.4 Cost accounting

| Kind | Cost model |
|---|---|
| `embedding-backfill` | `progress.costUsd += usage.promptTokens / 1e6 * priceUsdPerMtoken` via `embedBatchWithUsage` |
| `drawer-backfill` | same |
| `consolidation` | `costUsd = 0` — SQL-only, no external API |
| `synthesis` | `costUsd = 0` — SQL-only over existing embeddings |

**Missing `usage.promptTokens` fallback:** estimate `tokens ≈ Math.ceil(textLength / 4)` (4 chars per token — OpenAI heuristic). Set `progress.usageEstimated = true`. No `tiktoken` in v1.

## 8. `content_model` + `embedding_model` Lock and Search Predicate

**Model lock condition** (checked on provider PATCH/activate and on job creation):

```sql
SELECT content_model, COUNT(*) AS c
FROM memory_facts
WHERE embedding IS NOT NULL   -- only actually-embedded rows
GROUP BY content_model;
```

- 0 rows with embeddings → any provider allowed.
- 1 distinct `content_model` X → new provider must have `model = X`, else `MODEL_MISMATCH`.
- ≥ 2 distinct → DB already poisoned; banner + "Re-embed all" CTA (v1.1).

Same rule for `memory_drawers.embedding_model`. `MODEL_MISMATCH` is server-side enforced on POST `/api/memory/providers` and PATCH `/:id`.

**Unified search predicate (P0-7 fix):** v3 had three inconsistent policies (majority model, active model, fail-closed) with a dead `content_model IS NULL` clause (`content_model` is `NOT NULL DEFAULT`). v4 defines exactly one policy:

- **Vector path** (both facts and drawers): `embedding IS NOT NULL AND content_model = $queryModel` (facts), `embedding IS NOT NULL AND embedding_model = $queryModel` (drawers). `$queryModel` comes from `ResolvedEmbeddingClient.model`.
- **Non-vector paths** (BM25, graph, keyword): **no `content_model` filter**. These paths work with all facts regardless of embedding state and do not degrade when model switches.
- **`MIXED_MODEL_BLOCKED`** (503): fires on the vector path only when the result set would be empty AND the DB contains embedded rows with a different `content_model`. I.e.: `COUNT(*) WHERE embedding IS NOT NULL AND content_model = $queryModel` = 0 but `COUNT(*) WHERE embedding IS NOT NULL` > 0. This surfaces the real error rather than returning empty results silently.
- **`<MixedModelsBanner />`**: rendered when `memoryModelDistributionQuery()` returns ≥ 2 distinct embedded models. Text: "Memory facts were embedded with multiple models. Vector search is restricted to {activeModel}. Use /memory/operations to re-embed everything under one provider."

The `content_model IS NULL` clause is removed everywhere. BM25 and graph paths must not filter by `content_model`.

**Batch UPDATE SQL** (unchanged from v3 except `$2` is now always the factory-resolved model, not a hardcoded constant):

```sql
UPDATE memory_facts AS f
SET    embedding     = v.embedding::vector,
       content_model = $2        -- resolvedClient.model, not DEFAULT_CONTENT_MODEL
FROM   (SELECT id, embedding FROM jsonb_to_recordset($1::jsonb)
        AS x(id text, embedding text)) v
WHERE  f.id = v.id AND f.embedding IS NULL;
```

## 9. Runtime Credential Path Filter (PR A)

All reads/writes to `api_accounts` must filter by `credential_kind='runtime'`:

- `packages/control-plane/src/api/routes/accounts.ts` — GET `/`, POST, PATCH, DELETE, POST `/:id/test`.
- `packages/control-plane/src/scheduler/task-worker.ts:301-312`.
- `packages/control-plane/src/api/routes/sessions.ts:597-598,778-779,991-992,1168-1169,1597-1601`.
- `packages/control-plane/src/api/routes/oauth.ts`.
- `packages/control-plane/src/api/routes/settings.ts:81-83` — validates `defaultAccountId`; returns 422 `INVALID_ACCOUNT_KIND` if target row is `credential_kind='embedding'`. **Route and method (P1-2 fix):** this validation applies to `PUT /api/settings/defaults` with body `{ defaultAccountId }` — NOT `POST /api/settings`. The existing route is `PUT /api/settings/defaults` (verified: `packages/control-plane/src/api/routes/settings.ts:54-113`).
- `packages/control-plane/src/api/routes/agents.ts:333-419` — PATCH `/api/agents/:agentId` validates that the target `accountId` row exists and has `credential_kind='runtime'`; else 422 `INVALID_ACCOUNT_KIND`.
- `project_account_mappings` write path — same validation; else 422 `INVALID_ACCOUNT_KIND`.

PR A adds one failing test per site before implementing the filter.

## 10. Audit Logger (PR A interface + PR B/D implementation)

Dedicated `memory_ops_audit` table, LOCAL-ONLY:

```sql
-- Group D — memory_ops_audit
CREATE TABLE memory_ops_audit (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor     text NOT NULL,
  action    text NOT NULL,
  target    text NOT NULL,
  context   jsonb NOT NULL DEFAULT '{}'::jsonb,   -- max 64 KB; NEVER plaintext keys
  timestamp timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_ops_audit_action_ts ON memory_ops_audit (action, timestamp DESC);
CREATE INDEX idx_memory_ops_audit_target ON memory_ops_audit (target);
-- LOCAL-ONLY. NO sync_capture trigger. Not in TABLE_SYNC_CONFIG.
```

**Context redaction:** a shared `redactSensitiveKeys(obj)` helper removes any key whose name contains `key`, `token`, `secret`, `password`, `credential` (case-insensitive) from nested JSON before writing. Max context size: 64 KB (truncate to summary if exceeded). Required test: API keys and bearer tokens must not appear in written audit rows.

`MemoryOpsAuditLogger` interface — single `write(entry)` method. Action enum: `provider.{create,update,delete,rotate-key,test-ephemeral,test-succeeded,test-failed}` + `job.{create,cancel,complete,fail}`.

## 11. SSRF / Egress Controls

- **`baseUrl` not user-configurable.** Catalog-only; Zod `.strict()` blocks unknown fields.
- **`sourceRoot` restricted** to configured paths (§6.3).
- **Egress ack server-enforced** (§6.2); UI dialog is convenience only.
- **Redaction truth:** `redactMemoryWriteMetadata` + `sanitizeMemoryDrawerContent` cover drawer writes only. v1 transmits existing `memory_facts.content` to the provider as-is after operator egress confirmation. Documented in UI dialog copy.

## 12. Data Egress UI Copy

Before first `embedding-backfill` / `drawer-backfill`: show destination host (from catalog), estimated row count, estimated tokens + cost (from `egress_snapshot` returned in POST 201 response); warn plainly that existing fact content leaves the machine as-is; require explicit "I understand memory content will leave this machine" checkbox. Submit posts `egressConfirmed: true`. `sessionStorage['memory-ops-egress-ack:<credentialId>']='true'` skips the dialog on subsequent same-tab runs.

## 13. UI Surface

### 13.1 Settings → Memory & Embeddings (PR C — `minor` bump)

- File: `packages/web/src/views/settings/MemoryEmbeddingsSection.tsx` (new).
- Registered in `SettingsView.tsx` nav array (`:26-67`); uses `SettingsSection` wrapper (verified: `packages/web/src/views/settings/SettingsShell.tsx:56-82`). Section `id="memory-embeddings"`.
- Provider list via `useQuery(memoryProvidersQuery())` — `queryOptions()` pattern (verified: `queries.ts` + `MemoryBrowserView.tsx:166`).
- Add/Edit dialog: Test-before-save via `/test-ephemeral`; stores `signedToken` in dialog state; POST `/` includes `recentTestResult`. Edit + no key change → `/:id/test`. Edit + key changed → `/test-ephemeral`.
- Save banner: "This provider will only be available on this machine."

### 13.2 `/memory/operations` (PR F — `minor` bump)

- View: `packages/web/src/views/MemoryOperationsPage.tsx`.
- Route: `packages/web/src/app/memory/operations/page.tsx`.
- Sidebar: add to `MEMORY_NAV_ITEMS` in `packages/web/src/components/memory/MemorySidebar.tsx:13-40`.
- Layout: `<MissingEmbeddingAlert />`, egress dialog, 4 `<JobCard />` grid, `<RecentJobsTable />`, `<JobDetailDrawer />`.
- **JobCard disabled predicate:** see §6.2 for the per-kind rules. UI reads from `GET /api/memory/ops/capabilities`.
- Peer-owned jobs render read-only (no Cancel).

### 13.3 `<MissingEmbeddingAlert />`

Renders when: `useQuery(memoryProvidersQuery())` returns empty, OR active provider `metadata.lastTestOk === false`, OR `metadata.lastTestOk === null`. Non-dismissible. Links to `/settings#memory-embeddings`.

**Metadata casing (P2-4 fix):** DB columns use `snake_case` (`last_test_ok`, `last_test_error`); API and UI use `camelCase` (`lastTestOk`, `lastTestError`). The Drizzle schema + route serialization apply the transform. Alert checks `metadata.lastTestOk` (camelCase). PATCH matrix uses `lastTestOk`/`lastTestError` (camelCase in API).

### 13.4 Alert mount points — 10 views (8 with alert)

| View | File | Mount alert? |
|---|---|---|
| Memory Browser | `packages/web/src/views/MemoryBrowserView.tsx` | Yes |
| Memory Dashboard | `packages/web/src/views/MemoryDashboardView.tsx` | Yes |
| Memory Drawers | `packages/web/src/views/MemoryDrawersView.tsx` | Yes |
| Memory Import | `packages/web/src/views/MemoryImportView.tsx` | **No** |
| Memory Maintenance | `packages/web/src/views/MemoryMaintenancePage.tsx` | Yes |
| Memory Reports | `packages/web/src/views/MemoryReportsView.tsx` | Yes |
| Memory Scope Manager | `packages/web/src/views/MemoryScopeManagerView.tsx` | **No** |
| Memory Synthesis | `packages/web/src/views/MemorySynthesisPage.tsx` | Yes |
| Knowledge Graph | `packages/web/src/views/KnowledgeGraphView.tsx` | Yes |
| Consolidation Board | `packages/web/src/views/ConsolidationBoardView.tsx` | Yes |

### 13.5 Web API client

- Barrel: `packages/web/src/lib/api.ts`. Core helper: `request<T>(path, init)` at `core.ts:21`. `apiFetch` does not exist.
- New: `packages/web/src/lib/api/memory-providers.ts`, `packages/web/src/lib/api/memory-ops.ts`.
- Query helpers in `queries.ts` under `queryKeys.memory.*` namespace (verified: `queries.ts:159-181`).

## 14. Error Envelope and Status Map

**Flat envelope** (matches `server.ts:937-962` + `web/src/lib/api/core.ts:21-44`):

```jsonc
{ "error": "STABLE_CODE", "message": "human-readable", "details": { ... } }
```

**`details` vs `hint` (P2-3 fix):** v4 uses a typed `details` object (not a `hint` string). `details` is machine-readable JSON for codes that need structured client parsing. `ControlPlaneError.context` maps to `details` in the error responder. The `hint` field is dropped.

**Error responder extension (P0-8 fix):** PR B extends `controlPlaneErrorToStatus()` in `packages/control-plane/src/api/server.ts` to cover all memory-ops codes. The global handler emits `details` from `err.context`. Required additions to the status map:

| `error` code | HTTP | `details` shape |
|---|---|---|
| `VALIDATION_ERROR` | 422 | `{ issues: ZodIssue[] }` |
| `EMBEDDING_NO_PROVIDER` | 409 | `{}` |
| `PROVIDER_AUTH_FAILED` | 401 | `{}` |
| `PROVIDER_RATE_LIMITED` | 429 | `{}` |
| `RATE_LIMITED` | 429 | `{}` |
| `EMBEDDING_CREDENTIAL_DECRYPT_FAILED` | 500 | `{}` |
| `PROVIDER_HAS_ACTIVE_JOBS` | 409 | `{ blockingJobIds: string[] }` |
| `PROVIDER_NOT_FOUND` | 404 | `{}` |
| `JOB_NOT_FOUND` | 404 | `{}` |
| `JOB_NOT_CANCELLABLE` | 409 | `{}` |
| `REMOTE_PEER_JOB` | 403 | `{ executorMachineId: string }` |
| `JOB_ALREADY_RUNNING` | 409 | `{ existingJobId: string; existingMachine: string }` |
| `DUPLICATE_ACTIVE_EMBEDDING` | 409 | `{ constraint: string }` |
| `EGRESS_NOT_CONFIRMED` | 400 | `{}` |
| `FEATURE_DISABLED` | 400 | `{}` |
| `JOB_KIND_NOT_ENABLED` | 400 | `{ enabledKinds: string[] }` |
| `MODEL_MISMATCH` | 409 | `{ existingModel: string; incomingModel: string }` |
| `MIXED_MODEL_BLOCKED` | 503 | `{ queryModel: string; existingModels: string[] }` |
| `INVALID_ACCOUNT_KIND` | 422 | `{ expectedKind: 'runtime'; actualKind: string }` |
| `QUEUE_ENQUEUE_FAILED` | 500 | `{}` |

Every §14 status/code pair must have an API-level integration test asserting the HTTP status and `error` field. Tests for `details` content on codes with non-empty detail shapes.

## 15. Testing Strategy

- **Docker Postgres with pgvector** for integration tests. Reuse pattern from `packages/control-plane/src/memory/memory-store.test.ts`.
- **Playwright** for e2e: `packages/web/e2e/memory-ops/*.spec.ts`.
- Every PR: failing test → implementation → passing test → commit.
- **Coverage:** match or exceed each package's existing baseline; no regressions.

**Required integration tests (complete list — includes P1-13 additions):**

1. Partial unique index fires under concurrent active-inserts (Docker PG).
2. Batch UPDATE writes N rows in one round trip; updates both `embedding` and `content_model`; `content_model` = resolved provider model (not hardcoded constant).
3. `addFact` with non-default provider (e.g., `gemini-embedding-001`): assert written `content_model = 'gemini-embedding-001'`.
4. `writeSource` (drawer) with non-default provider: assert written `embedding_model = 'gemini-embedding-001'`.
5. Drawer search: uses factory, returns only rows where `embedding IS NOT NULL AND embedding_model = $queryModel`.
6. Fleet-wide exclusion: two simulated peers (different `MACHINE_ID`) both POST `embedding-backfill` with same scope — second returns 409 `JOB_ALREADY_RUNNING` (via fleet-check SELECT on shared jobs table).
7. Concurrent same-peer requests: advisory lock causes second concurrent POST to return 409 (not a duplicate INSERT).
8. **Outbox atomicity — Redis enqueue fails after DB commit:** simulate enqueue failure; assert job row has `status='failed'`, `error_code='QUEUE_ENQUEUE_FAILED'`.
9. **Outbox atomicity — DB commit fails:** assert no BullMQ job is left referencing a non-existent DB row (verify via `getJob(id)` returns null).
10. Scope canonicalization: omitted scope, blank scope, `'  FOO  '`, `'foo'` all collide with `normalizedScope='foo'`; second POST returns 409.
11. `credentialId` omitted at job creation: resolved active provider is persisted in `provider_kind`, `provider_model`, `credential_id`.
12. 401 response from stub provider → job `status='failed'`, `error_code='PROVIDER_AUTH_FAILED'`, provider `metadata.lastTestOk=false` (NOT `is_active=false`).
13. Cancelling mid-batch → `status='cancelled'`; cannot transition to `completed` afterward (terminal-transition invariant).
14. SSE reconnect with `Last-Event-Id: N` replays N+1..current including both `memory_ops_jobs` and `memory_ops_job_events` rows.
15. SSE notification fires on `memory_ops_job_events` insert (not only on `memory_ops_jobs` update).
16. Migration 0033 on populated `api_accounts` (existing runtime rows) completes; partial unique index does not fire on runtime rows; rollback removes all four table artifacts cleanly.
17. `PUT /api/settings/defaults` with `defaultAccountId` pointing at embedding-kind row → 422 `INVALID_ACCOUNT_KIND`.
18. `PATCH /api/agents/:id` with `accountId` pointing at embedding-kind row → 422 `INVALID_ACCOUNT_KIND`.
19. Every §14 error code returns the specified HTTP status; every `details`-bearing code returns the specified shape.
20. Provider invalidation bus: `resetBusForTesting()` removes listener and clears cache; factory re-resolves after active provider change.
21. Bus listener count after 1000 factory calls: still exactly 1.
22. `sourceRoot` path traversal (`../`), symlink escape, absolute path outside allowed roots, oversized tree, disallowed extension — all return 422 `VALIDATION_ERROR` with `context.sourceRootViolation`.
23. Gemini Gate 1: fake API key to `generativelanguage.googleapis.com/v1beta/openai/embeddings` returns 401 (not 404).

**Required e2e (Playwright):**
1. OpenAI full journey: Settings → Add → Test pre-save → Save → confirm egress → Run embedding-backfill → see progress → `/memory/maintenance` non-empty.
2. Gemini full journey: stubbed at `https://generativelanguage.googleapis.com/v1beta/openai/embeddings`. Asserts `output_dimensionality:1536` in request body.
3. Alert coverage: no provider → `MissingEmbeddingAlert` on all 8 target views; absent on Import + ScopeManager.

## 16. Rollout

| PR | Scope | Bump | Notes |
|---|---|---|---|
| **A** | Migration `0033_add_memory_ops.sql` (groups A–D) + `.down.sql`; Drizzle schema; `TABLE_SYNC_CONFIG`; `EmbeddingClient` additive; runtime `credential_kind='runtime'` filter (accounts/sessions/task-worker/oauth/settings/agents); `MemoryOpsAuditLogger` interface; catalog + shared types (providers, ops, ops-audit). **Gemini Gate 1 test must pass before merge.** | patch | Critical path |
| **B** | `embedding-client-factory.ts` + cache; `provider-invalidation-bus.ts`; `/api/memory/providers` routes (MODEL_MISMATCH server gate, pgPool injection); audit-logger impl for provider events; rewire ALL memory runtime surfaces (§7.3.2 full list, including drawer search); PR B extends `controlPlaneErrorToStatus()` for all memory-ops codes; `.env.example` += `MEMORY_OPS_SIGNING_SECRET`; coverage baseline committed | patch | Critical path |
| **C** | Settings → Memory & Embeddings UI | minor | Critical path |
| **D** | memory-ops BullMQ queue + JobsRepository + JobEventsRepository + `/api/memory/ops/jobs` CRUD + `/api/memory/ops/capabilities` route + SSE; `ENABLED_JOB_KINDS = new Set()` on ship; log-retention extension | patch | Critical path |
| **E** | `embedding-backfill` + `drawer-backfill` handlers + worker boot + cost tracker; `ENABLED_JOB_KINDS` expands to backfill kinds; `.env.example` += `MEMORY_OPS_ENABLED=false`, `MEMORY_OPS_MAX_FAIL_RATIO=0.05`, `MEMORY_OPS_DRAWER_SOURCE_ROOTS` | patch | Critical path — 19k backfill available via API with operator-set `MEMORY_OPS_ENABLED=true` |
| **F** | `/memory/operations` page + 8 `MissingEmbeddingAlert` mounts + `<MixedModelsBanner />` + sidebar + egress dialog; `.env.example` flips `MEMORY_OPS_ENABLED=true`; audit logger for job events | minor | Non-critical |
| **G** | `consolidation` + `synthesis` handlers (costUsd=0, SQL-only); `ENABLED_JOB_KINDS` expands to all four; Playwright e2e (3 specs); Gemini Gate 2 test (if `GEMINI_API_KEY` available in CI); CHANGELOG + runbook | patch | Non-critical |

**Rollback:** PR A+B revertible via `0033_add_memory_ops.down.sql`. Before PR F, `MEMORY_OPS_ENABLED=false` makes reverting PR E trivially safe. After PR F flips the default, set `MEMORY_OPS_ENABLED=false` and drain queue before reverting PR E.

## 17. Operational Runbook

Ships with PR G's release notes.

**Normal ops:**
- Pause enqueues: `export MEMORY_OPS_ENABLED=false; pm2 restart <process>`.
- Force-fail stuck running jobs (after stopping worker): `UPDATE memory_ops_jobs SET status='failed', error_code='MANUAL_FAIL', finished_at=now() WHERE status='running' AND executor_machine_id=$machineId`.
- Purge events: `DELETE FROM memory_ops_job_events WHERE created_at < now() - interval '14 days'` (handled by `log-retention.ts`).

**Origin-offline stuck-job runbook (P1-14 fix):** If peer A goes offline with a `queued` or `running` job, peer B sees the job as read-only. Steps to recover:

1. Identify stuck jobs: `SELECT id, kind, status, executor_machine_id, created_at FROM memory_ops_jobs WHERE status IN ('queued','running') AND executor_machine_id = '<offline-machine-id>'`.
2. If `status='queued'` (worker never started): the job is safe to cancel or force-fail. `UPDATE memory_ops_jobs SET status='cancelled', finished_at=now() WHERE id=$id AND status='queued'`. Then POST a new job on the current peer.
3. If `status='running'` (worker was in progress): the embedding writes may be partial. Force-fail with `error_code='EXECUTOR_OFFLINE'`, then POST a new job. The new job's `WHERE f.embedding IS NULL` guard skips already-embedded rows.
4. UI copy for read-only remote jobs: "This job was created on {machine} which is currently offline. To restart, contact {machine} or use the admin force-fail runbook."

**Re-embed all (v1.1 not shipped; manual workaround):**
```sql
-- ⚠️ FLEET-WIDE IMPACT. memory_facts is mesh-synced. Nulling propagates to all peers.
-- Stop all CPs in fleet before running.
UPDATE memory_facts SET embedding = NULL WHERE content_model = '<old-model>';
UPDATE memory_drawers SET embedding = NULL WHERE embedding_model = '<old-model>';
```
Then enable new provider and POST `embedding-backfill`.

**PM2 process names** (verified from `infra/pm2/ecosystem.*.config.cjs`):

| Tier | Process name | Redis DB |
|---|---|---|
| beta | `agentctl-cp-beta` | 0 |
| dev-1 | `agentctl-cp-dev1` | 1 |
| dev-2 | `agentctl-cp-dev2` | 2 |

## 18. Acceptance Criteria

- Settings → Add OpenAI provider → Test shows `dim=1536, costUsd > 0, latencyMs > 0` before Save.
- With no provider, `<MissingEmbeddingAlert />` renders on all 8 target views; absent on Memory Import + ScopeManager.
- With active provider + ≥ 1 fact with `embedding IS NULL`, `embedding-backfill`:
  - writes both `embedding` and `content_model` (= active provider model) per fact;
  - `progress.embedded`, `progress.processed`, `progress.costUsd` monotonically increase;
  - ends `status='completed'` when `failed / total < 0.05`; else `status='failed'`.
- Deleting active provider with running job → 409 `PROVIDER_HAS_ACTIVE_JOBS` + `details.blockingJobIds`. After cancel → 204.
- Two concurrent POST `/providers { active:true }` → one 201, one 409 `DUPLICATE_ACTIVE_EMBEDDING`.
- Rotating key resets `lastTestOk=null`, clears `lastTestError`, bumps `updated_at`.
- OpenAI 401 mid-job → job `status='failed'`, `error_code='PROVIDER_AUTH_FAILED'`; provider `metadata.lastTestOk=false`; `is_active` unchanged.
- Cancel mid-batch → `status='cancelled'`; terminal invariant holds.
- SSE reconnect with `Last-Event-Id: N` on same peer → replays N+1..current.
- Provider on A not visible on B (expected). Job on A → `executor_machine_id=A`; visible on B as read-only.
- POST /jobs without `egressConfirmed:true` for backfill → 400 `EGRESS_NOT_CONFIRMED`.
- POST /jobs with `MEMORY_OPS_ENABLED=false` → 400 `FEATURE_DISABLED`.
- Migration 0033 on existing runtime rows: all rows end with `credential_kind='runtime'`; partial unique index does not fire. Migration on 19k-row `memory_facts` table: no embedding data touched.
- `PUT /api/settings/defaults` with `defaultAccountId` targeting embedding-kind row → 422 `INVALID_ACCOUNT_KIND`.
- `PATCH /api/agents/:id` with `accountId` targeting embedding-kind row → 422 `INVALID_ACCOUNT_KIND`.
- **Performance (P1-12 fix):** dedicated `addFact` benchmark (NOT measured during backfill, since backfill uses batch UPDATE not `addFact`). Benchmark: 1,000 sequential `addFact` calls with warm factory cache and a stub provider. P99 latency ≤ baseline + 15%. Baseline committed in `docs/superpowers/specs/2026-04-24-memory-operations-ui-coverage-baseline.md` by PR B. Benchmark command, hardware tier, and sample size documented in that file.
- Manual performance target (PR G records): 19,226 facts → OpenAI `text-embedding-3-small`, median < 10 min, cost ~$0.05–$0.10.

## 19. Risks

| Risk | Mitigation |
|---|---|
| Cross-machine write-job race window (§5.2) | `WHERE f.embedding IS NULL` guard limits worst case to redundant no-op; v1.1 closes with Redis distributed lock |
| Gemini compat layer ignores `output_dimensionality` | Gate 2 test catches before GA; fallback to `gemini-embedding-2-preview` (native 1536) |
| Price catalog drift | Quarterly PR; cost column is historical (captured at job time) |
| Mesh peer on old schema | `sync_nodes_schema_ahead_rejection` (migration 0027) rejects cross-version sync |
| Worker crash during long backfill | Boot reconciliation marks jobs failed; v1.1: resumable via `progress.currentBatch` |
| In-process worker blocks Fastify event loop | BullMQ async iteration; all DB calls are async; monitor P99 API latency during 19k backfill in dev-1 |

---

## Appendix A — Files created/modified per PR

All paths verified against worktree head. Convention: every `.ts` → `.test.ts`; every `.tsx` → `.test.tsx`.

**PR A:**
- `packages/control-plane/drizzle/0033_add_memory_ops.sql` + `.down.sql`
- `packages/control-plane/drizzle/meta/_journal.json`
- `packages/control-plane/src/db/schema.ts` (apiAccounts cols + memoryOpsJobs w/ provider snapshot cols + memoryOpsJobEvents + memoryOpsAudit)
- `packages/shared/src/types/sync.ts` (TABLE_SYNC_CONFIG += memory_ops_jobs)
- `packages/shared/src/memory/providers.ts`, `ops.ts`, `ops-audit.ts`
- `packages/control-plane/src/memory/embedding-client.ts` (additive)
- Runtime-kind filter: `src/api/routes/{accounts,sessions,oauth,settings,agents}.ts`, `src/scheduler/task-worker.ts`
- Gemini Gate 1 contract test

**PR B:**
- `src/memory/embedding-client-factory.ts` + cache + bus
- `src/memory/provider-invalidation-bus.ts`
- `src/api/routes/memory-providers.ts` (MODEL_MISMATCH gate, pgPool injection)
- `src/memory/ops/audit-logger.ts`
- Rewired (factory getter, resolved model written): `src/memory/{memory-search,memory-store,memory-drawer-store,memory-drawer-search}.ts`
- Newly rewired in PR B: `src/api/routes/memory-drawers.ts`, `src/api/routes/memory-facts.ts` (drawer fusion)
- `src/api/server.ts` (passes factory getter; extends controlPlaneErrorToStatus)
- `src/index.ts` (drop LITELLM_URL block)
- `.env.example` += `MEMORY_OPS_SIGNING_SECRET`
- `docs/superpowers/specs/2026-04-24-memory-operations-ui-coverage-baseline.md`

**PR C** (minor): `packages/web/src/lib/api/memory-providers.ts`; `src/components/memory/ProviderDialog.tsx`; `src/views/settings/MemoryEmbeddingsSection.tsx`; `src/views/SettingsView.tsx`; `src/lib/api.ts`; `src/lib/queries.ts`.

**PR D:** `src/memory/ops/{queue,jobs-repository,job-events-repository,sse-stream,worker-runtime}.ts`; `src/api/routes/memory-ops.ts` (incl. `/capabilities` route at `/api/memory/ops/capabilities`; empty ENABLED_JOB_KINDS); `src/api/server.ts`; `src/index.ts` (queue boot); `src/audit/log-retention.ts` (events + audit retention).

**PR E:** `src/memory/ops/{embedding-backfill,drawer-backfill,worker,cost-tracker}.ts`; `src/memory/ops/e2e.test.ts`; `src/index.ts` (worker boot); ENABLED_JOB_KINDS expands; `.env.example` += `MEMORY_OPS_ENABLED=false`, `MEMORY_OPS_MAX_FAIL_RATIO=0.05`, `MEMORY_OPS_DRAWER_SOURCE_ROOTS`.

**PR F** (minor): `packages/web/src/lib/api/memory-ops.ts`; `src/components/memory/{JobCard,RecentJobsTable,JobDetailDrawer,MissingEmbeddingAlert,MixedModelsBanner,EgressConfirmationDialog}.tsx`; `src/views/MemoryOperationsPage.tsx`; `src/app/memory/operations/page.tsx`; `src/components/memory/MemorySidebar.tsx`; 8-view alert mounts; `src/lib/queries.ts` (ops hooks); `.env.example` flip.

**PR G:** `src/memory/ops/{consolidation,synthesis,catalog-smoke}.ts`; `packages/web/e2e/memory-ops/{openai-happy,gemini-happy,missing-embedding-alert}.spec.ts`; Gemini Gate 2 test (optional, `GEMINI_API_KEY` required); `CHANGELOG.md`; `docs/QUICKSTART.md`.

---

## Appendix B — Round-2 reviewer traceability

All Round-2 P0s (12 R1 + 18 R2 = 30) dispositioned Fix. See `docs/superpowers/reviews/2026-04-24-memory-operations-ui-v2-reviewer-checklist.md`.

---

## Appendix C — Round-3 reviewer disposition

All 15 unique round-3 P0s patched in v3 (unchanged in v4). See v3 Appendix C for mapping.

**Note:** Appendix C is a traceability record, not proof of readiness. v3 had 12 additional P0s in round-4 review despite Appendix C claiming closure. (P2-8 fix.)

---

## Appendix D — Round-4 reviewer disposition

Round-4 reviews on v3: [R1](../reviews/2026-04-24-memory-operations-ui-design-v3-strict-review.md) (12 P0, 15 P1, 8 P2) + [R2](../reviews/2026-04-24-memory-operations-ui-design-v3-strict-review-round-2.md) (4 P0, 12 P1, 30 P2).

### R1 P0 (12) — all fixed in v4

| # | Issue | v4 fix |
|---|---|---|
| 1 | Cross-peer concurrent write-job corrupts shared embeddings | §5.2 fleet-wide exclusion for write kinds via mesh-synced jobs table SELECT |
| 2 | Redis enqueue inside PG transaction = false atomicity | §5.2 outbox pattern: DB commit first, then enqueue; failure → status=failed |
| 3 | Scope NULL vs empty string bypasses duplicate detection | §5.2 always store `params.scope=normalizedScope`; COALESCE in query |
| 4 | Job creation doesn't persist provider snapshot | §5.2 + §5.4: `provider_kind`, `provider_model`, `provider_host`, `egress_snapshot` columns; resolved at INSERT |
| 5 | Drawer search missing from PR B rewiring | §7.3.2 + Appendix A PR B: `memory-drawer-search.ts` + `routes/memory-drawers.ts` |
| 6 | `addFact`/`writeSource` write hardcoded default model | §7.3.2: write `resolved.model`, not `DEFAULT_CONTENT_MODEL`/`MEMORY_EMBEDDING_MODEL` |
| 7 | Three contradictory search policies; dead IS NULL predicate | §8: single policy — vector=`IS NOT NULL AND model=$q`; non-vector=no model filter |
| 8 | Error codes map to 500; server doesn't emit `details` | §14 + PR B: extend `controlPlaneErrorToStatus()`; emit `details` from `err.context` |
| 9 | Capabilities URL inconsistent; disabled predicate contradicts §5.2 | §6.2: single URL `GET /api/memory/ops/capabilities`; per-kind disabled rules table |
| 10 | `drawer-backfill.sourceRoot` is arbitrary file exfiltration | §6.3: restricted to `MEMORY_OPS_DRAWER_SOURCE_ROOTS`; realpath + allowlist |
| 11 | Gemini gate: fake key can't prove dimension count | §6.3: Gate 1 (fake key→401) + Gate 2 (real key→dim check, CI secret) |
| 12 | Rollback SQL missing `DROP TABLE memory_ops_audit` | §5.5: added |

### R1 P1 (15) — all fixed in v4

| # | v4 fix |
|---|---|
| 1 | `JOB_NOT_FOUND` added to §14; routes use it (not `PROVIDER_NOT_FOUND`) |
| 2 | Settings route: `PUT /api/settings/defaults` + `defaultAccountId` (§9, §18) |
| 3 | `processed`=rows (not batches); `usageEstimated?: boolean` in progress shape (§5.2) |
| 4 | `pg_notify` after job events inserts too; `payload jsonb` column for overflow (§5.3) |
| 5 | `recentTestResult` token binds to `apiKeyFingerprint`; PATCH validates fingerprint (§6.1) |
| 6 | `/test-ephemeral` rate limit: 5/min per IP; missing secret = boot fail (§6.1) |
| 7 | Server computes + persists egress snapshot at job creation; worker uses stored `credential_id` (§6.2) |
| 8 | Cache invalidation always clears `'active'` key on any provider write (§7.3) |
| 9 | Manual test 401: marks metadata unhealthy only; does NOT flip `is_active` (§6.1) |
| 10 | Provider routes receive `pgPool` for raw SQL model-distribution check (§6, Appendix A) |
| 11 | Per-kind `requiresProvider` matrix in §6.2; consolidation/synthesis never raise `EMBEDDING_NO_PROVIDER` |
| 12 | P99 benchmark on `addFact` (not during backfill); command + hardware specified in §18 |
| 13 | 23 required integration tests including all new failure modes (§15) |
| 14 | Origin-offline stuck-job runbook in §17 |
| 15 | Bus: one listener at module init; `resetBusForTesting()` exported (§7.3.1) |

### R1 P2 (8) — all fixed in v4

| # | v4 fix |
|---|---|
| 1 | `getMachineId()` cited from `sync/machine-identity.ts:11` (§4) |
| 2 | `/test-ephemeral` "No persistence" → no provider row; audit row IS written (§6.1) |
| 3 | `hint` → typed `details` object; convention documented (§14) |
| 4 | DB snake_case, API/UI camelCase; transform documented (§13.3) |
| 5 | `executor_machine_id` NOT NULL in v1 schema (§5.2, §5.4) |
| 6 | Advisory lock collision acknowledged (§5.2) |
| 7 | `result` ≤ 16 KB; audit context ≤ 64 KB; `redactSensitiveKeys` helper (§10) |
| 8 | Appendix C is traceability only, not proof of readiness (§Appendix C note) |

### R2 P0 (4) — all overlap with R1; fixed above

| # | v4 fix |
|---|---|
| 1 | DROP TABLE memory_ops_audit in rollback → §5.5 |
| 2 | JOB_NOT_FOUND 404 on job routes → §6.2, §14 |
| 3 | JobCard disabled predicate contradiction → §6.2 per-kind table |
| 4 | Stale "two CPs - only one wins" integration test → §15 test 6 (rewritten for v4 fleet-exclusion model) |
