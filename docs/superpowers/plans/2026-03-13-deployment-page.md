# Deployment Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/deployment` page that shows tier health, provides gated dev→beta promotion, and tracks promotion history.

**Architecture:** New CP API routes (`/api/deployment/*`) backed by a `promotion_history` DB table, PM2 programmatic API for process metrics, and `.env.*` file parsing for tier discovery. Frontend is a Next.js page with tier status cards, a promote gate with pre-checks, and a history side panel. SSE streams promotion progress in real-time.

**Tech Stack:** Fastify routes, Drizzle ORM + PostgreSQL, PM2 JS API, dotenv, Next.js App Router, TanStack Query, shadcn/Radix UI, Lucide icons, EventSource (SSE).

**Spec:** `docs/superpowers/specs/2026-03-13-deployment-page-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `packages/shared/src/types/deployment.ts` | Shared types: PromotionStatus, PreflightCheckResult, TierConfig, etc. |
| `packages/control-plane/src/db/schema-deployment.ts` | Drizzle schema for `promotion_history` table |
| `packages/control-plane/drizzle/0017_add_promotion_history.sql` | SQL migration |
| `packages/control-plane/src/utils/tier-config.ts` | TierConfigLoader — reads .env.* files, parses tier configs |
| `packages/control-plane/src/utils/pm2-client.ts` | Pm2Client — wraps PM2 programmatic API |
| `packages/control-plane/src/utils/promotion-runner.ts` | PromotionRunner — executes the promote pipeline, emits SSE events |
| `packages/control-plane/src/api/routes/deployment.ts` | Fastify route plugin: tiers, preflight, promote, history, SSE stream |
| `packages/control-plane/src/api/routes/deployment.test.ts` | Route tests |
| `packages/web/src/app/deployment/page.tsx` | Next.js page entry |
| `packages/web/src/app/deployment/layout.tsx` | Pass-through layout |
| `packages/web/src/views/DeploymentView.tsx` | Main view component |
| `packages/web/src/components/deployment/TierCard.tsx` | Single tier status card |
| `packages/web/src/components/deployment/TierGrid.tsx` | 2-col grid of TierCards |
| `packages/web/src/components/deployment/PromoteGate.tsx` | Pre-check indicators + promote button |
| `packages/web/src/components/deployment/PromotionHistory.tsx` | Side panel with scrollable history |
| `packages/web/src/components/deployment/PromotionProgress.tsx` | SSE-powered progress modal |

### Modified Files

| File | Change |
|------|--------|
| `packages/shared/src/types/index.ts` | Re-export deployment types |
| `packages/control-plane/src/db/index.ts` | Re-export schema-deployment |
| `packages/control-plane/src/api/server.ts` | Register deployment routes |
| `packages/control-plane/drizzle/meta/_journal.json` | Add migration 0017 entry |
| `packages/web/src/components/Sidebar.tsx` | Add Deployment nav item |
| `packages/web/src/lib/api.ts` | Add deployment API methods + types |
| `packages/web/src/lib/queries.ts` | Add deployment query hooks |
| `infra/pm2/ecosystem.beta.config.cjs` | Add REPO_ROOT env var |

---

## Chunk 1: Shared Types + Database Schema

### Task 1: Shared deployment types

**Files:**
- Create: `packages/shared/src/types/deployment.ts`
- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1: Create deployment types file**

```typescript
// packages/shared/src/types/deployment.ts

export const PROMOTION_STATUSES = ['pending', 'running', 'success', 'failed'] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

export const PREFLIGHT_CHECK_NAMES = [
  'source_health',
  'target_health',
  'migration_parity',
  'build',
] as const;
export type PreflightCheckName = (typeof PREFLIGHT_CHECK_NAMES)[number];

export const PREFLIGHT_CHECK_STATUSES = ['pass', 'fail', 'running', 'skipped'] as const;
export type PreflightCheckStatus = (typeof PREFLIGHT_CHECK_STATUSES)[number];

export type PreflightCheckResult = {
  readonly name: PreflightCheckName;
  readonly status: PreflightCheckStatus;
  readonly message?: string;
  readonly durationMs?: number;
};

export type ServiceHealth = {
  readonly name: 'cp' | 'worker' | 'web';
  readonly port: number;
  readonly healthy: boolean;
  readonly memoryMb?: number;
  readonly uptimeSeconds?: number;
  readonly restarts?: number;
  readonly pid?: number;
};

export type TierConfig = {
  readonly name: string;
  readonly label: string;
  readonly cpPort: number;
  readonly workerPort: number;
  readonly webPort: number;
  readonly database: string;
  readonly redisDb: number;
};

export type TierStatus = {
  readonly name: string;
  readonly label: string;
  readonly status: 'running' | 'degraded' | 'stopped';
  readonly services: readonly ServiceHealth[];
  readonly config: TierConfig;
};

export type PromotionRecord = {
  readonly id: string;
  readonly sourceTier: string;
  readonly targetTier: string;
  readonly status: PromotionStatus;
  readonly checks: readonly PreflightCheckResult[];
  readonly error?: string;
  readonly gitSha?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly triggeredBy: string;
};

export type PromotionEvent =
  | { readonly type: 'check'; readonly name: string; readonly status: PreflightCheckStatus; readonly message?: string }
  | { readonly type: 'step'; readonly step: string; readonly message: string }
  | { readonly type: 'log'; readonly line: string }
  | { readonly type: 'complete'; readonly status: 'success' | 'failed'; readonly durationMs: number; readonly error?: string; readonly failedStep?: string };
```

- [ ] **Step 2: Re-export from shared types index**

Add to `packages/shared/src/types/index.ts`:

```typescript
export type {
  PreflightCheckResult,
  PromotionEvent,
  PromotionRecord,
  PromotionStatus,
  PreflightCheckName,
  PreflightCheckStatus,
  ServiceHealth,
  TierConfig,
  TierStatus,
} from './deployment.js';
export {
  PREFLIGHT_CHECK_NAMES,
  PREFLIGHT_CHECK_STATUSES,
  PROMOTION_STATUSES,
} from './deployment.js';
```

- [ ] **Step 3: Verify shared package builds**

Run: `pnpm --filter @agentctl/shared build`
Expected: Clean build, no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/deployment.ts packages/shared/src/types/index.ts
git commit -m "feat(shared): add deployment types for tier status and promotion"
```

### Task 2: Drizzle schema + migration

**Files:**
- Create: `packages/control-plane/src/db/schema-deployment.ts`
- Create: `packages/control-plane/drizzle/0017_add_promotion_history.sql`
- Modify: `packages/control-plane/src/db/index.ts`
- Modify: `packages/control-plane/drizzle/meta/_journal.json`

- [ ] **Step 1: Create Drizzle schema**

```typescript
// packages/control-plane/src/db/schema-deployment.ts
import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const promotionHistory = pgTable('promotion_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceTier: text('source_tier').notNull(),
  targetTier: text('target_tier').notNull().default('beta'),
  status: text('status').notNull().default('pending'),
  checks: jsonb('checks').default([]),
  error: text('error'),
  gitSha: text('git_sha'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),
  triggeredBy: text('triggered_by').notNull().default('web'),
});
```

- [ ] **Step 2: Write SQL migration**

Check the highest existing migration number first:
```bash
ls packages/control-plane/drizzle/*.sql | sort | tail -1
```

Then create the next-numbered migration file (assumed 0017 here):

```sql
-- 0017_add_promotion_history.sql
CREATE TABLE IF NOT EXISTS "promotion_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_tier" text NOT NULL,
  "target_tier" text NOT NULL DEFAULT 'beta',
  "status" text NOT NULL DEFAULT 'pending',
  "checks" jsonb DEFAULT '[]'::jsonb,
  "error" text,
  "git_sha" text,
  "started_at" timestamptz DEFAULT now(),
  "completed_at" timestamptz,
  "duration_ms" integer,
  "triggered_by" text NOT NULL DEFAULT 'web'
);
```

- [ ] **Step 3: Add entry to drizzle journal**

Read `packages/control-plane/drizzle/meta/_journal.json`, add a new entry with the correct `idx` (increment from last).

- [ ] **Step 4: Re-export schema from db/index.ts**

Add to `packages/control-plane/src/db/index.ts`:
```typescript
export * from './schema-deployment.js';
```

- [ ] **Step 5: Verify CP builds**

Run: `pnpm --filter @agentctl/control-plane build`
Expected: Clean build.

- [ ] **Step 6: Apply migration to local DB**

Run: `DATABASE_URL=postgresql://hahaschool@127.0.0.1:5433/agentctl pnpm --filter @agentctl/control-plane drizzle-kit migrate`
Expected: Migration applied successfully.

- [ ] **Step 7: Commit**

```bash
git add packages/control-plane/src/db/schema-deployment.ts packages/control-plane/src/db/index.ts \
  packages/control-plane/drizzle/0017_add_promotion_history.sql packages/control-plane/drizzle/meta/_journal.json
git commit -m "feat(db): add promotion_history table for deployment tracking"
```

---

## Chunk 2: Backend Utilities (TierConfigLoader, Pm2Client, PromotionRunner)

### Task 3: TierConfigLoader

**Files:**
- Create: `packages/control-plane/src/utils/tier-config.ts`

- [ ] **Step 1: Implement TierConfigLoader**

```typescript
// packages/control-plane/src/utils/tier-config.ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import type { TierConfig } from '@agentctl/shared';

const TIER_FILES = ['.env.beta', '.env.dev-1', '.env.dev-2'] as const;

const TIER_LABELS: Record<string, string> = {
  beta: 'Production-like',
  'dev-1': 'Agent Workspace',
  'dev-2': 'Dev Environment 2',
};

// Secrets to exclude from parsed config
const SECRET_PATTERNS = [/KEY/i, /SECRET/i, /TOKEN/i, /PASSWORD/i, /CREDENTIAL/i];

function parseRedisDb(redisUrl: string): number {
  try {
    const url = new URL(redisUrl);
    const db = url.pathname.replace('/', '');
    return db ? parseInt(db, 10) : 0;
  } catch {
    return 0;
  }
}

function parseDatabaseName(dbUrl: string): string {
  try {
    const url = new URL(dbUrl);
    return url.pathname.replace('/', '');
  } catch {
    return 'unknown';
  }
}

export function loadTierConfigs(repoRoot: string): readonly TierConfig[] {
  const configs: TierConfig[] = [];

  for (const file of TIER_FILES) {
    const filePath = join(repoRoot, file);
    if (!existsSync(filePath)) continue;

    const raw = readFileSync(filePath, 'utf-8');
    const env = parse(raw);

    const tierName = env.TIER;
    if (!tierName) continue;

    configs.push({
      name: tierName,
      label: TIER_LABELS[tierName] ?? tierName,
      cpPort: parseInt(env.PORT ?? '8080', 10),
      workerPort: parseInt(env.WORKER_PORT ?? '9000', 10),
      webPort: parseInt(env.WEB_PORT ?? '5173', 10),
      database: parseDatabaseName(env.DATABASE_URL ?? ''),
      redisDb: parseRedisDb(env.REDIS_URL ?? 'redis://localhost:6379/0'),
    });
  }

  return configs;
}

export function isValidSourceTier(source: string, configs: readonly TierConfig[]): boolean {
  return /^dev-\d+$/.test(source) && configs.some((c) => c.name === source);
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @agentctl/control-plane build`

- [ ] **Step 3: Commit**

```bash
git add packages/control-plane/src/utils/tier-config.ts
git commit -m "feat(cp): add TierConfigLoader for .env.* tier discovery"
```

### Task 4: Pm2Client

**Files:**
- Create: `packages/control-plane/src/utils/pm2-client.ts`

- [ ] **Step 1: Install pm2 as dependency**

Run: `pnpm --filter @agentctl/control-plane add pm2`

- [ ] **Step 2: Implement Pm2Client**

```typescript
// packages/control-plane/src/utils/pm2-client.ts
import pm2 from 'pm2';

export type Pm2ProcessInfo = {
  readonly name: string;
  readonly pid: number;
  readonly status: string;
  readonly memoryMb: number;
  readonly uptimeMs: number;
  readonly restarts: number;
};

function connectPm2(): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function listPm2(): Promise<pm2.ProcessDescription[]> {
  return new Promise((resolve, reject) => {
    pm2.list((err, list) => {
      if (err) reject(err);
      else resolve(list);
    });
  });
}

function restartPm2(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.restart(name, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function pm2List(): Promise<readonly Pm2ProcessInfo[]> {
  try {
    await connectPm2();
    const list = await listPm2();
    pm2.disconnect();

    return list.map((p) => ({
      name: p.name ?? 'unknown',
      pid: p.pid ?? 0,
      status: p.pm2_env?.status ?? 'unknown',
      memoryMb: Math.round((p.monit?.memory ?? 0) / 1024 / 1024 * 100) / 100,
      uptimeMs: p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0,
      restarts: (p.pm2_env as Record<string, unknown>)?.restart_time as number ?? 0,
    }));
  } catch {
    return [];
  }
}

export async function pm2Restart(name: string): Promise<void> {
  await connectPm2();
  await restartPm2(name);
  pm2.disconnect();
}
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @agentctl/control-plane build`

- [ ] **Step 4: Commit**

```bash
git add packages/control-plane/src/utils/pm2-client.ts
git commit -m "feat(cp): add Pm2Client wrapper for programmatic PM2 access"
```

### Task 5: PromotionRunner

**Files:**
- Create: `packages/control-plane/src/utils/promotion-runner.ts`

- [ ] **Step 1: Implement PromotionRunner**

This is the core promotion pipeline. It:
1. Runs pre-checks
2. Executes `pnpm build` as a child process
3. Runs `drizzle-kit migrate` against beta DB
4. Restarts PM2 beta services
5. Polls health endpoints
6. Emits events via a callback

Key implementation details:
- Use `child_process.spawn` for build/migrate (non-blocking)
- Use an `EventEmitter` pattern for SSE event emission
- Implement an in-process mutex (promise-based) for concurrency control
- Health probes: fetch with 5s timeout, 30s total polling timeout
- Capture `git rev-parse HEAD` via `execSync` for git_sha

The runner receives: `repoRoot`, `sourceTier`, `betaTierConfig`, `db` (for recording history), `logger`.

Exports: `PromotionRunner` class with `runPreflight(source)` and `promote(source)` methods. `promote` returns an `EventEmitter` that emits `PromotionEvent` objects.

Also exports: `createPromotionMutex()` returning `{ acquire(): Promise<release()>, isLocked: boolean }`.

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @agentctl/control-plane build`

- [ ] **Step 3: Commit**

```bash
git add packages/control-plane/src/utils/promotion-runner.ts
git commit -m "feat(cp): add PromotionRunner with preflight checks and gated promote pipeline"
```

---

## Chunk 3: Backend API Routes

### Task 6: Deployment routes + registration

**Files:**
- Create: `packages/control-plane/src/api/routes/deployment.ts`
- Modify: `packages/control-plane/src/api/server.ts`
- Modify: `infra/pm2/ecosystem.beta.config.cjs`

- [ ] **Step 1: Add REPO_ROOT to PM2 config**

Add to `infra/pm2/ecosystem.beta.config.cjs` CP env block:
```javascript
REPO_ROOT: REPO_ROOT,
```

And add at the top of the config, after `REPO_ROOT` const:
```javascript
const REPO_ROOT = path.resolve(__dirname, '../..');
```

Wait — `REPO_ROOT` is already the variable name used for `path.resolve(__dirname, '../..')`. Just add it to the CP env:

```javascript
REPO_ROOT: REPO_ROOT,  // already defined at top of file
```

Also add it to the worker env block.

- [ ] **Step 2: Implement deployment routes**

Create `packages/control-plane/src/api/routes/deployment.ts` with:

```typescript
import type { FastifyPluginAsync } from 'fastify';
import type { Database } from '../../db/index.js';
import type { Logger } from 'pino';
import { loadTierConfigs, isValidSourceTier } from '../../utils/tier-config.js';
import { pm2List } from '../../utils/pm2-client.js';
import { PromotionRunner, createPromotionMutex } from '../../utils/promotion-runner.js';
import { promotionHistory } from '../../db/schema-deployment.js';
import { desc, eq, sql } from 'drizzle-orm';

export type DeploymentRoutesOptions = {
  db: Database;
  logger: Logger;
};

export const deploymentRoutes: FastifyPluginAsync<DeploymentRoutesOptions> = async (app, opts) => {
  const { db, logger } = opts;
  const repoRoot = process.env.REPO_ROOT ?? process.cwd();
  const tierConfigs = loadTierConfigs(repoRoot);
  const mutex = createPromotionMutex();
  const runner = new PromotionRunner(repoRoot, db, logger);

  // GET /tiers — list all tiers with health
  app.get('/tiers', { schema: { tags: ['deployment'], summary: 'List tier statuses' } }, async () => {
    // Probe health for each tier in parallel, merge with PM2 data for beta
    // Return TierStatusResponse
  });

  // POST /promote/preflight — run pre-checks
  app.post<{ Body: { source: string } }>(
    '/promote/preflight',
    { schema: { tags: ['deployment'], summary: 'Run promotion pre-checks' } },
    async (request, reply) => {
      const { source } = request.body;
      if (!isValidSourceTier(source, tierConfigs)) {
        return reply.code(400).send({ error: 'INVALID_SOURCE', message: `Unknown tier: ${source}` });
      }
      const result = await runner.runPreflight(source, tierConfigs);
      return result;
    },
  );

  // POST /promote — trigger promotion
  app.post<{ Body: { source: string } }>(
    '/promote',
    {
      schema: { tags: ['deployment'], summary: 'Promote dev tier to beta' },
      config: { rateLimit: { max: 1, timeWindow: 30000 } },
    },
    async (request, reply) => {
      const { source } = request.body;
      if (!isValidSourceTier(source, tierConfigs)) {
        return reply.code(400).send({ error: 'INVALID_SOURCE', message: `Unknown tier: ${source}` });
      }
      if (mutex.isLocked) {
        return reply.code(409).send({ error: 'PROMOTION_IN_PROGRESS', message: 'A promotion is already running' });
      }
      const record = await runner.promote(source, tierConfigs, mutex);
      return reply.code(202).send({ id: record.id, status: 'pending' });
    },
  );

  // GET /promote/:id/stream — SSE
  app.get<{ Params: { id: string } }>(
    '/promote/:id/stream',
    { schema: { tags: ['deployment'], summary: 'Stream promotion progress' } },
    async (request, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      // Subscribe to runner events for this promotion ID
      // On each event: reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
      // On complete: reply.raw.end()
    },
  );

  // GET /history — paginated
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/history',
    { schema: { tags: ['deployment'], summary: 'Promotion history' } },
    async (request) => {
      const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100);
      const offset = parseInt(request.query.offset ?? '0', 10);
      const records = await db.select().from(promotionHistory)
        .orderBy(desc(promotionHistory.startedAt))
        .limit(limit)
        .offset(offset);
      const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(promotionHistory);
      return { records, total: Number(count) };
    },
  );
};
```

- [ ] **Step 3: Register in server.ts**

Add import and registration in `packages/control-plane/src/api/server.ts`:

```typescript
import { deploymentRoutes } from './routes/deployment.js';
```

In the `if (db)` block (where other DB-dependent routes are registered):

```typescript
await app.register(deploymentRoutes, {
  prefix: '/api/deployment',
  db,
  logger,
});
```

- [ ] **Step 4: Verify build**

Run: `pnpm --filter @agentctl/control-plane build`

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/api/routes/deployment.ts \
  packages/control-plane/src/api/server.ts \
  infra/pm2/ecosystem.beta.config.cjs
git commit -m "feat(cp): add deployment API routes for tier status, preflight, promote, history"
```

### Task 7: Route tests

**Files:**
- Create: `packages/control-plane/src/api/routes/deployment.test.ts`

- [ ] **Step 1: Write route tests**

Test the following:
- `GET /tiers` — returns tier list with health status
- `POST /promote/preflight` — validates source, returns check results
- `POST /promote` — validates source, rejects concurrent, returns 202
- `POST /promote` — returns 409 if already running
- `POST /promote` — returns 400 for invalid source tier
- `GET /history` — returns paginated results
- `GET /history` — respects limit/offset

Mock: `TierConfigLoader` (return fixed configs), `pm2List` (return mock processes), DB (use vi.fn mocks following existing pattern), `PromotionRunner` (mock preflight/promote methods).

Follow the existing pattern from `runtime-config.test.ts`: create mock stores, build test app with `Fastify.default()`, use `app.inject()` for requests.

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @agentctl/control-plane test -- src/api/routes/deployment.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/control-plane/src/api/routes/deployment.test.ts
git commit -m "test(cp): add deployment route tests"
```

---

## Chunk 4: Frontend — Page, API Hooks, Navigation

### Task 8: API client + query hooks

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/queries.ts`

- [ ] **Step 1: Add types and API methods to api.ts**

Add response types near existing type definitions:

```typescript
// Deployment types
export type SessionContentMessage = /* existing */;

export type DeploymentTierStatus = {
  name: string;
  label: string;
  status: 'running' | 'degraded' | 'stopped';
  services: Array<{
    name: string;
    port: number;
    healthy: boolean;
    memoryMb?: number;
    uptimeSeconds?: number;
    restarts?: number;
    pid?: number;
  }>;
  config: {
    cpPort: number;
    workerPort: number;
    webPort: number;
    database: string;
    redisDb: number;
  };
};

export type DeploymentPreflightCheck = {
  name: string;
  status: 'pass' | 'fail' | 'running' | 'skipped';
  message?: string;
  durationMs?: number;
};

export type DeploymentPromotionRecord = {
  id: string;
  sourceTier: string;
  targetTier: string;
  status: string;
  checks: DeploymentPreflightCheck[];
  error?: string;
  gitSha?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  triggeredBy: string;
};
```

Add to the `api` object:

```typescript
// Deployment
getDeploymentTiers: () => request<{ tiers: DeploymentTierStatus[] }>('/api/deployment/tiers'),
runPreflight: (source: string) =>
  request<{ ready: boolean; checks: DeploymentPreflightCheck[] }>('/api/deployment/promote/preflight', {
    method: 'POST',
    body: JSON.stringify({ source }),
  }),
triggerPromotion: (source: string) =>
  request<{ id: string; status: string }>('/api/deployment/promote', {
    method: 'POST',
    body: JSON.stringify({ source }),
  }),
getPromotionHistory: (limit = 20, offset = 0) =>
  request<{ records: DeploymentPromotionRecord[]; total: number }>(
    `/api/deployment/history?limit=${limit}&offset=${offset}`,
  ),
```

- [ ] **Step 2: Add query hooks to queries.ts**

Add to `queryKeys`:
```typescript
deploymentTiers: ['deployment-tiers'] as const,
promotionHistory: ['promotion-history'] as const,
```

Add query option functions:
```typescript
export function deploymentTiersQuery() {
  return queryOptions({
    queryKey: queryKeys.deploymentTiers,
    queryFn: api.getDeploymentTiers,
    refetchInterval: 10_000,
    staleTime: 8_000,
    refetchIntervalInBackground: false,
  });
}

export function promotionHistoryQuery() {
  return queryOptions({
    queryKey: queryKeys.promotionHistory,
    queryFn: () => api.getPromotionHistory(),
  });
}
```

- [ ] **Step 3: Verify web builds**

Run: `pnpm --filter @agentctl/web build`

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/lib/queries.ts
git commit -m "feat(web): add deployment API methods and query hooks"
```

### Task 9: Sidebar nav + page route

**Files:**
- Modify: `packages/web/src/components/Sidebar.tsx`
- Create: `packages/web/src/app/deployment/page.tsx`
- Create: `packages/web/src/app/deployment/layout.tsx`

- [ ] **Step 1: Add Deployment to sidebar**

In `Sidebar.tsx`, import `Rocket` from `lucide-react` and add to `NAV_ITEMS`:

```typescript
{ href: '/deployment', label: 'Deployment', icon: Rocket, shortcut: '0' },
```

- [ ] **Step 2: Create page and layout**

```typescript
// packages/web/src/app/deployment/layout.tsx
export default function DeploymentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

```typescript
// packages/web/src/app/deployment/page.tsx
import type { Metadata } from 'next';
import { DeploymentView } from '@/views/DeploymentView';

export const metadata: Metadata = { title: 'Deployment' };

export default function DeploymentPage() {
  return <DeploymentView />;
}
```

- [ ] **Step 3: Create placeholder DeploymentView**

```typescript
// packages/web/src/views/DeploymentView.tsx
'use client';

export function DeploymentView(): React.JSX.Element {
  return (
    <div className="min-h-full p-4 md:p-6 animate-page-enter">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-2xl font-bold tracking-tight mb-6">Deployment</h1>
        <p className="text-muted-foreground">Coming soon...</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify web builds and nav works**

Run: `pnpm --filter @agentctl/web build`

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/Sidebar.tsx \
  packages/web/src/app/deployment/layout.tsx \
  packages/web/src/app/deployment/page.tsx \
  packages/web/src/views/DeploymentView.tsx
git commit -m "feat(web): add /deployment route and sidebar navigation"
```

---

## Chunk 5: Frontend — Components + Full View

### Task 10: TierCard + TierGrid

**Files:**
- Create: `packages/web/src/components/deployment/TierCard.tsx`
- Create: `packages/web/src/components/deployment/TierGrid.tsx`

- [ ] **Step 1: Implement TierCard**

Shows tier name, status badge (RUNNING/DEGRADED/STOPPED), per-service health indicators with port, memory, uptime, restarts. Stopped tiers shown dimmed.

Status badge colors: running → green, degraded → yellow, stopped → muted gray.
Service health: green dot if healthy, red dot if not. Show port, memoryMb, uptimeSeconds (formatted), restarts.

- [ ] **Step 2: Implement TierGrid**

2-column CSS grid (`grid-cols-1 lg:grid-cols-2`) of TierCards. Renders all tiers from the query data.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/deployment/TierCard.tsx \
  packages/web/src/components/deployment/TierGrid.tsx
git commit -m "feat(web): add TierCard and TierGrid deployment components"
```

### Task 11: PromoteGate

**Files:**
- Create: `packages/web/src/components/deployment/PromoteGate.tsx`

- [ ] **Step 1: Implement PromoteGate**

Contains:
- Source tier dropdown (select from available dev tiers, default dev-1)
- 4 pre-check indicators (icon + name + status). Show spinner for `running`, checkmark for `pass`, X for `fail`, dash for `skipped`
- "Run Preflight" button (triggers `POST /promote/preflight` via mutation)
- "Promote to Beta" button (disabled until all checks pass, triggers `POST /promote`)
- Confirmation dialog before promote (shadcn AlertDialog)

Use `useMutation` for preflight and promote. On promote success, open PromotionProgress modal.

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/deployment/PromoteGate.tsx
git commit -m "feat(web): add PromoteGate with preflight checks and promote button"
```

### Task 12: PromotionHistory + PromotionProgress

**Files:**
- Create: `packages/web/src/components/deployment/PromotionHistory.tsx`
- Create: `packages/web/src/components/deployment/PromotionProgress.tsx`

- [ ] **Step 1: Implement PromotionHistory**

Side panel (right column). Scrollable list of promotion records from `useQuery(promotionHistoryQuery())`.

Each record shows: time (relative, e.g. "2h ago"), source→target, status badge (success=green, failed=red, running=blue pulse), duration.

Click to expand: show check results, error message, git SHA.

Empty state: "No promotions yet" with subtle icon.

- [ ] **Step 2: Implement PromotionProgress**

Modal/overlay shown during active promotion. Connects to `EventSource` at `/api/deployment/promote/:id/stream`.

Shows:
- Step indicators (check → build → migrate → restart → health)
- Live log lines from build/migrate
- Final result: success (green) or failed (red with error)

On `complete` event: invalidate tiers and history queries, close EventSource.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/deployment/PromotionHistory.tsx \
  packages/web/src/components/deployment/PromotionProgress.tsx
git commit -m "feat(web): add PromotionHistory and PromotionProgress components"
```

### Task 13: Wire up DeploymentView

**Files:**
- Modify: `packages/web/src/views/DeploymentView.tsx`

- [ ] **Step 1: Replace placeholder with full view**

```typescript
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { deploymentTiersQuery, promotionHistoryQuery } from '@/lib/queries';
import { TierGrid } from '@/components/deployment/TierGrid';
import { PromoteGate } from '@/components/deployment/PromoteGate';
import { PromotionHistory } from '@/components/deployment/PromotionHistory';
import { PromotionProgress } from '@/components/deployment/PromotionProgress';

export function DeploymentView(): React.JSX.Element {
  const { data: tiersData, isLoading: tiersLoading, error: tiersError } = useQuery(deploymentTiersQuery());
  const { data: historyData } = useQuery(promotionHistoryQuery());
  const [activePromotionId, setActivePromotionId] = useState<string | null>(null);

  return (
    <div className="min-h-full p-4 md:p-6 animate-page-enter">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-2xl font-bold tracking-tight mb-6">Deployment</h1>

        {tiersError && (
          <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            Failed to load tier status. Is the control plane running?
          </div>
        )}

        <div className="flex gap-6">
          {/* Main content */}
          <div className="flex-1 space-y-6">
            <TierGrid tiers={tiersData?.tiers ?? []} loading={tiersLoading} />
            <PromoteGate
              tiers={tiersData?.tiers ?? []}
              onPromoteStarted={setActivePromotionId}
            />
          </div>

          {/* History side panel */}
          <div className="w-72 shrink-0 hidden lg:block">
            <PromotionHistory records={historyData?.records ?? []} />
          </div>
        </div>

        {activePromotionId && (
          <PromotionProgress
            promotionId={activePromotionId}
            onClose={() => setActivePromotionId(null)}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify full web build**

Run: `pnpm --filter @agentctl/web build`

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/views/DeploymentView.tsx
git commit -m "feat(web): wire up DeploymentView with tier grid, promote gate, and history"
```

---

## Chunk 6: Integration + PR

### Task 14: Full build + existing tests

- [ ] **Step 1: Run full monorepo build**

Run: `pnpm build`
Expected: All packages build cleanly.

- [ ] **Step 2: Run existing tests**

Run: `pnpm --filter @agentctl/control-plane test`
Run: `pnpm --filter @agentctl/shared test`
Expected: No regressions.

- [ ] **Step 3: Fix any issues found**

### Task 15: Create PR

- [ ] **Step 1: Push branch and create PR**

```bash
git push -u origin agent/claude-1/feat/deployment-page
gh pr create --base main --title "feat(web): add /deployment page for CD pipeline management" --body "$(cat <<'EOF'
## Summary
- New `/deployment` page showing tier status, gated promotion, and history
- Backend: 5 API routes, promotion_history DB table, PM2 integration, tier config discovery
- Frontend: Tier cards grid, preflight checks gate, SSE-powered promotion progress, history panel
- Shared types for deployment domain

## Test plan
- [ ] CP route tests pass
- [ ] Full monorepo build passes
- [ ] Navigate to /deployment, verify tier cards show health
- [ ] Run preflight checks, verify gate enables promote button
- [ ] Trigger promotion, verify SSE progress stream works
- [ ] Check promotion history panel updates after completion
EOF
)"
```

- [ ] **Step 2: Merge PR**

After CI passes:
```bash
gh pr merge --squash --delete-branch --admin
git checkout main && git pull origin main
```
