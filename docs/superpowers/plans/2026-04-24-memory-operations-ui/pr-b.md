# PR B — Backend: Factory + Providers Route + Memory Rewiring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Status:** Landed in PR #797 (`04ade063`). Keep this file as the implementation record; continue with PR C from the index.

**Goal:** The embedding-client factory (`resolveEmbeddingClient`) with DB-backed provider resolution + cache. Full `/api/memory/providers` CRUD (switch-mode activation, test-before-save, signed ephemeral token). All memory runtime calls wired to use the factory. LITELLM_URL embedding fallback removed. `MEMORY_OPS_STATUS_MAP` Map extension to `controlPlaneErrorToStatus()`.

**Architecture:** The factory is a module singleton. All existing callers of `EmbeddingClient` are refactored to call `resolveEmbeddingClient()` instead. A provider-invalidation bus (Node EventEmitter singleton) fires `provider.changed` after every CRUD op, invalidating the factory cache. The `/api/memory/providers` route shares `pgPool` for raw SQL model-distribution queries.

**Prerequisite:** PR A merged to `main`. Branch this PR from `main` (NOT from PR A's branch).

**Branch:**
```bash
git fetch origin
git worktree add .trees/pr-b -b agent/claude-1/feat/memory-ops-pr-b
cd .trees/pr-b
```

**Tech Stack:** Fastify plugins, Node EventEmitter, crypto HMAC for signed opaque tokens, encrypted short-lived test credentials for full-key binding, Zod `.strict()`, Drizzle ORM, rate-limit plugin.

---

## Files

**Create:**
- `packages/control-plane/src/memory/provider-invalidation-bus.ts`
- `packages/control-plane/src/memory/embedding-client-factory.ts`
- `packages/control-plane/src/memory/ops/audit-logger.ts`
- `packages/control-plane/src/api/routes/memory-providers.ts`
- `packages/control-plane/src/api/routes/memory-providers.test.ts`
- `docs/superpowers/specs/2026-04-24-memory-operations-ui-coverage-baseline.md`
- `docs/superpowers/specs/2026-04-24-memory-operations-ui-perf-baseline.md`

**Modify:**
- `packages/control-plane/src/memory/memory-search.ts` — factory getter; vector predicate update; BM25/graph audit
- `packages/control-plane/src/memory/memory-store.ts` — `addFact` writes `resolved.model` to `content_model`
- `packages/control-plane/src/memory/memory-drawer-store.ts` — `writeSource` writes `resolved.model` to `embedding_model`
- `packages/control-plane/src/memory/memory-drawer-search.ts` — factory getter; embedding predicate
- `packages/control-plane/src/api/routes/memory-drawers.ts` — receives factory getter
- `packages/control-plane/src/api/routes/memory-facts.ts` (lines 285–290, 681–690) — drawer fusion uses factory getter
- `packages/control-plane/src/api/server.ts` — register providers route; extend `controlPlaneErrorToStatus()`; add MEMORY_OPS_STATUS_MAP
- `packages/control-plane/src/index.ts` — drop LITELLM_URL block
- `.env.example` — add `MEMORY_OPS_SIGNING_SECRET`

---

## Task 1: Provider invalidation bus

**Files:**
- Create: `packages/control-plane/src/memory/provider-invalidation-bus.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/control-plane/src/memory/provider-invalidation-bus.test.ts
import { providerInvalidationBus, resetBusForTesting } from './provider-invalidation-bus.js';

beforeEach(() => resetBusForTesting());

it('emits provider.changed and can be listened to', async () => {
  const received: string[] = [];
  providerInvalidationBus.on('provider.changed', (id) => received.push(id));
  providerInvalidationBus.emit('provider.changed', 'uuid-1');
  expect(received).toEqual(['uuid-1']);
});

it('resetBusForTesting leaves exactly 1 listener after re-init', () => {
  // add a spurious listener
  providerInvalidationBus.on('provider.changed', () => {});
  providerInvalidationBus.on('provider.changed', () => {});
  resetBusForTesting();
  // standard listener is re-registered; spurious ones removed
  expect(providerInvalidationBus.listenerCount('provider.changed')).toBe(1);
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd packages/control-plane
pnpm vitest run src/memory/provider-invalidation-bus.test.ts
# Expected: FAIL — module not found
```

- [ ] **Step 3: Create the bus**

```typescript
// packages/control-plane/src/memory/provider-invalidation-bus.ts
import { EventEmitter } from 'node:events';

type ProviderBusEvents = {
  'provider.changed': [credentialId: string | 'active'];
};

class ProviderInvalidationBus extends EventEmitter<ProviderBusEvents> {}

export const providerInvalidationBus = new ProviderInvalidationBus();
providerInvalidationBus.setMaxListeners(3);

// Standard cache-clearing listener — registered once at module init.
// resetBusForTesting() removes and re-registers it so tests get a clean slate.
function standardListener(_id: string) {
  // The factory module registers its actual cache-clearing logic here.
  // This placeholder is overwritten by the factory on import.
}

providerInvalidationBus.on('provider.changed', standardListener);

export function resetBusForTesting(): void {
  providerInvalidationBus.removeAllListeners('provider.changed');
  // Re-register so the bus has exactly 1 listener
  providerInvalidationBus.on('provider.changed', standardListener);
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm vitest run src/memory/provider-invalidation-bus.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/memory/provider-invalidation-bus.ts packages/control-plane/src/memory/provider-invalidation-bus.test.ts
git commit -m "feat(memory-ops): provider invalidation bus singleton"
```

---

## Task 2: embedding-client-factory.ts

**Files:**
- Create: `packages/control-plane/src/memory/embedding-client-factory.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/control-plane/src/memory/embedding-client-factory.test.ts
import { resolveEmbeddingClient, resetFactoryForTesting } from './embedding-client-factory.js';
import { resetBusForTesting } from './provider-invalidation-bus.js';

const mockPool = {} as Pool;
const mockDb = {
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([
          { id: 'cred-1', provider: 'openai', credential: 'encrypted', credentialIv: 'iv',
            metadata: {}, credentialKind: 'embedding' },
        ]),
      }),
    }),
  }),
} as unknown as Database;

beforeEach(() => {
  resetFactoryForTesting();
  resetBusForTesting();
});

it('throws EMBEDDING_NO_PROVIDER when no active embedding account', async () => {
  const db = {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
    })})
  } as unknown as Database;
  await expect(resolveEmbeddingClient({ pool: mockPool, db, encryptionKey: 'key', logger: silentLogger }))
    .rejects.toMatchObject({ code: 'EMBEDDING_NO_PROVIDER' });
});

it('caches result on second call', async () => {
  // Call twice — db.select should only be called once
  await resolveEmbeddingClient({ pool: mockPool, db: mockDb, encryptionKey: 'key', logger: silentLogger });
  await resolveEmbeddingClient({ pool: mockPool, db: mockDb, encryptionKey: 'key', logger: silentLogger });
  // mockDb.select called only once (cache hit on second)
  expect(mockDb.select).toHaveBeenCalledTimes(1);
});

it('clears cache on provider.changed event', async () => {
  await resolveEmbeddingClient({ pool: mockPool, db: mockDb, encryptionKey: 'key', logger: silentLogger });
  providerInvalidationBus.emit('provider.changed', 'active');
  await resolveEmbeddingClient({ pool: mockPool, db: mockDb, encryptionKey: 'key', logger: silentLogger });
  expect(mockDb.select).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pnpm vitest run src/memory/embedding-client-factory.test.ts
# Expected: FAIL — module not found
```

- [ ] **Step 3: Implement the factory**

```typescript
// packages/control-plane/src/memory/embedding-client-factory.ts
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';

import type { Logger } from '../logger.js';
import type { Database } from '../db/index.js';
import { apiAccounts } from '../db/schema.js';
import { ControlPlaneError } from '../errors.js';
import { decryptCredential } from '../crypto/credentials.js';
import { EMBEDDING_MODEL_CATALOG } from '@agentctl/shared';
import { EmbeddingClient } from './embedding-client.js';
import { providerInvalidationBus } from './provider-invalidation-bus.js';

export type ResolvedEmbeddingClient = {
  client: EmbeddingClient;
  model: string;
  providerKind: string;
  providerHost: string;
  priceUsdPerMtoken: number;
  credentialId: string;
};

type FactoryInput = {
  pool: Pool;
  db: Database;
  encryptionKey: string;
  logger: Logger;
  credentialId?: string;
};

type CacheEntry = { resolved: ResolvedEmbeddingClient; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

// Register cache-clearing listener once.
providerInvalidationBus.on('provider.changed', (id) => {
  cache.delete(id);
  cache.delete('active');
});

export async function resolveEmbeddingClient(input: FactoryInput): Promise<ResolvedEmbeddingClient> {
  const cacheKey = input.credentialId ?? 'active';
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.resolved;
  }

  let row: typeof apiAccounts.$inferSelect | undefined;

  if (input.credentialId) {
    const rows = await input.db
      .select()
      .from(apiAccounts)
      .where(
        and(
          eq(apiAccounts.id, input.credentialId),
          eq(apiAccounts.credentialKind, 'embedding'),
        ),
      )
      .limit(1);
    row = rows[0];
    if (!row) {
      throw new ControlPlaneError('EMBEDDING_CREDENTIAL_NOT_FOUND', `Embedding credential ${input.credentialId} not found`);
    }
  } else {
    const rows = await input.db
      .select()
      .from(apiAccounts)
      .where(
        and(
          eq(apiAccounts.isActive, true),
          eq(apiAccounts.credentialKind, 'embedding'),
        ),
      )
      .limit(1);
    row = rows[0];
    if (!row) {
      throw new ControlPlaneError('EMBEDDING_NO_PROVIDER', 'No active embedding provider configured');
    }
  }

  let apiKey: string;
  try {
    apiKey = await decryptCredential(row.credential, row.credentialIv, input.encryptionKey);
  } catch {
    throw new ControlPlaneError('EMBEDDING_CREDENTIAL_DECRYPT_FAILED', 'Failed to decrypt embedding credential');
  }

  const catalogEntry = EMBEDDING_MODEL_CATALOG.find(
    (e) => e.provider === row!.provider && e.model === (row!.metadata as Record<string,unknown>).model as string,
  );

  const model = (row.metadata as Record<string, unknown>).model as string;
  const entry = catalogEntry ?? EMBEDDING_MODEL_CATALOG.find(e => e.provider === row!.provider);

  const client = new EmbeddingClient({
    baseUrl: entry?.baseUrl ?? 'https://api.openai.com',
    model,
    apiKey,
    embeddingsPath: entry?.embeddingsPath,
    extraBody: entry?.extraBody,
    logger: input.logger,
  });

  const resolved: ResolvedEmbeddingClient = {
    client,
    model,
    providerKind: row.provider,
    providerHost: entry?.baseUrl ?? 'https://api.openai.com',
    priceUsdPerMtoken: entry?.pricePerMtoken ?? 0.02,
    credentialId: row.id,
  };

  cache.set(cacheKey, { resolved, expiresAt: Date.now() + TTL_MS });
  return resolved;
}

/** Call in tests only. Clears cache and resets bus listeners. */
export function resetFactoryForTesting(): void {
  cache.clear();
}
```

Note: `decryptCredential` is imported from an existing crypto utility. Grep for its location:
```bash
grep -rn "decryptCredential\|decrypt_credential" packages/control-plane/src/ | head -5
```
Use whatever the existing pattern is.

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm vitest run src/memory/embedding-client-factory.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/memory/embedding-client-factory.ts packages/control-plane/src/memory/embedding-client-factory.test.ts
git commit -m "feat(memory-ops): resolveEmbeddingClient factory with TTL cache and bus invalidation"
```

---

## Task 3: Memory runtime rewiring

**Files:**
- Modify: `packages/control-plane/src/memory/memory-store.ts`
- Modify: `packages/control-plane/src/memory/memory-search.ts`
- Modify: `packages/control-plane/src/memory/memory-drawer-store.ts`
- Modify: `packages/control-plane/src/memory/memory-drawer-search.ts`
- Modify: `packages/control-plane/src/api/routes/memory-drawers.ts`
- Modify: `packages/control-plane/src/api/routes/memory-facts.ts`

Before making changes, audit non-vector search paths for incorrect `content_model` filters.

- [ ] **Step 1: Audit non-vector search methods**

```bash
grep -n "content_model\|embedding_model" packages/control-plane/src/memory/memory-search.ts
```

Any `content_model` WHERE clause in BM25, graph, or keyword search must be removed. Only vector search gets the model predicate.

- [ ] **Step 2: Write failing tests for addFact content_model write**

```typescript
// Add to memory-store.test.ts:
it('addFact writes resolved.model to content_model (not hardcoded)', async () => {
  const resolvedClient = {
    client: mockEmbeddingClient,
    model: 'gemini-embedding-001', // non-default model
    providerKind: 'gemini',
    providerHost: 'https://generativelanguage.googleapis.com',
    priceUsdPerMtoken: 0.15,
    credentialId: 'cred-1',
  };
  await store.addFact('test content', { factoryGetter: async () => resolvedClient });
  const [fact] = await db.query.memoryFacts... // or raw SQL
  // IMPORTANT: content_model is a raw-SQL column; use pool for verification
  const row = await pool.query('SELECT content_model FROM memory_facts WHERE id=$1', [fact.id]);
  expect(row.rows[0].content_model).toBe('gemini-embedding-001');
});

it('BM25 search returns facts with old content_model when active provider is different', async () => {
  // seed: a fact with content_model='old-model' + embedding is not null
  await pool.query(
    "INSERT INTO memory_facts(content, content_model, embedding) VALUES ($1,'old-model',$2::vector)",
    ['old content', pgvector(Array(1536).fill(0.1))],
  );
  const results = await store.bm25Search('content');
  expect(results.some(r => r.content === 'old content')).toBe(true); // NOT filtered out
});
```

- [ ] **Step 3: Run tests — expect failure on content_model write**

```bash
pnpm vitest run src/memory/memory-store.test.ts
# Expected: FAIL — content_model is written as hardcoded default, not resolved.model
```

- [ ] **Step 4: Rewire memory-store.ts addFact**

In `memory-store.ts`, the `addFact` method calls `embeddingClient.embed(text)`. Change it to accept a `factoryGetter` function, call `resolveEmbeddingClient()`, then write `resolved.model` to `content_model` via raw SQL:

```typescript
// The addFact signature gains a factory getter:
async addFact(content: string, options: {
  factoryGetter: () => Promise<ResolvedEmbeddingClient>;
  // ... existing options
}): Promise<MemoryFact> {
  const resolved = await options.factoryGetter();
  const { vectors } = await resolved.client.embedBatchWithUsage([content]);
  const vector = vectors[0];
  // Write content_model = resolved.model via raw SQL (it's not in Drizzle schema for facts):
  await this.pool.query(
    `UPDATE memory_facts SET embedding = $1::vector, content_model = $2 WHERE id = $3`,
    [pgvector(vector), resolved.model, factId],
  );
}
```

The exact integration depends on the existing `addFact` internals — read `memory-store.ts` fully before making changes. The key invariant: `content_model` must equal `resolved.model`, not a hardcoded constant.

- [ ] **Step 5: Rewire memory-search.ts vector path**

In `memory-search.ts`, `vectorSearch` must filter by `embedding IS NOT NULL AND content_model = $queryModel`. The `$queryModel` comes from `resolveEmbeddingClient()`.model. Non-vector paths (BM25, graph, keyword) must NOT filter by `content_model`.

Remove any existing `content_model IS NULL` clause (column is NOT NULL DEFAULT).

- [ ] **Step 6: Rewire drawer-store.ts writeSource**

Same pattern as addFact: write `resolved.model` to `embedding_model` (this column IS in Drizzle schema — `memory_drawers.embeddingModel`).

- [ ] **Step 7: Rewire drawer-search.ts**

`vectorSearch` must filter by `embedding IS NOT NULL AND embedding_model = $queryModel`.

- [ ] **Step 8: Update route files to pass factory getter**

`memory-drawers.ts` and `memory-facts.ts` receive a factory getter bound at server startup. They pass it to `MemoryDrawerStore`, `MemoryDrawerSearch`, `MemorySearch`, `MemoryStore`. The factory getter is `() => resolveEmbeddingClient({ pool, db, encryptionKey, logger })`.

- [ ] **Step 9: Drop LITELLM_URL embedding block from index.ts**

In `packages/control-plane/src/index.ts`, find and remove the block that creates an `EmbeddingClient` from `LITELLM_URL`. Add a comment in `.env.example`:
```
# LITELLM_URL: used for LLM routing only; NOT an embedding source since v0.3.x.
# To embed memory facts, configure a provider in Settings → Memory & Embeddings.
```

- [ ] **Step 10: Run all memory tests**

```bash
pnpm vitest run src/memory/
# Expected: PASS
```

- [ ] **Step 11: Commit**

```bash
git add packages/control-plane/src/memory/ packages/control-plane/src/api/routes/memory-drawers.ts packages/control-plane/src/api/routes/memory-facts.ts packages/control-plane/src/index.ts
git commit -m "feat(memory-ops): wire all memory paths through resolveEmbeddingClient; remove LITELLM_URL embedding fallback"
```

---

## Task 4: Audit logger implementation

**Files:**
- Create: `packages/control-plane/src/memory/ops/audit-logger.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/control-plane/src/memory/ops/audit-logger.test.ts
import { MemoryOpsAuditLogger } from './audit-logger.js';

it('writes an audit entry to the DB', async () => {
  const pool = testPool(); // use real integration pool
  const logger = new MemoryOpsAuditLogger(pool);
  await logger.write({
    actor: 'local:testhost',
    action: 'provider.create',
    target: 'openai/text-embedding-3-small',
    context: { providerId: 'uuid-1' },
  });
  const result = await pool.query('SELECT * FROM memory_ops_audit ORDER BY timestamp DESC LIMIT 1');
  expect(result.rows[0].action).toBe('provider.create');
  expect(result.rows[0].actor).toBe('local:testhost');
});

it('redacts sensitive keys in context', async () => {
  const pool = testPool();
  const logger = new MemoryOpsAuditLogger(pool);
  await logger.write({
    actor: 'worker:m1',
    action: 'job.create',
    target: 'job-uuid',
    context: { apiKey: 'sk-secret', providerId: 'uuid-1' },
  });
  const result = await pool.query('SELECT context FROM memory_ops_audit ORDER BY timestamp DESC LIMIT 1');
  expect(result.rows[0].context.apiKey).toBe('[REDACTED]');
  expect(result.rows[0].context.providerId).toBe('uuid-1');
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm vitest run src/memory/ops/audit-logger.test.ts
# Expected: FAIL — module not found
```

- [ ] **Step 3: Implement audit logger**

```typescript
// packages/control-plane/src/memory/ops/audit-logger.ts
import type { Pool } from 'pg';
import { redactSensitiveKeys, type MemoryOpsAuditAction } from '@agentctl/shared';

type AuditEntry = {
  actor: string;
  action: MemoryOpsAuditAction;
  target: string;
  context: Record<string, unknown>;
};

export class MemoryOpsAuditLogger {
  constructor(private readonly pool: Pool) {}

  async write(entry: AuditEntry): Promise<void> {
    const redacted = redactSensitiveKeys(entry.context);
    await this.pool.query(
      `INSERT INTO memory_ops_audit (actor, action, target, context)
       VALUES ($1, $2, $3, $4)`,
      [entry.actor, entry.action, entry.target, JSON.stringify(redacted)],
    );
  }
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm vitest run src/memory/ops/audit-logger.test.ts
# Expected: PASS (requires live postgres; use INTEGRATION_TEST=true or docker-compose pg)
```

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/memory/ops/audit-logger.ts packages/control-plane/src/memory/ops/audit-logger.test.ts
git commit -m "feat(memory-ops): MemoryOpsAuditLogger writes to memory_ops_audit with context redaction"
```

---

## Task 5: `/api/memory/providers` route

**Files:**
- Create: `packages/control-plane/src/api/routes/memory-providers.ts`
- Create: `packages/control-plane/src/api/routes/memory-providers.test.ts`

This is the most complex task in PR B. The route implements full CRUD + two test endpoints. Key behaviors:
- Switch-mode activation: PATCH `active:true` atomically deactivates other embedding rows in same TX
- Signed ephemeral token for test-before-save flow
- `recentTestResult` server-side validation (HMAC fingerprint + expiry)
- MODEL_MISMATCH detection queries both `memory_facts` and `memory_drawers`

- [ ] **Step 1: Write failing tests (key scenarios)**

```typescript
// packages/control-plane/src/api/routes/memory-providers.test.ts
describe('GET /api/memory/providers', () => {
  it('returns only embedding-kind accounts', async () => {
    // seed one runtime + one embedding account
    // GET → only embedding appears
  });
});

describe('POST /api/memory/providers', () => {
  it('returns 409 DUPLICATE_ACTIVE_EMBEDDING when active provider already exists', async () => {
    // seed: active embedding provider exists
    // POST new active provider → 409
  });

  it('validates provider/model against catalog.verified=true', async () => {
    // POST with provider:gemini → 422 VALIDATION_ERROR "provider not verified"
  });
});

describe('POST /api/memory/providers/test-ephemeral', () => {
  it('returns 503 SIGNING_SECRET_MISSING when env var absent', async () => {
    process.env.MEMORY_OPS_SIGNING_SECRET = '';
    const res = await app.inject({ method: 'POST', url: '/api/memory/providers/test-ephemeral',
      payload: { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'sk-test' } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('SIGNING_SECRET_MISSING');
  });
});

describe('PATCH /api/memory/providers/:id', () => {
  it('switch-mode activation deactivates old active provider', async () => {
    // seed: provider A is active
    // PATCH provider B { active: true }
    // assert: provider A is_active=false, provider B is_active=true (same TX)
  });

  it('PATCH apiKey without recentTestResult → lastTestOk=null', async () => {});
  it('PATCH apiKey with valid recentTestResult → lastTestOk=true (not null)', async () => {});
  it('expired recentTestResult → 422 VALIDATION_ERROR', async () => {});
});

describe('DELETE /api/memory/providers/:id', () => {
  it('returns 409 PROVIDER_HAS_ACTIVE_JOBS when active jobs reference credential', async () => {
    // seed: running job with credential_id = provider.id
    // DELETE → 409
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pnpm vitest run src/api/routes/memory-providers.test.ts
# Expected: FAIL — route not registered
```

- [ ] **Step 3: Implement the route**

Key implementation details (read spec §6.1 for full contract):

```typescript
// packages/control-plane/src/api/routes/memory-providers.ts
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { and, eq, ne } from 'drizzle-orm';
import type { Pool } from 'pg';

import { apiAccounts } from '../../db/schema.js';
import type { Database } from '../../db/index.js';
import { ControlPlaneError } from '../../errors.js';
import { EMBEDDING_MODEL_CATALOG, validateCatalog } from '@agentctl/shared';
import { encryptCredential, decryptCredential } from '../../crypto/credentials.js';
import { providerInvalidationBus } from '../../memory/provider-invalidation-bus.js';
import { MemoryOpsAuditLogger } from '../../memory/ops/audit-logger.js';
import type { Logger } from '../../logger.js';

validateCatalog(); // Boot: throws if catalog invalid; CP must not start with broken catalog

const SIGNING_SECRET = process.env.MEMORY_OPS_SIGNING_SECRET ?? '';
const TOKEN_TTL_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;

const embeddingProviderCreateSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(['openai', 'gemini']),
  model: z.string(),
  apiKey: z.string().min(1),
  active: z.boolean().default(false),
  recentTestResult: z.object({
    signedToken: z.string(),
    apiKey: z.string(), // submitted key for fingerprint check
  }).optional(),
}).strict().superRefine((val, ctx) => {
  const entry = EMBEDDING_MODEL_CATALOG.find(e => e.provider === val.provider && e.model === val.model);
  if (!entry || !entry.verified) {
    ctx.addIssue({ code: 'custom', message: 'provider not verified', path: ['provider'] });
  }
});

// Helper: sign an ephemeral test result token
function signToken(payload: Record<string, unknown>): string {
  return createHmac('sha256', SIGNING_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
}

// Helper: verify a recentTestResult token
function verifyRecentTestResult(token: { signedToken: string; apiKey: string }): {
  ok: boolean; dim: number; model: string; latencyMs: number; costUsd: number; testedAt: number; provider: string;
} | null {
  // Token format: { provider, model, apiKeyFingerprint, dim, ok, testedAt }
  // We decode from signedToken (base64 JSON + signature check)
  try {
    const [payloadB64, sig] = token.signedToken.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
    const expectedSig = createHmac('sha256', SIGNING_SECRET)
      .update(payloadB64)
      .digest('hex');
    if (sig !== expectedSig) return null;
    if (Date.now() - payload.testedAt > TOKEN_TTL_MS) return null;
    // Verify apiKey fingerprint
    const fingerprint = createHmac('sha256', SIGNING_SECRET).update(token.apiKey).digest('hex');
    if (fingerprint !== payload.apiKeyFingerprint) return null;
    return payload;
  } catch {
    return null;
  }
}

type ProviderRouteOptions = {
  db: Database;
  pool: Pool;
  encryptionKey: string;
  logger: Logger;
};

export const memoryProvidersRoutes: FastifyPluginAsync<ProviderRouteOptions> = async (fastify, opts) => {
  const audit = new MemoryOpsAuditLogger(opts.pool);

  // GET /api/memory/providers
  fastify.get('/', async (_req, reply) => {
    const rows = await opts.db
      .select()
      .from(apiAccounts)
      .where(eq(apiAccounts.credentialKind, 'embedding'))
      .orderBy(apiAccounts.createdAt);
    reply.send({ providers: rows.map(rowToProvider) });
  });

  // POST /api/memory/providers/test-ephemeral (rate-limited)
  fastify.post('/test-ephemeral', {
    config: { rateLimit: { max: RATE_LIMIT_MAX, timeWindow: RATE_LIMIT_WINDOW_MS } },
  }, async (req, reply) => {
    if (!SIGNING_SECRET) {
      throw new ControlPlaneError('SIGNING_SECRET_MISSING', 'MEMORY_OPS_SIGNING_SECRET not configured');
    }
    const body = req.body as { provider: string; model: string; apiKey: string };
    const entry = EMBEDDING_MODEL_CATALOG.find(e => e.provider === body.provider && e.model === body.model);
    if (!entry) throw new ControlPlaneError('VALIDATION_ERROR', 'Unknown provider/model');

    const start = Date.now();
    const client = new EmbeddingClient({
      baseUrl: entry.baseUrl, model: body.model, apiKey: body.apiKey,
      embeddingsPath: entry.embeddingsPath, extraBody: entry.extraBody, logger: opts.logger,
    });
    const result = await client.embedBatchWithUsage(['ping']);
    const latencyMs = Date.now() - start;
    const dim = result.vectors[0].length;
    const testedAt = Date.now();
    const apiKeyFingerprint = createHmac('sha256', SIGNING_SECRET).update(body.apiKey).digest('hex');
    const payload = { provider: body.provider, model: body.model, apiKeyFingerprint, dim, ok: true, testedAt };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
    const sig = createHmac('sha256', SIGNING_SECRET).update(payloadB64).digest('hex');
    const signedToken = `${payloadB64}.${sig}`;
    const costUsd = (result.usage.promptTokens / 1e6) * entry.pricePerMtoken;

    reply.send({ ok: true, dim, model: result.model, costUsd, latencyMs, signedToken });
  });

  // POST /api/memory/providers
  fastify.post('/', async (req, reply) => {
    const body = embeddingProviderCreateSchema.parse(req.body);
    const { encrypted, iv } = await encryptCredential(body.apiKey, opts.encryptionKey);
    const last4 = body.apiKey.slice(-4);

    // Parse recentTestResult if provided
    let metadata: Record<string, unknown> = { model: body.model, lastTestOk: null, lastTestError: null, lastTestedAt: null, dim: null, latencyMs: null, costUsd: null };
    if (body.recentTestResult) {
      const verified = verifyRecentTestResult(body.recentTestResult);
      if (!verified) throw new ControlPlaneError('VALIDATION_ERROR', 'recentTestResult expired or invalid', { issues: [{ message: 'recentTestResult expired' }] });
      metadata = { ...metadata, lastTestOk: true, lastTestError: null, lastTestedAt: new Date().toISOString(), dim: verified.dim, latencyMs: verified.latencyMs, costUsd: verified.costUsd };
    }

    const actor = (req.headers['x-agentctl-actor'] as string) ?? `local:${os.hostname()}`;

    try {
      await opts.db.transaction(async (tx) => {
        if (body.active) {
          // Model-lock check
          await checkModelLock(opts.pool, body.model);
          // Deactivate all other embedding accounts
          await tx.update(apiAccounts)
            .set({ isActive: false })
            .where(and(eq(apiAccounts.credentialKind, 'embedding'), eq(apiAccounts.isActive, true)));
        }
        await tx.insert(apiAccounts).values({
          name: body.name, provider: body.provider, credential: encrypted, credentialIv: iv,
          credentialKind: 'embedding', credentialLast4: last4, isActive: body.active,
          metadata,
        });
      });
    } catch (err: unknown) {
      if (isUniqueConstraintViolation(err, 'api_accounts_one_active_embedding')) {
        throw new ControlPlaneError('DUPLICATE_ACTIVE_EMBEDDING', 'An active embedding provider already exists', { constraint: 'api_accounts_one_active_embedding' });
      }
      throw err;
    }

    providerInvalidationBus.emit('provider.changed', 'active');
    await audit.write({ actor, action: 'provider.create', target: `${body.provider}/${body.model}`, context: { name: body.name } });

    const rows = await opts.db.select().from(apiAccounts).where(eq(apiAccounts.credentialKind, 'embedding')).orderBy(apiAccounts.createdAt);
    reply.code(201).send({ provider: rowToProvider(rows[rows.length - 1]) });
  });

  // PATCH /api/memory/providers/:id, DELETE, POST /:id/test — implement similarly
  // (see spec §6.1 for full field matrix)
};

function rowToProvider(row: typeof apiAccounts.$inferSelect) {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  return {
    id: row.id, name: row.name, provider: row.provider,
    model: meta.model, apiKeyLast4: row.credentialLast4, isActive: row.isActive,
    metadata: {
      lastTestOk: meta.lastTestOk ?? null,
      lastTestError: meta.lastTestError ?? null,
      lastTestedAt: meta.lastTestedAt ?? null,
      dim: meta.dim ?? null,
      latencyMs: meta.latencyMs ?? null,
      costUsd: meta.costUsd ?? null,
    },
    createdAt: row.createdAt?.toISOString(), updatedAt: row.updatedAt?.toISOString(),
  };
}

async function checkModelLock(pool: Pool, incomingModel: string): Promise<void> {
  const { rows } = await pool.query(`
    SELECT 'memory_facts' AS tbl, content_model AS model, COUNT(*)::int AS c
    FROM memory_facts WHERE embedding IS NOT NULL GROUP BY content_model
    UNION ALL
    SELECT 'memory_drawers', embedding_model, COUNT(*)::int
    FROM memory_drawers WHERE embedding IS NOT NULL GROUP BY embedding_model
  `);
  if (rows.length === 0) return; // no existing embeddings — any provider ok
  const models = [...new Set(rows.map((r: {model:string}) => r.model))];
  if (models.length === 1 && models[0] === incomingModel) return; // same model — ok
  throw new ControlPlaneError('MODEL_MISMATCH', 'Existing embeddings use a different model',
    { existingModels: rows.map((r: {tbl:string;model:string;c:number}) => ({ table: r.tbl, model: r.model, count: r.c })), incomingModel });
}

function isUniqueConstraintViolation(err: unknown, constraintName: string): boolean {
  return (err as {code?:string;constraint?:string})?.code === '23505'
    && (err as {constraint?:string})?.constraint === constraintName;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm vitest run src/api/routes/memory-providers.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/api/routes/memory-providers.ts packages/control-plane/src/api/routes/memory-providers.test.ts
git commit -m "feat(memory-ops): /api/memory/providers CRUD — switch-mode activation, signed ephemeral token, model-lock"
```

---

## Task 6: Register routes + extend controlPlaneErrorToStatus()

**Files:**
- Modify: `packages/control-plane/src/api/server.ts`

- [ ] **Step 1: Write failing test**

```typescript
// In server integration tests, verify EMBEDDING_NO_PROVIDER → 409:
it('resolveEmbeddingClient failure returns 409 EMBEDDING_NO_PROVIDER', async () => {
  // set up server with no active embedding account
  // trigger any route that calls resolveEmbeddingClient
  // expect 409 with error: 'EMBEDDING_NO_PROVIDER'
});
```

- [ ] **Step 2: Add MEMORY_OPS_STATUS_MAP to server.ts**

Find `controlPlaneErrorToStatus` at line 1197 and extend it with a Map lookup before the existing pattern-match:

```typescript
// Add near top of controlPlaneErrorToStatus function:
const MEMORY_OPS_STATUS_MAP = new Map<string, number>([
  ['VALIDATION_ERROR', 422],
  ['EMBEDDING_NO_PROVIDER', 409],
  ['PROVIDER_AUTH_FAILED', 401],
  ['RATE_LIMITED', 429],
  ['EMBEDDING_CREDENTIAL_DECRYPT_FAILED', 500],
  ['EMBEDDING_CREDENTIAL_NOT_FOUND', 404],
  ['PROVIDER_HAS_ACTIVE_JOBS', 409],
  ['PROVIDER_NOT_FOUND', 404],
  ['JOB_NOT_FOUND', 404],
  ['JOB_NOT_CANCELLABLE', 409],
  ['REMOTE_PEER_JOB', 403],
  ['CONCURRENT_JOB_REQUEST', 409],
  ['JOB_ALREADY_RUNNING', 409],
  ['DUPLICATE_ACTIVE_EMBEDDING', 409],
  ['EGRESS_NOT_CONFIRMED', 400],
  ['EGRESS_SNAPSHOT_STALE', 400],
  ['FEATURE_DISABLED', 400],
  ['JOB_KIND_NOT_ENABLED', 400],
  ['MODEL_MISMATCH', 409],
  ['MIXED_MODEL_BLOCKED', 409],
  ['INVALID_ACCOUNT_KIND', 422],
  ['QUEUE_ENQUEUE_FAILED', 500],
  ['SIGNING_SECRET_MISSING', 503],
  ['CATALOG_INVALID', 500],
]);

function controlPlaneErrorToStatus(code: string): number {
  const fromMap = MEMORY_OPS_STATUS_MAP.get(code);
  if (fromMap !== undefined) return fromMap;
  // ... existing pattern-match fallback
}
```

Also register the providers route:
```typescript
// In the db + pool + encryptionKey guard section (pattern from accountRoutes at lines 828-847):
await fastify.register(memoryProvidersRoutes, {
  prefix: '/api/memory/providers',
  db, pool, encryptionKey, logger,
});
```

- [ ] **Step 3: Run server tests**

```bash
pnpm vitest run src/api/server.test.ts
# Expected: PASS
```

- [ ] **Step 4: Update .env.example**

```bash
echo '' >> .env.example
echo '# Memory Operations — signing secret for ephemeral test-before-save tokens (32+ chars)' >> .env.example
echo '# MEMORY_OPS_SIGNING_SECRET=' >> .env.example
```

- [ ] **Step 5: Write baseline docs**

Create `docs/superpowers/specs/2026-04-24-memory-operations-ui-coverage-baseline.md`:
```markdown
# Memory Operations — Coverage Baseline (PR B)

Recorded after PR B merges. Target: maintain or improve.

| Package | File | Coverage |
|---------|------|----------|
| control-plane | memory/embedding-client-factory.ts | TBD — run `pnpm vitest run --coverage` |
| control-plane | memory/memory-store.ts | TBD |
| control-plane | api/routes/memory-providers.ts | TBD |
```

Create `docs/superpowers/specs/2026-04-24-memory-operations-ui-perf-baseline.md`:
```markdown
# Memory Operations — Performance Baseline (PR B)

Benchmark: 1,000 sequential `addFact` calls, warm factory cache, stub embedding provider.

Command: `pnpm vitest bench src/memory/memory-store.bench.ts`

Result (recorded after PR B): **TBD** — run after merge and fill in P50/P99.

Acceptance gate (PR E evaluation): P99 ≤ baseline + 15%.
```

- [ ] **Step 6: Full build + test**

```bash
pnpm build && pnpm vitest run && pnpm lint
# Expected: 0 errors
```

- [ ] **Step 7: Commit + push + open PR**

```bash
git add packages/control-plane/src/api/server.ts .env.example docs/superpowers/specs/
git commit -m "feat(memory-ops): register providers route; MEMORY_OPS_STATUS_MAP in controlPlaneErrorToStatus"
git push origin agent/claude-1/feat/memory-ops-pr-b
gh pr create --base main \
  --title "feat(memory-ops): PR B — factory, providers route, memory rewiring, LITELLM_URL removal" \
  --body "Connects all memory read/write paths to DB-backed embedding provider. Removes LITELLM_URL embedding fallback. Implements /api/memory/providers CRUD with switch-mode activation and signed ephemeral tokens."
```
