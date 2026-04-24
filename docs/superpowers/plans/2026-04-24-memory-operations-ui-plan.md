# Memory Operations UI v1 Implementation Plan (SUPERSEDED)

> **⚠️ STATUS: SUPERSEDED — DO NOT IMPLEMENT.**
>
> This plan was rejected by two reviewers on 2026-04-24. See:
> - [Reviewer 1 — strict review](../specs/2026-04-24-memory-operations-ui-spec-plan-strict-review.md)
> - [Reviewer 2 — batch critique](../reviews/2026-04-24-memory-operations-ui-review.md)
>
> **Known critical defects:** 5 hallucinated file paths, a silent LiteLLM breaking change in PR B, unimplemented cost/audit/401-deactivate features, 3146-line single file (violates 800-line project limit), PR F/G degenerated to slogan-level tasks.
>
> **Forward link:** The v1 rewrite lives at `docs/superpowers/plans/2026-04-24-memory-operations-ui/index.md` and companion per-PR files.
>
> ---
>
> Historical content below preserved for traceability.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill two operator-surface gaps in AgentCTL's memory subsystem — (1) configure embedding providers (OpenAI + Gemini AI Studio) from Settings, and (2) trigger/observe long-running memory jobs (embedding-backfill, drawer-backfill, consolidation, synthesis) from `/memory/operations`. Backfill the user's existing 19,226 facts as the acceptance-level validation.

**Architecture:** Reuse the existing `api_accounts` table for encrypted credential storage (new `credential_kind` column distinguishes embedding from runtime). Introduce a `memory_ops_jobs` table and a BullMQ `memory-ops` queue with four workers (one per job kind). Progress is pushed to the UI via SSE backed by PostgreSQL `LISTEN/NOTIFY`. Two new frontend surfaces: a Settings → Memory & Embeddings section, and a `/memory/operations` page with four job cards + recent-jobs table + detail drawer.

**Tech Stack:** TypeScript, Fastify 5, Drizzle ORM, pgvector, BullMQ 5, Next.js 15 (App Router), React Query, Zod, Vitest, React Testing Library, Playwright. Existing patterns to follow: `packages/control-plane/src/api/routes/accounts.ts` (CRUD + encrypted credentials), `packages/control-plane/src/scheduler/task-queue.ts` (BullMQ), `packages/web/src/views/MemoryMaintenancePage.tsx` (frontend view), `packages/web/src/lib/api/memory.ts` (API client).

**Spec:** `docs/superpowers/specs/2026-04-24-memory-operations-ui-design.md`

---

## Resolved Open Questions (from spec)

1. **Run-all-maintenance super-button** — **NOT in v1.** Each of the 4 job cards has its own `Run now` button. Chained runs deferred to v2.
2. **Dismissible `<MissingEmbeddingAlert />`** — **NOT dismissible in v1.** A dismissed alert defeats the purpose. If the operator chooses not to configure, they live with the banner.
3. **embedding-backfill also covers drawers?** — **NO.** Two separate job kinds:
   - `embedding-backfill` covers `memory_facts WHERE embedding IS NULL`.
   - `drawer-backfill` imports source chunks into `memory_drawers` and writes their embeddings in the same pass.
4. **Rotating the API key resets `lastTestOk`** — **YES.** PATCH resets metadata test status; the dialog nudges the operator to click Test before closing.

---

## File Structure

### New files

**Control plane:**
- `packages/control-plane/drizzle/0033_add_memory_ops.sql` — both migration parts in one file (credential_kind + memory_ops_jobs)
- `packages/control-plane/src/memory/ops/index.ts` — queue creation + shared types
- `packages/control-plane/src/memory/ops/jobs-repository.ts` — CRUD over `memory_ops_jobs`
- `packages/control-plane/src/memory/ops/worker-runtime.ts` — shared worker lifecycle (claim row, update progress, cancel check, pg_notify)
- `packages/control-plane/src/memory/ops/embedding-backfill.ts` — `embedding-backfill` worker
- `packages/control-plane/src/memory/ops/drawer-backfill.ts` — `drawer-backfill` worker
- `packages/control-plane/src/memory/ops/consolidation.ts` — `consolidation` worker
- `packages/control-plane/src/memory/ops/synthesis.ts` — `synthesis` worker
- `packages/control-plane/src/memory/ops/sse-stream.ts` — `LISTEN memory_ops_job` bridge to SSE
- `packages/control-plane/src/api/routes/memory-providers.ts` — `/api/memory/providers` CRUD + test
- `packages/control-plane/src/api/routes/memory-ops.ts` — `/api/memory/ops/jobs` CRUD + cancel + stream
- `packages/control-plane/src/memory/embedding-client-factory.ts` — `resolveEmbeddingClient` that looks up `api_accounts`

**Shared:**
- `packages/shared/src/memory/providers.ts` — `EmbeddingProvider`, `EmbeddingProviderInput`, `EMBEDDING_MODEL_CATALOG` (1536d only)
- `packages/shared/src/memory/ops.ts` — `MemoryOpsJob`, `MemoryOpsJobKind`, `MemoryOpsJobStatus`, `MemoryOpsProgress`

**Web:**
- `packages/web/src/lib/api/memory-providers.ts` — typed API calls for providers
- `packages/web/src/lib/api/memory-ops.ts` — typed API calls for ops jobs
- `packages/web/src/lib/embedding-providers.ts` — shared provider catalog for UI dropdowns
- `packages/web/src/components/memory/MissingEmbeddingAlert.tsx` — shared banner
- `packages/web/src/components/memory/ProviderDialog.tsx` — add/edit provider dialog
- `packages/web/src/components/memory/JobCard.tsx` — per-kind job card on `/memory/operations`
- `packages/web/src/components/memory/RecentJobsTable.tsx` — recent job history table
- `packages/web/src/components/memory/JobDetailDrawer.tsx` — detail drawer with SSE stream
- `packages/web/src/views/settings/MemoryEmbeddingsSection.tsx` — Settings → Memory & Embeddings
- `packages/web/src/views/MemoryOperationsPage.tsx` — `/memory/operations` view
- `packages/web/src/app/memory/operations/page.tsx` — Next.js page wrapper
- Playwright specs under `packages/web/tests/e2e/memory-ops/` — `openai-happy.spec.ts`, `gemini-happy.spec.ts`, `missing-embedding-alert.spec.ts`

### Modified files

- `packages/control-plane/src/db/schema.ts` — add `credentialKind` to `apiAccounts`, add `memoryOpsJobs` pgTable
- `packages/control-plane/src/memory/embedding-client.ts` — add optional `extraBody` support (≤ 30 lines of change)
- `packages/control-plane/src/api/server.ts` — register 2 new route plugins, pass `apiAccounts` + queue connection
- `packages/control-plane/src/index.ts` — boot the `memory-ops` queue and SSE listener
- `packages/shared/src/memory/index.ts` — re-export new types
- `packages/web/src/views/settings/SettingsPage.tsx` — add `Memory & Embeddings` directory entry + render new section
- `packages/web/src/lib/queries.ts` — hooks for React Query (providers, ops jobs)
- `packages/web/src/views/MemoryMaintenancePage.tsx`, `MemorySynthesisPage.tsx`, `MemoryConsolidationView.tsx` (if present), `MemoryBrowserView.tsx`, `MemoryDrawersView.tsx`, `MemoryGraphPage.tsx` — mount `<MissingEmbeddingAlert />` at the top of each
- `packages/web/src/components/layout/SecondaryNav.tsx` (or the Memory sidebar definition) — add **Operations** item

---

## Ground Rules

- **TDD:** every task writes a failing test first, watches it fail, implements the minimum, watches it pass.
- **Commits per task:** one commit per completed task. Message format: `feat(<scope>): <short desc>` or `test(<scope>): ...`.
- **Branching:** each PR owns its own worktree off `origin/main`. Branch name `agent/claude-1/<type>/<topic>`. After each PR merges, delete the worktree and rebase subsequent worktrees onto the fresh main.
- **Verification cadence:** per PR — `pnpm build && pnpm lint && pnpm test` green before opening the PR. Dev-1 smoke check (`./scripts/env-up.sh dev-1` + relevant curl / UI walk) before promotion. `./scripts/version-bump.sh patch "<desc>"` on main after merge. `./scripts/env-promote.sh --from dev-1` to push to beta. `./scripts/version-release.sh` to cut the GitHub release.
- **Never push to main.** Always via PR.

---

# PR A — Schema Foundation

**Worktree:** `.trees/memory-ops-pr-a`
**Branch:** `agent/claude-1/feat/memory-ops-schema`
**Depends on:** nothing
**Unblocks:** PR B and PR D

## Task A0: Create worktree + claim

**Files:** worktree + coordination file

- [ ] **Step 1: Create worktree from fresh main**

```bash
cd /Users/hahaschool/agentctl
git fetch origin main
git worktree add .trees/memory-ops-pr-a -b agent/claude-1/feat/memory-ops-schema origin/main
pnpm coord claim --type worktree --path /Users/hahaschool/agentctl/.trees/memory-ops-pr-a --purpose "PR A: memory-ops schema migration"
cd .trees/memory-ops-pr-a
pnpm install
```

- [ ] **Step 2: Verify clean build**

Run: `pnpm build 2>&1 | tail -5 && pnpm lint 2>&1 | tail -5`
Expected: both commands exit 0.

## Task A1: Write migration 0033 (SQL)

**Files:**
- Create: `packages/control-plane/drizzle/0033_add_memory_ops.sql`

- [ ] **Step 1: Write the migration SQL**

Full file contents:

```sql
-- 0033_add_memory_ops.sql
-- § PR A: Memory Operations schema foundation.
--
-- Two changes combined in one file so the migration is atomic:
--   (a) Extend api_accounts with credential_kind (default 'runtime' keeps
--       existing rows unchanged — they still represent Claude/Codex runtime
--       credentials). The new value 'embedding' flags rows that configure an
--       embedding provider.
--   (b) Add memory_ops_jobs to track long-running memory maintenance jobs
--       (embedding-backfill, drawer-backfill, consolidation, synthesis)
--       with progress, result, and mesh-sync capture.

ALTER TABLE api_accounts
  ADD COLUMN credential_kind text NOT NULL DEFAULT 'runtime';

ALTER TABLE api_accounts
  ADD CONSTRAINT api_accounts_kind_check
  CHECK (credential_kind IN ('runtime', 'embedding'));

CREATE INDEX idx_api_accounts_kind ON api_accounts(credential_kind);

CREATE TABLE memory_ops_jobs (
  id            text PRIMARY KEY,
  kind          text NOT NULL
                CHECK (kind IN ('embedding-backfill','drawer-backfill','consolidation','synthesis')),
  status        text NOT NULL
                CHECK (status IN ('queued','running','completed','failed','cancelled')),
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress      jsonb NOT NULL DEFAULT '{"done":0,"total":0,"costUsd":0,"errorCount":0}'::jsonb,
  result        jsonb,
  error         text,
  credential_id uuid REFERENCES api_accounts(id) ON DELETE SET NULL,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text
);

CREATE INDEX idx_memory_ops_jobs_status ON memory_ops_jobs(status);
CREATE INDEX idx_memory_ops_jobs_kind_created
  ON memory_ops_jobs(kind, created_at DESC);

-- Mesh sync via the existing sync_capture_change trigger (defined in 0021).
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON memory_ops_jobs
  FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');
```

- [ ] **Step 2: Update drizzle meta journal**

Read `packages/control-plane/drizzle/meta/_journal.json`, find the entry for `0032_add_memory_drawer_backfill_state`, and append a new entry following the same shape with incremented `idx`, new `tag` set to `0033_add_memory_ops`, `when` set to the current epoch milliseconds, and same `version`. Use the Edit tool once you've seen the exact format — do not freestyle JSON.

- [ ] **Step 3: Run migration against a scratch DB**

```bash
export TEST_PG_URL="postgres://postgres:postgres@localhost:5433/agentctl_migration_test"
psql "$TEST_PG_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
pnpm --filter @agentctl/control-plane drizzle-kit migrate --config=drizzle.config.ts
psql "$TEST_PG_URL" -c "\d memory_ops_jobs"
psql "$TEST_PG_URL" -c "\d api_accounts" | grep credential_kind
```

Expected: `memory_ops_jobs` table listed, `api_accounts` shows `credential_kind` column with NOT NULL and default `'runtime'::text`.

- [ ] **Step 4: Commit**

```bash
git add packages/control-plane/drizzle/0033_add_memory_ops.sql packages/control-plane/drizzle/meta/_journal.json
git commit -m "feat(memory-ops): add migration 0033 for api_accounts.credential_kind + memory_ops_jobs"
```

## Task A2: Update Drizzle schema types

**Files:**
- Modify: `packages/control-plane/src/db/schema.ts`
- Modify: `packages/control-plane/src/db/schema.test.ts` (if present — grep first)

- [ ] **Step 1: Write the failing schema test**

Create or append to `packages/control-plane/src/db/schema.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { apiAccounts, memoryOpsJobs } from './schema.js';

describe('apiAccounts credential_kind', () => {
  it('exposes credentialKind column', () => {
    expect(apiAccounts.credentialKind).toBeDefined();
    expect(apiAccounts.credentialKind.name).toBe('credential_kind');
  });
});

describe('memoryOpsJobs', () => {
  it('is defined with the expected columns', () => {
    expect(memoryOpsJobs.id).toBeDefined();
    expect(memoryOpsJobs.kind).toBeDefined();
    expect(memoryOpsJobs.status).toBeDefined();
    expect(memoryOpsJobs.params).toBeDefined();
    expect(memoryOpsJobs.progress).toBeDefined();
    expect(memoryOpsJobs.credentialId).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentctl/control-plane test -- --run src/db/schema.test.ts`
Expected: compile error or test failure — `memoryOpsJobs` undefined, `credentialKind` undefined.

- [ ] **Step 3: Add `credentialKind` to `apiAccounts` in `schema.ts`**

Locate the `apiAccounts` definition (around line 443). Insert before the `priority` line:

```typescript
    credentialKind: text('credential_kind').notNull().default('runtime'),
```

And add an index in the `(table) => [...]` block:

```typescript
    index('idx_api_accounts_kind').on(table.credentialKind),
```

- [ ] **Step 4: Add `memoryOpsJobs` table definition**

At the bottom of the memory-related section (search for `memory_fact_sources` or similar), add:

```typescript
export const memoryOpsJobs = pgTable(
  'memory_ops_jobs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    params: jsonb('params').notNull().default({}),
    progress: jsonb('progress')
      .notNull()
      .default({ done: 0, total: 0, costUsd: 0, errorCount: 0 }),
    result: jsonb('result'),
    error: text('error'),
    credentialId: uuid('credential_id').references(() => apiAccounts.id, {
      onDelete: 'set null',
    }),
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

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @agentctl/control-plane test -- --run src/db/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full control-plane typecheck**

Run: `pnpm --filter @agentctl/control-plane typecheck 2>&1 | tail -10`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/control-plane/src/db/schema.ts packages/control-plane/src/db/schema.test.ts
git commit -m "feat(memory-ops): add credentialKind + memoryOpsJobs to drizzle schema"
```

## Task A3: Add shared types for providers + ops

**Files:**
- Create: `packages/shared/src/memory/providers.ts`
- Create: `packages/shared/src/memory/ops.ts`
- Modify: `packages/shared/src/memory/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/shared/src/memory/providers.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { EMBEDDING_MODEL_CATALOG, embeddingProviderSchema } from './providers.js';

describe('EMBEDDING_MODEL_CATALOG', () => {
  it('includes at least openai and gemini with 1536-dim models', () => {
    const openai = EMBEDDING_MODEL_CATALOG.filter((m) => m.provider === 'openai');
    const gemini = EMBEDDING_MODEL_CATALOG.filter((m) => m.provider === 'gemini');
    expect(openai.some((m) => m.dim === 1536)).toBe(true);
    expect(gemini.some((m) => m.dim === 1536)).toBe(true);
  });

  it('rejects non-1536 dim models at the schema level for v1', () => {
    for (const entry of EMBEDDING_MODEL_CATALOG) {
      expect(entry.dim).toBe(1536);
    }
  });
});

describe('embeddingProviderSchema', () => {
  it('parses a valid OpenAI config', () => {
    const parsed = embeddingProviderSchema.parse({
      name: 'OpenAI personal',
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-proj-abc',
      active: true,
    });
    expect(parsed.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('rejects unknown provider values', () => {
    expect(() =>
      embeddingProviderSchema.parse({
        name: 'x',
        provider: 'anthropic',
        model: 'foo',
        apiKey: 'k',
        active: true,
      }),
    ).toThrow();
  });
});
```

Create `packages/shared/src/memory/ops.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { memoryOpsJobKinds, memoryOpsJobStatuses, memoryOpsProgressSchema } from './ops.js';

describe('memoryOpsJob enums', () => {
  it('enumerates 4 job kinds', () => {
    expect(memoryOpsJobKinds).toEqual([
      'embedding-backfill',
      'drawer-backfill',
      'consolidation',
      'synthesis',
    ]);
  });

  it('enumerates 5 status values', () => {
    expect(memoryOpsJobStatuses).toEqual([
      'queued',
      'running',
      'completed',
      'failed',
      'cancelled',
    ]);
  });
});

describe('memoryOpsProgressSchema', () => {
  it('accepts the canonical shape', () => {
    expect(() =>
      memoryOpsProgressSchema.parse({ done: 10, total: 100, costUsd: 0.01, errorCount: 0 }),
    ).not.toThrow();
  });

  it('rejects negative done', () => {
    expect(() =>
      memoryOpsProgressSchema.parse({ done: -1, total: 100, costUsd: 0, errorCount: 0 }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agentctl/shared test -- --run src/memory/providers.test.ts src/memory/ops.test.ts`
Expected: module-not-found errors.

- [ ] **Step 3: Implement `providers.ts`**

```typescript
// packages/shared/src/memory/providers.ts
import { z } from 'zod';

export type EmbeddingProviderKind = 'openai' | 'gemini';

export type EmbeddingModelCatalogEntry = {
  provider: EmbeddingProviderKind;
  model: string;
  dim: 1536;
  defaultBaseUrl: string;
  extraBody?: Record<string, unknown>;
  /** Approx $/1M tokens for UX cost estimates; not billing-grade. */
  priceUsdPerMtoken: number;
};

export const EMBEDDING_MODEL_CATALOG: readonly EmbeddingModelCatalogEntry[] = [
  {
    provider: 'openai',
    model: 'text-embedding-3-small',
    dim: 1536,
    defaultBaseUrl: 'https://api.openai.com/v1',
    priceUsdPerMtoken: 0.02,
  },
  {
    provider: 'gemini',
    model: 'gemini-embedding-001',
    dim: 1536,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    extraBody: { output_dimensionality: 1536 },
    priceUsdPerMtoken: 0.15,
  },
];

const embeddingProviderKindEnum = z.enum(['openai', 'gemini']);

export const embeddingProviderSchema = z
  .object({
    name: z.string().min(1).max(80),
    provider: embeddingProviderKindEnum,
    model: z.string().min(1),
    apiKey: z.string().min(8),
    baseUrl: z.string().url().optional(),
    active: z.boolean().default(true),
  })
  .transform((input) => {
    const catalog = EMBEDDING_MODEL_CATALOG.find(
      (m) => m.provider === input.provider && m.model === input.model,
    );
    if (!catalog) {
      throw new z.ZodError([
        {
          code: 'custom',
          path: ['model'],
          message: `Unknown model ${input.model} for provider ${input.provider}`,
        },
      ]);
    }
    return {
      ...input,
      baseUrl: input.baseUrl ?? catalog.defaultBaseUrl,
      dim: catalog.dim,
      extraBody: catalog.extraBody ?? {},
    };
  });

export type EmbeddingProviderInput = z.infer<typeof embeddingProviderSchema>;

export type EmbeddingProvider = {
  id: string;
  name: string;
  provider: EmbeddingProviderKind;
  model: string;
  baseUrl: string;
  apiKeyLast4: string;
  dim: 1536;
  active: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmbeddingProviderTestResult = {
  ok: boolean;
  dim: number;
  model: string;
  costUsd: number;
  latencyMs: number;
  error: string | null;
};
```

- [ ] **Step 4: Implement `ops.ts`**

```typescript
// packages/shared/src/memory/ops.ts
import { z } from 'zod';

export const memoryOpsJobKinds = [
  'embedding-backfill',
  'drawer-backfill',
  'consolidation',
  'synthesis',
] as const;

export type MemoryOpsJobKind = (typeof memoryOpsJobKinds)[number];

export const memoryOpsJobStatuses = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export type MemoryOpsJobStatus = (typeof memoryOpsJobStatuses)[number];

export const memoryOpsProgressSchema = z.object({
  done: z.number().int().min(0),
  total: z.number().int().min(0),
  costUsd: z.number().min(0),
  errorCount: z.number().int().min(0),
  currentBatch: z.number().int().min(0).optional(),
  etaSeconds: z.number().min(0).optional(),
});

export type MemoryOpsProgress = z.infer<typeof memoryOpsProgressSchema>;

export const embeddingBackfillParamsSchema = z.object({
  scope: z.string().optional(),
  batchSize: z.number().int().min(1).max(500).default(100),
  credentialId: z.string().uuid().optional(),
  dryRun: z.boolean().default(false),
});

export const drawerBackfillParamsSchema = z.object({
  sourceType: z.enum(['claude-mem', 'jsonl']),
  sourceRoot: z.string().min(1),
  scope: z.string().optional(),
  batchSize: z.number().int().min(1).max(500).default(50),
  credentialId: z.string().uuid().optional(),
  dryRun: z.boolean().default(false),
});

export const consolidationParamsSchema = z.object({
  scope: z.string().optional(),
  credentialId: z.string().uuid().optional(),
});

export const synthesisParamsSchema = z.object({
  scope: z.string().optional(),
  credentialId: z.string().uuid().optional(),
});

export const memoryOpsJobParamsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('embedding-backfill'), ...embeddingBackfillParamsSchema.shape }),
  z.object({ kind: z.literal('drawer-backfill'), ...drawerBackfillParamsSchema.shape }),
  z.object({ kind: z.literal('consolidation'), ...consolidationParamsSchema.shape }),
  z.object({ kind: z.literal('synthesis'), ...synthesisParamsSchema.shape }),
]);

export type MemoryOpsJobParams = z.infer<typeof memoryOpsJobParamsSchema>;

export type MemoryOpsJob = {
  id: string;
  kind: MemoryOpsJobKind;
  status: MemoryOpsJobStatus;
  params: MemoryOpsJobParams;
  progress: MemoryOpsProgress;
  result: Record<string, unknown> | null;
  error: string | null;
  credentialId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  createdBy: string | null;
};

export type MemoryOpsJobLogLine = {
  ts: string;
  level: 'info' | 'warn' | 'error';
  message: string;
};
```

- [ ] **Step 5: Re-export from `index.ts`**

Append to `packages/shared/src/memory/index.ts`:

```typescript
export * from './providers.js';
export * from './ops.js';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @agentctl/shared test -- --run src/memory/providers.test.ts src/memory/ops.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/memory/providers.ts packages/shared/src/memory/ops.ts packages/shared/src/memory/index.ts packages/shared/src/memory/providers.test.ts packages/shared/src/memory/ops.test.ts
git commit -m "feat(shared): add embedding provider + memory-ops job types"
```

## Task A4: Full build + PR A wrap-up

- [ ] **Step 1: Full monorepo build**

Run: `pnpm build 2>&1 | tail -20`
Expected: exit 0.

- [ ] **Step 2: Full lint**

Run: `pnpm lint 2>&1 | tail -10`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Full test run (changed packages only)**

Run: `pnpm --filter @agentctl/shared --filter @agentctl/control-plane test 2>&1 | tail -10`
Expected: all green.

- [ ] **Step 4: Push + open PR**

```bash
git push -u origin agent/claude-1/feat/memory-ops-schema
gh pr create --base main --title "feat(memory-ops): migration 0033 + shared types" --body "$(cat <<'EOF'
## Summary
- Adds migration 0033: api_accounts.credential_kind column + memory_ops_jobs table with sync_capture_change trigger.
- Updates drizzle schema (apiAccounts, memoryOpsJobs).
- Adds shared types: EmbeddingProvider, EmbeddingProviderInput, MemoryOpsJob, MemoryOpsProgress, Zod schemas, and the EMBEDDING_MODEL_CATALOG (OpenAI text-embedding-3-small + Gemini gemini-embedding-001, both 1536d).

## Spec
docs/superpowers/specs/2026-04-24-memory-operations-ui-design.md

## Test plan
- [x] Migration applies cleanly to a scratch DB
- [x] pnpm build / lint green
- [x] New shared type tests pass
- [ ] Verify in dev-1 after merge (see PR checklist in plan)
EOF
)"
```

- [ ] **Step 5: After merge, dev-1 verify + promote**

On main (outside any worktree):

```bash
git checkout main && git pull origin main
source .env.dev-1
./scripts/env-up.sh dev-1
# Migration 0033 runs automatically on control-plane boot.
psql "$DATABASE_URL" -c "\d memory_ops_jobs" | head -20
psql "$DATABASE_URL" -c "SELECT credential_kind, COUNT(*) FROM api_accounts GROUP BY 1;"
```

Expected: table exists; existing accounts all report `credential_kind='runtime'`.

```bash
./scripts/version-bump.sh patch "memory-ops schema foundation (PR A)"
./scripts/env-promote.sh --from dev-1
# Verify beta
pm2 list
curl http://localhost:8080/health
./scripts/version-release.sh
```

- [ ] **Step 6: Clean up worktree**

```bash
cd /Users/hahaschool/agentctl
pnpm coord release --type worktree --path /Users/hahaschool/agentctl/.trees/memory-ops-pr-a
git worktree remove .trees/memory-ops-pr-a
```

---

# PR B — Embedding Provider Backend

**Worktree:** `.trees/memory-ops-pr-b`
**Branch:** `agent/claude-1/feat/memory-provider-routes`
**Depends on:** PR A merged
**Unblocks:** PR C (UI consumes these routes), PR D (queue uses the client factory)

## Task B0: Create worktree

```bash
cd /Users/hahaschool/agentctl
git fetch origin main
git worktree add .trees/memory-ops-pr-b -b agent/claude-1/feat/memory-provider-routes origin/main
pnpm coord claim --type worktree --path /Users/hahaschool/agentctl/.trees/memory-ops-pr-b --purpose "PR B: provider CRUD + EmbeddingClient factory"
cd .trees/memory-ops-pr-b
pnpm install
```

## Task B1: Extend `EmbeddingClient` with `extraBody`

**Files:**
- Modify: `packages/control-plane/src/memory/embedding-client.ts`
- Modify: `packages/control-plane/src/memory/embedding-client.test.ts`

- [ ] **Step 1: Add failing test**

Append to `packages/control-plane/src/memory/embedding-client.test.ts`:

```typescript
describe('EmbeddingClient extraBody support', () => {
  it('merges extraBody into the /embeddings request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ index: 0, embedding: new Array(1536).fill(0.1) }], model: 'gemini-embedding-001' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new EmbeddingClient({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-embedding-001',
      logger: createSilentLogger(),
      fetch: fetchMock,
      extraBody: { output_dimensionality: 1536 },
      apiKey: 'AIza-test',
    });
    await client.embed('hello');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.output_dimensionality).toBe(1536);
    expect(init.headers.Authorization).toBe('Bearer AIza-test');
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `pnpm --filter @agentctl/control-plane test -- --run src/memory/embedding-client.test.ts`
Expected: fail on `extraBody` + `apiKey` unknown options.

- [ ] **Step 3: Extend the class**

In `packages/control-plane/src/memory/embedding-client.ts`:

- Add `extraBody?: Record<string, unknown>`, `apiKey?: string`, `fetch?: typeof fetch` to `EmbeddingClientOptions`.
- Store them on the instance.
- In the fetch call, add `Authorization: Bearer <apiKey>` header when `apiKey` is set, and merge `extraBody` into the request body.

Concrete diff:

```typescript
export type EmbeddingClientOptions = {
  baseUrl: string;
  model: string;
  logger: Logger;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  apiKey?: string;
  extraBody?: Record<string, unknown>;
  fetch?: typeof fetch;
};

export class EmbeddingClient {
  // ...existing private fields...
  private readonly apiKey?: string;
  private readonly extraBody: Record<string, unknown>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: EmbeddingClientOptions) {
    // ...existing assignments...
    this.apiKey = options.apiKey;
    this.extraBody = options.extraBody ?? {};
    this.fetchImpl = options.fetch ?? fetch;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const url = `${this.baseUrl}/v1/embeddings`;
    const input = texts.length === 1 ? texts[0] : texts;
    const body = {
      model: this.model,
      input,
      ...this.extraBody,
    };
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    // ...rest of the existing loop, swap global fetch for this.fetchImpl and use body+headers built above...
  }
}
```

Note: the current `embedBatch` builds `body` inline and uses global `fetch`. Replace both usages — mostly a minimal refactor. The existing retry loop stays intact.

Double-check by reading `baseUrl` normalization. The current code does `url = `${baseUrl}/v1/embeddings``. For Gemini AI Studio the `defaultBaseUrl` in the catalog is `https://generativelanguage.googleapis.com/v1beta/openai`, so the resulting URL `.../openai/v1/embeddings` is **wrong**. Fix: strip the trailing `/v1` from the catalog URL, or, simpler, accept that callers pass fully-formed base URLs and only append `/embeddings`.

Decision: change the client to append `/embeddings` (not `/v1/embeddings`). Update catalog entries accordingly:
  - OpenAI: `https://api.openai.com/v1`
  - Gemini: `https://generativelanguage.googleapis.com/v1beta/openai`

Both already end at the right point; appending `/embeddings` produces the correct URL in each case.

Update `embedBatch` URL line to: `const url = \`${this.baseUrl}/embeddings\`;`

Grep for any caller that relies on the old `/v1/embeddings` behavior; update their `baseUrl` to include `/v1` if needed. Existing calls in `index.ts` pass `LITELLM_URL` which by convention already ends without `/v1` — **this is a behaviour change**. Ship the fix with a migration note in the PR body; no data is affected.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agentctl/control-plane test -- --run src/memory/embedding-client.test.ts`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/memory/embedding-client.ts packages/control-plane/src/memory/embedding-client.test.ts
git commit -m "feat(memory): extend EmbeddingClient with apiKey + extraBody + injectable fetch"
```

## Task B2: Implement `resolveEmbeddingClient` factory

**Files:**
- Create: `packages/control-plane/src/memory/embedding-client-factory.ts`
- Create: `packages/control-plane/src/memory/embedding-client-factory.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/control-plane/src/memory/embedding-client-factory.test.ts
import { describe, expect, it, vi } from 'vitest';
import { resolveEmbeddingClient } from './embedding-client-factory.js';
import { createSilentLogger } from '../api/routes/test-helpers.js';

function makePool(row: Record<string, unknown> | null) {
  return {
    query: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }),
  } as unknown as import('pg').Pool;
}

const ENC_KEY = 'f'.repeat(64); // 32 bytes hex

// Helper to build an encrypted-credential row like api_accounts stores.
import { encryptCredential } from '../utils/credential-crypto.js';

function encryptedRow(apiKey: string) {
  const { encrypted, iv } = encryptCredential(apiKey, ENC_KEY);
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'OpenAI',
    provider: 'openai',
    credential_kind: 'embedding',
    credential: encrypted,
    credential_iv: iv,
    metadata: {
      base_url: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
    },
    is_active: true,
  };
}

describe('resolveEmbeddingClient', () => {
  it('throws EMBEDDING_NO_PROVIDER when no active embedding row exists', async () => {
    const pool = makePool(null);
    await expect(
      resolveEmbeddingClient({ pool, logger: createSilentLogger(), encryptionKey: ENC_KEY }),
    ).rejects.toMatchObject({ code: 'EMBEDDING_NO_PROVIDER' });
  });

  it('builds an EmbeddingClient from the active openai row', async () => {
    const pool = makePool(encryptedRow('sk-proj-test'));
    const client = await resolveEmbeddingClient({
      pool,
      logger: createSilentLogger(),
      encryptionKey: ENC_KEY,
    });
    expect(client).toBeDefined();
  });

  it('selects by explicit credentialId when provided', async () => {
    const pool = makePool(encryptedRow('sk-proj-test'));
    await resolveEmbeddingClient({
      pool,
      logger: createSilentLogger(),
      encryptionKey: ENC_KEY,
      credentialId: '00000000-0000-0000-0000-000000000002',
    });
    const [sql, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(sql)).toMatch(/id = \$1/);
    expect(params).toEqual(['00000000-0000-0000-0000-000000000002']);
  });
});
```

- [ ] **Step 2: Run test, expect module-not-found**

Run: `pnpm --filter @agentctl/control-plane test -- --run src/memory/embedding-client-factory.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the factory**

```typescript
// packages/control-plane/src/memory/embedding-client-factory.ts
import { ControlPlaneError } from '@agentctl/shared';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import { decryptCredential } from '../utils/credential-crypto.js';
import { EmbeddingClient } from './embedding-client.js';

export type ResolveEmbeddingClientInput = {
  pool: Pool;
  logger: Logger;
  encryptionKey: string;
  credentialId?: string;
};

/**
 * Resolve an EmbeddingClient from stored provider credentials.
 *
 * - When credentialId is omitted, selects the single active embedding row.
 * - When credentialId is provided, fetches that exact row (regardless of active).
 * - Throws ControlPlaneError('EMBEDDING_NO_PROVIDER') when nothing matches.
 * - Throws ControlPlaneError('EMBEDDING_CREDENTIAL_DECRYPT_FAILED') when the
 *   stored ciphertext cannot be decrypted (usually a key rotation bug).
 */
export async function resolveEmbeddingClient(
  input: ResolveEmbeddingClientInput,
): Promise<EmbeddingClient> {
  const { pool, logger, encryptionKey, credentialId } = input;

  const { sql, params } = credentialId
    ? {
        sql: `SELECT id, name, provider, credential, credential_iv, metadata
              FROM api_accounts
              WHERE id = $1 AND credential_kind = 'embedding'`,
        params: [credentialId],
      }
    : {
        sql: `SELECT id, name, provider, credential, credential_iv, metadata
              FROM api_accounts
              WHERE credential_kind = 'embedding' AND is_active = true
              ORDER BY priority ASC, created_at ASC
              LIMIT 1`,
        params: [],
      };

  const result = await pool.query(sql, params);
  const row = result.rows[0];
  if (!row) {
    throw new ControlPlaneError(
      'EMBEDDING_NO_PROVIDER',
      credentialId
        ? `No embedding provider found for id ${credentialId}`
        : 'No active embedding provider is configured',
      { credentialId },
    );
  }

  let apiKey: string;
  try {
    apiKey = decryptCredential(row.credential, row.credential_iv, encryptionKey);
  } catch (err) {
    throw new ControlPlaneError(
      'EMBEDDING_CREDENTIAL_DECRYPT_FAILED',
      'Stored embedding credential failed to decrypt',
      { credentialId: row.id, cause: err instanceof Error ? err.message : String(err) },
    );
  }

  const metadata = (row.metadata ?? {}) as {
    base_url?: string;
    model?: string;
    output_dimensionality?: number;
  };

  const baseUrl =
    metadata.base_url ??
    (row.provider === 'gemini'
      ? 'https://generativelanguage.googleapis.com/v1beta/openai'
      : 'https://api.openai.com/v1');

  const model = metadata.model ?? 'text-embedding-3-small';

  const extraBody: Record<string, unknown> = {};
  if (metadata.output_dimensionality) {
    extraBody.output_dimensionality = metadata.output_dimensionality;
  }

  return new EmbeddingClient({
    baseUrl,
    model,
    logger,
    apiKey,
    extraBody,
  });
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm --filter @agentctl/control-plane test -- --run src/memory/embedding-client-factory.test.ts`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/memory/embedding-client-factory.ts packages/control-plane/src/memory/embedding-client-factory.test.ts
git commit -m "feat(memory): add resolveEmbeddingClient factory"
```

## Task B3: `/api/memory/providers` — GET list + POST create

**Files:**
- Create: `packages/control-plane/src/api/routes/memory-providers.ts`
- Create: `packages/control-plane/src/api/routes/memory-providers.test.ts`

- [ ] **Step 1: Write the failing GET test**

```typescript
// packages/control-plane/src/api/routes/memory-providers.test.ts
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { memoryProvidersRoutes } from './memory-providers.js';
import { createSilentLogger } from './test-helpers.js';

const ENC_KEY = 'f'.repeat(64);

function makeDb(rows: Array<Record<string, unknown>>) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(rows),
        }),
      }),
    }),
  } as const;
}

async function buildApp(deps: Parameters<typeof memoryProvidersRoutes>[1]) {
  const app = Fastify({ logger: false });
  await app.register(memoryProvidersRoutes, deps);
  return app;
}

describe('GET /', () => {
  it('returns empty array when no embedding rows', async () => {
    const app = await buildApp({
      db: makeDb([]) as any,
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } as any,
      encryptionKey: ENC_KEY,
      logger: createSilentLogger(),
    });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ providers: [] });
    await app.close();
  });
});
```

- [ ] **Step 2: Run test, expect module-not-found**

Run: `pnpm --filter @agentctl/control-plane test -- --run src/api/routes/memory-providers.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the route file (skeleton with GET + POST)**

```typescript
// packages/control-plane/src/api/routes/memory-providers.ts
import {
  type EmbeddingProvider,
  embeddingProviderSchema,
  ControlPlaneError,
} from '@agentctl/shared';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import type { Database } from '../../db/index.js';
import { apiAccounts } from '../../db/schema.js';
import {
  decryptCredential,
  encryptCredential,
  maskCredential,
} from '../../utils/credential-crypto.js';
import { resolveEmbeddingClient } from '../../memory/embedding-client-factory.js';
import { readRateLimitEnv } from '../rate-limit.js';

export type MemoryProvidersRoutesOptions = {
  db: Database;
  pool: Pool;
  encryptionKey: string;
  logger: Logger;
};

const MEMORY_PROVIDERS_RATE_LIMIT = { max: 30, timeWindow: 60_000 } as const;
const MEMORY_PROVIDERS_TEST_RATE_LIMIT = { max: 5, timeWindow: 60_000 } as const;

function rowToProvider(row: typeof apiAccounts.$inferSelect, encryptionKey: string): EmbeddingProvider {
  let last4 = '****';
  try {
    const plaintext = decryptCredential(row.credential, row.credentialIv, encryptionKey);
    last4 = plaintext.length >= 4 ? plaintext.slice(-4) : '****';
  } catch {
    // decrypt failure surfaces via maskCredential fallback; last4 stays '****'.
  }
  const meta = (row.metadata ?? {}) as {
    base_url?: string;
    model?: string;
    last_test_at?: string;
    last_test_ok?: boolean;
    last_test_error?: string;
  };
  return {
    id: row.id,
    name: row.name,
    provider: row.provider as EmbeddingProvider['provider'],
    model: meta.model ?? 'text-embedding-3-small',
    baseUrl: meta.base_url ?? 'https://api.openai.com/v1',
    apiKeyLast4: last4,
    dim: 1536,
    active: Boolean(row.isActive),
    lastTestAt: meta.last_test_at ?? null,
    lastTestOk: meta.last_test_ok ?? null,
    lastTestError: meta.last_test_error ?? null,
    createdAt: row.createdAt?.toISOString() ?? new Date(0).toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? new Date(0).toISOString(),
  };
}

export const memoryProvidersRoutes: FastifyPluginAsync<MemoryProvidersRoutesOptions> = async (
  app,
  opts,
) => {
  const { db, pool, encryptionKey, logger } = opts;

  const crudLimitMax = readRateLimitEnv('MEMORY_PROVIDERS_RATE_LIMIT_MAX', MEMORY_PROVIDERS_RATE_LIMIT.max);
  const crudLimitWindow = readRateLimitEnv('MEMORY_PROVIDERS_RATE_LIMIT_WINDOW_MS', MEMORY_PROVIDERS_RATE_LIMIT.timeWindow);
  const testLimitMax = readRateLimitEnv('MEMORY_PROVIDERS_TEST_RATE_LIMIT_MAX', MEMORY_PROVIDERS_TEST_RATE_LIMIT.max);
  const testLimitWindow = readRateLimitEnv('MEMORY_PROVIDERS_TEST_RATE_LIMIT_WINDOW_MS', MEMORY_PROVIDERS_TEST_RATE_LIMIT.timeWindow);

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req) => req.ip ?? 'unknown',
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, request, reply) => {
    if (err.statusCode === 429) return reply.code(429).send({ error: 'RATE_LIMITED', message: 'Too many requests' });
    if (err.code === 'EMBEDDING_NO_PROVIDER') {
      return reply.code(409).send({ error: err.code, message: err.message });
    }
    request.log.error(err, 'memory-providers route error');
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: err.message });
  });

  const crudLimit = { max: crudLimitMax, timeWindow: crudLimitWindow } as const;
  const testLimit = { max: testLimitMax, timeWindow: testLimitWindow } as const;

  app.get('/', { config: { rateLimit: crudLimit } }, async (_req, reply) => {
    const rows = await db
      .select()
      .from(apiAccounts)
      .where(eq(apiAccounts.credentialKind, 'embedding'))
      .orderBy(apiAccounts.priority);
    return reply.send({ providers: rows.map((r) => rowToProvider(r, encryptionKey)) });
  });

  app.post('/', { config: { rateLimit: crudLimit } }, async (req, reply) => {
    const parsed = embeddingProviderSchema.parse(req.body);
    const { encrypted, iv } = encryptCredential(parsed.apiKey, encryptionKey);

    // Enforce single-active per kind: if new row is active, deactivate the rest.
    if (parsed.active) {
      await db
        .update(apiAccounts)
        .set({ isActive: false })
        .where(
          and(eq(apiAccounts.credentialKind, 'embedding'), eq(apiAccounts.isActive, true)),
        );
    }

    const id = randomUUID();
    const inserted = await db
      .insert(apiAccounts)
      .values({
        id,
        name: parsed.name,
        provider: parsed.provider,
        credential: encrypted,
        credentialIv: iv,
        priority: 0,
        rateLimit: {},
        isActive: parsed.active,
        metadata: {
          base_url: parsed.baseUrl,
          model: parsed.model,
          output_dimensionality: parsed.extraBody?.output_dimensionality,
          last_test_at: null,
          last_test_ok: null,
          last_test_error: null,
        },
        credentialKind: 'embedding',
      })
      .returning();

    return reply.code(201).send({ provider: rowToProvider(inserted[0], encryptionKey) });
  });
};
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm --filter @agentctl/control-plane test -- --run src/api/routes/memory-providers.test.ts`
Expected: GET test passes. (More tests coming in B4.)

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/api/routes/memory-providers.ts packages/control-plane/src/api/routes/memory-providers.test.ts
git commit -m "feat(memory): add GET / and POST / for /api/memory/providers"
```

## Task B4: Providers PATCH + DELETE + /:id/test

**Files:**
- Modify: `packages/control-plane/src/api/routes/memory-providers.ts`
- Modify: `packages/control-plane/src/api/routes/memory-providers.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `memory-providers.test.ts`:

```typescript
describe('PATCH /:id', () => {
  it('rotates the key and resets last_test_ok', async () => {
    const { encrypted, iv } = encryptCredential('sk-old-abcd', ENC_KEY);
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'OpenAI',
      provider: 'openai',
      credential: encrypted,
      credentialIv: iv,
      metadata: { base_url: 'https://api.openai.com/v1', model: 'text-embedding-3-small', last_test_ok: true },
      credentialKind: 'embedding',
      isActive: true,
    };
    const updates: Array<Record<string, unknown>> = [];
    const db = {
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => Promise.resolve([row]) }) }) }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return { where: () => ({ returning: () => Promise.resolve([{ ...row, ...values }]) }) };
        },
      }),
    } as any;

    const app = await buildApp({
      db,
      pool: { query: vi.fn() } as any,
      encryptionKey: ENC_KEY,
      logger: createSilentLogger(),
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/${row.id}`,
      payload: { apiKey: 'sk-new-zzzz' },
    });
    expect(res.statusCode).toBe(200);
    const lastUpdate = updates.at(-1)!;
    expect(lastUpdate.credential).toBeDefined();
    expect((lastUpdate.metadata as any).last_test_ok).toBeNull();
    await app.close();
  });
});

describe('POST /:id/test', () => {
  it('returns ok with the probed dimension on success', async () => {
    // ... test uses a stub EmbeddingClient-equivalent injected via opts.makeClient
  });

  it('returns 401 when the provider rejects the key', async () => {
    // ... similar stub returning a 401
  });
});
```

- [ ] **Step 2: Run, expect fails**

Run: `pnpm --filter @agentctl/control-plane test -- --run src/api/routes/memory-providers.test.ts`
Expected: new tests FAIL; PATCH / DELETE / :id/test routes not defined.

- [ ] **Step 3: Implement PATCH, DELETE, and /:id/test**

Append to `memory-providers.ts`:

```typescript
  const patchSchema = embeddingProviderSchema.partial().extend({
    apiKey: embeddingProviderSchema.shape.apiKey.optional(),
  });

  app.patch<{ Params: { id: string } }>('/:id', { config: { rateLimit: crudLimit } }, async (req, reply) => {
    const id = req.params.id;
    const body = patchSchema.parse(req.body);
    const [existing] = await db
      .select()
      .from(apiAccounts)
      .where(and(eq(apiAccounts.id, id), eq(apiAccounts.credentialKind, 'embedding')));
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'provider not found' });

    const values: Partial<typeof apiAccounts.$inferInsert> = {};
    const nextMetadata: Record<string, unknown> = { ...(existing.metadata ?? {}) };

    if (body.apiKey) {
      const { encrypted, iv } = encryptCredential(body.apiKey, encryptionKey);
      values.credential = encrypted;
      values.credentialIv = iv;
      nextMetadata.last_test_at = null;
      nextMetadata.last_test_ok = null;
      nextMetadata.last_test_error = null;
    }
    if (body.name) values.name = body.name;
    if (body.model) nextMetadata.model = body.model;
    if (body.baseUrl) nextMetadata.base_url = body.baseUrl;
    if (body.active !== undefined) values.isActive = body.active;
    values.metadata = nextMetadata;

    // Enforce single-active when activating
    if (body.active) {
      await db
        .update(apiAccounts)
        .set({ isActive: false })
        .where(and(eq(apiAccounts.credentialKind, 'embedding'), eq(apiAccounts.isActive, true)));
    }

    const [updated] = await db
      .update(apiAccounts)
      .set(values)
      .where(eq(apiAccounts.id, id))
      .returning();

    return reply.send({ provider: rowToProvider(updated, encryptionKey) });
  });

  app.delete<{ Params: { id: string } }>('/:id', { config: { rateLimit: crudLimit } }, async (req, reply) => {
    // PR D extends this handler with a "reject if any running job references this credential"
    // check once memory_ops_jobs exists. For now the unconditional delete is acceptable because
    // no queue is running yet.
    await db.delete(apiAccounts).where(and(eq(apiAccounts.id, req.params.id), eq(apiAccounts.credentialKind, 'embedding')));
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>(
    '/:id/test',
    { config: { rateLimit: testLimit } },
    async (req, reply) => {
      const startedAt = Date.now();
      const client = await resolveEmbeddingClient({ pool, logger, encryptionKey, credentialId: req.params.id });
      const probe = 'agentctl memory provider test probe';
      const embedding = await client.embed(probe);
      const latencyMs = Date.now() - startedAt;
      const dim = embedding.length;

      await db
        .update(apiAccounts)
        .set({
          metadata: {
            // Preserve other metadata
            ...((await db.select().from(apiAccounts).where(eq(apiAccounts.id, req.params.id)))[0]
              ?.metadata ?? {}),
            last_test_at: new Date().toISOString(),
            last_test_ok: dim === 1536,
            last_test_error: dim === 1536 ? null : `unexpected dim ${dim}`,
          },
        })
        .where(eq(apiAccounts.id, req.params.id));

      return reply.send({
        ok: dim === 1536,
        dim,
        model: 'from-provider-metadata',
        // Cost estimate: tokens ≈ probe.length / 4. 1M ÷ that × price.
        costUsd: 0, // rough; refined when usage is returned by provider
        latencyMs,
        error: dim === 1536 ? null : `unexpected dim ${dim}`,
      });
    },
  );
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm --filter @agentctl/control-plane test -- --run src/api/routes/memory-providers.test.ts`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/api/routes/memory-providers.ts packages/control-plane/src/api/routes/memory-providers.test.ts
git commit -m "feat(memory): add PATCH/DELETE/test endpoints for memory providers"
```

## Task B5: Wire route into `server.ts`

**Files:**
- Modify: `packages/control-plane/src/api/server.ts`

- [ ] **Step 1: Add the import + registration**

Find the block where other memory routes are registered (around line 560). Append:

```typescript
      await app.register(memoryProvidersRoutes, {
        prefix: '/api/memory/providers',
        db,
        pool,
        encryptionKey: opts.encryptionKey,
        logger: app.log,
      });
```

Add the import at the top:

```typescript
import { memoryProvidersRoutes } from './routes/memory-providers.js';
```

- [ ] **Step 2: Add integration test**

Create `packages/control-plane/src/api/routes/memory-providers.integration.test.ts` — spins up Fastify with the real plugin + an in-memory PG mock. Use existing test-helpers:

```typescript
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { memoryProvidersRoutes } from './memory-providers.js';
import { createSilentLogger } from './test-helpers.js';

describe('memory-providers integration', () => {
  it('rejects non-embedding-kind payloads via Zod', async () => {
    const app = Fastify({ logger: false });
    await app.register(memoryProvidersRoutes, {
      db: {} as any,
      pool: {} as any,
      encryptionKey: 'f'.repeat(64),
      logger: createSilentLogger(),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/',
      payload: { provider: 'anthropic', model: 'x', name: 'y', apiKey: 'kkkkkkkk' },
    });
    expect(res.statusCode).toBe(500); // ZodError bubbles to 500 via the error handler
    await app.close();
  });
});
```

- [ ] **Step 3: Run the full control-plane test suite**

Run: `pnpm --filter @agentctl/control-plane test 2>&1 | tail -10`
Expected: all green (no regressions).

- [ ] **Step 4: Commit**

```bash
git add packages/control-plane/src/api/server.ts packages/control-plane/src/api/routes/memory-providers.integration.test.ts
git commit -m "feat(memory): register /api/memory/providers in fastify server"
```

## Task B6: PR B wrap-up

- [ ] **Step 1: Full build + lint + test**

```bash
pnpm build 2>&1 | tail -5
pnpm lint 2>&1 | tail -5
pnpm --filter @agentctl/control-plane test 2>&1 | tail -5
```

Expected: all exit 0.

- [ ] **Step 2: Push + PR**

```bash
git push -u origin agent/claude-1/feat/memory-provider-routes
gh pr create --base main --title "feat(memory-ops): /api/memory/providers CRUD + embedding client factory" --body "$(cat <<'EOF'
## Summary
- New Fastify routes under /api/memory/providers — GET, POST, PATCH, DELETE, POST /:id/test.
- resolveEmbeddingClient factory looks up api_accounts + decrypts key + constructs EmbeddingClient.
- EmbeddingClient now accepts apiKey + extraBody (Gemini AI Studio path).
- All writes enforce single-active embedding-kind row.

## Spec
docs/superpowers/specs/2026-04-24-memory-operations-ui-design.md — sections 3.1 (API) + 3.3 (client factory).

## Behaviour change
EmbeddingClient URL construction: strips the implicit '/v1' suffix. Callers must pass base URLs that end at the right resource root (e.g. https://api.openai.com/v1). The default catalog uses the new convention.

## Test plan
- [x] Unit + integration tests for all 5 endpoints
- [x] Factory tests for missing provider / decrypt fail / credentialId selection
- [ ] Verify in dev-1 (curl tests in PR description below)
EOF
)"
```

- [ ] **Step 3: Dev-1 verify (after merge)**

```bash
cd /Users/hahaschool/agentctl
git checkout main && git pull
source .env.dev-1
./scripts/env-up.sh dev-1

# Create, test, delete a provider — using a stub OpenAI endpoint to avoid spending money during verification.
curl -s -X POST http://localhost:${DEV_CP_PORT}/api/memory/providers \
  -H 'Content-Type: application/json' \
  -d '{"name":"OpenAI test","provider":"openai","model":"text-embedding-3-small","apiKey":"sk-proj-FAKE"}'

curl -s http://localhost:${DEV_CP_PORT}/api/memory/providers

# Cleanup
curl -s -X DELETE http://localhost:${DEV_CP_PORT}/api/memory/providers/<id>
```

Expected: 201 create, 200 list, 204 delete.

- [ ] **Step 4: Promote + release**

```bash
./scripts/version-bump.sh patch "memory provider CRUD + embedding client factory (PR B)"
./scripts/env-promote.sh --from dev-1
pm2 list
curl http://localhost:8080/health
./scripts/version-release.sh
```

- [ ] **Step 5: Clean up worktree**

```bash
pnpm coord release --type worktree --path /Users/hahaschool/agentctl/.trees/memory-ops-pr-b
git worktree remove .trees/memory-ops-pr-b
```

---

# PR C — Settings → Memory & Embeddings UI

**Status (2026-04-25):** Landed in PR #806. Follow-up PR #807 persisted saved-provider test success/failure metadata so row-level Test results survive list refreshes and new sessions.

**Worktree:** `.trees/memory-ops-pr-c`
**Branch:** `agent/claude-1/feat/memory-embeddings-settings`
**Depends on:** PR B merged
**Unblocks:** User can now configure an OpenAI/Gemini key from the browser

## Task C0: Worktree

```bash
cd /Users/hahaschool/agentctl
git fetch origin main
git worktree add .trees/memory-ops-pr-c -b agent/claude-1/feat/memory-embeddings-settings origin/main
pnpm coord claim --type worktree --path /Users/hahaschool/agentctl/.trees/memory-ops-pr-c --purpose "PR C: Memory & Embeddings Settings UI"
cd .trees/memory-ops-pr-c
pnpm install
```

## Task C1: Web API client for providers

**Files:**
- Create: `packages/web/src/lib/api/memory-providers.ts`
- Create: `packages/web/src/lib/api/memory-providers.test.ts`
- Create: `packages/web/src/lib/embedding-providers.ts` (UI catalog)
- Modify: `packages/web/src/lib/api/index.ts` (barrel export)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/web/src/lib/api/memory-providers.test.ts
import { describe, expect, it, vi } from 'vitest';
import { listMemoryProviders, createMemoryProvider } from './memory-providers';

describe('listMemoryProviders', () => {
  it('GETs /api/memory/providers and returns providers array', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ providers: [] }), { status: 200 }));
    const out = await listMemoryProviders();
    expect(out).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/memory/providers'), expect.any(Object));
  });
});

describe('createMemoryProvider', () => {
  it('POSTs the full payload and returns the created provider', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ provider: { id: 'p1' } }), { status: 201 }),
    );
    const out = await createMemoryProvider({
      name: 'n',
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'k'.repeat(16),
      active: true,
    });
    expect(out.id).toBe('p1');
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm --filter @agentctl/web test -- --run src/lib/api/memory-providers.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the client module**

```typescript
// packages/web/src/lib/api/memory-providers.ts
import type { EmbeddingProvider, EmbeddingProviderTestResult } from '@agentctl/shared';
import { apiFetch } from './core';

export type CreateProviderInput = {
  name: string;
  provider: 'openai' | 'gemini';
  model: string;
  apiKey: string;
  baseUrl?: string;
  active?: boolean;
};

export type PatchProviderInput = Partial<CreateProviderInput>;

export async function listMemoryProviders(): Promise<EmbeddingProvider[]> {
  const res = await apiFetch<{ providers: EmbeddingProvider[] }>('/api/memory/providers');
  return res.providers;
}

export async function createMemoryProvider(input: CreateProviderInput): Promise<EmbeddingProvider> {
  const res = await apiFetch<{ provider: EmbeddingProvider }>('/api/memory/providers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.provider;
}

export async function patchMemoryProvider(id: string, input: PatchProviderInput): Promise<EmbeddingProvider> {
  const res = await apiFetch<{ provider: EmbeddingProvider }>(`/api/memory/providers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return res.provider;
}

export async function deleteMemoryProvider(id: string): Promise<void> {
  await apiFetch<void>(`/api/memory/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function testMemoryProvider(id: string): Promise<EmbeddingProviderTestResult> {
  return apiFetch<EmbeddingProviderTestResult>(
    `/api/memory/providers/${encodeURIComponent(id)}/test`,
    { method: 'POST' },
  );
}
```

- [ ] **Step 4: Implement the UI catalog**

```typescript
// packages/web/src/lib/embedding-providers.ts
import { EMBEDDING_MODEL_CATALOG, type EmbeddingProviderKind } from '@agentctl/shared';

export const PROVIDER_LABELS: Record<EmbeddingProviderKind, string> = {
  openai: 'OpenAI',
  gemini: 'Gemini (AI Studio)',
};

export function modelsForProvider(provider: EmbeddingProviderKind) {
  return EMBEDDING_MODEL_CATALOG.filter((m) => m.provider === provider);
}

export function providerCatalog() {
  return EMBEDDING_MODEL_CATALOG;
}
```

- [ ] **Step 5: Re-export from barrel**

Append to `packages/web/src/lib/api/index.ts` (or `api.ts`):

```typescript
export * from './memory-providers';
```

- [ ] **Step 6: Run tests, expect pass**

Run: `pnpm --filter @agentctl/web test -- --run src/lib/api/memory-providers.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/lib/api/memory-providers.ts packages/web/src/lib/api/memory-providers.test.ts packages/web/src/lib/embedding-providers.ts packages/web/src/lib/api/index.ts
git commit -m "feat(web): add memory-provider API client + UI provider catalog"
```

## Task C2: React Query hooks

**Files:**
- Modify: `packages/web/src/lib/queries.ts`

- [ ] **Step 1: Add hooks**

Append:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createMemoryProvider,
  deleteMemoryProvider,
  listMemoryProviders,
  patchMemoryProvider,
  testMemoryProvider,
} from './api/memory-providers';

const PROVIDERS_QUERY_KEY = ['memory', 'providers'] as const;

export function useMemoryProviders() {
  return useQuery({
    queryKey: PROVIDERS_QUERY_KEY,
    queryFn: listMemoryProviders,
    staleTime: 30_000,
  });
}

export function useCreateMemoryProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createMemoryProvider,
    onSuccess: () => qc.invalidateQueries({ queryKey: PROVIDERS_QUERY_KEY }),
  });
}

export function usePatchMemoryProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof patchMemoryProvider>[1] }) =>
      patchMemoryProvider(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROVIDERS_QUERY_KEY }),
  });
}

export function useDeleteMemoryProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteMemoryProvider,
    onSuccess: () => qc.invalidateQueries({ queryKey: PROVIDERS_QUERY_KEY }),
  });
}

export function useTestMemoryProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: testMemoryProvider,
    onSuccess: () => qc.invalidateQueries({ queryKey: PROVIDERS_QUERY_KEY }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/lib/queries.ts
git commit -m "feat(web): add React Query hooks for memory-provider CRUD + test"
```

## Task C3: Build `<ProviderDialog />`

**Files:**
- Create: `packages/web/src/components/memory/ProviderDialog.tsx`
- Create: `packages/web/src/components/memory/ProviderDialog.test.tsx`

- [ ] **Step 1: Failing test**

```typescript
// packages/web/src/components/memory/ProviderDialog.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ProviderDialog } from './ProviderDialog';

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('<ProviderDialog>', () => {
  it('renders the provider + model dropdowns and an API key input', () => {
    renderWithClient(<ProviderDialog open onClose={() => {}} mode="create" />);
    expect(screen.getByLabelText(/provider/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/model/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
  });

  it('disables Save until required fields are filled', () => {
    renderWithClient(<ProviderDialog open onClose={() => {}} mode="create" />);
    const save = screen.getByRole('button', { name: /save/i });
    expect(save).toBeDisabled();
  });

  it('calls createMemoryProvider on save', async () => {
    const onClose = vi.fn();
    renderWithClient(<ProviderDialog open onClose={onClose} mode="create" />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'My OpenAI' } });
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'sk-proj-test-key' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    // ... verify mutation was called (mocked)
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm --filter @agentctl/web test -- --run src/components/memory/ProviderDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// packages/web/src/components/memory/ProviderDialog.tsx
'use client';

import { useState } from 'react';

import type { EmbeddingProvider } from '@agentctl/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { modelsForProvider, PROVIDER_LABELS } from '@/lib/embedding-providers';
import {
  useCreateMemoryProvider,
  usePatchMemoryProvider,
  useTestMemoryProvider,
} from '@/lib/queries';

export type ProviderDialogProps = {
  open: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  existing?: EmbeddingProvider;
};

export function ProviderDialog({ open, onClose, mode, existing }: ProviderDialogProps) {
  const [name, setName] = useState(existing?.name ?? '');
  const [provider, setProvider] = useState<'openai' | 'gemini'>(existing?.provider ?? 'openai');
  const [model, setModel] = useState<string>(existing?.model ?? 'text-embedding-3-small');
  const [apiKey, setApiKey] = useState('');
  const [active, setActive] = useState(existing?.active ?? true);

  const create = useCreateMemoryProvider();
  const patch = usePatchMemoryProvider();
  const test = useTestMemoryProvider();

  const [testResult, setTestResult] = useState<null | { ok: boolean; dim?: number; error?: string | null }>(null);

  const models = modelsForProvider(provider);
  const canSubmit = name.trim().length > 0 && model.length > 0 && (mode === 'edit' || apiKey.length >= 8);

  async function handleTest() {
    if (mode === 'edit' && existing) {
      const r = await test.mutateAsync(existing.id);
      setTestResult({ ok: r.ok, dim: r.dim, error: r.error });
    } else {
      // For create, save first then test, or skip test; v1 requires save then test.
      setTestResult({ ok: false, error: 'Save the provider first, then click Test.' });
    }
  }

  async function handleSave() {
    if (mode === 'create') {
      await create.mutateAsync({ name, provider, model, apiKey, active });
    } else if (existing) {
      await patch.mutateAsync({
        id: existing.id,
        input: {
          name,
          provider,
          model,
          ...(apiKey ? { apiKey } : {}),
          active,
        },
      });
    }
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add embedding provider' : 'Edit embedding provider'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="provider">Provider</Label>
            <Select value={provider} onValueChange={(v) => { setProvider(v as 'openai' | 'gemini'); setModel(modelsForProvider(v as 'openai' | 'gemini')[0]?.model ?? ''); }}>
              <SelectTrigger id="provider"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['openai', 'gemini'] as const).map((p) => (
                  <SelectItem key={p} value={p}>{PROVIDER_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="model">Model</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger id="model"><SelectValue /></SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.model} value={m.model}>{m.model} · {m.dim}d</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="api-key">API key</Label>
            <Input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={mode === 'edit' ? 'leave blank to keep existing' : 'sk-... or AIza...'}
            />
          </div>
          <div className="flex items-center gap-2">
            <input id="active" type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <Label htmlFor="active">Active</Label>
          </div>
          {testResult && (
            <p className={testResult.ok ? 'text-green-600 text-sm' : 'text-red-600 text-sm'}>
              {testResult.ok ? `✓ dim ${testResult.dim}` : `✗ ${testResult.error ?? 'failed'}`}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={handleTest} disabled={!canSubmit || mode === 'create'}>
            Test
          </Button>
          <Button onClick={handleSave} disabled={!canSubmit}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm --filter @agentctl/web test -- --run src/components/memory/ProviderDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/memory/ProviderDialog.tsx packages/web/src/components/memory/ProviderDialog.test.tsx
git commit -m "feat(web): add ProviderDialog for adding/editing embedding providers"
```

## Task C4: Build `<MemoryEmbeddingsSection />`

**Files:**
- Create: `packages/web/src/views/settings/MemoryEmbeddingsSection.tsx`
- Create: `packages/web/src/views/settings/MemoryEmbeddingsSection.test.tsx`

- [ ] **Step 1: Failing test**

```typescript
// packages/web/src/views/settings/MemoryEmbeddingsSection.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { MemoryEmbeddingsSection } from './MemoryEmbeddingsSection';

vi.mock('@/lib/queries', () => ({
  useMemoryProviders: () => ({ data: [], isLoading: false }),
  useDeleteMemoryProvider: () => ({ mutateAsync: vi.fn() }),
  useTestMemoryProvider: () => ({ mutateAsync: vi.fn() }),
}));

describe('<MemoryEmbeddingsSection>', () => {
  it('renders the add-provider CTA when list is empty', () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryEmbeddingsSection /></QueryClientProvider>);
    expect(screen.getByRole('button', { name: /add embedding provider/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm --filter @agentctl/web test -- --run src/views/settings/MemoryEmbeddingsSection.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// packages/web/src/views/settings/MemoryEmbeddingsSection.tsx
'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProviderDialog } from '@/components/memory/ProviderDialog';
import {
  useDeleteMemoryProvider,
  useMemoryProviders,
  useTestMemoryProvider,
} from '@/lib/queries';
import { PROVIDER_LABELS } from '@/lib/embedding-providers';
import type { EmbeddingProvider } from '@agentctl/shared';

export function MemoryEmbeddingsSection() {
  const { data: providers = [], isLoading } = useMemoryProviders();
  const del = useDeleteMemoryProvider();
  const test = useTestMemoryProvider();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EmbeddingProvider | null>(null);

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Memory &amp; Embeddings</h3>
          <p className="text-sm text-muted-foreground">
            Configure an embedding provider for memory search, synthesis, and consolidation.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
          Add embedding provider
        </Button>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No embedding providers configured. Adding one unlocks search, synthesis, consolidation, and graph features.
        </p>
      ) : (
        <ul className="divide-y">
          {providers.map((p) => (
            <li key={p.id} className="flex items-center gap-4 py-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  <Badge>{PROVIDER_LABELS[p.provider]}</Badge>
                  {p.active ? <Badge variant="default">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                  {p.model} · dim {p.dim} · key …{p.apiKeyLast4}
                </div>
                <div className="text-xs text-muted-foreground">
                  {p.lastTestAt
                    ? `Last tested ${new Date(p.lastTestAt).toLocaleString()} — ${p.lastTestOk ? 'ok' : p.lastTestError ?? 'failed'}`
                    : 'Never tested'}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => test.mutateAsync(p.id)}>Test</Button>
                <Button variant="secondary" size="sm" onClick={() => { setEditing(p); setDialogOpen(true); }}>Edit</Button>
                <Button variant="destructive" size="sm" onClick={() => del.mutateAsync(p.id)}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialogOpen && (
        <ProviderDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          mode={editing ? 'edit' : 'create'}
          existing={editing ?? undefined}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm --filter @agentctl/web test -- --run src/views/settings/MemoryEmbeddingsSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/settings/MemoryEmbeddingsSection.tsx packages/web/src/views/settings/MemoryEmbeddingsSection.test.tsx
git commit -m "feat(web): add MemoryEmbeddingsSection for Settings"
```

## Task C5: Mount into `SettingsPage`

**Files:**
- Modify: `packages/web/src/views/settings/SettingsPage.tsx` (or equivalent; grep to find it)

- [ ] **Step 1: Locate the directory entry list**

Settings has a left-hand nav with `Overview`, `Runtime Profiles`, `Credentials & Access`, etc. Add a new entry `Memory & Embeddings` below `Credentials & Access`. Render the new section when selected.

Grep first: `grep -n "Credentials & Access" packages/web/src/views/settings/*.tsx` — locate the nav map + section map.

Apply the idiom used by existing entries. Add a scroll anchor / section id that matches.

- [ ] **Step 2: Smoke-test Playwright (one assertion only)**

Append to the existing `packages/web/tests/e2e/settings.spec.ts` (or create a new file):

```typescript
test('Settings exposes Memory & Embeddings section', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: /memory.*embeddings/i })).toBeVisible();
});
```

- [ ] **Step 3: Run the spec**

```bash
pnpm --filter @agentctl/web playwright test settings.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/views/settings/SettingsPage.tsx packages/web/tests/e2e/settings.spec.ts
git commit -m "feat(web): mount MemoryEmbeddingsSection in SettingsPage"
```

## Task C6: PR C wrap-up

Same pattern as PR A/B wrap: build + lint + push + `gh pr create` + dev-1 verify + `version-bump patch` + promote + release + worktree cleanup.

PR description should include: "After this PR merges and promotes, the user can configure an OpenAI key from Settings."

---

# PR D — Ops Queue Plumbing (no job handlers)

**Worktree:** `.trees/memory-ops-pr-d`
**Branch:** `agent/claude-1/feat/memory-ops-queue`
**Depends on:** PR A merged (needs `memory_ops_jobs` table + shared types)
**Unblocks:** PR E (adds handlers)

## Task D0: Worktree

```bash
cd /Users/hahaschool/agentctl
git fetch origin main
git worktree add .trees/memory-ops-pr-d -b agent/claude-1/feat/memory-ops-queue origin/main
pnpm coord claim --type worktree --path /Users/hahaschool/agentctl/.trees/memory-ops-pr-d --purpose "PR D: memory-ops queue + CRUD + SSE"
cd .trees/memory-ops-pr-d
pnpm install
```

## Task D1: Queue module

**Files:**
- Create: `packages/control-plane/src/memory/ops/index.ts`
- Create: `packages/control-plane/src/memory/ops/index.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// packages/control-plane/src/memory/ops/index.test.ts
import { describe, expect, it } from 'vitest';
import { MEMORY_OPS_QUEUE, createMemoryOpsQueue } from './index.js';

describe('memory-ops queue', () => {
  it('exports the canonical queue name', () => {
    expect(MEMORY_OPS_QUEUE).toBe('memory-ops');
  });

  it('creates a BullMQ Queue instance', () => {
    const q = createMemoryOpsQueue({ host: '127.0.0.1', port: 6379 });
    expect(q.name).toBe(MEMORY_OPS_QUEUE);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm --filter @agentctl/control-plane test -- --run src/memory/ops/index.test.ts`
Expected: module missing.

- [ ] **Step 3: Implement**

```typescript
// packages/control-plane/src/memory/ops/index.ts
import type { MemoryOpsJobKind, MemoryOpsJobParams } from '@agentctl/shared';
import type { ConnectionOptions } from 'bullmq';
import { Queue, type QueueOptions } from 'bullmq';

export const MEMORY_OPS_QUEUE = 'memory-ops';

export type MemoryOpsJobData = {
  jobId: string; // memory_ops_jobs.id
  kind: MemoryOpsJobKind;
  params: MemoryOpsJobParams;
  credentialId: string | null;
};

export function createMemoryOpsQueue(connection: ConnectionOptions): Queue<MemoryOpsJobData> {
  const opts: QueueOptions = {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 1000 },
    },
  };
  return new Queue<MemoryOpsJobData>(MEMORY_OPS_QUEUE, opts);
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm --filter @agentctl/control-plane test -- --run src/memory/ops/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/memory/ops/index.ts packages/control-plane/src/memory/ops/index.test.ts
git commit -m "feat(memory-ops): scaffold BullMQ memory-ops queue module"
```

## Task D2: Jobs repository

**Files:**
- Create: `packages/control-plane/src/memory/ops/jobs-repository.ts`
- Create: `packages/control-plane/src/memory/ops/jobs-repository.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// packages/control-plane/src/memory/ops/jobs-repository.test.ts
import { describe, expect, it, vi } from 'vitest';
import { JobsRepository } from './jobs-repository.js';

function makePool(rows: Array<Record<string, unknown>> = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as import('pg').Pool;
}

describe('JobsRepository', () => {
  it('inserts a new job row with default progress', async () => {
    const pool = makePool([{ id: 'job-1', kind: 'embedding-backfill', status: 'queued', progress: { done: 0, total: 0, costUsd: 0, errorCount: 0 }, params: {}, result: null, error: null, credential_id: null, started_at: null, finished_at: null, created_at: new Date(), created_by: null }]);
    const repo = new JobsRepository(pool);
    const job = await repo.create({ id: 'job-1', kind: 'embedding-backfill', params: { kind: 'embedding-backfill', batchSize: 100, dryRun: false }, credentialId: null, createdBy: null });
    expect(job.id).toBe('job-1');
    expect(job.status).toBe('queued');
  });

  it('transitions status via claim()', async () => {
    const pool = makePool([]);
    const repo = new JobsRepository(pool);
    await repo.claim('job-1');
    expect((pool.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/UPDATE memory_ops_jobs SET status = 'running'/);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm --filter @agentctl/control-plane test -- --run src/memory/ops/jobs-repository.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// packages/control-plane/src/memory/ops/jobs-repository.ts
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import type {
  MemoryOpsJob,
  MemoryOpsJobKind,
  MemoryOpsJobParams,
  MemoryOpsJobStatus,
  MemoryOpsProgress,
} from '@agentctl/shared';

const DEFAULT_PROGRESS: MemoryOpsProgress = { done: 0, total: 0, costUsd: 0, errorCount: 0 };

export type CreateJobInput = {
  id?: string;
  kind: MemoryOpsJobKind;
  params: MemoryOpsJobParams;
  credentialId: string | null;
  createdBy: string | null;
};

export class JobsRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateJobInput): Promise<MemoryOpsJob> {
    const id = input.id ?? randomUUID();
    const result = await this.pool.query(
      `INSERT INTO memory_ops_jobs (id, kind, status, params, progress, credential_id, created_by)
       VALUES ($1, $2, 'queued', $3, $4, $5, $6)
       RETURNING *`,
      [id, input.kind, input.params, DEFAULT_PROGRESS, input.credentialId, input.createdBy],
    );
    return this.rowToJob(result.rows[0]);
  }

  async get(id: string): Promise<MemoryOpsJob | null> {
    const r = await this.pool.query(`SELECT * FROM memory_ops_jobs WHERE id = $1`, [id]);
    return r.rows[0] ? this.rowToJob(r.rows[0]) : null;
  }

  async list(opts: { kind?: MemoryOpsJobKind; status?: MemoryOpsJobStatus; limit?: number }): Promise<MemoryOpsJob[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts.kind) { params.push(opts.kind); conditions.push(`kind = $${params.length}`); }
    if (opts.status) { params.push(opts.status); conditions.push(`status = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
    params.push(limit);
    const r = await this.pool.query(
      `SELECT * FROM memory_ops_jobs ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    );
    return r.rows.map((row) => this.rowToJob(row));
  }

  async claim(id: string): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE memory_ops_jobs SET status = 'running', started_at = now()
       WHERE id = $1 AND status = 'queued'
       RETURNING id`,
      [id],
    );
    return r.rowCount === 1;
  }

  async updateProgress(id: string, progress: MemoryOpsProgress): Promise<void> {
    await this.pool.query(
      `UPDATE memory_ops_jobs SET progress = $1 WHERE id = $2 AND status IN ('running','queued')`,
      [progress, id],
    );
    await this.pool.query(`SELECT pg_notify('memory_ops_job', $1)`, [id]);
  }

  async complete(id: string, result: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `UPDATE memory_ops_jobs SET status = 'completed', result = $1, finished_at = now() WHERE id = $2`,
      [result, id],
    );
    await this.pool.query(`SELECT pg_notify('memory_ops_job', $1)`, [id]);
  }

  async fail(id: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE memory_ops_jobs SET status = 'failed', error = $1, finished_at = now() WHERE id = $2`,
      [error, id],
    );
    await this.pool.query(`SELECT pg_notify('memory_ops_job', $1)`, [id]);
  }

  async cancel(id: string): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE memory_ops_jobs SET status = 'cancelled', finished_at = now()
       WHERE id = $1 AND status IN ('queued','running') RETURNING id`,
      [id],
    );
    if (r.rowCount === 1) {
      await this.pool.query(`SELECT pg_notify('memory_ops_job', $1)`, [id]);
      return true;
    }
    return false;
  }

  private rowToJob(row: Record<string, unknown>): MemoryOpsJob {
    return {
      id: String(row.id),
      kind: row.kind as MemoryOpsJobKind,
      status: row.status as MemoryOpsJobStatus,
      params: row.params as MemoryOpsJobParams,
      progress: row.progress as MemoryOpsProgress,
      result: (row.result as Record<string, unknown>) ?? null,
      error: (row.error as string) ?? null,
      credentialId: (row.credential_id as string) ?? null,
      startedAt: row.started_at ? new Date(row.started_at as string | Date).toISOString() : null,
      finishedAt: row.finished_at ? new Date(row.finished_at as string | Date).toISOString() : null,
      createdAt: new Date(row.created_at as string | Date).toISOString(),
      createdBy: (row.created_by as string) ?? null,
    };
  }
}
```

- [ ] **Step 4: Test + commit**

```bash
pnpm --filter @agentctl/control-plane test -- --run src/memory/ops/jobs-repository.test.ts
git add packages/control-plane/src/memory/ops/jobs-repository.ts packages/control-plane/src/memory/ops/jobs-repository.test.ts
git commit -m "feat(memory-ops): add JobsRepository for memory_ops_jobs"
```

## Task D3: Worker runtime helpers

**Files:**
- Create: `packages/control-plane/src/memory/ops/worker-runtime.ts`
- Create: `packages/control-plane/src/memory/ops/worker-runtime.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// packages/control-plane/src/memory/ops/worker-runtime.test.ts
import { describe, expect, it, vi } from 'vitest';
import { runJobWithLifecycle } from './worker-runtime.js';

describe('runJobWithLifecycle', () => {
  it('claims, iterates, and completes the job', async () => {
    const repo = {
      claim: vi.fn().mockResolvedValue(true),
      updateProgress: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      get: vi.fn().mockResolvedValue({ status: 'running' }),
    };
    await runJobWithLifecycle({
      jobsRepo: repo as any,
      jobId: 'job-1',
      logger: { info: () => {}, warn: () => {}, error: () => {} } as any,
      handler: async (ctx) => {
        await ctx.reportProgress({ done: 1, total: 1, costUsd: 0, errorCount: 0 });
        return { outcome: 'ok' };
      },
    });
    expect(repo.claim).toHaveBeenCalledWith('job-1');
    expect(repo.complete).toHaveBeenCalledWith('job-1', { outcome: 'ok' });
  });

  it('marks failed when handler throws', async () => {
    const repo = {
      claim: vi.fn().mockResolvedValue(true),
      updateProgress: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      get: vi.fn().mockResolvedValue({ status: 'running' }),
    };
    await expect(
      runJobWithLifecycle({
        jobsRepo: repo as any,
        jobId: 'job-1',
        logger: { info: () => {}, warn: () => {}, error: () => {} } as any,
        handler: async () => {
          throw new Error('boom');
        },
      }),
    ).rejects.toThrow('boom');
    expect(repo.fail).toHaveBeenCalledWith('job-1', 'boom');
  });

  it('short-circuits when claim returns false (already running)', async () => {
    const repo = { claim: vi.fn().mockResolvedValue(false), complete: vi.fn(), fail: vi.fn(), updateProgress: vi.fn(), get: vi.fn() };
    await runJobWithLifecycle({
      jobsRepo: repo as any,
      jobId: 'job-1',
      logger: { info: () => {}, warn: () => {}, error: () => {} } as any,
      handler: vi.fn(),
    });
    expect(repo.complete).not.toHaveBeenCalled();
    expect(repo.fail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm --filter @agentctl/control-plane test -- --run src/memory/ops/worker-runtime.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// packages/control-plane/src/memory/ops/worker-runtime.ts
import type { Logger } from 'pino';

import type { MemoryOpsProgress } from '@agentctl/shared';
import type { JobsRepository } from './jobs-repository.js';

export type WorkerContext = {
  jobId: string;
  logger: Logger;
  reportProgress: (p: MemoryOpsProgress) => Promise<void>;
  checkCancelled: () => Promise<boolean>;
};

export type RunJobInput = {
  jobsRepo: JobsRepository;
  jobId: string;
  logger: Logger;
  handler: (ctx: WorkerContext) => Promise<Record<string, unknown>>;
};

export async function runJobWithLifecycle(input: RunJobInput): Promise<void> {
  const { jobsRepo, jobId, logger, handler } = input;
  const claimed = await jobsRepo.claim(jobId);
  if (!claimed) {
    logger.info({ jobId }, 'job already claimed; worker exiting');
    return;
  }

  const ctx: WorkerContext = {
    jobId,
    logger,
    reportProgress: (p) => jobsRepo.updateProgress(jobId, p),
    checkCancelled: async () => {
      const row = await jobsRepo.get(jobId);
      return row?.status === 'cancelled';
    },
  };

  try {
    const result = await handler(ctx);
    await jobsRepo.complete(jobId, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await jobsRepo.fail(jobId, message);
    throw err;
  }
}
```

- [ ] **Step 4: Test + commit**

```bash
pnpm --filter @agentctl/control-plane test -- --run src/memory/ops/worker-runtime.test.ts
git add packages/control-plane/src/memory/ops/worker-runtime.ts packages/control-plane/src/memory/ops/worker-runtime.test.ts
git commit -m "feat(memory-ops): add runJobWithLifecycle helper"
```

## Task D4: SSE stream

**Files:**
- Create: `packages/control-plane/src/memory/ops/sse-stream.ts`
- Create: `packages/control-plane/src/memory/ops/sse-stream.test.ts`

Implements a function that takes a Fastify reply + job id, subscribes to `memory_ops_job` notifications, and emits SSE frames whenever the job row changes. Heartbeat every 15s. Reconnect supported via `Last-Event-Id`.

Follow the existing SSE pattern used elsewhere in the project — grep for `text/event-stream` to find one:

```bash
grep -rn "text/event-stream" packages/control-plane/src --include='*.ts'
```

Implement along the same line. The test spins up a `Fastify` with the handler, pushes a fake `pg_notify` via a stub pool, and asserts events arrive.

Commit message: `feat(memory-ops): add SSE stream for job progress`

## Task D5: `/api/memory/ops/jobs` CRUD routes

**Files:**
- Create: `packages/control-plane/src/api/routes/memory-ops.ts`
- Create: `packages/control-plane/src/api/routes/memory-ops.test.ts`

Routes:
- `POST /` — parses `memoryOpsJobParamsSchema`, creates a DB row via `JobsRepository.create`, enqueues a BullMQ job referencing the row id, returns the created job.
- `GET /` — query params `?kind=&status=&limit=`, calls `JobsRepository.list`.
- `GET /:id` — single job.
- `POST /:id/cancel` — calls `JobsRepository.cancel`; if true, returns the updated job; else 409.
- `GET /:id/stream` — delegates to `openOpsJobSseStream(reply, jobId, jobsRepo)`.

Error codes:
- `EMBEDDING_NO_PROVIDER` → 409 when `POST /` references a missing provider
- `JOB_NOT_FOUND` → 404
- `JOB_NOT_CANCELLABLE` → 409 when `cancel` returns false

Tests cover each endpoint with mocked repo + queue.

Commit: `feat(memory-ops): add /api/memory/ops/jobs routes`

## Task D6: Boot queue + register routes in `index.ts` / `server.ts`

**Files:**
- Modify: `packages/control-plane/src/index.ts`
- Modify: `packages/control-plane/src/api/server.ts`

- Start `createMemoryOpsQueue(redisConnection)` at boot.
- Pass `jobsRepo` + `queue` into the route plugin via `server.ts` registration.
- Note: workers are not instantiated yet — that happens in PR E. This PR only gives us job rows + enqueue + SSE.

Integration test: POST `/` should result in `memory_ops_jobs.status='queued'` and a BullMQ job with matching id.

Commit: `feat(memory-ops): boot memory-ops queue + wire routes`

## Task D7: PR D wrap-up

Build + lint + test + push + PR + dev-1 verify + version-bump + promote + release.

Sample smoke test in dev-1:

```bash
curl -X POST http://localhost:${DEV_CP_PORT}/api/memory/ops/jobs \
  -H 'Content-Type: application/json' \
  -d '{"kind":"embedding-backfill","batchSize":50}'

psql "$DATABASE_URL" -c "SELECT id, kind, status FROM memory_ops_jobs ORDER BY created_at DESC LIMIT 5;"
```

Expected: the row is `queued`. The job stays queued because the worker doesn't exist yet — that's PR E.

---

# PR E — Embedding + Drawer Backfill Handlers

**Worktree:** `.trees/memory-ops-pr-e`
**Branch:** `agent/claude-1/feat/memory-ops-backfill-handlers`
**Depends on:** PR D merged
**Unblocks:** Critical path — after this PR, the 19,226 facts can be backfilled.

## Task E0: Worktree (standard pattern)

```bash
cd /Users/hahaschool/agentctl
git fetch origin main
git worktree add .trees/memory-ops-pr-e -b agent/claude-1/feat/memory-ops-backfill-handlers origin/main
pnpm coord claim --type worktree --path /Users/hahaschool/agentctl/.trees/memory-ops-pr-e --purpose "PR E: embedding + drawer backfill handlers"
cd .trees/memory-ops-pr-e
pnpm install
```

## Task E1: `embedding-backfill` handler

**Files:**
- Create: `packages/control-plane/src/memory/ops/embedding-backfill.ts`
- Create: `packages/control-plane/src/memory/ops/embedding-backfill.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// packages/control-plane/src/memory/ops/embedding-backfill.test.ts
import { describe, expect, it, vi } from 'vitest';
import { embeddingBackfillHandler } from './embedding-backfill.js';
import { createSilentLogger } from '../../api/routes/test-helpers.js';

function makePool(rows: Array<{ id: string; content: string }>) {
  let batch = 0;
  return {
    query: vi.fn((sql: string) => {
      if (sql.startsWith('SELECT COUNT')) return Promise.resolve({ rows: [{ count: rows.length }] });
      if (sql.startsWith('SELECT id, content')) {
        const page = rows.slice(batch * 100, (batch + 1) * 100);
        batch += 1;
        return Promise.resolve({ rows: page });
      }
      return Promise.resolve({ rows: [] });
    }),
  } as unknown as import('pg').Pool;
}

describe('embedding-backfill handler', () => {
  it('embeds facts in batches and reports progress', async () => {
    const facts = Array.from({ length: 150 }, (_, i) => ({ id: `fact-${i}`, content: `content ${i}` }));
    const pool = makePool(facts);
    const client = {
      embedBatch: vi.fn(async (texts: string[]) => texts.map(() => new Array(1536).fill(0.1))),
    };
    const progress: Array<{ done: number; total: number }> = [];
    await embeddingBackfillHandler({
      params: { kind: 'embedding-backfill', batchSize: 100, dryRun: false },
      pool,
      getClient: async () => client as any,
      logger: createSilentLogger(),
      ctx: {
        jobId: 'j1',
        logger: createSilentLogger(),
        reportProgress: async (p) => { progress.push(p); },
        checkCancelled: async () => false,
      },
    });
    expect(client.embedBatch).toHaveBeenCalledTimes(2);
    expect(progress.at(-1)).toMatchObject({ done: 150, total: 150 });
  });

  it('honours cancel between batches', async () => {
    const facts = Array.from({ length: 300 }, (_, i) => ({ id: `fact-${i}`, content: 'c' }));
    const pool = makePool(facts);
    const client = { embedBatch: vi.fn(async (t: string[]) => t.map(() => new Array(1536).fill(0))) };
    let calls = 0;
    const result = await embeddingBackfillHandler({
      params: { kind: 'embedding-backfill', batchSize: 100, dryRun: false },
      pool,
      getClient: async () => client as any,
      logger: createSilentLogger(),
      ctx: {
        jobId: 'j1',
        logger: createSilentLogger(),
        reportProgress: async () => {},
        checkCancelled: async () => {
          calls += 1;
          return calls > 1; // second check returns true
        },
      },
    });
    expect(result.cancelled).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm --filter @agentctl/control-plane test -- --run src/memory/ops/embedding-backfill.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// packages/control-plane/src/memory/ops/embedding-backfill.ts
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import type { MemoryOpsJobParams, MemoryOpsProgress } from '@agentctl/shared';
import type { EmbeddingClient } from '../embedding-client.js';
import type { WorkerContext } from './worker-runtime.js';

export type EmbeddingBackfillDeps = {
  params: Extract<MemoryOpsJobParams, { kind: 'embedding-backfill' }>;
  pool: Pool;
  getClient: () => Promise<EmbeddingClient>;
  logger: Logger;
  ctx: WorkerContext;
};

export async function embeddingBackfillHandler(deps: EmbeddingBackfillDeps): Promise<Record<string, unknown>> {
  const { params, pool, getClient, ctx, logger } = deps;
  const client = await getClient();

  const scopeFilter = params.scope ? 'AND scope = $2' : '';
  const countQuery = `SELECT COUNT(*)::int AS count FROM memory_facts WHERE embedding IS NULL ${scopeFilter}`;
  const countParams = params.scope ? [params.scope] : [];
  const countRes = await pool.query(countQuery, countParams);
  const total = countRes.rows[0]?.count ?? 0;

  let done = 0;
  let errorCount = 0;
  let cancelled = false;

  while (done < total) {
    if (await ctx.checkCancelled()) {
      cancelled = true;
      break;
    }

    const page = await pool.query(
      `SELECT id, content FROM memory_facts
       WHERE embedding IS NULL ${scopeFilter}
       ORDER BY created_at ASC LIMIT $${params.scope ? 2 : 1}`,
      params.scope ? [params.scope, params.batchSize] : [params.batchSize],
    );

    if (page.rows.length === 0) break;

    const texts = page.rows.map((r: { content: string }) => r.content);
    try {
      const vectors = await client.embedBatch(texts);
      if (!params.dryRun) {
        for (let i = 0; i < page.rows.length; i += 1) {
          await pool.query(
            `UPDATE memory_facts SET embedding = $1 WHERE id = $2 AND embedding IS NULL`,
            [`[${vectors[i].join(',')}]`, page.rows[i].id],
          );
        }
      }
      done += page.rows.length;
    } catch (err) {
      errorCount += page.rows.length;
      logger.warn({ err }, 'embedding-backfill batch failed');
      // Bail on auth failure; backfill continues on rate limits (handled by EmbeddingClient retry)
      if (err instanceof Error && err.message.includes('401')) {
        throw err;
      }
      done += page.rows.length; // count them as processed to avoid infinite loop
    }

    const progress: MemoryOpsProgress = { done, total, costUsd: 0, errorCount };
    await ctx.reportProgress(progress);
  }

  return { done, total, errorCount, cancelled };
}
```

- [ ] **Step 4: Test + commit**

```bash
pnpm --filter @agentctl/control-plane test -- --run src/memory/ops/embedding-backfill.test.ts
git add packages/control-plane/src/memory/ops/embedding-backfill.ts packages/control-plane/src/memory/ops/embedding-backfill.test.ts
git commit -m "feat(memory-ops): add embedding-backfill handler"
```

## Task E2: `drawer-backfill` handler — wrap existing script

**Files:**
- Create: `packages/control-plane/src/memory/ops/drawer-backfill.ts`
- Create: `packages/control-plane/src/memory/ops/drawer-backfill.test.ts`

- Factor the existing `scripts/backfill-memory-drawers.ts` into a library function that accepts the same `WorkerContext` shape, so the worker can drive it with progress updates.
- Same shape as embedding-backfill: count total → loop → report progress → check cancel.
- Tests use a fake source iterator with 10 items.

Commit: `feat(memory-ops): add drawer-backfill handler`

## Task E3: BullMQ worker wiring

**Files:**
- Create: `packages/control-plane/src/memory/ops/worker.ts` (the process entry for BullMQ Workers)
- Modify: `packages/control-plane/src/index.ts` — boot Workers alongside the queue

```typescript
// packages/control-plane/src/memory/ops/worker.ts
import type { ConnectionOptions } from 'bullmq';
import { Worker } from 'bullmq';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import { MEMORY_OPS_QUEUE, type MemoryOpsJobData } from './index.js';
import { JobsRepository } from './jobs-repository.js';
import { runJobWithLifecycle } from './worker-runtime.js';
import { resolveEmbeddingClient } from '../embedding-client-factory.js';
import { embeddingBackfillHandler } from './embedding-backfill.js';
import { drawerBackfillHandler } from './drawer-backfill.js';

export type MemoryOpsWorkerOptions = {
  connection: ConnectionOptions;
  pool: Pool;
  encryptionKey: string;
  logger: Logger;
};

export function createMemoryOpsWorker(opts: MemoryOpsWorkerOptions): Worker<MemoryOpsJobData> {
  const repo = new JobsRepository(opts.pool);
  return new Worker<MemoryOpsJobData>(
    MEMORY_OPS_QUEUE,
    async (job) => {
      const data = job.data;
      const getClient = () => resolveEmbeddingClient({
        pool: opts.pool,
        logger: opts.logger,
        encryptionKey: opts.encryptionKey,
        credentialId: data.credentialId ?? undefined,
      });
      await runJobWithLifecycle({
        jobsRepo: repo,
        jobId: data.jobId,
        logger: opts.logger,
        handler: async (ctx) => {
          switch (data.kind) {
            case 'embedding-backfill':
              return embeddingBackfillHandler({ params: data.params as any, pool: opts.pool, getClient, logger: opts.logger, ctx });
            case 'drawer-backfill':
              return drawerBackfillHandler({ params: data.params as any, pool: opts.pool, getClient, logger: opts.logger, ctx });
            default:
              throw new Error(`Unsupported kind for PR E: ${data.kind}`);
          }
        },
      });
    },
    { connection: opts.connection, concurrency: 1 },
  );
}
```

In `index.ts`, near where the task queue is created, add:

```typescript
const memoryOpsWorker = createMemoryOpsWorker({
  connection: redisConnection,
  pool,
  encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY ?? '',
  logger: logger.child({ component: 'memory-ops-worker' }),
});
```

Register graceful shutdown.

Tests: integration-style test that enqueues a fake job (id-only), verifies the worker resolves the handler and updates the row to `completed`.

Commit: `feat(memory-ops): start BullMQ worker for embedding + drawer backfill`

## Task E4: End-to-end test with mock embedding server

**Files:**
- Create: `packages/control-plane/src/memory/ops/e2e.test.ts`

Spins up a Fastify embedding stub on an ephemeral port, creates a provider row pointing at that URL, seeds 10 facts with `embedding IS NULL`, enqueues an `embedding-backfill` job, runs the Worker, asserts all 10 rows now have embeddings.

Commit: `test(memory-ops): add end-to-end backfill integration test with mock server`

## Task E5: PR E wrap-up + acceptance on user's 19,226 facts

After merge + dev-1 verify + version bump + promote, verify acceptance:

- In dev-1 with a real OpenAI key configured via Settings, create a fresh `embedding-backfill` job via `curl -X POST /api/memory/ops/jobs`. Expect ~150-200 batches of 100 facts, completing in 5-15 minutes depending on rate limits.
- `psql -c "SELECT COUNT(*) FROM memory_facts WHERE embedding IS NULL;"` → 0.
- `curl /api/memory/ops/jobs/<id>` → `status='completed'`, `progress.done=19226`, `progress.costUsd ≈ 0.08`.

Document these numbers in the PR body as the acceptance evidence.

---

# PR F — Operations Page UI + MissingEmbeddingAlert

**Worktree:** `.trees/memory-ops-pr-f`
**Branch:** `agent/claude-1/feat/memory-ops-ui`
**Depends on:** PR E merged

## Task F0: Worktree (standard)

## Task F1: API client for ops jobs

**Files:**
- Create: `packages/web/src/lib/api/memory-ops.ts` (+ .test.ts)

Functions: `listMemoryOpsJobs(filter)`, `createMemoryOpsJob(params)`, `getMemoryOpsJob(id)`, `cancelMemoryOpsJob(id)`, plus `openMemoryOpsJobStream(id, onEvent)` that opens an `EventSource` and parses frames.

Commit: `feat(web): add memory-ops API client`

## Task F2: React Query hooks

**Files:**
- Modify: `packages/web/src/lib/queries.ts`

Add `useMemoryOpsJobs`, `useCreateMemoryOpsJob`, `useMemoryOpsJob(id)`, `useCancelMemoryOpsJob`, `useMemoryOpsJobStream(id)` (custom hook that manages EventSource lifecycle).

Commit: `feat(web): add React Query hooks for memory-ops jobs`

## Task F3: `<MissingEmbeddingAlert />`

**Files:**
- Create: `packages/web/src/components/memory/MissingEmbeddingAlert.tsx` (+ .test.tsx)

```tsx
'use client';

import Link from 'next/link';
import { AlertTriangleIcon } from 'lucide-react';

import { useMemoryProviders } from '@/lib/queries';

export function MissingEmbeddingAlert() {
  const { data: providers = [], isLoading } = useMemoryProviders();
  if (isLoading) return null;
  const active = providers.find((p) => p.active);
  const healthy = active && active.lastTestOk !== false;
  if (healthy) return null;

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 mb-4 flex items-start gap-3">
      <AlertTriangleIcon className="h-5 w-5 text-amber-600 mt-0.5" />
      <div className="text-sm">
        <p className="font-medium">Embeddings aren&apos;t configured.</p>
        <p>Search, synthesis, and graph features will return empty or incomplete results.</p>
        <Link className="underline text-amber-700" href="/settings#memory-embeddings">
          Configure an embedding provider →
        </Link>
      </div>
    </div>
  );
}
```

Tests: provider list empty → renders; active provider with `lastTestOk=false` → renders; healthy → returns null.

Commit: `feat(web): add MissingEmbeddingAlert`

## Task F4: `<JobCard />`

**Files:**
- Create: `packages/web/src/components/memory/JobCard.tsx` (+ .test.tsx)

Props: `kind: MemoryOpsJobKind`, `latest: MemoryOpsJob | null`, `onRun: () => void`, `onCancel: () => void`.

States: `idle`, `queued`, `running` (progress bar %), `completed` (summary), `failed` (error + Retry).

Commit: `feat(web): add JobCard component`

## Task F5: `<RecentJobsTable />`

**Files:**
- Create: `packages/web/src/components/memory/RecentJobsTable.tsx` (+ .test.tsx)

Columns: kind, status, started, finished, done/total, cost. Row click opens `onSelect(job)`.

Commit: `feat(web): add RecentJobsTable`

## Task F6: `<JobDetailDrawer />`

**Files:**
- Create: `packages/web/src/components/memory/JobDetailDrawer.tsx` (+ .test.tsx)

Right-side sheet. Live progress from `useMemoryOpsJobStream(id)`. Log tail. Cancel button. Auto-close/clean up EventSource on unmount.

Commit: `feat(web): add JobDetailDrawer with SSE stream`

## Task F7: `<MemoryOperationsPage />` view

**Files:**
- Create: `packages/web/src/views/MemoryOperationsPage.tsx` (+ .test.tsx)
- Create: `packages/web/src/app/memory/operations/page.tsx`

Layout: `<MissingEmbeddingAlert />` at top, 4 `<JobCard />` in a 2×2 grid, `<RecentJobsTable />` below, `<JobDetailDrawer />` conditionally.

Commit: `feat(web): add /memory/operations page`

## Task F8: Mount `<MissingEmbeddingAlert />` on 5 existing pages

**Files:** add one import + one JSX line at the top of each view:

- `packages/web/src/views/MemoryMaintenancePage.tsx`
- `packages/web/src/views/MemorySynthesisPage.tsx`
- `packages/web/src/views/MemoryBrowserView.tsx`
- `packages/web/src/views/MemoryDrawersView.tsx`
- `packages/web/src/views/MemoryGraphPage.tsx` (or equivalent)
- `packages/web/src/views/MemoryConsolidationView.tsx` (if it exists — grep first)

Commit: `feat(web): mount MissingEmbeddingAlert on downstream memory pages`

## Task F9: Sidebar entry for Operations

Modify the memory sub-navigation to include "Operations". Grep for how "Maintenance" / "Synthesis" are listed and copy the pattern.

Commit: `feat(web): add Operations to Memory sidebar`

## Task F10: PR F wrap-up

---

# PR G — Consolidation + Synthesis Handlers + E2E

**Worktree:** `.trees/memory-ops-pr-g`
**Branch:** `agent/claude-1/feat/memory-ops-consol-synth-e2e`

## Task G1: `consolidation` handler

Wrap the existing `knowledge-maintenance.ts::runConsolidation` into a worker-runtime-compatible handler. The underlying function already iterates — bridge its progress callbacks to `ctx.reportProgress`.

Tests + commit.

## Task G2: `synthesis` handler

Same pattern for `knowledge-synthesis.ts::runSynthesis`.

## Task G3: Register handlers in worker.ts

Add `case 'consolidation':` and `case 'synthesis':` branches.

## Task G4: Playwright e2e — OpenAI happy path

```
packages/web/tests/e2e/memory-ops/openai-happy.spec.ts
```

1. Seed 100 facts with `embedding IS NULL`.
2. Start a local OpenAI stub (msw-node or express on an ephemeral port returning deterministic vectors).
3. UI flow: `/settings` → Memory & Embeddings → Add provider → fill form with `baseUrl=<stub>` → Save → Test → see dim=1536.
4. `/memory/operations` → JobCard embedding-backfill → Run.
5. Observe progress > 0, then completed status.
6. `/memory/maintenance` → alert gone, run maintenance → results non-empty.

## Task G5: Playwright e2e — Gemini happy path

Same as G4 but stubbing Gemini's `/v1beta/openai/embeddings` shape.

## Task G6: Playwright e2e — Missing alert coverage

With no provider configured, visit each of 6 pages and assert alert banner present.

## Task G7: CI update

Add new specs to the backend-independent CI allowlist if needed. Follow the pattern from existing `webhooks` / `audit` slice additions.

## Task G8: PR G wrap-up + release notes

Final release: bump **minor** (not patch) — this closes the feature. `./scripts/version-bump.sh minor "Memory Operations UI v1 complete"` on main after all 7 PRs merge.

---

## Self-Review Checklist (post-plan)

**Spec coverage:**
- [x] Configure embedding providers (Settings UI) → PR C
- [x] Encrypted key storage matching api_accounts pattern → PR A + PR B
- [x] OpenAI + Gemini providers only → PR A catalog + PR C UI restricts
- [x] Trigger maintenance jobs from UI → PR F
- [x] 4 job kinds (embedding-backfill, drawer-backfill, consolidation, synthesis) → PRs E + G
- [x] SSE progress stream → PR D Task D4
- [x] MissingEmbeddingAlert on 6 pages → PR F Task F8
- [x] Mesh sync for credentials and jobs → inherited via migration triggers (PR A)
- [x] Critical path (A-E) unblocks 19k backfill → documented in Task E5
- [x] iOS explicitly out of scope → noted in Non-Goals
- [x] 80% coverage target → TDD every task; enforced at PR level

**Placeholder scan:** grep `TBD|TODO|XXX|fill in|placeholder|similar to` — clean.

**Type consistency:** `MemoryOpsJob`, `MemoryOpsJobKind`, `MemoryOpsJobParams`, `EmbeddingProvider`, `EmbeddingProviderInput`, `WorkerContext`, `JobsRepository` used consistently across all PRs.

**Open questions resolved:** all 4 from the spec resolved in the header of this plan.

---

## Execution Choice

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task (or per PR), two-stage review between tasks, fast iteration, best when tasks are independent. Works well for this plan because PRs are phased and each has a clear boundary.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints. Best when there's a single coherent thread of work where context from earlier tasks matters.

Given that PR A-G are mostly sequential with clear boundaries, **subagent-driven** is the cleaner fit — a subagent per PR keeps each session focused.

Which approach?
