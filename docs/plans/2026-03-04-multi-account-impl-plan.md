> ⚠️ **ARCHIVED** — This plan has been fully implemented. Kept for historical reference.

# Multi-Account Configuration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add multi-account management so users can register multiple API keys / Claude Max subscriptions, assign them at global/project/agent/session level, and configure auto-failover.

**Architecture:** Account Registry + LiteLLM hybrid. Central `api_accounts` table with encrypted credentials. Assignment cascade: session → agent → project → global default. Fastify API routes for CRUD. Settings UI in the web frontend.

**Tech Stack:** Drizzle ORM (pg-core), Fastify route plugins, AES-256-GCM encryption, TanStack Query v5, shadcn/ui components.

**Design doc:** `docs/plans/2026-03-04-multi-account-design.md`

---

## Task 1: DB Migration — api_accounts + project_account_mappings

**Files:**
- Create: `packages/control-plane/drizzle/0007_add_api_accounts.sql`
- Modify: `packages/control-plane/src/db/schema.ts`

**Step 1: Write the migration SQL**

Create `packages/control-plane/drizzle/0007_add_api_accounts.sql`:

```sql
-- 0007: Add multi-account tables and columns
CREATE TABLE IF NOT EXISTS "api_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "provider" text NOT NULL,
  "credential" text NOT NULL,
  "credential_iv" text NOT NULL,
  "priority" integer NOT NULL DEFAULT 0,
  "rate_limit" jsonb DEFAULT '{}',
  "is_active" boolean DEFAULT true,
  "metadata" jsonb DEFAULT '{}',
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "project_account_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_path" text NOT NULL UNIQUE,
  "account_id" uuid NOT NULL REFERENCES "api_accounts"("id") ON DELETE CASCADE,
  "created_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "settings" (
  "key" text PRIMARY KEY,
  "value" jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT now()
);

-- Add account_id to agents
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE "agents" ADD COLUMN "account_id" uuid REFERENCES "api_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Add account_id to rc_sessions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rc_sessions' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE "rc_sessions" ADD COLUMN "account_id" uuid REFERENCES "api_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_api_accounts_provider" ON "api_accounts"("provider");
CREATE INDEX IF NOT EXISTS "idx_api_accounts_is_active" ON "api_accounts"("is_active");
CREATE INDEX IF NOT EXISTS "idx_project_account_mappings_account_id" ON "project_account_mappings"("account_id");
```

**Step 2: Add Drizzle schema definitions**

Add to `packages/control-plane/src/db/schema.ts`:

```typescript
// After existing table definitions:

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
    isActive: integer('is_active').default(1),  // boolean via int
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_api_accounts_provider').on(table.provider),
  ],
);

export const projectAccountMappings = pgTable('project_account_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectPath: text('project_path').notNull().unique(),
  accountId: uuid('account_id').notNull().references(() => apiAccounts.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
```

Also add `accountId` column to existing `agents` and `rcSessions` tables:

In `agents` table definition, add:
```typescript
accountId: uuid('account_id').references(() => apiAccounts.id, { onDelete: 'set null' }),
```

In `rcSessions` table definition, add:
```typescript
accountId: uuid('account_id').references(() => apiAccounts.id, { onDelete: 'set null' }),
```

**Step 3: Run migration**

```bash
cd packages/control-plane && pnpm dev
# Migration runner auto-discovers and applies 0007
```

**Step 4: Commit**

```bash
git add packages/control-plane/drizzle/0007_add_api_accounts.sql packages/control-plane/src/db/schema.ts
git commit -m "feat(control-plane): add api_accounts and settings tables (multi-account)"
```

---

## Task 2: Shared Types — ApiAccount, AccountProvider

**Files:**
- Create: `packages/shared/src/types/account.ts`
- Modify: `packages/shared/src/types/index.ts`

**Step 1: Create account types**

Create `packages/shared/src/types/account.ts`:

```typescript
export type AccountProvider = 'anthropic_api' | 'claude_max' | 'bedrock' | 'vertex';

export const ACCOUNT_PROVIDERS: AccountProvider[] = [
  'anthropic_api',
  'claude_max',
  'bedrock',
  'vertex',
];

export type ApiAccount = {
  id: string;
  name: string;
  provider: AccountProvider;
  /** Masked credential — never the raw key */
  credentialMasked: string;
  priority: number;
  rateLimit: { itpm?: number; otpm?: number };
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ProjectAccountMapping = {
  id: string;
  projectPath: string;
  accountId: string;
  createdAt: string;
};

export type FailoverPolicy = 'none' | 'priority' | 'round_robin';

export type AccountDefaults = {
  defaultAccountId: string | null;
  failoverPolicy: FailoverPolicy;
};
```

**Step 2: Export from barrel**

Add to `packages/shared/src/types/index.ts`:

```typescript
export type { AccountDefaults, AccountProvider, ApiAccount, FailoverPolicy, ProjectAccountMapping } from './account.js';
export { ACCOUNT_PROVIDERS } from './account.js';
```

**Step 3: Commit**

```bash
git add packages/shared/src/types/account.ts packages/shared/src/types/index.ts
git commit -m "feat(shared): add ApiAccount and AccountProvider types"
```

---

## Task 3: Credential Encryption Utility

**Files:**
- Create: `packages/control-plane/src/utils/credential-crypto.ts`
- Create: `packages/control-plane/src/utils/credential-crypto.test.ts`

**Step 1: Write the failing test**

Create `packages/control-plane/src/utils/credential-crypto.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { decryptCredential, encryptCredential, maskCredential } from './credential-crypto.js';

const TEST_KEY = 'a'.repeat(64); // 32-byte hex key

describe('credential-crypto', () => {
  it('encrypts and decrypts a credential round-trip', () => {
    const original = 'sk-ant-api03-xxxxxxxxxxxx';
    const { encrypted, iv } = encryptCredential(original, TEST_KEY);
    expect(encrypted).not.toBe(original);
    expect(iv).toBeTruthy();
    const decrypted = decryptCredential(encrypted, iv, TEST_KEY);
    expect(decrypted).toBe(original);
  });

  it('produces different ciphertext for the same plaintext', () => {
    const original = 'sk-ant-api03-xxxxxxxxxxxx';
    const a = encryptCredential(original, TEST_KEY);
    const b = encryptCredential(original, TEST_KEY);
    expect(a.encrypted).not.toBe(b.encrypted);
  });

  it('masks API keys correctly', () => {
    expect(maskCredential('sk-ant-api03-abcdefghijklmnop')).toBe('sk-ant-...mnop');
    expect(maskCredential('short')).toBe('***ort');
    expect(maskCredential('')).toBe('***');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/control-plane && pnpm vitest run src/utils/credential-crypto.test.ts
```

Expected: FAIL (module not found)

**Step 3: Implement**

Create `packages/control-plane/src/utils/credential-crypto.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export function encryptCredential(
  plaintext: string,
  hexKey: string,
): { encrypted: string; iv: string } {
  const key = Buffer.from(hexKey, 'hex');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: Buffer.concat([encrypted, authTag]).toString('base64'),
    iv: iv.toString('base64'),
  };
}

export function decryptCredential(
  encryptedBase64: string,
  ivBase64: string,
  hexKey: string,
): string {
  const key = Buffer.from(hexKey, 'hex');
  const iv = Buffer.from(ivBase64, 'base64');
  const data = Buffer.from(encryptedBase64, 'base64');
  const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(0, data.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

export function maskCredential(credential: string): string {
  if (credential.length === 0) return '***';
  const last4 = credential.slice(-Math.min(4, credential.length));
  if (credential.startsWith('sk-ant-')) return `sk-ant-...${last4}`;
  if (credential.length <= 6) return `***${last4}`;
  return `${credential.slice(0, 4)}...${last4}`;
}
```

**Step 4: Run test to verify it passes**

```bash
cd packages/control-plane && pnpm vitest run src/utils/credential-crypto.test.ts
```

Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add packages/control-plane/src/utils/credential-crypto.ts packages/control-plane/src/utils/credential-crypto.test.ts
git commit -m "feat(control-plane): add AES-256-GCM credential encryption utility"
```

---

## Task 4: Account API Routes — CRUD

**Files:**
- Create: `packages/control-plane/src/api/routes/accounts.ts`
- Create: `packages/control-plane/src/api/routes/accounts.test.ts`
- Modify: `packages/control-plane/src/api/server.ts` (mount routes)

**Step 1: Write the test file**

Create `packages/control-plane/src/api/routes/accounts.test.ts` following the `sessions.test.ts` pattern:

```typescript
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { accountRoutes } from './accounts.js';

function createMockDb() {
  let rows: unknown[] = [];
  const chain: Record<string, unknown> = {};
  const methods = [
    'select', 'from', 'where', 'orderBy', 'limit', 'offset',
    'insert', 'update', 'delete', 'values', 'set', 'returning',
    'onConflictDoUpdate',
  ];
  for (const m of methods) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => void) => { resolve(rows); return chain; };
  return {
    db: chain,
    setRows: (r: unknown[]) => { rows = r; },
  };
}

const TEST_KEY = 'a'.repeat(64);

async function buildApp(mockDb: ReturnType<typeof createMockDb>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(accountRoutes, {
    prefix: '/api/settings/accounts',
    db: mockDb.db as never,
    encryptionKey: TEST_KEY,
  });
  await app.ready();
  return app;
}

describe('Account routes — /api/settings/accounts', () => {
  let app: FastifyInstance;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeAll(async () => {
    mockDb = createMockDb();
    app = await buildApp(mockDb);
  });

  afterAll(async () => { await app.close(); });

  describe('GET /', () => {
    it('returns 200 with list of accounts (credentials masked)', async () => {
      mockDb.setRows([{
        id: 'acc-1', name: 'Work Key', provider: 'anthropic_api',
        credential: 'encrypted', credentialIv: 'iv', priority: 0,
        rateLimit: {}, isActive: true, metadata: {},
        createdAt: new Date(), updatedAt: new Date(),
      }]);
      const res = await app.inject({ method: 'GET', url: '/api/settings/accounts' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      // credential should be masked, not raw
      expect(body[0].credential).toBeUndefined();
      expect(body[0].credentialMasked).toBeDefined();
    });
  });

  describe('POST /', () => {
    it('creates an account and returns 201', async () => {
      mockDb.setRows([{
        id: 'acc-new', name: 'New Key', provider: 'anthropic_api',
        credential: 'enc', credentialIv: 'iv', priority: 0,
        rateLimit: {}, isActive: true, metadata: {},
        createdAt: new Date(), updatedAt: new Date(),
      }]);
      const res = await app.inject({
        method: 'POST',
        url: '/api/settings/accounts',
        payload: {
          name: 'New Key',
          provider: 'anthropic_api',
          credential: 'sk-ant-api03-test',
          priority: 0,
        },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe('DELETE /:id', () => {
    it('returns 200 on successful delete', async () => {
      mockDb.setRows([{ id: 'acc-1' }]);
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/settings/accounts/acc-1',
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/control-plane && pnpm vitest run src/api/routes/accounts.test.ts
```

**Step 3: Implement the route**

Create `packages/control-plane/src/api/routes/accounts.ts`:

```typescript
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../db/index.js';
import { apiAccounts } from '../../db/schema.js';
import {
  decryptCredential,
  encryptCredential,
  maskCredential,
} from '../../utils/credential-crypto.js';

export type AccountRoutesOptions = {
  db: Database;
  encryptionKey: string;
};

export const accountRoutes: FastifyPluginAsync<AccountRoutesOptions> = async (app, opts) => {
  const { db, encryptionKey } = opts;

  // GET / — list all accounts (masked credentials)
  app.get('/', async (_request, reply) => {
    const rows = await db.select().from(apiAccounts).orderBy(apiAccounts.priority);
    const masked = rows.map((r) => ({
      id: r.id,
      name: r.name,
      provider: r.provider,
      credentialMasked: maskCredential(decryptCredential(r.credential, r.credentialIv, encryptionKey)),
      priority: r.priority,
      rateLimit: r.rateLimit,
      isActive: r.isActive,
      metadata: r.metadata,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    return reply.send(masked);
  });

  // GET /:id
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const [row] = await db.select().from(apiAccounts).where(eq(apiAccounts.id, request.params.id));
    if (!row) return reply.code(404).send({ error: 'ACCOUNT_NOT_FOUND', message: 'Account not found' });
    return reply.send({
      ...row,
      credential: undefined,
      credentialIv: undefined,
      credentialMasked: maskCredential(decryptCredential(row.credential, row.credentialIv, encryptionKey)),
    });
  });

  // POST / — create account
  app.post<{
    Body: { name: string; provider: string; credential: string; priority?: number; metadata?: Record<string, unknown> };
  }>('/', async (request, reply) => {
    const { name, provider, credential, priority = 0, metadata = {} } = request.body;
    if (!name || !provider || !credential) {
      return reply.code(400).send({ error: 'INVALID_BODY', message: 'name, provider, and credential are required' });
    }
    const { encrypted, iv } = encryptCredential(credential, encryptionKey);
    const [inserted] = await db
      .insert(apiAccounts)
      .values({ name, provider, credential: encrypted, credentialIv: iv, priority, metadata })
      .returning();
    return reply.code(201).send({
      ...inserted,
      credential: undefined,
      credentialIv: undefined,
      credentialMasked: maskCredential(credential),
    });
  });

  // PUT /:id — update account
  app.put<{
    Params: { id: string };
    Body: { name?: string; provider?: string; credential?: string; priority?: number; isActive?: boolean; metadata?: Record<string, unknown> };
  }>('/:id', async (request, reply) => {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const { name, provider, credential, priority, isActive, metadata } = request.body;
    if (name !== undefined) updates.name = name;
    if (provider !== undefined) updates.provider = provider;
    if (priority !== undefined) updates.priority = priority;
    if (isActive !== undefined) updates.isActive = isActive ? 1 : 0;
    if (metadata !== undefined) updates.metadata = metadata;
    if (credential) {
      const { encrypted, iv } = encryptCredential(credential, encryptionKey);
      updates.credential = encrypted;
      updates.credentialIv = iv;
    }
    const [updated] = await db.update(apiAccounts).set(updates).where(eq(apiAccounts.id, request.params.id)).returning();
    if (!updated) return reply.code(404).send({ error: 'ACCOUNT_NOT_FOUND', message: 'Account not found' });
    return reply.send({ ...updated, credential: undefined, credentialIv: undefined });
  });

  // DELETE /:id
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const [deleted] = await db.delete(apiAccounts).where(eq(apiAccounts.id, request.params.id)).returning();
    if (!deleted) return reply.code(404).send({ error: 'ACCOUNT_NOT_FOUND', message: 'Account not found' });
    return reply.send({ ok: true });
  });

  // POST /:id/test — test connectivity
  app.post<{ Params: { id: string } }>('/:id/test', async (request, reply) => {
    const [row] = await db.select().from(apiAccounts).where(eq(apiAccounts.id, request.params.id));
    if (!row) return reply.code(404).send({ error: 'ACCOUNT_NOT_FOUND', message: 'Account not found' });
    const key = decryptCredential(row.credential, row.credentialIv, encryptionKey);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      if (res.ok) return reply.send({ ok: true, latencyMs: 0 });
      const body = await res.json().catch(() => ({}));
      return reply.code(400).send({
        error: 'ACCOUNT_TEST_FAILED',
        message: (body as Record<string, unknown>).error?.message ?? `HTTP ${res.status}`,
      });
    } catch (err) {
      return reply.code(500).send({
        error: 'ACCOUNT_TEST_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
};
```

**Step 4: Mount in server.ts**

Add to `packages/control-plane/src/api/server.ts` after existing route registrations:

```typescript
import { accountRoutes } from './routes/accounts.js';

// Inside createServer(), after other route registrations:
const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY ?? '';
if (db && encryptionKey) {
  await app.register(accountRoutes, {
    prefix: '/api/settings/accounts',
    db,
    encryptionKey,
  });
}
```

**Step 5: Run tests**

```bash
cd packages/control-plane && pnpm vitest run src/api/routes/accounts.test.ts
```

**Step 6: Commit**

```bash
git add packages/control-plane/src/api/routes/accounts.ts packages/control-plane/src/api/routes/accounts.test.ts packages/control-plane/src/api/server.ts
git commit -m "feat(control-plane): add account CRUD API routes with encrypted credentials"
```

---

## Task 5: Settings & Project Mapping API Routes

**Files:**
- Create: `packages/control-plane/src/api/routes/settings.ts`
- Create: `packages/control-plane/src/api/routes/settings.test.ts`
- Modify: `packages/control-plane/src/api/server.ts`

**Step 1: Write tests**

Test file following same pattern as Task 4 — tests for:
- `GET /api/settings/defaults` returns `{ defaultAccountId, failoverPolicy }`
- `PUT /api/settings/defaults` updates settings
- `GET /api/settings/project-accounts` lists project→account mappings
- `PUT /api/settings/project-accounts` upserts a mapping
- `DELETE /api/settings/project-accounts/:id` removes a mapping

**Step 2: Implement settings routes**

Create `packages/control-plane/src/api/routes/settings.ts`:

Uses the `settings` table for key-value storage (`default_account_id`, `failover_policy`) and the `projectAccountMappings` table for project scoping.

Key endpoints:
- `GET /defaults` — query settings table for `default_account_id` and `failover_policy`
- `PUT /defaults` — upsert into settings table
- `GET /project-accounts` — `select().from(projectAccountMappings)`
- `PUT /project-accounts` — upsert with `onConflictDoUpdate` on `projectPath`
- `DELETE /project-accounts/:id` — delete by ID

**Step 3: Mount in server.ts**

```typescript
import { settingsRoutes } from './routes/settings.js';

if (db) {
  await app.register(settingsRoutes, { prefix: '/api/settings', db });
}
```

**Step 4: Run tests, commit**

```bash
git commit -m "feat(control-plane): add settings and project-account mapping routes"
```

---

## Task 6: Account Resolution Utility

**Files:**
- Create: `packages/control-plane/src/utils/resolve-account.ts`
- Create: `packages/control-plane/src/utils/resolve-account.test.ts`

**Purpose:** Given a session/agent/project context, resolve which account to use following the cascade: `session.accountId → agent.accountId → projectMapping[projectPath] → globalDefault`.

```typescript
export type AccountResolutionContext = {
  sessionAccountId?: string | null;
  agentAccountId?: string | null;
  projectPath?: string | null;
};

export async function resolveAccountId(
  ctx: AccountResolutionContext,
  db: Database,
): Promise<string | null> {
  if (ctx.sessionAccountId) return ctx.sessionAccountId;
  if (ctx.agentAccountId) return ctx.agentAccountId;
  if (ctx.projectPath) {
    const [mapping] = await db.select().from(projectAccountMappings)
      .where(eq(projectAccountMappings.projectPath, ctx.projectPath));
    if (mapping) return mapping.accountId;
  }
  const [setting] = await db.select().from(settings)
    .where(eq(settings.key, 'default_account_id'));
  return (setting?.value as { value?: string })?.value ?? null;
}
```

**Tests:** Verify each level of the cascade with mocked DB responses.

**Commit:**
```bash
git commit -m "feat(control-plane): add account resolution cascade utility"
```

---

## Task 7: Worker Dispatch Integration

**Files:**
- Modify: `packages/control-plane/src/scheduler/task-worker.ts`

**What changes:** After resolving the agent and machine in the dispatch flow, resolve the account using `resolveAccountId()`, decrypt the credential, and include it in the dispatch payload to the worker.

**Additions to DispatchPayload type:**
```typescript
type DispatchPayload = {
  // ... existing fields ...
  accountCredential?: string;   // decrypted API key (sent over Tailscale)
  accountProvider?: string;     // 'anthropic_api' | 'claude_max' | 'bedrock' | 'vertex'
};
```

**In the BullMQ processor, after resolving agent/machine:**
```typescript
const accountId = await resolveAccountId({
  sessionAccountId: null, // session-level set later
  agentAccountId: agent.accountId,
  projectPath: agent.projectPath,
}, db);

let accountCredential: string | undefined;
let accountProvider: string | undefined;
if (accountId) {
  const [account] = await db.select().from(apiAccounts).where(eq(apiAccounts.id, accountId));
  if (account) {
    accountCredential = decryptCredential(account.credential, account.credentialIv, encryptionKey);
    accountProvider = account.provider;
  }
}
```

**Commit:**
```bash
git commit -m "feat(control-plane): inject resolved account credentials into worker dispatch"
```

---

## Task 8: Web API Client — Account Endpoints

**Files:**
- Modify: `packages/web/src/lib/api.ts` — add account types and API methods
- Modify: `packages/web/src/lib/queries.ts` — add query hooks

**Add to api.ts:**

```typescript
export type ApiAccount = {
  id: string;
  name: string;
  provider: string;
  credentialMasked: string;
  priority: number;
  rateLimit: Record<string, number>;
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ProjectAccountMapping = {
  id: string;
  projectPath: string;
  accountId: string;
  createdAt: string;
};

export type AccountDefaults = {
  defaultAccountId: string | null;
  failoverPolicy: 'none' | 'priority' | 'round_robin';
};

// In the api object:
// Accounts
listAccounts: () => request<ApiAccount[]>('/api/settings/accounts'),
createAccount: (body: { name: string; provider: string; credential: string; priority?: number }) =>
  request<ApiAccount>('/api/settings/accounts', { method: 'POST', body: JSON.stringify(body) }),
updateAccount: (id: string, body: Record<string, unknown>) =>
  request<ApiAccount>(`/api/settings/accounts/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
deleteAccount: (id: string) =>
  request<{ ok: boolean }>(`/api/settings/accounts/${id}`, { method: 'DELETE' }),
testAccount: (id: string) =>
  request<{ ok: boolean; latencyMs?: number }>(`/api/settings/accounts/${id}/test`, { method: 'POST' }),

// Settings
getDefaults: () => request<AccountDefaults>('/api/settings/defaults'),
updateDefaults: (body: Partial<AccountDefaults>) =>
  request<AccountDefaults>('/api/settings/defaults', { method: 'PUT', body: JSON.stringify(body) }),

// Project account mappings
listProjectAccounts: () => request<ProjectAccountMapping[]>('/api/settings/project-accounts'),
upsertProjectAccount: (body: { projectPath: string; accountId: string }) =>
  request<ProjectAccountMapping>('/api/settings/project-accounts', { method: 'PUT', body: JSON.stringify(body) }),
deleteProjectAccount: (id: string) =>
  request<{ ok: boolean }>(`/api/settings/project-accounts/${id}`, { method: 'DELETE' }),
```

**Add to queries.ts:**

```typescript
export const queryKeys = {
  // ... existing keys ...
  accounts: ['accounts'] as const,
  accountDefaults: ['account-defaults'] as const,
  projectAccounts: ['project-accounts'] as const,
};

export function accountsQuery() {
  return queryOptions({
    queryKey: queryKeys.accounts,
    queryFn: api.listAccounts,
  });
}

export function accountDefaultsQuery() {
  return queryOptions({
    queryKey: queryKeys.accountDefaults,
    queryFn: api.getDefaults,
  });
}

export function projectAccountsQuery() {
  return queryOptions({
    queryKey: queryKeys.projectAccounts,
    queryFn: api.listProjectAccounts,
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createAccount,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: queryKeys.accounts }); },
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) => api.updateAccount(id, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: queryKeys.accounts }); },
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: queryKeys.accounts }); },
  });
}

export function useTestAccount() {
  return useMutation({ mutationFn: api.testAccount });
}
```

**Commit:**
```bash
git commit -m "feat(web): add account API client and query hooks"
```

---

## Task 9: Settings UI — Accounts Section

**Files:**
- Create: `packages/web/src/views/AccountsSection.tsx`
- Modify: `packages/web/src/views/SettingsView.tsx`

**The Accounts section includes:**
1. Account list — card per account with name, provider badge, masked key, priority, active toggle, test button
2. Add Account dialog — provider dropdown, credential input, name, priority
3. Delete confirmation

**Uses existing components:** `Card`, `CardContent`, `Button`, `Dialog`, `Input`, `Select`, `StatusBadge` (for provider)

This is a standard CRUD UI component. Wire up the query hooks from Task 8.

**Commit:**
```bash
git commit -m "feat(web): add Accounts management section to Settings page"
```

---

## Task 10: Settings UI — Project Mappings & Failover

**Files:**
- Create: `packages/web/src/views/ProjectAccountsSection.tsx`
- Create: `packages/web/src/views/FailoverSection.tsx`
- Modify: `packages/web/src/views/SettingsView.tsx`

**ProjectAccountsSection:** Table of project_path → account name, with add/edit/remove buttons. Uses `projectAccountsQuery` + `accountsQuery` for the dropdown.

**FailoverSection:** Radio group for none/priority/round_robin. Global default account dropdown. Uses `accountDefaultsQuery`.

**Commit:**
```bash
git commit -m "feat(web): add project account mappings and failover settings UI"
```

---

## Task 11: Agent Detail — Account Dropdown

**Files:**
- Modify: `packages/web/src/app/agents/[id]/page.tsx`

**Add an account selection dropdown** in the Agent Details card, after the existing info fields. Uses `accountsQuery` for the dropdown options and a mutation to `PATCH /api/agents/agents/:id` with `{ accountId }`.

**Commit:**
```bash
git commit -m "feat(web): add account selector to agent detail page"
```

---

## Task 12: Session Creation — Account Override

**Files:**
- Modify: `packages/web/src/views/SessionsPage.tsx` (New Session dialog)

**Add an optional "Account" dropdown** to the session creation flow. When selected, includes `accountId` in the POST body to `/api/sessions`.

**Commit:**
```bash
git commit -m "feat(web): add account override to session creation"
```

---

## Dependency Graph

```
Task 1 (DB migration) ← Task 2 (types) ← Task 3 (encryption)
                                            ↓
Task 4 (account routes) ← Task 5 (settings routes) ← Task 6 (resolver)
                                                        ↓
                                              Task 7 (worker dispatch)

Task 8 (web API client) ← Task 9 (accounts UI) ← Task 10 (project/failover UI)
                            ↑
                         Task 11 (agent dropdown)
                         Task 12 (session override)
```

Tasks 1-3 are sequential. Tasks 4-5 depend on 1-3. Task 6 depends on 1. Task 7 depends on 6.
Tasks 8-12 are the web frontend and depend on Tasks 4-5 being deployed.
Tasks 9-12 can be parallelized after Task 8.
