# PR A — Foundation: Migration + Shared Types + EmbeddingClient

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Database schema for 3 new tables + api_accounts extensions. Shared TypeScript types. Additive EmbeddingClient extension. Filter all existing `api_accounts` reads by `credential_kind='runtime'`. No breaking changes to existing functionality.

**Architecture:** All changes are additive or filtered. The migration adds columns + tables without changing existing rows. The EmbeddingClient gains new optional options; callers are unchanged. The `credential_kind` filter is added to 6 routes and the scheduler — existing `api_accounts` rows automatically satisfy `credential_kind='runtime'` (the DEFAULT value).

**Tech Stack:** PostgreSQL + Drizzle ORM (schema only, no query builder for new tables yet), TypeScript, Zod, Vitest.

**Branch:** Create from `main`:
```bash
git worktree add .trees/pr-a -b agent/claude-1/feat/memory-ops-pr-a
cd .trees/pr-a
```

---

## Files

**Create:**
- `packages/control-plane/drizzle/0033_add_memory_ops.sql`
- `packages/control-plane/drizzle/0033_add_memory_ops.down.sql`
- `packages/shared/src/memory/providers.ts`
- `packages/shared/src/memory/ops.ts`
- `packages/shared/src/memory/ops-audit.ts`
- `packages/control-plane/src/memory/embedding-client-factory.test.ts` (Gate 1 contract test only)

**Modify:**
- `packages/control-plane/src/db/schema.ts` (lines 443–462: apiAccounts + append 3 new tables)
- `packages/shared/src/types/sync.ts` (lines 162+: TABLE_SYNC_CONFIG)
- `packages/control-plane/src/memory/embedding-client.ts` (additive: new options + `embedBatchWithUsage`)
- `packages/control-plane/src/api/routes/accounts.ts` — add `credential_kind='runtime'` filter
- `packages/control-plane/src/api/routes/sessions.ts` — add filter
- `packages/control-plane/src/api/routes/oauth.ts` — add filter
- `packages/control-plane/src/api/routes/settings.ts` — add filter + `INVALID_ACCOUNT_KIND` guard
- `packages/control-plane/src/api/routes/agents.ts` — add filter
- `packages/control-plane/src/scheduler/task-worker.ts` — add filter
- `packages/shared/src/index.ts` — re-export new modules

---

## Task 1: Write the migration SQL (up)

**Files:**
- Create: `packages/control-plane/drizzle/0033_add_memory_ops.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- packages/control-plane/drizzle/0033_add_memory_ops.sql

-- ============================================================
-- Group A — api_accounts extensions
-- ============================================================
ALTER TABLE api_accounts
  ADD COLUMN credential_kind text NOT NULL DEFAULT 'runtime',
  ADD CONSTRAINT api_accounts_kind_check
    CHECK (credential_kind IN ('runtime', 'embedding')),
  ADD COLUMN credential_last4 text;

CREATE UNIQUE INDEX api_accounts_one_active_embedding
  ON api_accounts (credential_kind)
  WHERE is_active = true AND credential_kind = 'embedding';

CREATE INDEX idx_api_accounts_kind ON api_accounts (credential_kind);

-- ============================================================
-- Group B — memory_ops_jobs (mesh-synced mutable)
-- ============================================================
CREATE TABLE memory_ops_jobs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                      text NOT NULL
                            CHECK (kind IN ('embedding-backfill','drawer-backfill',
                                            'consolidation','synthesis')),
  status                    text NOT NULL
                            CHECK (status IN ('queued','running','cancelling',
                                              'completed','failed','cancelled')),
  params                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress                  jsonb NOT NULL
                            DEFAULT '{"processed":0,"embedded":0,"failed":0,"total":0,"costUsd":0,"usageEstimated":false}'::jsonb,
  result                    jsonb,
  error                     text,
  error_code                text,
  credential_id             uuid,
  provider_kind             text,
  provider_model            text,
  provider_host             text,
  price_usd_per_mtoken      numeric(12,8),
  origin_machine_id         text NOT NULL,
  executor_machine_id       text NOT NULL,
  cancel_requested_at       timestamptz,
  started_at                timestamptz,
  finished_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  egress_confirmed_at       timestamptz,
  egress_confirmed_by       text,
  egress_snapshot           jsonb
);

CREATE INDEX idx_memory_ops_jobs_status_executor
  ON memory_ops_jobs (status, executor_machine_id);
CREATE INDEX idx_memory_ops_jobs_kind_created
  ON memory_ops_jobs (kind, created_at DESC);
-- Expression index — raw SQL only; Drizzle cannot express COALESCE in index().on().
-- CAUTION: Never drop this index in a future drizzle-kit migration.
CREATE INDEX idx_memory_ops_jobs_kind_scope_status
  ON memory_ops_jobs ((COALESCE(params->>'scope','')), kind, status);

CREATE TRIGGER sync_capture
  AFTER INSERT OR UPDATE OF status, result, finished_at, error, error_code,
                             cancel_requested_at
     OR DELETE
  ON memory_ops_jobs
  FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

-- ============================================================
-- Group C — memory_ops_job_events (LOCAL-ONLY)
-- ============================================================
CREATE TABLE memory_ops_job_events (
  event_id   bigserial PRIMARY KEY,
  job_id     uuid NOT NULL REFERENCES memory_ops_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL
             CHECK (event_type IN ('started','progress','log','completed',
                                   'failed','cancelled','cancelling')),
  level      text CHECK (level IN ('info','warn','error')),
  message    text,
  progress   jsonb,
  payload    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_ops_job_events_job ON memory_ops_job_events (job_id, event_id);
-- LOCAL-ONLY: NO sync_capture trigger. Not in TABLE_SYNC_CONFIG.

-- ============================================================
-- Group D — memory_ops_audit (LOCAL-ONLY)
-- ============================================================
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
-- LOCAL-ONLY. No sync_capture. Not in TABLE_SYNC_CONFIG.
```

- [ ] **Step 2: Create the rollback migration**

```sql
-- packages/control-plane/drizzle/0033_add_memory_ops.down.sql
DROP TABLE IF EXISTS memory_ops_job_events;
DROP TABLE IF EXISTS memory_ops_audit;
DROP TABLE IF EXISTS memory_ops_jobs;
DROP INDEX IF EXISTS api_accounts_one_active_embedding;
DROP INDEX IF EXISTS idx_api_accounts_kind;
ALTER TABLE api_accounts
  DROP COLUMN IF EXISTS credential_last4,
  DROP CONSTRAINT IF EXISTS api_accounts_kind_check,
  DROP COLUMN IF EXISTS credential_kind;
```

- [ ] **Step 3: Update the Drizzle journal**

```bash
# Drizzle journal lives at drizzle/meta/_journal.json
# Add an entry for 0033:
cd packages/control-plane
# Open drizzle/meta/_journal.json and append:
# { "idx": 33, "version": "7", "when": <unix-ms>, "tag": "0033_add_memory_ops", "breakpoints": true }
# Get current unix ms: node -e "console.log(Date.now())"
```

Open `packages/control-plane/drizzle/meta/_journal.json` and append entry. Copy the `idx`/`version` pattern from entry 32.

- [ ] **Step 4: Run migration against dev-1 to verify it applies cleanly**

```bash
source .env.dev-1
cd packages/control-plane
pnpm drizzle-kit migrate
# Expected: "0033_add_memory_ops.sql applied successfully"
```

- [ ] **Step 5: Verify rollback**

```bash
# Rollback is manual SQL — verify it doesn't error:
psql $DATABASE_URL -f drizzle/0033_add_memory_ops.down.sql
# Expected: DROP TABLE, DROP INDEX, ALTER TABLE — no errors
# Re-apply:
pnpm drizzle-kit migrate
```

---

## Task 2: Update Drizzle schema.ts with new table definitions

**Files:**
- Modify: `packages/control-plane/src/db/schema.ts`

- [ ] **Step 1: Write the failing test** (schema round-trip)

Create `packages/control-plane/src/db/schema.test.ts` has existing tests. Add to it:

```typescript
// In the existing schema.test.ts describe block, add:
it('memoryOpsJobs has correct column names', () => {
  // Drizzle table object exposes column names via [Symbol.for('drizzle:Name')]
  // Simplest check: the table export exists and has key columns
  expect(memoryOpsJobs).toBeDefined();
  expect(memoryOpsJobs.id).toBeDefined();
  expect(memoryOpsJobs.cancelRequestedAt).toBeDefined();
  expect(memoryOpsJobs.executorMachineId).toBeDefined();
});

it('memoryOpsJobEvents references memoryOpsJobs', () => {
  expect(memoryOpsJobEvents).toBeDefined();
  expect(memoryOpsJobEvents.jobId).toBeDefined();
});

it('memoryOpsAudit has actor/action/target columns', () => {
  expect(memoryOpsAudit).toBeDefined();
  expect(memoryOpsAudit.actor).toBeDefined();
  expect(memoryOpsAudit.action).toBeDefined();
});
```

- [ ] **Step 2: Run the test — expect failure** (exports don't exist yet)

```bash
cd packages/control-plane
pnpm vitest run src/db/schema.test.ts
# Expected: FAIL — memoryOpsJobs is not exported
```

- [ ] **Step 3: Add apiAccounts columns and new table definitions to schema.ts**

In `packages/control-plane/src/db/schema.ts`, modify the `apiAccounts` table (line 443) to add `credentialKind` and `credentialLast4`, then append the three new table definitions at the end of the file:

```typescript
// Modify apiAccounts table (around line 443):
export const apiAccounts = pgTable(
  'api_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    provider: text('provider').notNull(),
    credential: text('credential').notNull(),
    credentialIv: text('credential_iv').notNull(),
    priority: integer('priority').notNull().default(0),
    rateLimit: jsonb('rate_limit').default({}),
    isActive: boolean('is_active').default(true),
    metadata: jsonb('metadata').default({}),
    // NEW: credential_kind distinguishes runtime LLM accounts from embedding accounts
    credentialKind: text('credential_kind').notNull().default('runtime'),
    credentialLast4: text('credential_last4'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_api_accounts_provider').on(table.provider),
    index('idx_api_accounts_is_active').on(table.isActive),
    // Note: api_accounts_one_active_embedding partial unique index is raw-SQL only (migration 0033)
  ],
);
```

Append after the last table in the file:

```typescript
// CAUTION: idx_memory_ops_jobs_kind_scope_status is a raw-SQL expression index
// defined in migration 0033_add_memory_ops.sql. Never generate a DROP for it.
export const memoryOpsJobs = pgTable('memory_ops_jobs', {
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
  priceUsdPerMtoken: numeric('price_usd_per_mtoken', { precision: 12, scale: 8 }),
  originMachineId: text('origin_machine_id').notNull(),
  executorMachineId: text('executor_machine_id').notNull(),
  cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  egressConfirmedAt: timestamp('egress_confirmed_at', { withTimezone: true }),
  egressConfirmedBy: text('egress_confirmed_by'),
  egressSnapshot: jsonb('egress_snapshot'),
}, (table) => [
  index('idx_memory_ops_jobs_status_executor').on(table.status, table.executorMachineId),
  index('idx_memory_ops_jobs_kind_created').on(table.kind, table.createdAt),
  // idx_memory_ops_jobs_kind_scope_status — raw-SQL in migration 0033; omitted here intentionally.
]);

// LOCAL-ONLY: NOT in TABLE_SYNC_CONFIG.
export const memoryOpsJobEvents = pgTable('memory_ops_job_events', {
  eventId: bigserial('event_id', { mode: 'bigint' }).primaryKey(),
  jobId: uuid('job_id').notNull().references(() => memoryOpsJobs.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  level: text('level'),
  message: text('message'),
  progress: jsonb('progress'),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_memory_ops_job_events_job').on(table.jobId, table.eventId),
]);

// LOCAL-ONLY: NOT in TABLE_SYNC_CONFIG.
export const memoryOpsAudit = pgTable('memory_ops_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  target: text('target').notNull(),
  context: jsonb('context').notNull().default(sql`'{}'::jsonb`),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_memory_ops_audit_action_ts').on(table.action, table.timestamp),
  index('idx_memory_ops_audit_target').on(table.target),
]);
```

Make sure `sql` is imported from `drizzle-orm` at the top of schema.ts. Also import `numeric` and `bigserial` from `drizzle-orm/pg-core` if not already present.

- [ ] **Step 4: Run schema test — expect pass**

```bash
pnpm vitest run src/db/schema.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/drizzle/ packages/control-plane/src/db/schema.ts
git commit -m "feat(memory-ops): migration 0033 + Drizzle schema for memory ops tables"
```

---

## Task 3: Update TABLE_SYNC_CONFIG

**Files:**
- Modify: `packages/shared/src/types/sync.ts`

- [ ] **Step 1: Write failing test**

```typescript
// In packages/shared/src/types/sync.test.ts (or add to nearest existing test):
import { TABLE_SYNC_CONFIG } from './sync.js';
it('memory_ops_jobs is mesh-synced mutable', () => {
  expect(TABLE_SYNC_CONFIG['memory_ops_jobs']).toBe('mutable');
});
it('memory_ops_job_events is not in sync config', () => {
  expect(TABLE_SYNC_CONFIG['memory_ops_job_events']).toBeUndefined();
});
it('memory_ops_audit is not in sync config', () => {
  expect(TABLE_SYNC_CONFIG['memory_ops_audit']).toBeUndefined();
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd packages/shared
pnpm vitest run src/types/sync.test.ts
# Expected: FAIL — memory_ops_jobs not in config
```

- [ ] **Step 3: Add `memory_ops_jobs: 'mutable'` to TABLE_SYNC_CONFIG**

In `packages/shared/src/types/sync.ts` around line 178, inside `TABLE_SYNC_CONFIG`:

```typescript
  memory_ops_jobs: 'mutable',
  // memory_ops_job_events: intentionally absent — LOCAL-ONLY
  // memory_ops_audit: intentionally absent — LOCAL-ONLY
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm vitest run src/types/sync.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/sync.ts
git commit -m "feat(memory-ops): add memory_ops_jobs to TABLE_SYNC_CONFIG as mutable"
```

---

## Task 4: Shared types — providers, ops, ops-audit

**Files:**
- Create: `packages/shared/src/memory/providers.ts`
- Create: `packages/shared/src/memory/ops.ts`
- Create: `packages/shared/src/memory/ops-audit.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/shared/src/memory/providers.test.ts
import { EMBEDDING_MODEL_CATALOG, validateCatalog } from './providers.js';

it('catalog has openai text-embedding-3-small with verified:true', () => {
  const entry = EMBEDDING_MODEL_CATALOG.find(e => e.provider === 'openai');
  expect(entry).toBeDefined();
  expect(entry!.verified).toBe(true);
  expect(entry!.dim).toBe(1536);
});

it('catalog has gemini entry with verified:false', () => {
  const gemini = EMBEDDING_MODEL_CATALOG.find(e => e.provider === 'gemini');
  expect(gemini).toBeDefined();
  expect(gemini!.verified).toBe(false);
});

it('validateCatalog throws when verified entry has wrong dim', () => {
  expect(() => validateCatalog([{ provider: 'openai', model: 'x', dim: 768,
    baseUrl: 'https://a.com', embeddingsPath: '/v1/e', extraBody: {},
    pricePerMtoken: 0.02, verified: true }])).toThrow('CATALOG_INVALID');
});

it('validateCatalog passes for valid catalog', () => {
  expect(() => validateCatalog(EMBEDDING_MODEL_CATALOG)).not.toThrow();
});
```

```typescript
// packages/shared/src/memory/ops.test.ts
import { scopeNormalize } from './ops.js';

it('normalizes empty/blank scope to empty string', () => {
  expect(scopeNormalize('')).toBe('');
  expect(scopeNormalize('  ')).toBe('');
  expect(scopeNormalize(undefined)).toBe('');
});

it('trims and lowercases scope', () => {
  expect(scopeNormalize(' MyScope ')).toBe('myscope');
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd packages/shared
pnpm vitest run src/memory/
# Expected: FAIL — modules not found
```

- [ ] **Step 3: Create providers.ts**

```typescript
// packages/shared/src/memory/providers.ts

export type EmbeddingProviderKind = 'openai' | 'gemini';

export type EmbeddingCatalogEntry = {
  provider: EmbeddingProviderKind;
  model: string;
  dim: number;
  baseUrl: string;
  embeddingsPath: string;
  extraBody: Record<string, unknown>;
  pricePerMtoken: number; // USD per million tokens
  verified: boolean;      // false = hidden from UI until Gate 2 passes
};

export const EMBEDDING_MODEL_CATALOG: EmbeddingCatalogEntry[] = [
  {
    provider: 'openai',
    model: 'text-embedding-3-small',
    dim: 1536,
    baseUrl: 'https://api.openai.com',
    embeddingsPath: '/v1/embeddings',
    extraBody: {},
    pricePerMtoken: 0.02,
    verified: true,
  },
  {
    provider: 'gemini',
    model: 'gemini-embedding-001',
    dim: 1536,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    embeddingsPath: '/embeddings',
    extraBody: { output_dimensionality: 1536 },
    pricePerMtoken: 0.15,
    verified: false, // Gate 2 required before flipping to true
  },
];

export function validateCatalog(catalog: EmbeddingCatalogEntry[] = EMBEDDING_MODEL_CATALOG): void {
  for (const entry of catalog) {
    if (entry.verified && entry.dim !== 1536) {
      throw new Error(
        `CATALOG_INVALID: verified entry ${entry.provider}/${entry.model} has dim=${entry.dim}, expected 1536`,
      );
    }
  }
}

export type EmbeddingProvider = {
  id: string;
  name: string;
  provider: EmbeddingProviderKind;
  model: string;
  apiKeyLast4: string | null;
  isActive: boolean;
  metadata: EmbeddingProviderMetadata;
  createdAt: string;
  updatedAt: string;
};

export type EmbeddingProviderMetadata = {
  lastTestOk: boolean | null;
  lastTestError: string | null;
  lastTestedAt: string | null;
  dim: number | null;
  latencyMs: number | null;
  costUsd: number | null;
};

export type EgressSnapshot = {
  kind: 'embedding-backfill' | 'drawer-backfill';
  providerKind: string;
  providerModel: string;
  providerHost: string;
  priceUsdPerMtoken: number;
  rowCount?: number;
  chunkCount?: number;
  fileCount?: number;
  totalBytes?: number;
  tokenEstimate: number;
  costEstimate: number;
  contentClass: 'memory-facts' | 'drawer-source-files';
  computedAt: string;
};
```

- [ ] **Step 4: Create ops.ts**

```typescript
// packages/shared/src/memory/ops.ts

export type MemoryOpsJobKind =
  | 'embedding-backfill'
  | 'drawer-backfill'
  | 'consolidation'
  | 'synthesis';

export type MemoryOpsJobStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type MemoryOpsProgress = {
  processed: number;
  embedded: number;
  failed: number;
  total: number;
  costUsd: number;
  usageEstimated: boolean;
  etaSeconds?: number;
  currentBatch?: number;
};

export type MemoryOpsJob = {
  id: string;
  kind: MemoryOpsJobKind;
  status: MemoryOpsJobStatus;
  params: Record<string, unknown>;
  progress: MemoryOpsProgress;
  result: Record<string, unknown> | null;
  error: string | null;
  errorCode: string | null;
  credentialId: string | null;
  providerKind: string | null;
  providerModel: string | null;
  providerHost: string | null;
  priceUsdPerMtoken: string | null;
  originMachineId: string;
  executorMachineId: string;
  cancelRequestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  egressConfirmedAt: string | null;
  egressConfirmedBy: string | null;
  egressSnapshot: Record<string, unknown> | null;
};

/** Normalize a scope string: trim + lowercase + treat blank as empty string. */
export function scopeNormalize(scope: string | undefined | null): string {
  return (scope ?? '').trim().toLowerCase();
}

export const MEMORY_OPS_JOB_KINDS = [
  'embedding-backfill',
  'drawer-backfill',
  'consolidation',
  'synthesis',
] as const satisfies MemoryOpsJobKind[];

export const REQUIRES_PROVIDER: Record<MemoryOpsJobKind, boolean> = {
  'embedding-backfill': true,
  'drawer-backfill': true,
  'consolidation': false,
  'synthesis': false,
};
```

- [ ] **Step 5: Create ops-audit.ts**

```typescript
// packages/shared/src/memory/ops-audit.ts

export type MemoryOpsAuditAction =
  | 'provider.create'
  | 'provider.update'
  | 'provider.delete'
  | 'provider.rotate-key'
  | 'provider.test-ephemeral'
  | 'provider.test-succeeded'
  | 'provider.test-failed'
  | 'job.create'
  | 'job.cancel'
  | 'job.complete'
  | 'job.fail';

const SENSITIVE_KEY_PATTERN = /key|token|secret|password|credential/i;

/** Recursively remove sensitive keys from a context object. Max 64KB. */
export function redactSensitiveKeys(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const json = JSON.stringify(obj);
  if (json.length > 65_536) {
    return { _truncated: true, _originalSize: json.length };
  }
  return redactDeep(obj) as Record<string, unknown>;
}

function redactDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactDeep);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    result[k] = SENSITIVE_KEY_PATTERN.test(k) ? '[REDACTED]' : redactDeep(v);
  }
  return result;
}
```

- [ ] **Step 6: Re-export from shared index**

In `packages/shared/src/index.ts`, add exports:

```typescript
export * from './memory/providers.js';
export * from './memory/ops.js';
export * from './memory/ops-audit.js';
```

- [ ] **Step 7: Run tests — expect pass**

```bash
cd packages/shared
pnpm vitest run src/memory/
# Expected: PASS (all tests)
```

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/memory/ packages/shared/src/index.ts
git commit -m "feat(memory-ops): shared types — providers, ops, ops-audit, scopeNormalize"
```

---

## Task 5: EmbeddingClient additive extension

**Files:**
- Modify: `packages/control-plane/src/memory/embedding-client.ts`
- Test: `packages/control-plane/src/memory/embedding-client.test.ts`

Current `EmbeddingClient` (line 31) has `embedBatch(texts): Promise<number[][]>`. We add `apiKey`, `extraBody`, `embeddingsPath` options and `embedBatchWithUsage()`.

- [ ] **Step 1: Write failing tests**

```typescript
// Add to existing embedding-client.test.ts:
describe('EmbeddingClient additive extensions', () => {
  it('uses Authorization: Bearer header when apiKey provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: Array(1536).fill(0.1) }], usage: { prompt_tokens: 10 }, model: 'text-embedding-3-small' }),
    });
    const client = new EmbeddingClient({
      baseUrl: 'https://api.openai.com',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test-1234',
      logger: silentLogger,
      fetch: fetchMock,
    });
    await client.embedBatch(['hello']);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test-1234' }),
      }),
    );
  });

  it('embedBatchWithUsage returns vectors and promptTokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: Array(1536).fill(0.5) }],
        usage: { prompt_tokens: 25 },
        model: 'text-embedding-3-small',
      }),
    });
    const client = new EmbeddingClient({
      baseUrl: 'https://api.openai.com',
      model: 'text-embedding-3-small',
      logger: silentLogger,
      fetch: fetchMock,
    });
    const result = await client.embedBatchWithUsage(['world']);
    expect(result.vectors).toHaveLength(1);
    expect(result.usage.promptTokens).toBe(25);
    expect(result.model).toBe('text-embedding-3-small');
  });

  it('merges extraBody after base body without overriding model', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: Array(1536).fill(0.1) }],
        usage: { prompt_tokens: 5 },
        model: 'gemini-embedding-001',
      }),
    });
    const client = new EmbeddingClient({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-embedding-001',
      embeddingsPath: '/embeddings',
      extraBody: { output_dimensionality: 1536, model: 'SHOULD_NOT_OVERRIDE' },
      logger: silentLogger,
      fetch: fetchMock,
    });
    await client.embedBatch(['test']);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe('gemini-embedding-001'); // not overridden by extraBody
    expect(body.output_dimensionality).toBe(1536);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd packages/control-plane
pnpm vitest run src/memory/embedding-client.test.ts
# Expected: FAIL — EmbeddingClientOptions has no apiKey/extraBody/embeddingsPath; embedBatchWithUsage missing
```

- [ ] **Step 3: Extend EmbeddingClientOptions and add embedBatchWithUsage**

In `packages/control-plane/src/memory/embedding-client.ts`, extend `EmbeddingClientOptions` and add the new method. All existing callers pass only `baseUrl`, `model`, `logger` — these remain unchanged:

```typescript
export type EmbeddingClientOptions = {
  baseUrl: string;
  model: string;
  logger: Logger;
  apiKey?: string;
  extraBody?: Record<string, unknown>;
  embeddingsPath?: string;
  fetch?: typeof globalThis.fetch; // for testing
};
```

In the `embedBatch` method, change the URL construction from hardcoded `/v1/embeddings`:
```typescript
const path = this.options.embeddingsPath ?? '/v1/embeddings';
const url = `${this.baseUrl}${path}`;
```

Add `Authorization` header when `apiKey` present. Merge `extraBody` after base body but protect `model`/`input`:
```typescript
const baseBody = { model: this.model, input: texts };
const body = { ...this.options.extraBody, ...baseBody }; // base overrides extraBody
```

Add `Authorization` to headers:
```typescript
const headers: Record<string, string> = { 'Content-Type': 'application/json' };
if (this.options.apiKey) {
  headers['Authorization'] = `Bearer ${this.options.apiKey}`;
}
```

Add the `embedBatchWithUsage` method:
```typescript
async embedBatchWithUsage(texts: string[]): Promise<{
  vectors: number[][];
  usage: { promptTokens: number };
  model: string;
}> {
  // Reuse embedBatch internals — make a private method that returns raw response
  const path = this.options.embeddingsPath ?? '/v1/embeddings';
  const url = `${this.baseUrl}${path}`;
  const baseBody = { model: this.model, input: texts };
  const body = { ...this.options.extraBody, ...baseBody };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (this.options.apiKey) headers['Authorization'] = `Bearer ${this.options.apiKey}`;

  const fetchFn = this.options.fetch ?? globalThis.fetch;
  const resp = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!resp.ok) {
    throw new ControlPlaneError('EMBEDDING_API_ERROR', `Embedding API error ${resp.status}`, { status: resp.status });
  }
  const data = await resp.json() as { data: Array<{embedding: number[]}>; usage: {prompt_tokens: number}; model: string };
  return {
    vectors: data.data.map(d => d.embedding),
    usage: { promptTokens: data.usage.prompt_tokens },
    model: data.model,
  };
}
```

Note: `ControlPlaneError.context` gains `status: number` here. Verify the existing `ControlPlaneError` class accepts this.

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm vitest run src/memory/embedding-client.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/memory/embedding-client.ts packages/control-plane/src/memory/embedding-client.test.ts
git commit -m "feat(memory-ops): additive EmbeddingClient — apiKey, extraBody, embeddingsPath, embedBatchWithUsage"
```

---

## Task 6: credential_kind filter on existing routes

**Files:**
- Modify: `packages/control-plane/src/api/routes/accounts.ts`
- Modify: `packages/control-plane/src/api/routes/sessions.ts`
- Modify: `packages/control-plane/src/api/routes/oauth.ts`
- Modify: `packages/control-plane/src/api/routes/settings.ts`
- Modify: `packages/control-plane/src/api/routes/agents.ts`
- Modify: `packages/control-plane/src/scheduler/task-worker.ts`

All `api_accounts` queries in these files must add `AND credential_kind = 'runtime'` (or its Drizzle equivalent `eq(apiAccounts.credentialKind, 'runtime')`).

- [ ] **Step 1: Write failing test for accounts route**

```typescript
// In packages/control-plane/src/api/routes/accounts.test.ts (or nearest test file)
// Add scenario: embedding account is NOT returned by GET /api/accounts
it('GET /api/accounts excludes embedding-kind accounts', async () => {
  // seed: one runtime account + one embedding account
  // assert only runtime account appears in response
  const app = await buildTestApp(db);
  await db.insert(apiAccounts).values([
    { id: uuid1, name: 'Runtime', provider: 'anthropic', credential: 'enc', credentialIv: 'iv',
      credentialKind: 'runtime' },
    { id: uuid2, name: 'Embedding', provider: 'openai', credential: 'enc', credentialIv: 'iv',
      credentialKind: 'embedding' },
  ]);
  const res = await app.inject({ method: 'GET', url: '/api/accounts' });
  const body = res.json();
  expect(body.accounts.map((a: {id:string}) => a.id)).toContain(uuid1);
  expect(body.accounts.map((a: {id:string}) => a.id)).not.toContain(uuid2);
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm vitest run src/api/routes/accounts.test.ts
# Expected: FAIL — embedding account appears in results
```

- [ ] **Step 3: Add credential_kind filter to accounts.ts**

Find all `db.select().from(apiAccounts)` calls in `accounts.ts`. Add `.where(eq(apiAccounts.credentialKind, 'runtime'))` (or append with `and(existingWhere, eq(...))` if there's already a WHERE clause).

The pattern appears in at minimum: GET list, GET by id, PATCH, DELETE handlers.

Example change for a list query:
```typescript
// Before:
const accounts = await db.select().from(apiAccounts).where(eq(apiAccounts.isActive, true));
// After:
const accounts = await db.select().from(apiAccounts).where(
  and(eq(apiAccounts.isActive, true), eq(apiAccounts.credentialKind, 'runtime'))
);
```

Apply to ALL reads of `api_accounts` in accounts.ts. Import `and` from `drizzle-orm` if not already imported.

- [ ] **Step 4: Apply same filter pattern to sessions.ts, oauth.ts, agents.ts, task-worker.ts**

Each file that queries `api_accounts` needs the filter. Use `grep` to find them:
```bash
grep -n "apiAccounts\|api_accounts" \
  src/api/routes/sessions.ts \
  src/api/routes/oauth.ts \
  src/api/routes/agents.ts \
  src/scheduler/task-worker.ts
```

For each match, add `eq(apiAccounts.credentialKind, 'runtime')` to the WHERE clause.

- [ ] **Step 5: settings.ts — add INVALID_ACCOUNT_KIND guard**

In `settings.ts`, the `PUT /api/settings/defaults` handler (around line 54) validates `defaultAccountId`. Add a check that the resolved account has `credential_kind='runtime'`:

```typescript
// After fetching the account by id:
if (account.credentialKind !== 'runtime') {
  throw new ControlPlaneError(
    'INVALID_ACCOUNT_KIND',
    'defaultAccountId must reference a runtime account, not an embedding account',
    { expectedKind: 'runtime', actualKind: account.credentialKind },
  );
}
```

- [ ] **Step 6: Run all modified route tests**

```bash
pnpm vitest run src/api/routes/accounts.test.ts src/api/routes/settings.test.ts
# Expected: PASS
```

- [ ] **Step 7: Full CP test suite to verify no regressions**

```bash
pnpm vitest run
# Expected: all tests pass; pay attention to any failure in accounts/sessions/agents
```

- [ ] **Step 8: Commit**

```bash
git add packages/control-plane/src/api/routes/ packages/control-plane/src/scheduler/
git commit -m "feat(memory-ops): filter api_accounts reads by credential_kind='runtime' on all existing routes"
```

---

## Task 7: Gate 1 contract test + build verify

**Files:**
- Create: `packages/control-plane/src/memory/ops/embedding-client-factory.test.ts` (Gate 1 test only — rest of factory is PR B)

- [ ] **Step 1: Write Gate 1 contract test (skipped in CI by default)**

```typescript
// packages/control-plane/src/memory/ops/embedding-client-factory.test.ts
import { describe, it, expect } from 'vitest';

// Gate 1: Gemini OpenAI-compat endpoint returns 401 for fake key (not 404/ENOTFOUND)
// This test makes a REAL HTTP request. It is skipped in CI unless GATE1_LIVE=true.
describe.skipIf(!process.env.GATE1_LIVE)('Gate 1 — Gemini URL contract', () => {
  it('returns 401 for fake API key (not 404 or network error)', async () => {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/openai/embeddings',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer fake-key-gate1-test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'gemini-embedding-001', input: ['test'] }),
      },
    );
    expect(res.status).toBe(401);
  }, 10_000);
});
```

- [ ] **Step 2: Verify Gate 1 manually before merging**

```bash
GATE1_LIVE=true pnpm vitest run src/memory/ops/embedding-client-factory.test.ts
# Expected: PASS with real HTTP response 401
# Record result: "Gate 1 verified YYYY-MM-DD — returns 401" in PR description
```

- [ ] **Step 3: Full build**

```bash
cd /path/to/repo-root
pnpm build
# Expected: 0 TypeScript errors across all packages
```

- [ ] **Step 4: Full lint**

```bash
pnpm lint
# Expected: 0 Biome errors
```

- [ ] **Step 5: Commit + push**

```bash
git add packages/control-plane/src/memory/ops/embedding-client-factory.test.ts
git commit -m "test(memory-ops): Gate 1 contract test for Gemini OpenAI-compat endpoint"
git push origin agent/claude-1/feat/memory-ops-pr-a
```

- [ ] **Step 6: Open PR**

```bash
gh pr create \
  --base main \
  --title "feat(memory-ops): PR A — migration 0033, shared types, EmbeddingClient extension" \
  --body "$(cat <<'EOF'
## Summary
- Migration 0033: api_accounts + memory_ops_jobs + memory_ops_job_events + memory_ops_audit
- Drizzle schema for all 3 new tables
- Shared types: EmbeddingProvider, MemoryOpsJob, scopeNormalize, EMBEDDING_MODEL_CATALOG (Gemini verified:false)
- EmbeddingClient additive: apiKey, extraBody, embeddingsPath, embedBatchWithUsage
- credential_kind='runtime' filter on 6 existing routes + scheduler
- INVALID_ACCOUNT_KIND guard on PUT /api/settings/defaults
- Gate 1 verified: Gemini URL returns 401 for fake key

## Gate 1 result
Verified YYYY-MM-DD: `curl https://generativelanguage.googleapis.com/v1beta/openai/embeddings` with fake key → 401

## Test plan
- [ ] pnpm vitest run (all packages)
- [ ] pnpm build (0 TS errors)
- [ ] pnpm lint (0 Biome errors)
- [ ] drizzle-kit migrate on dev-1 succeeds
- [ ] Rollback SQL executes cleanly
EOF
)"
```
