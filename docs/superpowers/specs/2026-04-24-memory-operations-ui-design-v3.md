# Memory Operations UI — v3 Design (third rewrite)

> **Status:** ⚠️ SUPERSEDED by [v4](./2026-04-24-memory-operations-ui-design-v4.md). Round-4 reviews found 12 P0 blockers; v4 addresses all of them.
> **v2 → v3 delta:** Both round-3 reviewers flagged v2 as "close, not yet": [Reviewer 1 round 3](../reviews/2026-04-24-memory-operations-ui-design-v2-strict-review.md) (8 P0, 12 P1, 7 P2), [Reviewer 2 round 3](../reviews/2026-04-24-memory-operations-ui-design-v2-strict-review-round-2.md) (7 P0 + §A's 16 kept wins). v3 patches all 15 unique round-3 P0s without altering the architectural spine. Appendix C is the round-3 disposition log.
> **Companion anchor files in this repo:**
> - Reviewer checklist: `docs/superpowers/reviews/2026-04-24-memory-operations-ui-v2-reviewer-checklist.md`
> - Verified facts (item 37 corrected 2026-04-24): `docs/superpowers/reviews/2026-04-24-memory-operations-ui-v2-verified-facts.md`

## 1. Problem

`memory_facts` rows with `embedding IS NULL`: 19,226 on the operator's laptop as of 2026-04-24; drawers and edges not populated. **Semantic/vector-dependent** surfaces on `/memory/graph`, drawer search, `MemorySearch.vectorSearch`, and consolidation's near-duplicate detection are therefore empty or degraded. Non-vector features of `MemoryMaintenance.run` (stale paths, deleted files, coverage gaps) and `MemorySynthesis.runSynthesis` (lint grouping) DO function without a provider; the degradation is partial, not total. (Narrows v2 overclaim per R1b P2-1.)

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
- Cost budgets / kill-switches at provider level (v1 records cost; does not enforce caps).
- Scheduled/cron maintenance runs.
- Multiple simultaneously active embedding providers.
- Hash-chained audit log. Current CP has no hash-chain infrastructure (verified: no `hashChain`, `audit_chain`, `prev_hash` in `packages/control-plane/src/`). v1 writes structured audit rows; chaining deferred.
- Resumable worker after CP crash. v1 marks in-flight jobs `failed` on reboot; resume is v1.1.

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
│ Control plane (Fastify, per-machine, guard = db+encryptionKey)   │
│                                                                  │
│  /api/memory/providers           CRUD + /test + /test-ephemeral  │
│  /api/memory/ops/jobs            CRUD + /cancel + /stream        │
│             │                                                    │
│             ▼                                                    │
│  memory-ops BullMQ Worker  (in-process with CP, concurrency=1)   │
│    handlers: embedding-backfill, drawer-backfill,                │
│              consolidation, synthesis                            │
│             │                                                    │
│             ▼                                                    │
│  resolveEmbeddingClient(pool, encKey, credentialId?)             │
│  Used by: memory-ops workers, MemorySearch, MemoryStore.addFact, │
│           drawer-store writes  (§7.3 replaces LITELLM_URL path)  │
└──────────────────────────────────────────────────┬───────────────┘
                                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│ PostgreSQL                                                       │
│  api_accounts (+ credential_kind, + credential_last4)            │
│  memory_ops_jobs (mesh-synced mutable, origin+executor columns)  │
│  memory_ops_job_events (LOCAL-ONLY — SSE replay is same-peer)    │
│  memory_facts.embedding / content_model (raw SQL only;           │
│    Drizzle schema omits the vector column; verified              │
│    schema.ts:354-375)                                            │
│  memory_drawers.embedding / embedding_model                      │
└──────────────────────────────────────────────────────────────────┘
```

**Concurrency story.** BullMQ queue is namespaced per Redis DB. The per-tier `REDIS_URL` encodes the DB number (see `packages/control-plane/src/utils/tier-config.ts:99` `extractRedisDb` + test fixtures in `tier-config.test.ts:84,123,139`). Current fleet layout: beta → DB 0, dev-1 → DB 1, dev-2 → DB 2, configured via PM2 ecosystem configs. Each tier runs exactly one CP process with one worker at global `concurrency=1` — **all four job kinds share a single queue; at most one job runs per CP at any time.** Cross-peer duplicate protection is via `memory_ops_jobs.executor_machine_id` + conditional-claim UPDATE (§5.2), not Redis. (Fixes R2b P1-17 + P2-51.)

**Worker process model.** In-process with CP for v1. Boot-time reconciliation: `UPDATE memory_ops_jobs SET status='failed', error_code='CP_RESTART_DURING_RUN', finished_at=now() WHERE status='running' AND executor_machine_id = $machineId`. Crash-resumable execution is v1.1.

`$machineId` throughout this spec means `getMachineId()` from `packages/control-plane/src/index.ts:242-244` — the helper that consults `MACHINE_ID` env + hostname fallback. Never read `process.env.MACHINE_ID` directly (R2b P1-24).

## 5. Data Model

### 5.1 `api_accounts` extensions

Table: `packages/control-plane/src/db/schema.ts:443` (`apiAccounts`). Local-only per `sync.ts:182`.

Existing columns: `id uuid`, `name text`, `provider text`, `credential text`, `credential_iv text`, `priority int`, `rate_limit jsonb`, `is_active bool`, `metadata jsonb`, `created_at`, `updated_at`.

**Migration `0033_add_memory_ops.sql` (PR A, single file, three statement groups):**

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
- `credential_kind` lands in **PR A**, same PR as the runtime-filter code that depends on it (fixes [R1b P0#2, R2b P0-1]).
- `credential_last4` is populated on INSERT/PATCH-with-new-key. PATCH without `apiKey` leaves it untouched.
- Partial unique index is a DB invariant for single-active-embedding — not API-layer race prevention. Loser sees Postgres `SQLSTATE 23505` → route maps to `409 DUPLICATE_ACTIVE_EMBEDDING` (§14).
- Existing runtime rows default to `credential_kind='runtime'`; no behavior change.

### 5.2 `memory_ops_jobs` (new, mesh-synced mutable)

```sql
-- Group B — memory_ops_jobs
CREATE TABLE memory_ops_jobs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                   text NOT NULL
                         CHECK (kind IN ('embedding-backfill','drawer-backfill',
                                         'consolidation','synthesis')),
  status                 text NOT NULL
                         CHECK (status IN ('queued','running','completed',
                                           'failed','cancelled')),
  params                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress               jsonb NOT NULL
                         DEFAULT '{"processed":0,"embedded":0,"failed":0,"total":0,"costUsd":0}'::jsonb,
  result                 jsonb,
  error                  text,
  error_code             text,          -- structured code for UI parsing
  credential_id          uuid,          -- no FK; api_accounts is local-only
  origin_machine_id      text NOT NULL, -- identifies the peer that created the job
  executor_machine_id    text,          -- peer that claims + runs; NULL = unclaimed
  started_at             timestamptz,
  finished_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  egress_confirmed_at    timestamptz,   -- server-recorded egress ack
  egress_confirmed_by    text
);

CREATE INDEX idx_memory_ops_jobs_status_executor
  ON memory_ops_jobs (status, executor_machine_id);
CREATE INDEX idx_memory_ops_jobs_kind_created
  ON memory_ops_jobs (kind, created_at DESC);

-- Column-level trigger: only fire mesh-sync on status / result / finished_at changes,
-- NOT on progress updates (which happen ~192× per 19k-row backfill).
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

`SYNCED_TABLES` derives automatically (sync.ts:190-192). `TABLE_PK_COLUMN` defaults to `'id'`; no entry needed.

**Progress shape (fixes [R1b P1#16, R2b §B P0-15 partial]):**

```typescript
type MemoryOpsProgress = {
  processed: number; // batches attempted
  embedded: number;  // successfully written
  failed: number;    // per-fact failures within retry budget
  total: number;     // eligible work snapshot at job start
  costUsd: number;   // accumulated across all four handler kinds
  etaSeconds?: number;
  currentBatch?: number;
};
```

**Mesh ownership (fixes [R1b P0#1 round-3], which caught v2 letting any peer claim an unowned job):**
- `POST /jobs` sets BOTH `origin_machine_id = getMachineId()` AND `executor_machine_id = getMachineId()` at insert time. v1 does NOT permit cross-peer job execution; every job runs on its origin peer.
- Worker claim UPDATE: `UPDATE memory_ops_jobs SET status='running', started_at=now() WHERE id=$jobId AND status='queued' AND executor_machine_id=$machineId`. Losers get 0 rows and abort.
- Peer UI renders `executor_machine_id != LOCAL` as read-only (no Run, no Cancel for remote). Cross-peer takeover is an explicit v1.1 feature, not a race outcome.
- JobCard disables `Run now` when (a) local has no active provider AND kind requires one, (b) kind is not in the local `ENABLED_JOB_KINDS` set (§6.2), OR (c) a job of the same kind/scope is already running locally. Cross-peer "running" visibility is informational only — a second peer CAN run a job of the same kind/scope since each peer has its own queue and provider.

**Advisory lock at enqueue (fixes [R2b P0-1, R1b P0#2 round-3]):**

The lock MUST run inside an explicit `db.transaction(...)`. `pool.query` runs autocommit and releases `pg_advisory_xact_lock` immediately (the v2 bug). Use `pg_try_advisory_xact_lock` (non-blocking) + 409 on false so `JOB_ALREADY_RUNNING` actually raises.

The POST handler runs, inside one transaction: (1) `SELECT pg_try_advisory_xact_lock(hashtext('memory-ops:' || $kind || ':' || $normalizedScope)::bigint) AS acquired` — if `false`, throw `ControlPlaneError('JOB_ALREADY_RUNNING')`; (2) SELECT for existing `queued|running` job on same `(kind, executor_machine_id=getMachineId(), params->>'scope' = $normalizedScope)` — if found, throw the same error with `jobId`; (3) INSERT `memory_ops_jobs` row with `executor_machine_id=getMachineId()`; (4) enqueue BullMQ job. All four steps in one Drizzle transaction. Pattern mirrors `packages/control-plane/src/sync/apply-change.ts:180` (precedent uses the same `db.transaction()` + `tx.execute(sql\`...\`)` + `::bigint` idiom).

Cross-peer protection is NOT the lock's job — that's `executor_machine_id` + claim UPDATE (above).

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
  message    text,
  progress   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_ops_job_events_job ON memory_ops_job_events (job_id, event_id);
CREATE INDEX idx_memory_ops_job_events_created ON memory_ops_job_events (created_at);
-- NO sync_capture trigger. Table NOT added to TABLE_SYNC_CONFIG.
```

Design decision (fixes [R1b P0#11, R2b P0-6]):
- Events **do not mesh-sync**. SSE `Last-Event-Id` replay is same-peer only.
- Single CP per machine; the UI reconnects to the same CP it started with. Operational reality matches the design.
- Dropping sync eliminates bigserial PK collision and FK-ordering-on-apply concerns.

**Size caps (fixes [R2b P2-40]):**
- `message` max 512 chars — application-level truncation before INSERT.
- `progress` is bounded by the struct shape (~100 bytes).
- `memory_ops_jobs.result` has a 16 KB soft cap — overflow writes a summary to `result` and full payload as an `event_type='log'` row.

**Retention (fixes [R2b P2-41]):**
- 14-day retention via extension of `packages/control-plane/src/audit/log-retention.ts`.
- PR D modifies that file to add a `memoryOpsEventRetentionDays` config + DELETE query.

### 5.4 Drizzle schema additions (PR A)

`apiAccounts` (near existing columns):

```typescript
credentialKind: text('credential_kind').notNull().default('runtime'),
credentialLast4: text('credential_last4'),
```

`memoryOpsJobs` (new table — `memory_facts.embedding` remains raw-SQL-only per the project convention at `memory-store.ts:231,606`):

```typescript
export const memoryOpsJobs = pgTable(
  'memory_ops_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    params: jsonb('params').notNull().default(sql`'{}'::jsonb`),
    progress: jsonb('progress').notNull().default(
      sql`'{"processed":0,"embedded":0,"failed":0,"total":0,"costUsd":0}'::jsonb`,
    ),
    result: jsonb('result'),
    error: text('error'),
    errorCode: text('error_code'),
    credentialId: uuid('credential_id'),
    originMachineId: text('origin_machine_id').notNull(),
    executorMachineId: text('executor_machine_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    egressConfirmedAt: timestamp('egress_confirmed_at', { withTimezone: true }),
    egressConfirmedBy: text('egress_confirmed_by'),
  },
  (table) => [
    index('idx_memory_ops_jobs_status_executor').on(table.status, table.executorMachineId),
    index('idx_memory_ops_jobs_kind_created').on(table.kind, table.createdAt),
  ],
);
```

`memoryOpsJobEvents` similar shape; `eventId` is `bigserial` → use Drizzle `bigserial()` or `bigint` + sequence.

### 5.5 Migration rollback (fixes [R2b P1-31])

`0033_add_memory_ops.down.sql` — manual runbook, not auto-applied (Drizzle doesn't auto-run downs):

```sql
DROP TABLE IF EXISTS memory_ops_job_events;
DROP TABLE IF EXISTS memory_ops_jobs;
DROP INDEX IF EXISTS api_accounts_one_active_embedding;
DROP INDEX IF EXISTS idx_api_accounts_kind;
ALTER TABLE api_accounts
  DROP COLUMN IF EXISTS credential_last4,
  DROP CONSTRAINT IF EXISTS api_accounts_kind_check,
  DROP COLUMN IF EXISTS credential_kind;
```

## 6. API Contract

All routes are registered in `server.ts` under the existing `db + encryptionKey` guard — same pattern as `accountRoutes` (verified: `packages/control-plane/src/api/server.ts:828-847`).

### 6.1 `/api/memory/providers` (PR B)

```
GET    /                    -> 200 { providers: EmbeddingProvider[] }
                                order: is_active DESC, priority ASC, created_at ASC
POST   /                    -> 201 { provider: EmbeddingProvider }
                                409 DUPLICATE_ACTIVE_EMBEDDING on 23505 unique-violation
                                422 VALIDATION_ERROR on Zod failure
POST   /test-ephemeral      -> 200 { ok, dim, model, costUsd, latencyMs, signedToken }
                                401 PROVIDER_AUTH_FAILED
                                422 VALIDATION_ERROR
                                429 RATE_LIMITED (ours) | 429 PROVIDER_RATE_LIMITED (upstream)
                                  No persistence. signedToken = HMAC(secret, payloadHash),
                                  5-min TTL; POST / can accept it to carry test result.
PATCH  /:id                 -> 200 { provider }
                                404 PROVIDER_NOT_FOUND
                                409 PROVIDER_HAS_ACTIVE_JOBS when apiKey rotate OR deactivate
                                      with queued/running jobs referencing credential_id
                                422 VALIDATION_ERROR
DELETE /:id                 -> 204
                                404 PROVIDER_NOT_FOUND
                                409 PROVIDER_HAS_ACTIVE_JOBS (with blockingJobIds in body)
POST   /:id/test            -> 200 { ok, dim, model, costUsd, latencyMs }
                                401 PROVIDER_AUTH_FAILED (also deactivates row)
                                404 PROVIDER_NOT_FOUND
                                429 RATE_LIMITED (5/min per IP)
```

**PATCH field matrix (fixes [R2b P1-23 round-2, R2b P1-15 round-3]):**

| Field | Effect |
|---|---|
| `apiKey` provided | re-encrypt, recompute `credential_last4`, reset `last_test_ok=null` and `last_test_error=null` in metadata, bump `updated_at` |
| `name` | write name, bump `updated_at` |
| `model` | **if any `memory_facts.embedding IS NOT NULL` or `memory_drawers.embedding IS NOT NULL` has a different `content_model`/`embedding_model` than the incoming value → 409 `MODEL_MISMATCH` (see §8).** Else write into `metadata.model`, bump `updated_at`. Also 409 `PROVIDER_HAS_ACTIVE_JOBS` if queued/running jobs reference this credential. |
| `active=true` | flip target row active. **Server also runs the `MODEL_MISMATCH` check against the target provider's current `metadata.model`** (the UI-only v2 check was bypassable). DB partial unique index blocks conflict → SQLSTATE 23505 → 409 `DUPLICATE_ACTIVE_EMBEDDING` with `hint` = constraint name. |
| `active=false` | 409 `PROVIDER_HAS_ACTIVE_JOBS` with `hint = JSON.stringify({blockingJobIds})` if any queued/running job references this credential; else flip. |

POST `/` runs the same `MODEL_MISMATCH` gate as activate-flow when `active: true` in the payload. Server is the enforcer; UI is preflight only (fixes R1b P1#1).

**409 disambiguation (fixes [R2b P1-9]):** both `DUPLICATE_ACTIVE_EMBEDDING` and `PROVIDER_HAS_ACTIVE_JOBS` return 409. Differentiate via the `hint` field in the flat envelope: the former carries the constraint name; the latter carries JSON-encoded `{blockingJobIds}`.

**Request payloads:**

```jsonc
// POST / (create)
{
  "name": "OpenAI personal",
  "provider": "openai",                   // 'openai' | 'gemini'
  "model": "text-embedding-3-small",       // must match catalog
  "apiKey": "sk-...",                      // write-only
  "active": true,
  "recentTestResult": {                    // optional; from /test-ephemeral
    "ok": true,
    "dim": 1536,
    "model": "text-embedding-3-small",
    "costUsd": 0.00000002,
    "signedToken": "<HMAC token>",
    "testedAt": "2026-04-24T..."
  }
}

// POST /test-ephemeral — never persists
{
  "provider": "openai",
  "model": "text-embedding-3-small",
  "apiKey": "sk-..."
  // baseUrl derived from catalog; cannot be overridden
}
```

**Response shape (fixes [R1b P0#12] — flat envelope matches existing `server.ts:937-962` + `web/src/lib/api/core.ts:21-44`):**

```jsonc
// Success
{ "provider": { "id": "uuid", "name": "...", "apiKeyLast4": "...", ... } }

// Error — flat, matches existing project envelope
{ "error": "DUPLICATE_ACTIVE_EMBEDDING", "message": "...", "hint": "..." }
```

### 6.2 `/api/memory/ops/jobs` (PR D)

```
POST   /                   -> 201 { job: MemoryOpsJob }
                               400 EGRESS_NOT_CONFIRMED (embedding-backfill, drawer-backfill)
                               400 FEATURE_DISABLED  (MEMORY_OPS_ENABLED=false)
                               400 JOB_KIND_NOT_ENABLED (kind not in ENABLED_JOB_KINDS for this deploy)
                               409 EMBEDDING_NO_PROVIDER
                               409 JOB_ALREADY_RUNNING (pg_try_advisory_xact_lock loss, see §5.2)
                               422 VALIDATION_ERROR
GET    /                   -> 200 { jobs: MemoryOpsJob[] }  (filter: kind, status, limit≤200)
GET    /capabilities       -> 200 { enabled, enabledKinds, machineId, hasActiveProvider, activeProviderModel? }
GET    /:id                -> 200 | 404 PROVIDER_NOT_FOUND
POST   /:id/cancel         -> 200 { status: 'cancelled' | 'cancelling', job }
                               403 REMOTE_PEER_JOB (job's executor_machine_id != local)
                               404 PROVIDER_NOT_FOUND
                               409 JOB_NOT_CANCELLABLE (already in terminal state)
GET    /:id/stream         -> text/event-stream
                               same-peer only; Last-Event-Id respected from local bigserial
                               initial event: `peer` { machineId, eventSequenceStart } (R2b P1-21)
                               client stores (peerId, lastEventId); resets on peer mismatch
```

**Cancel semantics (fixes [R2b P0-2 round-3]):** 202 + error-envelope body was wrong (error shape on 2xx). v3 always returns 200 with `{status:'cancelled', job}` on completed cancel OR `{status:'cancelling', job}` if worker hasn't acked yet. No error code on success.

**REMOTE_PEER_JOB** (adds missing route spec per R2b P0-3): 403 when `executor_machine_id != getMachineId()`. Peer UI shows the job as read-only and hides the Cancel button, but a direct API call still returns 403 for defense-in-depth.

**Feature flag (fixes [R2b P1-32, R1b P0-4 round-3]):**
- `MEMORY_OPS_ENABLED` env var, defaults to `false`.
- PR E ships `.env.example` with `MEMORY_OPS_ENABLED=false`. Operator can opt-in manually to unblock the 19k backfill via API.
- PR F flips `.env.example` default to `true` and documents in CHANGELOG.
- Turns off POST only; GET (read-only) is always on.
- **Critical-path note (fixes R1b P0#4 round-3 + R2b P1-12):** after PR E merges, the 19k backfill is **available via curl with operator-set `MEMORY_OPS_ENABLED=true`**; PR F is when it becomes accessible from the web UI with the flag on by default.

**Per-PR enabled kinds (fixes [R1b P0#3 round-3]):**
- Server enforces `ENABLED_JOB_KINDS` (a `Set<MemoryOpsJobKind>` constant in `memory-ops.ts`).
- PR D ships the route with `ENABLED_JOB_KINDS = new Set()` (empty — all POSTs return 400 `JOB_KIND_NOT_ENABLED`).
- PR E expands to `new Set(['embedding-backfill', 'drawer-backfill'])`.
- PR G expands to all four.
- `GET /api/memory/ops/capabilities` (new route in PR D) returns `{ enabled: bool, enabledKinds: MemoryOpsJobKind[], machineId: string, hasActiveProvider: bool }`. UI uses this to disable Run buttons on unsupported kinds — fixes the "PR F renders all 4 JobCards before PR G has handlers" gap.

**Egress enforcement (fixes [R1b P0#9]):**
- `embedding-backfill` and `drawer-backfill` require `egressConfirmed: true` in the POST body.
- Server persists `egress_confirmed_at=now()` and `egress_confirmed_by=<header 'X-AgentCTL-Actor' OR 'local:${hostname}'>`.
- UI ALSO keeps `sessionStorage['memory-ops-egress-ack:<credentialId>']='true'` to skip the dialog on subsequent same-tab runs (fixes [R2b P1-34]).
- Direct curl without `egressConfirmed: true` → 400.

**SSE plumbing (fixes [R2b P2-43]):**
- CP boot opens one dedicated `pg.Client` with `LISTEN memory_ops_job_channel`.
- The repo writer does `pg_notify('memory_ops_job_channel', jobId)` after every `memory_ops_jobs` write.
- A fan-out map (in-memory) routes notifications to subscribed SSE clients keyed by `job_id`.
- SSE handler fetches new `memory_ops_job_events` rows since the client's `Last-Event-Id`.
- Payload ≤ 8 KB always (pg_notify budget respected — we only send `job_id`, not the row).

### 6.3 Shared types (PR A)

`packages/shared/src/memory/providers.ts` — exports `EmbeddingProviderKind = z.enum(['openai','gemini'])` and `EMBEDDING_MODEL_CATALOG`:

| provider | model | dim | baseUrl | embeddingsPath | extraBody | $/Mtok |
|---|---|---|---|---|---|---|
| openai | text-embedding-3-small | 1536 | `https://api.openai.com` | `/v1/embeddings` | `{}` | 0.02 |
| gemini | gemini-embedding-001 | 1536 | `https://generativelanguage.googleapis.com/v1beta/openai` | `/embeddings` | `{ output_dimensionality: 1536 }` | 0.15 |

Gemini `embeddingsPath='/embeddings'` (NOT `/v1/embeddings`) per [Google's OpenAI-compat docs](https://ai.google.dev/gemini-api/docs/openai) and [Gemini embeddings docs](https://ai.google.dev/gemini-api/docs/embeddings). **Round-3 caveats the spec must honor (R1b P0#6 round-3):**
- Google's OpenAI-compat page example uses `gemini-embedding-2-preview`, not `gemini-embedding-001`.
- `output_dimensionality` is documented on Gemini's **native** embeddings API, NOT on the OpenAI-compat layer. Whether the compat layer honors it is unverified.

**PR A hard requirement:** a failing-test-first network contract test against the real Gemini endpoint with a fake key, asserting the 401 response shape (proves the URL resolves). Must not merge PR A until this test passes against the live `gemini-embedding-001` endpoint with `output_dimensionality: 1536` returned at exactly 1536 dimensions. If the compat layer returns 3072-dim vectors instead, v1 switches catalog entry to `gemini-embedding-2-preview` (which natively emits 1536) or degrades Gemini to v1.1 until native-API bypass ships.

`validateCatalog()` runs at boot: every entry's `dim === 1536` (matches `vector(1536)` column); throws otherwise.

`embeddingProviderCreateSchema`:
- Fields: `name` (1..80), `provider` (enum), `model` (non-empty), `apiKey` (min 8), `active` (default true), `recentTestResult?` (from `/test-ephemeral`).
- `.strict()` — unknown keys (e.g., `baseUrl`) fail validation (fixes [R2b P0-9]).
- `.superRefine` checks `(provider, model)` exists in catalog; emits `VALIDATION_ERROR` with `context.issues[0].message === 'model not in catalog'` otherwise.

`packages/shared/src/memory/ops.ts` — Zod discriminated union `memoryOpsJobParamsSchema` over `kind` literal (fixes [R2b P1-30]). Per-kind fields:

| kind | base fields | extra fields | egressConfirmed required |
|---|---|---|---|
| `embedding-backfill` | `scope?`, `dryRun?`, `credentialId?` | `batchSize` (1-500, default 100) | **yes** |
| `drawer-backfill` | same | `sourceType: 'claude-mem'\|'jsonl'`, `sourceRoot` (non-empty), `batchSize` (default 50) | **yes** |
| `consolidation` | same | — | no |
| `synthesis` | same | — | no |

`scope` is coerced via `scopeNormalize(s) = (s ?? '').trim().toLowerCase()` shared with the advisory-lock key (§5.2). Exact-match semantics; prefix matching is v1.1.

## 7. Embedding Client + Cost Tracking

### 7.1 `EmbeddingClient` extension (PR A, additive only)

Current state (verified `packages/control-plane/src/memory/embedding-client.ts:64`): URL is `${baseUrl}/v1/embeddings`; no apiKey; no usage in return type.

PR A additive changes — default behavior preserved:

- New options: `apiKey?: string`, `extraBody?: Record<string, unknown>`, `embeddingsPath?: string` (default `/v1/embeddings`).
- New method: `embedBatchWithUsage(texts): Promise<{ vectors, usage: { promptTokens }, model }>`. `embed` / `embedBatch` unchanged.
- `ControlPlaneError('EMBEDDING_API_ERROR', ...)` context gains typed `status: number`. Handlers check `err.context?.status === 401`, not string match (fixes [R1b P0#18]).
- Existing callers (`index.ts:378` — LITELLM_URL path) untouched. When PR A ships, the old code continues to work; PR A begins migration.

### 7.2 Catalog — see §6.3.

### 7.3 `resolveEmbeddingClient` factory (PR B) — the memory-runtime wiring fix

Fixes [R1b P0#1 round-2]. The factory returns `{ client, model, dim }` (not just a client — needed for server-side mixed-model filtering, R1b P0#7 round-3):

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

**Resolution order** (fixes R2b P1-14):
1. If `credentialId` provided, fetch that `api_accounts` row (must be `credential_kind='embedding'`).
2. Else fetch the single `is_active=true AND credential_kind='embedding'` row.
3. Else if `process.env.LITELLM_URL` is set, construct a client against that URL with default model `text-embedding-3-small` — **legacy fallback, scheduled for removal in v1.2**. A boot-time warning logs the deprecation.
4. Else throw `ControlPlaneError('EMBEDDING_NO_PROVIDER', ...)`.

Decrypt failure → `ControlPlaneError('EMBEDDING_CREDENTIAL_DECRYPT_FAILED', ...)`.

**Cache (fixes [R2b P0-6 round-3] — hot path cost):**

`MemoryStore.addFact` is on every fact write path (verified `memory-store.ts:204-227`). Adding a DB SELECT + AES-GCM decrypt per call is unacceptable.

```typescript
// module-level, in embedding-client-factory.ts
const cache = new Map<string, { resolved: ResolvedEmbeddingClient; expiresAt: number }>();
const TTL_MS = 60_000;

// Key = credentialId || 'active' for the default-row path.
// On cache miss: SELECT + decrypt + construct; cache.
// On hit: return cached.
```

Invalidation: subscribes to `provider.changed` events from the invalidation bus (§7.3.1). Bus emits on every successful provider write (POST/PATCH/DELETE).

Performance acceptance (in §18): during a 19k-fact backfill with warm cache, `MemoryStore.addFact` P99 does not regress > 15% vs the current `LITELLM_URL`-injected baseline.

### 7.3.1 Provider invalidation bus (PR B)

Fixes [R2b P0-5 round-3]. New module `packages/control-plane/src/memory/provider-invalidation-bus.ts` — Node `EventEmitter` singleton; one event type `provider.changed` carrying `{ credentialId?: string; deletedId?: string }`. `memoryProvidersRoutes` emits after every successful POST/PATCH/DELETE/`/:id/test`; the factory's cache (§7.3) subscribes and clears matching entries on receipt (ambiguous events → full clear).

### 7.3.2 Memory runtime rewiring (PR B)

All memory runtime surfaces switch off the boot-time `LITELLM_URL` injection:

- `packages/control-plane/src/index.ts` — drop the `if (LITELLM_URL) { embeddingClient = new EmbeddingClient(...) }` block; legacy path now lives inside the factory's resolution order.
- `packages/control-plane/src/memory/memory-search.ts` — constructor takes a `() => Promise<ResolvedEmbeddingClient>` getter instead of an injected client. `MemorySearch.vectorSearch` uses the returned `.model` to add a `content_model = $queryModel` SQL predicate (fixes R1b P0#7 round-3: server-side mixed-model filter). `bm25Search` + `graphSearch` receive the same filter when acting on facts that have a vector model attached.
- `packages/control-plane/src/memory/memory-store.ts` — `addFact` calls the factory through the cache.
- `packages/control-plane/src/memory/memory-drawer-store.ts` — same.
- `packages/control-plane/src/api/server.ts` — route registration no longer passes an `embeddingClient?` param; passes the getter instead.

Outcome: configuring a provider in Settings immediately enables `/api/memory/search` without restart. Search results can never contain wrong-model facts because the server filter is unconditional.

### 7.4 Cost accounting — corrected for real handler semantics (fixes [R1b P0#5 round-3, R2b P0-15 round-2])

v2 wrongly claimed `KnowledgeMaintenance`/`KnowledgeSynthesis` accept an injected `EmbeddingClient`. Live code: `KnowledgeMaintenanceOptions = { pool, memoryStore, logger, projectRoot? }` (`knowledge-maintenance.ts:116-122`); `KnowledgeSynthesisOptions = { pool, logger }` (`knowledge-synthesis.ts:64-67`). **Neither service calls embed APIs.** `KnowledgeSynthesis.runSynthesis` uses SQL vector similarity over *existing* embeddings (no new API calls).

**v1 cost-tracking scope (corrected):**

| Kind | Cost model |
|---|---|
| `embedding-backfill` | `progress.costUsd += usage.promptTokens / 1e6 * priceUsdPerMtoken` via `EmbeddingClient.embedBatchWithUsage` |
| `drawer-backfill` | same |
| `consolidation` | **costUsd = 0** — handler writes to `memory_consolidation_items`, no external API calls |
| `synthesis` | **costUsd = 0** — SQL-only over existing embeddings |

If v1.1 adds embedding re-synthesis to either service, v1.1 extends those constructors to accept a `MemoryStore` wrapped with cost tracking — NOT an `EmbeddingClient` direct injection. v1 spec stops claiming otherwise.

**Missing `usage.promptTokens` fallback (fixes [R2b P1-8]):** estimate `tokens ≈ chars / 4` (OpenAI heuristic; Reviewer 2 caught that v2 had the ratio inverted as "4 tokens per char"). `estimatedTokens = Math.ceil(textLength / 4)`. Set `progress.usageEstimated = true`. No runtime `tiktoken` dependency in v1 — package considered for v1.1 accuracy.

## 8. `content_model` + `embedding_model` Lock (fixes [R1b P0#4, P0#5, R2b P0-14])

**Lock condition** — based on ACTUAL embedded rows, not the column default:

```sql
-- Is the active provider's model safe to use?
SELECT content_model, COUNT(*) AS c
FROM memory_facts
WHERE embedding IS NOT NULL
GROUP BY content_model;
```

- 0 rows with embeddings → any provider allowed.
- 1 distinct `content_model` X, ≥ 1 row → new provider must have `model = X`, else UI blocks save with `MODEL_MISMATCH` error and directs to re-embed-all (v1.1).
- ≥ 2 distinct `content_model` → DB is already poisoned; UI shows persistent warning banner + "Re-embed all" CTA (link to v1.1 task). **Search still functions** but with a `mixed-models` fail-closed filter that restricts results to the majority model (fixes [R1b P0#5], soft-landing per [R2b P2-46]).

**Same rule for `memory_drawers.embedding_model`** (fixes [R2b P0-14]):
- drawer-backfill writes both `embedding` and `embedding_model` in the batch UPDATE.
- UI lock considers both columns unioned.
- **`MODEL_MISMATCH` is raised server-side** (POST / PATCH /`/providers`), not only in UI, so curl cannot bypass (fixes R1b P1#1, R2b P0-3 route-vs-error-table mismatch).

**Mixed-model search (fixes [R1b P0#7 round-3, R2b P1-11]):**
- `MemorySearch.vectorSearch` applies a `content_model = $queryModel` predicate automatically — the `$queryModel` comes from the factory's `ResolvedEmbeddingClient.model` (§7.3). BM25 and graph paths also filter facts to `content_model = $queryModel OR content_model IS NULL` before RRF merge.
- If 0 rows exist with the current query model AND > 0 rows exist with a different `content_model`, the API returns 503 `MIXED_MODEL_BLOCKED`, not empty results — the operator sees a real error pointing at `/memory/operations` re-embed-all (v1.1).
- UI adds `<MixedModelsBanner />` alongside `<MissingEmbeddingAlert />` on the 8 mount points. Fed by a new `memoryModelDistributionQuery()` hook (queryOptions pattern). Banner text: "Memory facts were embedded with different models ({majority}: N, {minority}: M). Search is filtered to {active}. Re-embed everything under the active provider to unify."

**Batch UPDATE SQL (fixes [R1b P0#3]):**

```sql
-- memory_facts.id is TEXT (verified drizzle/0010_add_memory_layer.sql:19; schema.ts:357)
UPDATE memory_facts AS f
SET    embedding     = v.embedding::vector,
       content_model = $2
FROM   (SELECT id, embedding
        FROM jsonb_to_recordset($1::jsonb)
        AS x(id text, embedding text)) v   -- id is TEXT not UUID
WHERE  f.id = v.id AND f.embedding IS NULL;
```

Same cast pattern as `memory-store.ts:231,606` (verified). `$1` is `[{"id":"...","embedding":"[0.1,0.2,...]"}, ...]`. Drawer equivalent uses `memory_drawers.embedding` + `memory_drawers.embedding_model`.

**Performance target** for 19,226 facts: **8 minutes wall-clock at median**. 192 batches × (~2.5s OpenAI round-trip + ~30ms batch UPDATE) + overhead. Plan PR E acceptance records the real number.

## 9. Runtime Credential Path Filter (PR A)

All reads/writes to `api_accounts` must filter by `credential_kind='runtime'` (fixes [R1b P1#18, R2b P0-1, R1b P0#8 round-3 which caught agents.ts missing in v2]):

- `packages/control-plane/src/api/routes/accounts.ts` — GET `/`, POST, PATCH, DELETE, POST `/:id/test`.
- `packages/control-plane/src/scheduler/task-worker.ts:301-312` (runtime credential resolution).
- `packages/control-plane/src/api/routes/sessions.ts:597-598,778-779,991-992,1168-1169,1597-1601` (every explicit account-id ingress AND failover selection — Reviewer 1 round-3 enumerated multiple sites, not just line 1597).
- `packages/control-plane/src/api/routes/oauth.ts` (asserts runtime only).
- `packages/control-plane/src/api/routes/settings.ts:81-83` (validates `default_account_id`). Live grep confirmed this site reads `apiAccounts` with NO kind filter today — facts doc item 37 was wrong and is now corrected in the reviews directory. Returns 422 `INVALID_ACCOUNT_KIND` if target row is `credential_kind='embedding'`.
- **`packages/control-plane/src/api/routes/agents.ts:333-419`** — PATCH `/api/agents/:agentId` currently sets arbitrary `accountId` without validating against `api_accounts` at all. Add validation: target row must exist and have `credential_kind='runtime'`; else 422 `INVALID_ACCOUNT_KIND`. **Missed in v2; added here per R1b P0#8 round-3.**
- `project_account_mappings` write path — validate target `api_accounts.credential_kind='runtime'`; else 422 `INVALID_ACCOUNT_KIND`.

PR A adds one failing test per site proving the filter is applied, then implements. Also a data-migration acceptance: after 0033 applies, any existing `agents.account_id` or `project_account_mappings.account_id` pointing at a row that would now be flagged embedding is surfaced in a diagnostic log line (v1 does not auto-unbind; operator cleanup).

## 10. Audit Logger (PR A interface + PR B/D implementation)

Fixes [R2b P0-18 round-2, R2b P0-4 round-3 — v2 wrote to `agent_actions` without reconciling nullable `run_id`, mesh-sync, and helper signature].

**v3 decision: dedicated `memory_ops_audit` table.** Reason: `agent_actions` is mesh-synced (`sync.ts:164`) — writing provider-CRUD events there would propagate credential events to peers, contradicting §3's "providers are per-machine" story. Existing `insertActions(runId: string, actions)` helper also can't accept nullable `runId` without a signature change.

### Schema (added to `0033_add_memory_ops.sql`, new statement group "D")

```sql
CREATE TABLE memory_ops_audit (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor     text NOT NULL,
  action    text NOT NULL,
  target    text NOT NULL,
  context   jsonb NOT NULL DEFAULT '{}'::jsonb,
  timestamp timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_ops_audit_action_ts ON memory_ops_audit (action, timestamp DESC);
CREATE INDEX idx_memory_ops_audit_target ON memory_ops_audit (target);
-- LOCAL-ONLY. NO sync_capture trigger. Not added to TABLE_SYNC_CONFIG.
```

Retention: 90 days via the extended `log-retention.ts` worker (same file as `memory_ops_job_events`).

### Interface (PR A)

`packages/shared/src/memory/ops-audit.ts` exports:

```typescript
export type MemoryOpsAuditEntry = {
  actor: string;        // X-AgentCTL-Actor header; fallback `local:${os.hostname()}`
  action: string;       // enum below
  target: string;       // provider_id or job_id
  context: Record<string, unknown>;  // structured; NEVER plaintext keys
  timestamp: string;    // populated server-side
};
export interface MemoryOpsAuditLogger {
  write(entry: Omit<MemoryOpsAuditEntry, 'timestamp'>): Promise<void>;
}
```

Action enum: `provider.{create,update,delete,rotate-key,test,test-succeeded,test-failed}` + `job.{create,cancel,complete,fail}` (fixes R2b P2-54 — added `test-failed`; renamed `test` to `test-succeeded` vs `test-failed` to distinguish).

Reconciled to single-method `write` (settling R2b P1-25 spec-vs-checklist ambiguity).

### Impl (PR B provider events, PR D job events)

`packages/control-plane/src/memory/ops/audit-logger.ts` — direct Drizzle insert into `memory_ops_audit`. No hash-chain in v1 (CP has none; verified by grep). `actor` header note: v1 trusts `X-AgentCTL-Actor`; v1.1 promotes to authenticated identity (R2b P2-49).

Every write path (provider CRUD + test + test-ephemeral + job POST/cancel + internal state changes) calls the logger.

## 11. SSRF / Egress Controls

- **`baseUrl` not user-configurable.** Catalog-only (§6.3); Zod `.strict()` rejects unknown fields → VALIDATION_ERROR.
- **Egress ack is server-enforced** (§6.2); UI dialog is a convenience on top.
- **Redaction truth** (fixes [R1b P0#10]): `redactMemoryWriteMetadata` + `sanitizeMemoryDrawerContent` cover **drawer writes only**, not `memory_facts.content`. v1 transmits existing fact content as-is to the provider after operator egress confirmation. Document this explicitly in §12 (below) and in the UI dialog copy.

## 12. Data Egress UI Copy

Before the first `embedding-backfill` / `drawer-backfill`: show destination host (from catalog), estimated row count, estimated tokens + cost; warn plainly that existing facts leave as-is while new drawer imports are sanitized; require an explicit "I understand memory content will leave this machine" checkbox. Submit posts `egressConfirmed:true` (§6.2) server-side.

## 13. UI Surface

### 13.1 Settings → Memory & Embeddings (PR C — `minor` bump)

- File: `packages/web/src/views/settings/MemoryEmbeddingsSection.tsx` (new).
- Registered in `SettingsView.tsx` nav array (`:26-67`) after `credentials-access`, before `workers-sync`. Uses `SettingsSection` wrapper (verified: `packages/web/src/views/settings/SettingsShell.tsx:56-82`).
- Provider list via `useQuery(memoryProvidersQuery())` — follows existing hook pattern (verified: `queries.ts` exports `queryOptions()` helpers consumed at the call site with `useQuery(...)`; e.g., `MemoryBrowserView.tsx:166`).
- Add/Edit dialog:
  - Test-before-save via POST `/api/memory/providers/test-ephemeral`. Success stores the `signedToken` in dialog state; POST `/` includes `recentTestResult` payload.
  - Edit mode + apiKey unchanged → Test calls `/:id/test`.
  - Edit mode + apiKey changed → Test calls `/test-ephemeral`.
- Save banner: "This provider will only be available on this machine."

### 13.2 `/memory/operations` (PR F — `minor` bump)

- View: `packages/web/src/views/MemoryOperationsPage.tsx`.
- Route: `packages/web/src/app/memory/operations/page.tsx`.
- Sidebar: add to `MEMORY_NAV_ITEMS` in `packages/web/src/components/memory/MemorySidebar.tsx:13-40` (verified exists with 10 items).
- Layout:
  - `<MissingEmbeddingAlert />` at top.
  - Egress confirmation dialog on first backfill per browser session.
  - 4 `<JobCard />` grid. `Run now` button disabled when: (a) any job of that kind is running anywhere in the mesh, (b) local peer lacks an active provider AND kind needs one, or (c) `MEMORY_OPS_ENABLED=false`.
  - `<RecentJobsTable />` (20 rows) — kind/status filter.
  - `<JobDetailDrawer />` — live SSE, cancel button, log tail. Peer-owned jobs render read-only (no Cancel).

### 13.3 `<MissingEmbeddingAlert />`

File: `packages/web/src/components/memory/MissingEmbeddingAlert.tsx`.

Renders when:
- `useQuery(memoryProvidersQuery())` returns empty, OR
- The active provider's `metadata.last_test_ok === false`, OR
- `metadata.last_test_ok === null` (never tested).

Non-dismissible. Links to `/settings#memory-embeddings` anchor (wired via `SettingsSection id="memory-embeddings"`).

### 13.4 Alert mount points — all 10 views (fixes [R2b P0-5])

| View | File | Mount alert? |
|---|---|---|
| Memory Browser | `packages/web/src/views/MemoryBrowserView.tsx` | Yes |
| Memory Dashboard | `packages/web/src/views/MemoryDashboardView.tsx` | Yes |
| Memory Drawers | `packages/web/src/views/MemoryDrawersView.tsx` | Yes |
| Memory Import | `packages/web/src/views/MemoryImportView.tsx` | **No** — import doesn't require embeddings |
| Memory Maintenance | `packages/web/src/views/MemoryMaintenancePage.tsx` | Yes |
| Memory Reports | `packages/web/src/views/MemoryReportsView.tsx` | Yes |
| Memory Scope Manager | `packages/web/src/views/MemoryScopeManagerView.tsx` | **No** — scope CRUD is orthogonal |
| Memory Synthesis | `packages/web/src/views/MemorySynthesisPage.tsx` | Yes |
| Knowledge Graph | `packages/web/src/views/KnowledgeGraphView.tsx` | Yes |
| Consolidation Board | `packages/web/src/views/ConsolidationBoardView.tsx` | Yes |

8 mounts, 2 exempt. File count matches reality: 10 (verified via `ls`).

### 13.5 Web API client

- Barrel: single file `packages/web/src/lib/api.ts` (verified; NOT `api/index.ts`).
- Core helper: `request<T>(path, init)` (verified `core.ts:21`). `apiFetch` does not exist.
- New modules:
  - `packages/web/src/lib/api/memory-providers.ts` — exports typed client methods.
  - `packages/web/src/lib/api/memory-ops.ts` — same.
- Query helpers added to `queries.ts` under existing `queryKeys.memory.*` namespace (verified: `queries.ts:159-181`).
- `queryOptions(...)` pattern matches existing hooks (PR C does NOT add `useQuery` to import list since views always call `useQuery(providersQuery())`).

## 14. Error Envelope (flat; matches existing project code)

Fixes [R1b P0#12]. Matches `server.ts:937-962` + `web/src/lib/api/core.ts:21-44`.

```jsonc
{ "error": "STABLE_CODE", "message": "...", "hint": "..." }
```

| Scenario | HTTP | `error` code |
|---|---|---|
| Zod input invalid | 422 | `VALIDATION_ERROR` |
| No active embedding provider on job create | 409 | `EMBEDDING_NO_PROVIDER` |
| Provider 401 at test or mid-job | 401 | `PROVIDER_AUTH_FAILED` |
| Provider 429 upstream | 429 | `PROVIDER_RATE_LIMITED` |
| Our own rate limit | 429 | `RATE_LIMITED` |
| Decrypt failure | 500 | `EMBEDDING_CREDENTIAL_DECRYPT_FAILED` |
| Delete or deactivate provider with active jobs | 409 | `PROVIDER_HAS_ACTIVE_JOBS` |
| Provider not found | 404 | `PROVIDER_NOT_FOUND` |
| Cancel on terminal job | 409 | `JOB_NOT_CANCELLABLE` |
| Cancel request for a remote-owned job | 403 | `REMOTE_PEER_JOB` |
| Advisory-lock loss on enqueue | 409 | `JOB_ALREADY_RUNNING` |
| Partial unique index violation | 409 | `DUPLICATE_ACTIVE_EMBEDDING` |
| Egress not confirmed on egressing job | 400 | `EGRESS_NOT_CONFIRMED` |
| MEMORY_OPS_ENABLED=false on POST /jobs | 400 | `FEATURE_DISABLED` |
| New/activated provider model != existing embedded content_model | 409 | `MODEL_MISMATCH` |
| Mixed-model state; server-side search blocked | 503 | `MIXED_MODEL_BLOCKED` |
| POST /api/settings default_account_id targets embedding row | 422 | `INVALID_ACCOUNT_KIND` |
| POST /jobs kind not in this deploy's ENABLED_JOB_KINDS | 400 | `JOB_KIND_NOT_ENABLED` |

## 15. Testing Strategy

- **Docker Postgres with pgvector for integration tests** (fixes [R2b P1-28]). `pg-mem` cannot run `::vector` casts. Reuse the pattern from existing memory-store tests (verified: `packages/control-plane/src/memory/memory-store.test.ts` uses real PG in test helpers).
- Every PR: failing test → implementation → passing test → commit.
- **Coverage goal:** match or exceed each package's existing coverage baseline; no new regressions.
- **Playwright path** (fixes [R2b P0-12]): `packages/web/e2e/memory-ops/*.spec.ts` — real directory. Existing directory has 49 spec files; reuse setup/teardown patterns.
- **Required integration tests:**
  - Partial unique index fires under concurrent active-inserts (Docker PG).
  - Batch UPDATE writes N rows in one round trip; updates both `embedding` and `content_model`.
  - Ownership claim races: two CPs with different `MACHINE_ID` — only one wins.
  - 401 response from stub provider → job fails + `api_accounts.is_active=false`.
  - `egressConfirmed:false` on POST /jobs → 400 `EGRESS_NOT_CONFIRMED`.
  - Migration 0033 + rollback against a populated `api_accounts` table.
  - `memory_facts.embedding` ADD-equivalent lock check: no-embeddings state allows any provider.
- **Required e2e (Playwright):**
  1. OpenAI full journey: Settings → Add → Test pre-save → Save → confirm egress → Run embedding-backfill → see progress → `/memory/maintenance` non-empty.
  2. Gemini full journey: stubbed at `https://generativelanguage.googleapis.com/v1beta/openai/embeddings`. Asserts `output_dimensionality:1536` in body.
  3. Alert coverage: no provider → `MissingEmbeddingAlert` on all 8 target views; absent on Import + ScopeManager.

## 16. Rollout

| PR | Scope | Bump | Enabled by default | Critical path? |
|---|---|---|---|---|
| **A** | Migration `0033_add_memory_ops.sql` (four statement groups: api_accounts extensions, memory_ops_jobs, memory_ops_job_events, **memory_ops_audit** new in v3) + rollback script; Drizzle schema; `TABLE_SYNC_CONFIG` += `memory_ops_jobs`; `EmbeddingClient` additive (`apiKey` / `extraBody` / `embeddingsPath` / `embedBatchWithUsage` / typed error `context.status`); runtime-path `credential_kind='runtime'` filter on accounts/sessions/task-worker/oauth/settings/agents; `MemoryOpsAuditLogger` interface + `memory/provider-invalidation-bus.ts`; catalog + shared types; **Gemini URL contract test (must pass before merge)** | **patch** | n/a | Yes |
| **B** | `/api/memory/providers` CRUD + `/test` + `/test-ephemeral` + `resolveEmbeddingClient` factory with cache; migrate `MemorySearch` / `MemoryStore.addFact` / `memory-drawer-store` off `LITELLM_URL`; server-side `MODEL_MISMATCH` gate; audit logger concrete impl for provider events; `.env.example` += `MEMORY_OPS_SIGNING_SECRET`; baseline coverage snapshot committed at `docs/superpowers/specs/2026-04-24-memory-operations-ui-coverage-baseline.md` | **patch** | n/a | Yes |
| **C** | Settings → Memory & Embeddings UI | **minor** | first user-visible UI | Yes |
| **D** | `memory-ops` BullMQ queue + `JobsRepository` + `JobEventsRepository` + `/api/memory/ops/jobs` CRUD + `/capabilities` + SSE with `peer` initial event; `ENABLED_JOB_KINDS = empty` on ship; log-retention extension for job events + audit table | **patch** | n/a | Yes |
| **E** | `embedding-backfill` + `drawer-backfill` handlers + worker boot + cost tracker + 401 deactivate; `ENABLED_JOB_KINDS` expands to those two; `.env.example` += `MEMORY_OPS_ENABLED=false` + `MEMORY_OPS_MAX_FAIL_RATIO=0.05` | **patch** | `MEMORY_OPS_ENABLED=false` | Yes — **19k backfill AVAILABLE via API with operator-set `MEMORY_OPS_ENABLED=true`** |
| **F** | `/memory/operations` page + 8 `MissingEmbeddingAlert` mounts + `<MixedModelsBanner />` + sidebar entry + egress dialog; `.env.example` flips `MEMORY_OPS_ENABLED=true`; audit logger for job events | **minor** | **Yes** | No |
| **G** | `consolidation` + `synthesis` handlers (costUsd=0, SQL-only); `ENABLED_JOB_KINDS` adds those two; Playwright e2e (3 specs); optional catalog-smoke probe; CHANGELOG + runbook | **patch** | n/a | No |

**Rollback order (fixes R2b P2-28 typo + P2-47):** Before PR F merges, default is `MEMORY_OPS_ENABLED=false`; reverting PR E is trivially safe (POST is disabled by default). After PR F flips the default to `true`, reverting PR E requires setting `MEMORY_OPS_ENABLED=false` first and draining the queue. PR D can stand alone — routes exist, POSTs return 400 `JOB_KIND_NOT_ENABLED` because the kind set is empty pre-PR-E. PR A+B can be reverted via `0033_add_memory_ops.down.sql` (§5.5).

## 17. Operational Runbook

Ships with PR G's release notes. PM2 process names (verified from `infra/pm2/ecosystem.*.config.cjs`):

| Tier | Process name | Redis DB |
|---|---|---|
| beta | `agentctl-cp-beta` | 0 |
| dev-1 | `agentctl-cp-dev1` | 1 |
| dev-2 | `agentctl-cp-dev2` | 2 |
| mesh | `agentctl-cp-mesh` | see config |

Commands:

- **Pause new enqueues (API stays up):** `export MEMORY_OPS_ENABLED=false; pm2 restart <process>`. Restart is required for env vars to take effect; mid-flight jobs are interrupted and marked `CP_RESTART_DURING_RUN` via §4 boot reconciliation.
- **Stop the worker entirely:** `pm2 stop <process>`. Same effect as env flag since worker is in-process with CP.
- **Force-fail stuck running jobs (after stopping the worker):** `UPDATE memory_ops_jobs SET status='failed', error_code='MANUAL_FAIL', error='manual intervention', finished_at=now() WHERE status='running' AND executor_machine_id=$1`. Ordering matters; do NOT run while the worker is running or a racing `complete()` may rewrite status.
- **Purge old events:** handled by `log-retention.ts` (extended in PR D). Manual: `DELETE FROM memory_ops_job_events WHERE created_at < now() - interval '14 days'`. Audit retention is 90 days for `memory_ops_audit`.
- **Orphan `credential_id` on peer:** a job row syncs to a peer that never had the originating provider. UI labels it "(provider: not visible on this machine)"; recovery: create a provider locally and POST a new job (there is no per-job `retry` endpoint; "retry" means "POST `/` with the same params", R2b P2-46).
- **Re-embed all with new model (v1.1 not shipped; manual workaround):**
  ```sql
  -- ⚠️ WARNING: takes memory search offline FLEET-WIDE for minutes-to-hours.
  -- memory_facts is mesh-synced mutable. Null-ing embeddings propagates to peers.
  -- Consider pm2 stop <all CPs in fleet> during the window.
  UPDATE memory_facts SET embedding = NULL WHERE content_model = '<old>';
  UPDATE memory_drawers SET embedding = NULL WHERE embedding_model = '<old>';
  ```
  Then enable the new provider and POST `/api/memory/ops/jobs {kind:'embedding-backfill', egressConfirmed:true}`. Drawers also need their own backfill job if the deployment uses them. (R1b P1#5, R2b P1-19.)

## 18. Acceptance Criteria

- Given an empty `api_accounts` list, opening Settings → Memory & Embeddings and adding an OpenAI provider, clicking Test shows `dim=1536, costUsd > 0, latencyMs > 0` BEFORE Save.
- With no provider, `<MissingEmbeddingAlert />` renders on all 8 target views; absent on Memory Import + Memory ScopeManager.
- With an active provider + ≥ 1 fact having `embedding IS NULL`, triggering `embedding-backfill`:
  - writes both `embedding` and `content_model` per fact;
  - reports `progress.embedded`, `progress.processed`, `progress.costUsd` monotonically increasing;
  - ends `status='completed'` when `failed / total < 0.05`; else `status='failed'`.
- Deleting active provider with a running job → 409 + `blockingJobIds`. After cancel → 204.
- Two concurrent POST /providers `{active:true}` → one 201, one 409 `DUPLICATE_ACTIVE_EMBEDDING`.
- Rotating key resets `lastTestOk=null`, clears `lastTestError`; bumps `updated_at`.
- OpenAI 401 mid-job → job `status='failed'`, `error_code='PROVIDER_AUTH_FAILED'`, provider `is_active=false`.
- Cancelling mid-batch → `status='cancelled'`, never rewrites to `completed` even if handler returns naturally. Terminal-transition invariant enforced in repo (WHERE status IN ('queued','running')).
- SSE reconnect with `Last-Event-Id: N` on the same peer → replays N+1..current from `memory_ops_job_events`.
- Peer mesh: provider created on A not visible on B (expected, documented). Job created on A → `executor_machine_id=A`; visible on B as read-only.
- POST /jobs without `egressConfirmed:true` for embedding-backfill → 400 `EGRESS_NOT_CONFIRMED`.
- POST /jobs with `MEMORY_OPS_ENABLED=false` → 400 `FEATURE_DISABLED`.
- Migration 0033 on an `api_accounts` table with existing runtime rows completes; every pre-existing row ends with `credential_kind='runtime'`; partial unique index does not fire on runtime rows. (Fixes R2b P1-10 round-3 conflation of `api_accounts` vs `memory_facts` row counts.)
- Migration 0033 on a populated `memory_facts` table (19k rows with NULL embeddings) does not touch embedding data.
- POST `/api/settings` with `default_account_id` pointing at an embedding-kind row → 422 `INVALID_ACCOUNT_KIND` (fixes R2b P0-7).
- PATCH `/api/agents/:id` with `accountId` pointing at an embedding-kind row → 422 `INVALID_ACCOUNT_KIND` (fixes R1b P0#8 round-3).
- **Performance acceptance (fixes R2b P0-6 round-3):** during a 19k-fact backfill with the factory cache warm, `MemoryStore.addFact` P99 does not regress > 15% vs the current `LITELLM_URL`-injected baseline. Measurement recorded in PR E with the real baseline from a repo-committed `coverage-baseline.md` (PR B creates it).

**Manual performance bench (PR G collects; not a hard gate):** 19,226 facts → OpenAI `text-embedding-3-small`, median target < 10 min including provider rate limits, cost ~$0.05-$0.10. Separate Gemini baseline recorded when PR A's Gemini contract test passes. Real numbers captured in PR G release notes, not PR E (R2b P2-42).

## 19. Risks

| Risk | Mitigation |
|---|---|
| Gemini AI Studio URL convention drifts | Catalog is single source of truth; `validateCatalog()` runs at boot; add live `/v1beta/openai/models` smoke test behind `MEMORY_OPS_CATALOG_SMOKE=1`. |
| Price catalog drifts | Quarterly catalog-audit PR in risk register. Cost column in DB is historical (captured at job time); stays correct even if catalog updates. |
| Mesh peer runs old schema | Existing `sync_nodes_schema_ahead_rejection` (migration 0027) rejects cross-version sync. PR A includes mesh-behind test. |
| Worker crash during long backfill | v1: boot reconciliation marks jobs failed. v1.1: resumable via `memory_ops_jobs.progress.currentBatch`. |
| In-process worker blocks Fastify event loop | BullMQ offloads to a dedicated async iteration; fetch is non-blocking; DB calls are async. Monitor p99 API latency during a 19k backfill in PR E dev-1. |

## 20. Open Questions

None. All reviewer items are dispositioned in Appendix B.

---

## Appendix A — Files created/modified per PR

Every path verified against the worktree head and `docs/superpowers/reviews/2026-04-24-memory-operations-ui-v2-verified-facts.md` (item 37 corrected). Facts doc lives in `docs/superpowers/reviews/`, not `/tmp`.

**Convention:** every `.ts` file adds a matching `.test.ts`; `.tsx` → `.test.tsx`. Tests not listed separately unless path diverges.

All paths are `packages/control-plane/` or `packages/web/` unless stated. Every `.ts` adds `.test.ts`; every `.tsx` adds `.test.tsx`.

**PR A** — migration `drizzle/0033_add_memory_ops.sql` + `.down.sql`; `drizzle/meta/_journal.json`; `src/db/schema.ts` (apiAccounts cols + memoryOpsJobs + memoryOpsJobEvents + memoryOpsAudit); `packages/shared/src/types/sync.ts`; `packages/shared/src/memory/{providers,ops,ops-audit}.ts`; `src/memory/embedding-client.ts` (additive); runtime-kind filter on `src/api/routes/{accounts,sessions,oauth,settings,agents}.ts` + `src/scheduler/task-worker.ts`. **Gemini URL contract test** must pass before merge.

**PR B** — `src/memory/embedding-client-factory.ts` + cache; `src/memory/provider-invalidation-bus.ts`; `src/api/routes/memory-providers.ts` (incl. `MODEL_MISMATCH` server gate); `src/memory/ops/audit-logger.ts`; factory-rewiring of `src/memory/{memory-search,memory-store,memory-drawer-store}.ts`; `src/api/server.ts`; `src/index.ts` (drop `LITELLM_URL` block); `.env.example` += `MEMORY_OPS_SIGNING_SECRET`; `docs/superpowers/specs/2026-04-24-memory-operations-ui-coverage-baseline.md` committed.

**PR C** (`minor`) — `packages/web/src/lib/api/memory-providers.ts`; `packages/web/src/components/memory/ProviderDialog.tsx`; `packages/web/src/views/settings/MemoryEmbeddingsSection.tsx`; `packages/web/src/views/SettingsView.tsx` (nav + section id `memory-embeddings`); `packages/web/src/lib/api.ts`; `packages/web/src/lib/queries.ts` (`memoryProvidersQuery()`).

**PR D** — `src/memory/ops/{queue,jobs-repository,job-events-repository,sse-stream,worker-runtime}.ts`; `src/api/routes/memory-ops.ts` (incl. `/capabilities` + empty `ENABLED_JOB_KINDS`); `src/api/server.ts`; `src/index.ts` (queue boot); `src/audit/log-retention.ts` (events + audit retention).

**PR E** — `src/memory/ops/{embedding-backfill,drawer-backfill,worker,cost-tracker}.ts`; `src/memory/ops/e2e.test.ts`; `src/index.ts` (worker boot); `ENABLED_JOB_KINDS` expands to backfill kinds; `.env.example` += `MEMORY_OPS_ENABLED=false` + `MEMORY_OPS_MAX_FAIL_RATIO=0.05`.

**PR F** (`minor`) — `packages/web/src/lib/api/memory-ops.ts`; `packages/web/src/components/memory/{JobCard,RecentJobsTable,JobDetailDrawer,MissingEmbeddingAlert,MixedModelsBanner,EgressConfirmationDialog}.tsx`; `packages/web/src/views/MemoryOperationsPage.tsx`; `packages/web/src/app/memory/operations/page.tsx`; `packages/web/src/components/memory/MemorySidebar.tsx`; mount alert on 8 views (§13.4); `packages/web/src/lib/queries.ts` (ops hooks); `.env.example` flip `MEMORY_OPS_ENABLED=true`.

**PR G** — `src/memory/ops/{consolidation,synthesis,catalog-smoke}.ts`; `packages/web/e2e/memory-ops/{openai-happy,gemini-happy,missing-embedding-alert}.spec.ts`; `src/memory/ops/worker.ts` (+ `ENABLED_JOB_KINDS` += those two); `CHANGELOG.md`; `docs/QUICKSTART.md`.

---

## Appendix B — Round-2 reviewer traceability

Numbered disposition list: `docs/superpowers/reviews/2026-04-24-memory-operations-ui-v2-reviewer-checklist.md` (74 items). All Round 2 P0s (Reviewer 1 × 12 + Reviewer 2 × 18 = 30) dispositioned Fix.

Material cross-references (§ mappings):
- R1b P0: #1 → §7.3, #2 → §5.1 (schema in PR A), #3 → §8 (id text), #4 → §8 (embedded rows only), #5 → §8 (backend filter), #6 → §6.3 (embeddingsPath='/embeddings'), #7 → §5.2 (executor_machine_id), #8 → §5.2 (executor column is the real invariant), #9 → §6.2 (server-enforced egress), #10 → §11 (facts as-is truth), #11 → §5.3 (events local-only), #12 → §14 (flat envelope).
- R2b P0-5 → §13.4, P0-11 → §17, P0-12 → Appendix A (`packages/web/e2e/`), P0-13 → §16 (C/F minor), P0-16 → §13.5 (queryOptions), P0-17 → §4 (boot reconciliation), P0-18 → §10.

Deferred to v1.1 with explicit note in §3: crash-resumable workers, facts-content sanitize-before-embed, hash-chained audit, prefix scope matching.

---

## Appendix C — Round-3 reviewer disposition

Round-3 reviews on v2: [R1 round 3](../reviews/2026-04-24-memory-operations-ui-design-v2-strict-review.md) + [R2 round 3](../reviews/2026-04-24-memory-operations-ui-design-v2-strict-review-round-2.md). Every P0 raised is patched in v3; locations below.

### R1 round-3 P0 (8)
| # | Issue | v3 fix |
|---|---|---|
| 1 | Mesh job ownership race | §5.2 (executor = origin at insert; claim requires executor match) |
| 2 | Advisory lock doesn't "lose" | §5.2 (`pg_try_advisory_xact_lock` + 409; inside `db.transaction`) |
| 3 | PR F exposes kinds before PR G handlers | §6.2 (`ENABLED_JOB_KINDS` + `/capabilities`) |
| 4 | Critical path vs feature flag contradiction | §16 (PR E: "available via API with operator-set flag") |
| 5 | Cost tracking based on false code facts | §7.4 (consolidation/synthesis costUsd=0 in v1) |
| 6 | Gemini URL / model unverified | §6.3 (PR A contract test hard gate) |
| 7 | Mixed-model filter UI-only | §7.3.2 + §8 (server-side `content_model = $queryModel` in MemorySearch) |
| 8 | `agents.ts` missing from runtime filter | §9 (agents.ts:333-419 added) |

### R2 round-3 P0 (7)
| # | Issue | v3 fix |
|---|---|---|
| 1 | Advisory lock outside transaction | §5.2 |
| 2 | `CANCEL_ACCEPTED` error envelope on 2xx | §6.2 (always 200 with `{status}`) + §14 (removed) |
| 3 | `MODEL_MISMATCH` / `REMOTE_PEER_JOB` in §14 not §6.1/6.2 | §6.1 PATCH matrix + §6.2 cancel |
| 4 | Audit to `agent_actions` unreconciled | §10 (dedicated `memory_ops_audit` local-only table) |
| 5 | Invalidation bus unspecified | §7.3.1 |
| 6 | `MemoryStore.addFact` hot-path cost | §7.3 (cache + 15% P99 acceptance) |
| 7 | `settings.ts` kind filter + facts doc item 37 wrong | §9 + facts doc corrected |

### R1 round-3 P1 / R2 round-3 P1 (highlights)
- `tiktoken` math inverted → §7.4 (`chars/4`, not `chars*4`)
- 409 disambiguation via `hint` → §6.1 PATCH matrix
- `api_accounts` vs `memory_facts` row count conflation → §18 two separate bullets
- `MEMORY_OPS_MAX_FAIL_RATIO` unnamed → §18 + Appendix A PR E
- `recentTestResult.signedToken` HMAC secret → §6.1 + Appendix A PR B env var
- SSE peer identity → §6.2 (`peer` initial event)
- Tier DB mapping citation → §4 (`tier-config.ts:99`)
- `getMachineId()` helper → §4 (replaces `process.env.MACHINE_ID` throughout)
- Runbook `pm2 stop` process names → §17 table
- Re-embed-all fleet warning → §17
- `.env.example` ownership split across PRs B/E/F → §16 + Appendix A
- `MemoryOpsAuditLogger` single `write(entry)` method → §10
- `INVALID_ACCOUNT_KIND` → §14
- Rollback order typo "A+A+B" + pre-PR-F nuance → §16

Remaining round-3 P1/P2 items absorbed in-prose; no outstanding deferrals.
