# Memory Operations UI — v1 Design (rewrite)

> **Status:** Approved architectural decisions locked; awaiting implementation plan handoff.
> **Supersedes:** `2026-04-24-memory-operations-ui-design.md` (v0, rejected).
> **Incorporates:** [Reviewer 1 strict review](./2026-04-24-memory-operations-ui-spec-plan-strict-review.md), [Reviewer 2 batch critique](../reviews/2026-04-24-memory-operations-ui-review.md).
> **Authoritative facts:** all file paths and API signatures in this document are grounded in a 2026-04-24 codebase scan saved at `/tmp/memory-ops-rewrite-facts.md` (scratch). Spot-check with `grep -rn` before starting each PR.

## 1. Problem

The memory subsystem has infrastructure for embedding-backed search, drawer-based provenance, knowledge synthesis/maintenance/consolidation — but **no operator surface**. Consequences observed in production with the current user's database:

| Fact | Value |
|---|---|
| `memory_facts` rows | 19,226 |
| Rows with `embedding IS NOT NULL` | 0 |
| `memory_drawers` rows | 0 |
| `memory_fact_sources` rows | 0 |
| `memory_edges` rows | 0 |
| Active `api_accounts` rows with `credential_kind='embedding'` | n/a (column doesn't exist yet) |

Downstream consequence: `/memory/graph` renders 500 disconnected nodes; `MemoryMaintenancePage` + `MemorySynthesisPage` return empty results; the user thinks the feature is broken, but it's unconfigured.

**Root cause:** no UI to configure an embedding provider, and no UI to trigger the long-running jobs (embedding-backfill, drawer-backfill, consolidation, synthesis). Every lever is CLI-only.

## 2. Goals

- Configure embedding providers (OpenAI, Gemini AI Studio) from the Settings UI, with encrypted key storage reusing the existing `api_accounts` pattern.
- Trigger and observe four long-running memory maintenance jobs from a new `/memory/operations` page, with live progress via SSE.
- Warn operators on every downstream memory page when no embedding provider is configured.
- Deliver incrementally, shipping the critical path (PR 0 → PR A → PR B → PR C → PR D → PR E) before the UI dashboard (PR F, PR G) so the 19,226-fact backfill can run as early as PR E.

## 3. Non-Goals (v1)

- iOS UI — web-only.
- Embedding providers beyond OpenAI + Gemini (AI Studio via OpenAI-compat shim). Voyage / Azure / Bedrock / local Ollama / Anthropic-routed deferred.
- **Cross-peer credential replication.** `api_accounts` is explicitly `local-only` per `packages/shared/src/types/sync.ts:182` ("encrypted credentials must not auto-replicate"). v1 providers are per-machine; the UI makes this explicit.
- `memory_facts.embedding` schema migration away from `vector(1536)`.
- Custom `baseUrl` in the provider UI — v1 allows only the providers hardcoded in `EMBEDDING_MODEL_CATALOG` (SSRF/exfil mitigation).
- Switching an active provider's model while facts are embedded — v1 locks provider choice once any fact exists with that `content_model`. v2 adds a `re-embed-all` job.
- Cost budgets/kill-switches. v1 records cost per job but does not enforce caps.
- Scheduled/cron maintenance runs. v1 is manual-trigger only.
- Multiple simultaneously active providers. v1 permits at most one active `credential_kind='embedding'` row.
- Mesh-visible provider list. Jobs sync; providers don't.

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Web (Next.js App Router)                                        │
│  ┌──────────────────────┐   ┌────────────────────────────────┐  │
│  │ Settings             │   │ /memory/operations             │  │
│  │ └─ Memory & Embedding│   │  [4 JobCards]                  │  │
│  │    (SettingsSection) │   │  [RecentJobsTable]             │  │
│  └──────────┬───────────┘   │  [JobDetailDrawer — SSE]       │  │
│             │               └──────────────┬─────────────────┘  │
│  <MissingEmbeddingAlert /> on: Browser, Maintenance, Synthesis, │
│     Drawers, Graph, Dashboard, Reports. (Import intentionally   │
│     exempt — import runs without embeddings.)                   │
└──────────────┬───────────────────────────────────┬──────────────┘
               │                                   │
               ▼ HTTP + SSE                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ Control plane (Fastify)                                         │
│                                                                 │
│  /api/memory/providers     (CRUD + /test)                       │
│  /api/memory/ops/jobs      (CRUD + /cancel + /stream)           │
│             │                                                   │
│             ▼                                                   │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ memory-ops BullMQ Worker (in-process with CP for v1)   │     │
│  │  handlers:                                             │     │
│  │  ├── embedding-backfill                                │     │
│  │  ├── drawer-backfill (wraps existing script)           │     │
│  │  ├── consolidation   (wraps KnowledgeMaintenance.run)  │     │
│  │  └── synthesis       (wraps KnowledgeSynthesis.runSyn..│     │
│  └─────────────────┬──────────────────────────────────────┘     │
│                    ▼                                            │
│  resolveEmbeddingClient(pool, encryptionKey, credentialId?)     │
│  ├── OpenAI:  https://api.openai.com/v1        (existing shape) │
│  └── Gemini:  https://generativelanguage.googleapis.com/v1beta  │
│               /openai/v1 (OpenAI-compat shim; path convention   │
│               preserved via new additive `embeddingsPath` opt)  │
└─────────────────────────────┬───────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ PostgreSQL                                                      │
│  api_accounts           (+ credential_kind, + credential_last4) │
│                         (local-only per TABLE_SYNC_CONFIG)      │
│  memory_ops_jobs        (new; mutable mesh-synced)              │
│  memory_ops_job_events  (new; append-only mesh-synced; enables  │
│                          SSE Last-Event-Id replay + 200-line    │
│                          log tail)                              │
│  memory_facts           (existing; embedding + content_model    │
│                          updated atomically in batch UPDATE)    │
└─────────────────────────────────────────────────────────────────┘
```

## 5. Data Model

### 5.1 `api_accounts` extensions

Existing table: `packages/control-plane/src/db/schema.ts:443` (`apiAccounts`). Columns already present: `id uuid`, `name text`, `provider text`, `credential text` (AES-GCM ciphertext), `credential_iv text`, `priority int`, `rate_limit jsonb`, `is_active bool`, `metadata jsonb`, `created_at`, `updated_at`. Confirmed `local-only` in `packages/shared/src/types/sync.ts:182`.

**Migration 0033a (PR A):** additive only.

```sql
ALTER TABLE api_accounts
  ADD COLUMN credential_kind text NOT NULL DEFAULT 'runtime';

ALTER TABLE api_accounts
  ADD CONSTRAINT api_accounts_kind_check
  CHECK (credential_kind IN ('runtime', 'embedding'));

ALTER TABLE api_accounts
  ADD COLUMN credential_last4 text;

-- partial unique index: at most one active row per (credential_kind) allowed
-- for embedding kind. Runtime kind is unaffected (their active semantics
-- pre-exist; we don't touch them).
CREATE UNIQUE INDEX api_accounts_one_active_embedding
  ON api_accounts (credential_kind)
  WHERE is_active = true AND credential_kind = 'embedding';

CREATE INDEX idx_api_accounts_kind ON api_accounts(credential_kind);
```

- `credential_last4` is populated on INSERT/PATCH from the plaintext before encryption; **GET responses never decrypt**. This removes the "decrypt every key on every list" hot path flagged by Reviewer 2.
- Existing rows default to `credential_kind='runtime'` → no behavior change for Claude/Codex runtime credential flows, **provided PR 0 lands the runtime-side filter (§9.1).**
- Partial unique index makes single-active-embedding a DB invariant, not an API-layer race (fixes Reviewer 1 #24, Reviewer 2 §2.2).

### 5.2 `memory_ops_jobs` (new)

**Migration 0033b (PR A):**

```sql
CREATE TABLE memory_ops_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL
                CHECK (kind IN ('embedding-backfill','drawer-backfill','consolidation','synthesis')),
  status        text NOT NULL
                CHECK (status IN ('queued','running','completed','failed','cancelled')),
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress      jsonb NOT NULL
                DEFAULT '{"processed":0,"embedded":0,"failed":0,"total":0,"costUsd":0}'::jsonb,
  result        jsonb,
  error         text,
  credential_id uuid,  -- intentionally NOT a FK, see §5.4
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text
);

CREATE INDEX idx_memory_ops_jobs_status ON memory_ops_jobs(status);
CREATE INDEX idx_memory_ops_jobs_kind_created
  ON memory_ops_jobs(kind, created_at DESC);

CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON memory_ops_jobs
  FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');
```

And the shared sync registry (`packages/shared/src/types/sync.ts:162`) gains an entry:

```typescript
memory_ops_jobs: 'mutable',
```

`SYNCED_TABLES` is derived, so it picks up automatically. `TABLE_PK_COLUMN` doesn't need an entry (default `id` applies).

**Progress shape clarified (fixes Reviewer 1 #32 "done can lie"):**

```typescript
type MemoryOpsProgress = {
  processed: number;  // attempted (succeeded or failed, not remaining)
  embedded:  number;  // successfully written
  failed:    number;  // batch errors counted per fact
  total:     number;  // snapshot of eligible work at job start
  costUsd:   number;  // cumulative from provider usage responses
  etaSeconds?: number;
  currentBatch?: number;
};
```

### 5.3 `memory_ops_job_events` (new, append-only, mesh-synced)

**Migration 0033c (PR A):** enables SSE `Last-Event-Id` replay and the 200-line log tail the spec needs.

```sql
CREATE TABLE memory_ops_job_events (
  event_id   bigserial PRIMARY KEY,
  sync_id    uuid NOT NULL DEFAULT gen_random_uuid(),  -- mesh PK; see sync.ts note
  job_id     uuid NOT NULL REFERENCES memory_ops_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL
             CHECK (event_type IN ('started','progress','log','completed','failed','cancelled')),
  level      text CHECK (level IN ('info','warn','error')),  -- populated for 'log' only
  message    text,                                            -- log lines; 512-char max via app
  progress   jsonb,                                           -- snapshot for 'progress' events
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_ops_job_events_job
  ON memory_ops_job_events(job_id, event_id);

-- Retention: keep 7 days; drop older via existing log-retention worker.
CREATE INDEX idx_memory_ops_job_events_created
  ON memory_ops_job_events(created_at);

CREATE TRIGGER sync_capture AFTER INSERT ON memory_ops_job_events
  FOR EACH ROW EXECUTE FUNCTION sync_capture_change('sync_id');
```

Sync registry:

```typescript
memory_ops_job_events: 'append-only',
```

And since this uses `sync_id` (like `agent_actions` already does — see `sync.ts:159-160` precedent), add to `TABLE_PK_COLUMN`:

```typescript
memory_ops_job_events: 'sync_id',
```

SSE fetches the latest event row for the job and streams it plus any new rows. `Last-Event-Id` on reconnect resumes from the persisted sequence (fixes Reviewer 1 #13, Reviewer 2 §2.3).

**Log line budget:** 512 chars per `message`; 200 rows of log tail per job = ~100 KB frame worst case. Client-side renderer concatenates; server trims before insert.

### 5.4 `credential_id` on mesh-synced jobs

Since `api_accounts` is local-only, `memory_ops_jobs.credential_id` cannot be a real FK (it would violate on peers). It is stored as a `uuid` value with no `REFERENCES` clause. In the mesh change-log, the column value travels to peers where it is interpreted as an opaque key. Peer UI renders it as "(provider: not visible on this machine)" when no local `api_accounts` row matches.

This is explicit per-machine semantics and is documented in the UI (see §7.4).

### 5.5 Drizzle schema additions (PR A)

`apiAccounts` (add, near existing columns):

```typescript
credentialKind: text('credential_kind').notNull().default('runtime'),
credentialLast4: text('credential_last4'),
```

New table `memoryOpsJobs`:

```typescript
export const memoryOpsJobs = pgTable(
  'memory_ops_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    params: jsonb('params').notNull().default({}),
    progress: jsonb('progress').notNull().default({
      processed: 0, embedded: 0, failed: 0, total: 0, costUsd: 0,
    }),
    result: jsonb('result'),
    error: text('error'),
    credentialId: uuid('credential_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
  },
  (table) => [
    index('idx_memory_ops_jobs_status').on(table.status),
    index('idx_memory_ops_jobs_kind_created').on(table.kind, table.createdAt),
  ],
);
```

And `memoryOpsJobEvents` (similar shape, PK = uuid `syncId` + auto-increment `eventId`). Concrete Drizzle type in PR A Task A2.

## 6. API Contract

### 6.1 `/api/memory/providers` (PR B)

All routes live in `packages/control-plane/src/api/routes/memory-providers.ts`. Registered in `server.ts` **under the same `encryptionKey && db` guard** as `accountRoutes` (see `server.ts` pattern for `apiAccounts`-based route guarding — Reviewer 1 #27).

```
GET    /api/memory/providers                   -> { providers: EmbeddingProvider[] }
POST   /api/memory/providers                   -> 201 { provider: EmbeddingProvider }
                                                  422 { error, issues } on Zod failure
PATCH  /api/memory/providers/:id               -> 200 { provider: EmbeddingProvider }
                                                  409 if name/key conflicts with running job
DELETE /api/memory/providers/:id               -> 204 (idempotent)
                                                  409 with { blockingJobIds: string[] } if any
                                                      running/queued job references this provider
POST   /api/memory/providers/:id/test          -> 200 { ok, dim, model, costUsd, latencyMs }
                                                  401 if provider returns 401
                                                  422 if provider returns unexpected shape
                                                  429 if rate-limited (per-credential-id, not IP)
```

**Key payload normalization (write):**

```jsonc
{
  "name": "OpenAI personal",
  "provider": "openai",            // or "gemini"
  "model": "text-embedding-3-small",
  "apiKey": "sk-...",              // write-only; never returned; persisted encrypted
  "active": true                    // enforces partial unique index
}
```

**Key payload shape (read):**

```jsonc
{
  "id": "uuid-v4",
  "name": "OpenAI personal",
  "provider": "openai",
  "model": "text-embedding-3-small",
  "baseUrl": "https://api.openai.com/v1",  // derived from catalog, not user input
  "dim": 1536,
  "apiKeyLast4": "Zq8M",           // populated from api_accounts.credential_last4
  "active": true,
  "lastTestAt": "...",             // from metadata
  "lastTestOk": true,              // from metadata; null if never tested
  "lastTestError": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

**Error envelope (project-standard, enforced by all routes):**

```jsonc
{
  "error": { "code": "EMBEDDING_NO_PROVIDER", "message": "...", "context": {} }
}
```

Zod validation failures return 422 with `error.code = 'VALIDATION_ERROR'` and `error.context.issues` holding the ZodIssue array. **Never 500 for user input** (fixes Reviewer 1 #8, Reviewer 2 §3.3).

**Rate limits (fixes Reviewer 2 §3.5):**
- Write endpoints: 30/min per IP (matches existing `accountRoutes`).
- `/:id/test`: 5/min per `(ip, credentialId)` tuple (spec says per-account; the tuple approximates that without an auth layer).
- Configurable via `MEMORY_PROVIDERS_*_RATE_LIMIT_*` env vars using the existing `readRateLimitEnv` helper.

**baseUrl safety (Reviewer 1 #6):** The API does **not** accept a user-provided `baseUrl`. It is derived on the server from `EMBEDDING_MODEL_CATALOG` using the `provider` key. Changing model selections is restricted to catalog entries; custom endpoints are a v2 "advanced" feature.

### 6.2 `/api/memory/ops/jobs` (PR D)

Lives in `packages/control-plane/src/api/routes/memory-ops.ts`. Guards same as `/api/memory/providers`.

```
POST   /api/memory/ops/jobs                   -> 201 { job: MemoryOpsJob }
                                                 409 EMBEDDING_NO_PROVIDER if no active
                                                     provider and kind needs one
                                                 409 JOB_ALREADY_RUNNING if a job of the
                                                     same (kind, normalized scope) is active
GET    /api/memory/ops/jobs?kind=&status=&limit= -> { jobs: MemoryOpsJob[] }
GET    /api/memory/ops/jobs/:id               -> { job: MemoryOpsJob }
POST   /api/memory/ops/jobs/:id/cancel        -> 200 | 409 JOB_NOT_CANCELLABLE
GET    /api/memory/ops/jobs/:id/stream        -> text/event-stream
                                                 respects Last-Event-Id via
                                                 memory_ops_job_events table
```

**Advisory lock for duplicate prevention (Reviewer 1 #4):** Before enqueueing, `POST /` takes a PostgreSQL advisory lock on `hashtext('memory-ops:' || kind || ':' || scope_normalized)`. If the lock is held (another peer or process has a running job), returns 409. This gives cross-peer protection even across separate BullMQ workers.

### 6.3 Shared types (PR A)

Added to `packages/shared/src/memory/`:

- `providers.ts` — `EmbeddingProviderKind`, `EmbeddingProviderInput` (Zod schema using `.superRefine` to validate against catalog; **no** `.transform`), `EmbeddingProvider` (response type), `EMBEDDING_MODEL_CATALOG`, `EmbeddingUsage` (`{ promptTokens: number }`).
- `ops.ts` — `MemoryOpsJobKind`, `MemoryOpsJobStatus`, `MemoryOpsJobParams` (discriminated union per kind, Zod-validated), `MemoryOpsJob`, `MemoryOpsProgress`, `MemoryOpsJobEvent`.

Re-exported from `packages/shared/src/memory/index.ts`.

## 7. Embedding Client + Cost Tracking (PR 0 precursor + PR A shared types + PR B factory)

### 7.1 PR 0 additive change to `EmbeddingClient`

Current state (`packages/control-plane/src/memory/embedding-client.ts:1-168`):
- Constructor: `{ baseUrl, model, logger, timeoutMs?, maxAttempts?, retryBaseDelayMs?, sleep? }`
- URL: `${baseUrl}/v1/embeddings` (hard-coded `/v1/embeddings` suffix)
- No `Authorization` header injection
- No `usage` in return type
- Throws `ControlPlaneError('EMBEDDING_API_ERROR', ...)` with `{ url, model, status }` context

PR 0 **additive** changes (no breaking change to existing LiteLLM callers — fixes Reviewer 1 #10, Reviewer 2 §1.2-A + §2.1):

- Add optional `apiKey?: string` to options. When present, sets `Authorization: Bearer <apiKey>` header on requests.
- Add optional `extraBody?: Record<string, unknown>`. Merged into the request JSON (used for Gemini's `output_dimensionality`).
- Add optional `embeddingsPath?: string` (default `'/v1/embeddings'`). **Existing callers unchanged.** New Gemini catalog entry uses `baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai'` and **keeps** the default path, producing `.../v1beta/openai/v1/embeddings` — the actual Google OpenAI-compat shape.
- Extend the return type so callers can access usage. New method (non-breaking addition):
  ```typescript
  async embedBatchWithUsage(
    texts: string[],
  ): Promise<{ vectors: number[][]; usage: EmbeddingUsage; model: string }>;
  ```
  Existing `embed` / `embedBatch` keep their current return types.
- Typed status exposure: change the `ControlPlaneError` context to include a canonical `status: number` field (already present in `{ status: response.status }`; just make it typed via `EmbeddingApiErrorContext`) so handlers can check `err.context?.status === 401` instead of matching the message string (Reviewer 1 #18, Reviewer 2 §2.6).

### 7.2 Provider catalog (PR A shared types)

```typescript
// packages/shared/src/memory/providers.ts
export const EMBEDDING_MODEL_CATALOG = [
  {
    provider: 'openai',
    model: 'text-embedding-3-small',
    dim: 1536,
    baseUrl: 'https://api.openai.com/v1',
    embeddingsPath: '/v1/embeddings',
    extraBody: {},
    priceUsdPerMtoken: 0.02,
  },
  {
    provider: 'gemini',
    model: 'gemini-embedding-001',
    dim: 1536,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    embeddingsPath: '/v1/embeddings',
    extraBody: { output_dimensionality: 1536 },
    priceUsdPerMtoken: 0.15,
  },
] as const;
```

### 7.3 `resolveEmbeddingClient` factory (PR B)

```typescript
// packages/control-plane/src/memory/embedding-client-factory.ts
async function resolveEmbeddingClient(input: {
  pool: Pool;
  encryptionKey: string;
  logger: Logger;
  credentialId?: string;  // optional; otherwise picks active embedding row
}): Promise<EmbeddingClient>;
```

- Reads the target row, decrypts the key with `decryptCredential` (from `packages/control-plane/src/utils/credential-crypto.ts`).
- Looks up the catalog entry by `(provider, model)` to get `baseUrl`, `embeddingsPath`, `extraBody`.
- Returns a fully-constructed `EmbeddingClient`.
- Throws `ControlPlaneError('EMBEDDING_NO_PROVIDER', ..., { credentialId })` when nothing is available.

### 7.4 Cost accounting (PR B + PR E)

- `EmbeddingClient.embedBatchWithUsage` returns `usage.promptTokens` from the provider response.
- `embedding-backfill` handler accumulates per batch: `costUsd += usage.promptTokens / 1e6 * catalogEntry.priceUsdPerMtoken` and persists in `progress.costUsd`.
- `POST /:id/test` calls `embedBatchWithUsage(['agentctl provider test probe'])` and returns a real `costUsd`.

Fixes Reviewer 1 #17 (cost spec vs implementation), Reviewer 2 §2.5.

## 8. `content_model` Lock (PR A schema + PR C/F UI)

- Every write to `memory_facts.embedding` **must** set `content_model = <provider.model>` in the same UPDATE (see §9.2 batch pattern).
- UI: once at least one fact exists with `content_model = X`, the provider settings page **disables changing the active provider's model** (but not the key — rotating is allowed). A distinct `v2` "Re-embed everything with new model" job will allow swapping.
- The Ops page surfaces a "Model distribution" pill: e.g., `19,226 facts · 100% text-embedding-3-small`. If more than one `content_model` value appears, the UI shows a warning and disables search until reconciled.

Fixes Reviewer 2 §2.4.

## 9. Runtime Credential Path Filter (PR 0)

**The blast radius fix.** Without PR 0, creating an embedding row in `api_accounts` corrupts every runtime call site. PR 0 must ship before PR A.

### 9.1 Sites requiring a `credential_kind='runtime'` filter

Located via `grep -rn "api_accounts\|apiAccounts" packages/control-plane/src/` (Reviewer 1 #2):

- `packages/control-plane/src/api/routes/accounts.ts` — GET `/`, POST, PATCH, DELETE, POST `/:id/test`. All paths must filter to `credentialKind='runtime'` (or reject writes if `credentialKind='embedding'` slipped through). Returning embedding rows here would surface them in the Claude/Codex "Managed Credentials" UI.
- `packages/control-plane/src/scheduler/task-worker.ts:303-304` — runtime credential resolution via `apiAccounts.id`. Add the kind guard.
- `packages/control-plane/src/api/routes/sessions.ts` — failover account selection (exact line from spec scan: around session-management routes). Add the kind guard.
- `packages/control-plane/src/api/routes/oauth.ts` — OAuth binds runtime credentials only; no runtime→embedding cross-contamination possible, but add an assertive check.
- Any Drizzle query using `apiAccounts` without a `credentialKind` predicate is a bug.

### 9.2 Batch UPDATE pattern

Current memory-store writes (grep `::vector` in `packages/control-plane/src/memory/memory-store.ts`) use explicit casts. Backfill must follow the same pattern. Per-fact N+1 updates (Reviewer 2 §2.9) are replaced with:

```sql
UPDATE memory_facts AS f
SET    embedding     = v.embedding::vector,
       content_model = $2
FROM   (SELECT id, embedding
        FROM jsonb_to_recordset($1::jsonb)
        AS x(id uuid, embedding text)) v
WHERE  f.id = v.id AND f.embedding IS NULL;
```

`$1` is a JSON array of `{id, embedding: "[0.1,0.2,...]"}` rows. `$2` is the model name. One round trip per batch of 100.

Benchmark target for 19k facts: **≤ 8 minutes wall-clock** on OpenAI `text-embedding-3-small` (192 batches × ~2.5s each including network + DB). Actual number recorded via PR E acceptance and written into the plan, not guessed.

## 10. 401 Auto-Deactivate (PR B + PR E)

When `EmbeddingClient` throws with `context.status === 401`:
- PR B `/:id/test` returns 401 and sets `is_active = false`, `metadata.last_test_ok = false`, `metadata.last_test_error = 'Provider rejected credential (401)'` in a single transaction.
- PR E job handler detects the structured error, calls `providersRepo.deactivate(credentialId, 'auth_failed')`, then fails the job with `error = 'PROVIDER_AUTH_FAILED: ...'`.
- The UI Ops detail drawer surfaces a "Rotate key" CTA when a job fails with this error.

Fixes Reviewer 1 #18, Reviewer 2 §2.6.

## 11. Audit Log (PR B + PR D)

**Existing CP-side pattern:** `MemoryWriteAuditLogger` interface with `writeMemoryWrite(input: MemoryWriteAuditInput): Promise<void>` (see `packages/control-plane/src/memory/memory-drawer-store.ts:28`). It's injected into stores. v1 extends or mirrors this into a `MemoryOpsAuditLogger` (same injection idiom) emitting entries for:

- provider create/update/delete/rotate-key/test
- job create/cancel/complete/fail

Every entry includes `{ actor, action, target, tag: 'memory-ops', timestamp, hashChain }`. When audit log isn't configured, routes still function (logger defaults to a no-op). Unit tests assert the logger is called from every write path.

## 12. SSRF / Egress (PR B + PR F)

- `baseUrl` is not user-configurable (§6.1). Requests can only reach `api.openai.com` or `generativelanguage.googleapis.com`.
- Before the first `embedding-backfill` or `drawer-backfill` job, the UI requires a confirmation dialog showing:
  - Destination host (provider)
  - Estimated row count (from a `SELECT COUNT(*) WHERE embedding IS NULL`)
  - Estimated token count + cost
  - An explicit "I understand memory content will leave this machine" checkbox
- Confirmation is session-scoped (not persisted); subsequent runs within the same session skip it.
- Redaction: existing `redactMemoryWriteMetadata` + sanitizer paths (e.g., `packages/control-plane/src/memory/memory-drawer-sanitizer.ts`) already redact known secret patterns before any write. The UI dialog states this, and the plan adds a test asserting a seeded `sk-...` value is redacted before being sent to the stub provider.

Fixes Reviewer 1 #6 + #7.

## 13. UI Surface

### 13.1 Settings → Memory & Embeddings

- New file `packages/web/src/views/settings/MemoryEmbeddingsSection.tsx`.
- Registered in `packages/web/src/views/SettingsView.tsx:26-67` nav array **after `credentials-access`**, before `workers-sync`.
- Uses `SettingsSection` wrapper (exported from `packages/web/src/views/settings/SettingsShell.tsx`).
- Shows provider list (from `useMemoryProvidersQuery`), Add/Edit/Delete actions, a Test button per row.
- Add/Edit dialog: **Test-before-save** supported — dialog posts to `/api/memory/providers/test-ephemeral` (new endpoint, in PR B) that runs a single embed against the payload **without persisting**. On success the Save button becomes enabled. Fixes Reviewer 1 #11.
- Save shows a "This provider will only be available on this machine" banner to clarify local-only semantics.

### 13.2 `/memory/operations`

- New view `packages/web/src/views/MemoryOperationsPage.tsx`.
- New route `packages/web/src/app/memory/operations/page.tsx`.
- Sidebar: add `Operations` under the Memory submenu.
- Layout:
  - `<MissingEmbeddingAlert />` at top.
  - Egress-warning dialog (once per session, before any first-time embedding backfill).
  - 4 × `<JobCard />` grid — disabled Run button while any job of that kind is running.
  - `<RecentJobsTable />` (20 rows, filter by kind/status).
  - `<JobDetailDrawer />` — shows live SSE stream, reconnection via `Last-Event-Id`, cancel button, log tail.

### 13.3 `<MissingEmbeddingAlert />`

- New shared component `packages/web/src/components/memory/MissingEmbeddingAlert.tsx`.
- Renders when `useMemoryProvidersQuery` returns an empty list or active provider's `lastTestOk === false`.
- Also renders when `lastTestOk === null` (never tested) — treat as "not healthy" (fixes Reviewer 1 #28).
- Non-dismissible. Links to Settings.

### 13.4 Mount points for `<MissingEmbeddingAlert />`

Real view paths (from scan):

- `packages/web/src/views/MemoryBrowserView.tsx`
- `packages/web/src/views/MemoryMaintenancePage.tsx`
- `packages/web/src/views/MemorySynthesisPage.tsx`
- `packages/web/src/views/MemoryDrawersView.tsx`
- `packages/web/src/views/KnowledgeGraphView.tsx`
- `packages/web/src/views/MemoryDashboardView.tsx`
- `packages/web/src/views/MemoryReportsView.tsx`

**Intentionally not mounted on:**
- `MemoryImportView.tsx` — import runs without embeddings; banner would mislead.
- `MemoryScopeManagerView.tsx` — scope CRUD is orthogonal to search/synthesis.

Fixes Reviewer 2 §1.2-E.

### 13.5 Web API client

- Single-file barrel `packages/web/src/lib/api.ts` (not `api/index.ts`).
- New typed methods re-exported from a new sub-module `packages/web/src/lib/api/memory-providers.ts` and `packages/web/src/lib/api/memory-ops.ts`, both using `request<T>` from `./api/core`.
- New hooks in `packages/web/src/lib/queries.ts` under the existing `queryKeys.memory.*` namespace pattern.

## 14. Error Handling (fixes Reviewer 1 #8)

One envelope:

```jsonc
{ "error": { "code": "STABLE_CODE", "message": "...", "context": {} } }
```

| Scenario | HTTP | `error.code` |
|---|---|---|
| Zod input invalid | 422 | `VALIDATION_ERROR` (ZodIssue[] in context.issues) |
| No active embedding provider on job create | 409 | `EMBEDDING_NO_PROVIDER` |
| Provider 401 at test | 401 | `PROVIDER_AUTH_FAILED` |
| Provider 429 at test | 429 | `PROVIDER_RATE_LIMITED` |
| Decrypt failure | 500 | `EMBEDDING_CREDENTIAL_DECRYPT_FAILED` |
| Delete provider blocked by running job | 409 | `PROVIDER_HAS_ACTIVE_JOBS` |
| Cancel on terminal job | 409 | `JOB_NOT_CANCELLABLE` |
| Duplicate job (advisory-lock loss) | 409 | `JOB_ALREADY_RUNNING` |
| Model not in catalog | 422 | `UNSUPPORTED_MODEL` |
| baseUrl customization attempt | 400 | `BASEURL_NOT_ALLOWED` |

## 15. Testing

Every PR follows TDD: failing test → implementation → passing test → commit. 80% coverage target per `.claude/rules/common/testing.md`.

**Integration tests against real Postgres** (via `pg-mem` or a Docker-backed test instance) for:
- `api_accounts.partial unique index` enforces single-active-embedding under concurrent inserts.
- `memory_ops_jobs` lifecycle transitions (queue→run→complete vs cancel race) never produce `completed` after `cancelled`.
- Batch UPDATE writes all facts in one round trip and correctly updates `content_model`.
- `POST /providers/:id/test` with 401 provider response deactivates the row.

**Playwright e2e (PR G):** three specs, all using a local `msw-node` stub for OpenAI + Gemini:
1. OpenAI full journey: configure → test (pre-save) → save → run embedding-backfill → progress → complete → maintenance page no longer empty.
2. Gemini full journey: same flow, asserts `output_dimensionality: 1536` in request body.
3. Alert coverage: with no provider, assert `<MissingEmbeddingAlert />` renders on all 7 target views and is absent on Import + ScopeManager.

## 16. Rollout (updated PR sequence)

| PR | Scope | Independent? | Critical path? |
|---|---|---|---|
| **0** (precursor) | `credential_kind` runtime filter in `accounts/sessions/task-worker/oauth` + `EmbeddingClient` additive `apiKey`/`extraBody`/`embeddingsPath`/`embedBatchWithUsage` | Yes | Yes — unblocks A |
| **A** | Migrations 0033a/b/c, Drizzle schema, sync.ts registry updates, shared types, MemoryOpsAuditLogger interface | Depends on 0 | Yes |
| **B** | `/api/memory/providers` CRUD + `/test` + `/test-ephemeral` + `resolveEmbeddingClient` factory | Depends on 0 + A | Yes |
| **C** | Settings → Memory & Embeddings UI (ProviderDialog + MemoryEmbeddingsSection + hooks) | Depends on B | Yes — first operator-visible UI |
| **D** | `memory-ops` queue + `JobsRepository` + `JobEventsRepository` + `/api/memory/ops/jobs` CRUD + SSE with Last-Event-Id replay + advisory-lock duplicate prevention | Depends on A + B | Yes |
| **E** | `embedding-backfill` + `drawer-backfill` handlers + in-process BullMQ Worker + cost accounting + 401 deactivate | Depends on D | Yes — **19k backfill unblocked** |
| **F** | `/memory/operations` page + `<JobCard />`/`<RecentJobsTable />`/`<JobDetailDrawer />` + `<MissingEmbeddingAlert />` on 7 views + egress confirmation + sidebar entry | Depends on E | No (UI convenience after critical path) |
| **G** | `consolidation` + `synthesis` handlers + Playwright e2e (3 specs) + release notes + feature complete `minor` bump | Depends on F | No |

**Versioning strategy** (fixes Reviewer 2 §7.3): PRs 0 and A-F bump **patch** only (no user-visible feature). PR G bumps **minor** and posts a consolidated changelog entry. This is tractable for beta-stability and matches semver intent.

## 17. Operational Runbook (new — fixes Reviewer 2 §7)

Included in PR G's release notes:

- How to pause the queue (`pnpm --filter control-plane queue:pause memory-ops`).
- How to force-fail all running jobs (`UPDATE memory_ops_jobs SET status='failed', error='manual_intervention' WHERE status='running'`).
- How to purge `memory_ops_job_events` older than 30 days.
- How to recover an orphaned `credential_id` on a peer (re-create provider locally; rebuild embeddings if content_model mismatches).
- How to trigger re-embed-all: **not available in v1**. Operator workaround: `UPDATE memory_facts SET embedding = NULL WHERE content_model = '<old>'` then run `embedding-backfill` with the new provider active. Document this gotcha in the runbook with a warning about downtime for memory search.

## 18. Acceptance Criteria

Data-size-invariant:

- Given an empty `api_accounts` list, opening Settings → Memory & Embeddings and adding an OpenAI provider with `model=text-embedding-3-small`, clicking Test shows `dim=1536, costUsd > 0, latencyMs > 0` before saving.
- With no provider configured, all 7 target views render `<MissingEmbeddingAlert />`. Import + ScopeManager do not.
- With an active provider and ≥ 1 fact having `embedding IS NULL`, triggering `embedding-backfill` from the Ops page updates both `embedding` and `content_model` columns for each processed fact, accumulates `progress.costUsd > 0`, and ends in `status='completed'`.
- Deleting an active provider while a job references it returns 409 with `blockingJobIds`. Deleting after cancelling the job returns 204.
- With two concurrent `POST /providers {active:true}` requests, at most one succeeds; the other returns 409 `DUPLICATE_ACTIVE_EMBEDDING`.
- Rotating a provider's key resets `lastTestOk=null` and clears `lastTestError`.
- With the OpenAI provider disconnected mid-job, the job transitions to `failed` with `error.code='PROVIDER_AUTH_FAILED'`, the provider's `is_active` becomes false, and the Ops detail drawer shows a Rotate Key CTA.
- Cancelling a running job mid-batch exits before the next batch starts, writes `status='cancelled'`, and does NOT transition to `completed` even if the handler returns naturally.
- SSE reconnect with `Last-Event-Id: <N>` replays events starting at N+1 from `memory_ops_job_events`.
- Peer mesh: creating a provider on machine A does NOT make it visible on machine B (expected, documented). Creating a job on A is visible on B with `credentialId` rendered as "provider: not visible on this machine".

Manual benchmark (documented, not enforced):

- 19,226 facts → OpenAI `text-embedding-3-small`: expected ≤ 8 minutes wall-clock, costUsd ≈ $0.08. Real numbers recorded in PR E by running against dev-1.

## 19. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| OpenAI/Gemini rate-limit storms | `EmbeddingClient` exponential backoff + `errorCount` per batch; retry budget = 3 per batch, total errors do not fail the job. |
| Mesh peer schema behind 0033 | Existing `sync_nodes_schema_ahead_rejection` (migration 0027) rejects cross-version sync. PR A plan adds a spec-coverage test. |
| User deletes a provider mid-job on a different tab | 409 blocks; UI shows `blockingJobIds`. |
| `memory_ops_job_events` grows unbounded | 7-day retention via existing `log-retention` worker (add an entry to its config). |
| pg_notify 8KB limit | Notify payload is just `job_id`. The SSE route fetches the latest event row(s). Log frames > 512 bytes are split. |
| 3rd-party provider changes OpenAI-compat URL | Catalog is the single source of truth; adding a new model only changes catalog entries + tests. |

## 20. Open Questions — none

The v0 spec's open questions are resolved and baked in. Any new ones are surfaced during the plan's PR-level task lists.

---

## Appendix A — Files modified / created (authoritative list)

Verified against 2026-04-24 codebase scan (`/tmp/memory-ops-rewrite-facts.md`).

### PR 0 (precursor)
- M: `packages/control-plane/src/memory/embedding-client.ts`
- M: `packages/control-plane/src/memory/embedding-client.test.ts`
- M: `packages/control-plane/src/api/routes/accounts.ts` (+ `.test.ts`) — add `credentialKind='runtime'` filter
- M: `packages/control-plane/src/scheduler/task-worker.ts` (+ `.test.ts`)
- M: `packages/control-plane/src/api/routes/sessions.ts` (+ `.test.ts`) — failover query filter
- M: `packages/control-plane/src/api/routes/oauth.ts` (+ `.test.ts`) — assertion check

### PR A
- A: `packages/control-plane/drizzle/0033_add_memory_ops.sql`
- M: `packages/control-plane/drizzle/meta/_journal.json`
- M: `packages/control-plane/src/db/schema.ts` + `.test.ts`
- M: `packages/shared/src/types/sync.ts` (+ `TABLE_SYNC_CONFIG` and `TABLE_PK_COLUMN` entries)
- A: `packages/shared/src/memory/providers.ts` + `.test.ts`
- A: `packages/shared/src/memory/ops.ts` + `.test.ts`
- M: `packages/shared/src/memory/index.ts`

### PR B
- A: `packages/control-plane/src/memory/embedding-client-factory.ts` + `.test.ts`
- A: `packages/control-plane/src/api/routes/memory-providers.ts` + `.test.ts`
- M: `packages/control-plane/src/api/server.ts` (register plugin under same guard as accounts)

### PR C
- A: `packages/web/src/lib/api/memory-providers.ts` + `.test.ts`
- A: `packages/web/src/components/memory/ProviderDialog.tsx` + `.test.tsx`
- A: `packages/web/src/views/settings/MemoryEmbeddingsSection.tsx` + `.test.tsx`
- M: `packages/web/src/views/SettingsView.tsx` — register nav item + section
- M: `packages/web/src/lib/api.ts` — re-export new client
- M: `packages/web/src/lib/queries.ts` — new hooks + `queryKeys.memory.providers`

### PR D
- A: `packages/control-plane/src/memory/ops/index.ts` (queue + data-type module)
- A: `packages/control-plane/src/memory/ops/jobs-repository.ts` + `.test.ts`
- A: `packages/control-plane/src/memory/ops/job-events-repository.ts` + `.test.ts`
- A: `packages/control-plane/src/memory/ops/audit-logger.ts` (MemoryOpsAuditLogger impl)
- A: `packages/control-plane/src/memory/ops/sse-stream.ts` + `.test.ts`
- A: `packages/control-plane/src/memory/ops/worker-runtime.ts` + `.test.ts`
- A: `packages/control-plane/src/api/routes/memory-ops.ts` + `.test.ts`
- M: `packages/control-plane/src/api/server.ts`
- M: `packages/control-plane/src/index.ts` — boot queue + SSE listener

### PR E
- A: `packages/control-plane/src/memory/ops/embedding-backfill.ts` + `.test.ts`
- A: `packages/control-plane/src/memory/ops/drawer-backfill.ts` + `.test.ts`
- A: `packages/control-plane/src/memory/ops/worker.ts` (BullMQ Worker)
- M: `packages/control-plane/src/index.ts`
- A: `packages/control-plane/src/memory/ops/e2e.test.ts` (with stub embedding server)

### PR F
- A: `packages/web/src/lib/api/memory-ops.ts` + `.test.ts`
- A: `packages/web/src/components/memory/JobCard.tsx` + `.test.tsx`
- A: `packages/web/src/components/memory/RecentJobsTable.tsx` + `.test.tsx`
- A: `packages/web/src/components/memory/JobDetailDrawer.tsx` + `.test.tsx`
- A: `packages/web/src/components/memory/MissingEmbeddingAlert.tsx` + `.test.tsx`
- A: `packages/web/src/components/memory/EgressConfirmationDialog.tsx` + `.test.tsx`
- A: `packages/web/src/views/MemoryOperationsPage.tsx` + `.test.tsx`
- A: `packages/web/src/app/memory/operations/page.tsx`
- M: each of `MemoryBrowserView` / `MemoryMaintenancePage` / `MemorySynthesisPage` / `MemoryDrawersView` / `KnowledgeGraphView` / `MemoryDashboardView` / `MemoryReportsView` — mount `<MissingEmbeddingAlert />`
- M: Memory sidebar config (find the real file in PR F planning step — `grep -n 'maintenance\|synthesis' packages/web/src/components/layout/ packages/web/src/config/`)
- M: `packages/web/src/lib/queries.ts`

### PR G
- A: `packages/control-plane/src/memory/ops/consolidation.ts` + `.test.ts`
- A: `packages/control-plane/src/memory/ops/synthesis.ts` + `.test.ts`
- A: `packages/web/tests/e2e/memory-ops/openai-happy.spec.ts`
- A: `packages/web/tests/e2e/memory-ops/gemini-happy.spec.ts`
- A: `packages/web/tests/e2e/memory-ops/missing-embedding-alert.spec.ts`
- M: `packages/control-plane/src/memory/ops/worker.ts` (add consolidation/synthesis cases)
- M: CHANGELOG.md (minor bump)
