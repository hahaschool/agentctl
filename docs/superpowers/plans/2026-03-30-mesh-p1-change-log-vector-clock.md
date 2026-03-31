# Mesh P1: Change Log + Vector Clock — Implementation Plan (v4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trigger-based change tracking with vector clocks to 16 synced PostgreSQL tables, establishing the foundation for multi-master mesh sync.

**Architecture:** PostgreSQL triggers capture every INSERT/UPDATE/DELETE into a `sync_change_log` table with vector clock metadata. A `sync_nodes` table tracks node identity. TypeScript utilities provide vector clock comparison/merge logic. Node identity is set per-connection via `pool.on('connect')` in `connection.ts`. Advisory locks serialize concurrent vector clock increments. A `withSyncApplyGuard` transaction helper is prepared for P2's remote-apply path.

**Tech Stack:** PostgreSQL 14+ triggers (PL/pgSQL), Drizzle ORM (schema), TypeScript (vector clock logic), Vitest (tests), BullMQ (cleanup scheduling)

**Spec:** `docs/superpowers/specs/2026-03-30-mesh-p1-change-log-vector-clock-design.md`

**Review history:** Codex (GPT 5.4 xhigh) adversarial review — ongoing. Key fixes applied:
- Migration in `drizzle/0021_*` (repo uses `drizzle/` dir, latest is `0020`)
- Trigger PK via `TG_ARGV[0]` (`settings.key`, `memory_scopes.scope` don't have `id`)
- `pool.on('connect')` for `app.node_id` (connection pooling makes per-request SET useless)
- Advisory lock `pg_advisory_xact_lock(hashtext(table||row)::bigint)` for concurrent vclock safety
- `agent_actions` gets `sync_id UUID` column (its PK is `bigserial`, not globally unique)
- Sync-apply guard is a P2 transaction helper contract, not delivered runtime behavior

---

### Task 1: Vector Clock Utilities (Shared)

**Files:**
- Create: `packages/shared/src/vector-clock.ts`
- Create: `packages/shared/src/vector-clock.test.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/shared/src/vector-clock.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { vcCompare, vcDominates, vcMerge } from './vector-clock.js';

describe('vcDominates', () => {
  it('returns true when a strictly dominates b', () => {
    expect(vcDominates({ n1: 3, n2: 2 }, { n1: 2, n2: 1 })).toBe(true);
  });

  it('returns false when b has a higher component', () => {
    expect(vcDominates({ n1: 3, n2: 1 }, { n1: 2, n2: 2 })).toBe(false);
  });

  it('returns false when clocks are equal', () => {
    expect(vcDominates({ n1: 2 }, { n1: 2 })).toBe(false);
  });

  it('returns true when a has extra keys b does not', () => {
    expect(vcDominates({ n1: 2, n2: 1 }, { n1: 1 })).toBe(true);
  });

  it('handles empty clocks', () => {
    expect(vcDominates({}, {})).toBe(false);
    expect(vcDominates({ n1: 1 }, {})).toBe(true);
    expect(vcDominates({}, { n1: 1 })).toBe(false);
  });
});

describe('vcMerge', () => {
  it('takes element-wise max', () => {
    expect(vcMerge({ n1: 3, n2: 1 }, { n1: 1, n2: 5 })).toEqual({ n1: 3, n2: 5 });
  });

  it('includes keys only in one clock', () => {
    expect(vcMerge({ n1: 2 }, { n2: 3 })).toEqual({ n1: 2, n2: 3 });
  });

  it('merges empty clocks', () => {
    expect(vcMerge({}, { n1: 1 })).toEqual({ n1: 1 });
    expect(vcMerge({}, {})).toEqual({});
  });
});

describe('vcCompare', () => {
  it('detects a_dominates', () => {
    expect(vcCompare({ n1: 3 }, { n1: 1 })).toBe('a_dominates');
  });

  it('detects b_dominates', () => {
    expect(vcCompare({ n1: 1 }, { n1: 3 })).toBe('b_dominates');
  });

  it('detects equal', () => {
    expect(vcCompare({ n1: 2, n2: 3 }, { n1: 2, n2: 3 })).toBe('equal');
    expect(vcCompare({}, {})).toBe('equal');
  });

  it('detects conflict (concurrent edits)', () => {
    expect(vcCompare({ n1: 3, n2: 1 }, { n1: 1, n2: 3 })).toBe('conflict');
  });

  it('detects conflict with disjoint keys', () => {
    expect(vcCompare({ n1: 1 }, { n2: 1 })).toBe('conflict');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && pnpm vitest run src/vector-clock.test.ts`
Expected: FAIL — `Cannot find module './vector-clock.js'`

- [ ] **Step 3: Implement vector clock utilities**

Create `packages/shared/src/vector-clock.ts`:

```typescript
/** Maps nodeId → logical counter. */
export type VectorClock = Record<string, number>;

/** Returns true if a causally dominates b (a happened strictly after b). */
export function vcDominates(a: VectorClock, b: VectorClock): boolean {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dominated = false;
  for (const k of allKeys) {
    const av = a[k] ?? 0;
    const bv = b[k] ?? 0;
    if (av < bv) return false;
    if (av > bv) dominated = true;
  }
  return dominated;
}

/** Merge two vector clocks (element-wise max). */
export function vcMerge(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };
  for (const [k, v] of Object.entries(b)) {
    result[k] = Math.max(result[k] ?? 0, v);
  }
  return result;
}

/** Compare two vector clocks for causal ordering. */
export function vcCompare(
  a: VectorClock,
  b: VectorClock,
): 'a_dominates' | 'b_dominates' | 'equal' | 'conflict' {
  if (vcDominates(a, b)) return 'a_dominates';
  if (vcDominates(b, a)) return 'b_dominates';
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const equal = [...allKeys].every((k) => (a[k] ?? 0) === (b[k] ?? 0));
  return equal ? 'equal' : 'conflict';
}
```

- [ ] **Step 4: Re-export from shared package**

In `packages/shared/src/types/index.ts`, add after the `dispatch-config.js` exports (~line 71):

```typescript
export type { VectorClock } from '../vector-clock.js';
```

In `packages/shared/src/index.ts`, add:

```typescript
export { vcCompare, vcDominates, vcMerge } from './vector-clock.js';
export type { VectorClock } from './vector-clock.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/shared && pnpm vitest run src/vector-clock.test.ts`
Expected: 12 tests PASS

- [ ] **Step 6: Build shared**

Run: `pnpm --filter @agentctl/shared build`
Expected: clean build, no errors

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/vector-clock.ts packages/shared/src/vector-clock.test.ts packages/shared/src/types/index.ts packages/shared/src/index.ts
git commit -m "feat(mesh): add VectorClock type and vcDominates/vcMerge/vcCompare utilities"
```

---

### Task 2: Sync Types (Shared)

**Files:**
- Create: `packages/shared/src/types/sync.ts`
- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1: Create sync types**

Create `packages/shared/src/types/sync.ts`:

```typescript
import type { VectorClock } from '../vector-clock.js';

/** Which sync strategy applies to a table. */
export type TableSyncType = 'append-only' | 'mutable' | 'local-only';

/** A single change log entry as stored in sync_change_log. */
export type ChangeLogEntry = {
  id: number;
  nodeId: string;
  tableName: string;
  rowId: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: Record<string, unknown> | null;
  vclock: VectorClock;
  createdAt: Date;
  synced: boolean;
};

/** A detected conflict between local and remote changes. */
export type SyncConflict = {
  id: string;
  tableName: string;
  rowId: string;
  localVclock: VectorClock;
  localPayload: Record<string, unknown> | null;
  remoteVclock: VectorClock;
  remotePayload: Record<string, unknown> | null;
  remoteNodeId: string;
  status: 'pending' | 'resolved';
  resolution: 'local' | 'remote' | 'merged' | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

/** A node in the mesh network. */
export type SyncNode = {
  id: string;
  hostname: string;
  tailscaleIp: string | null;
  role: 'full' | 'worker-only';
  lastSeen: Date | null;
  createdAt: Date;
};

/**
 * Classification of all tables for sync purposes.
 *
 * - append-only: Records are created once, never updated across nodes.
 *   PK must be globally unique (UUID). Auto-merge by deduplication.
 * - mutable: Records can be updated. Uses vector clocks for conflict detection.
 * - local-only: Not synced between nodes.
 *
 * NOTE: agent_actions has bigserial PK (not globally unique). The trigger uses
 * its sync_id UUID column instead. See drizzle/0021 migration.
 */
export const TABLE_SYNC_CONFIG: Record<string, TableSyncType> = {
  // Append-only (4 tables) — truly insert-only, never updated
  agent_actions: 'append-only', // trigger uses sync_id UUID, not bigserial id
  session_handoffs: 'append-only',
  native_import_attempts: 'append-only',
  run_handoff_decisions: 'append-only',
  // Mutable (11 tables) — receive status updates, need vector clock conflict detection
  agents: 'mutable',
  machines: 'mutable',
  agent_runs: 'mutable',        // status updates: running→success/failure
  rc_sessions: 'mutable',       // status updates: active→ended
  managed_sessions: 'mutable',  // status updates during lifecycle
  project_account_mappings: 'mutable',
  settings: 'mutable', // PK = 'key' (not 'id')
  runtime_config_revisions: 'mutable',
  memory_scopes: 'mutable', // PK = 'scope' (not 'id')
  memory_facts: 'mutable',
  memory_edges: 'mutable',
  // Local-only (not synced)
  machine_runtime_state: 'local-only',
  api_accounts: 'local-only',   // encrypted credentials must not auto-replicate
  sync_change_log: 'local-only',
  sync_nodes: 'local-only',
  sync_conflicts: 'local-only',
  sync_peer_cursors: 'local-only',
} as const;

/** List of table names that have sync triggers attached (15 tables). */
export const SYNCED_TABLES = Object.entries(TABLE_SYNC_CONFIG)
  .filter(([, type]) => type !== 'local-only')
  .map(([name]) => name);

/**
 * Map of table name → PK column used by the sync trigger.
 * Most tables use 'id', but settings uses 'key', memory_scopes uses 'scope',
 * and agent_actions uses 'sync_id' (UUID, globally unique).
 */
export const TABLE_PK_COLUMN: Record<string, string> = {
  settings: 'key',
  memory_scopes: 'scope',
  agent_actions: 'sync_id',
};

/** Get the PK column name for a synced table. Defaults to 'id'. */
export function getTablePkColumn(tableName: string): string {
  return TABLE_PK_COLUMN[tableName] ?? 'id';
}
```

- [ ] **Step 2: Re-export from types/index.ts**

In `packages/shared/src/types/index.ts`, add:

```typescript
export type {
  ChangeLogEntry,
  SyncConflict,
  SyncNode,
  TableSyncType,
} from './sync.js';
export {
  getTablePkColumn,
  SYNCED_TABLES,
  TABLE_PK_COLUMN,
  TABLE_SYNC_CONFIG,
} from './sync.js';
```

- [ ] **Step 3: Build shared**

Run: `pnpm --filter @agentctl/shared build`
Expected: clean build

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/sync.ts packages/shared/src/types/index.ts
git commit -m "feat(mesh): add sync types — ChangeLogEntry, SyncConflict, SyncNode, TABLE_SYNC_CONFIG"
```

---

### Task 3: Machine Identity Module

Uses existing `MACHINE_ID` env var (same as worker registration). No separate file-based nodeId.

**Files:**
- Create: `packages/control-plane/src/sync/machine-identity.ts`
- Create: `packages/control-plane/src/sync/machine-identity.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/control-plane/src/sync/machine-identity.test.ts`:

```typescript
import * as os from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getMachineId } from './machine-identity.js';

describe('getMachineId', () => {
  const originalEnv = process.env.MACHINE_ID;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MACHINE_ID = originalEnv;
    } else {
      delete process.env.MACHINE_ID;
    }
  });

  it('returns MACHINE_ID from env when set', () => {
    process.env.MACHINE_ID = 'mac-local';
    expect(getMachineId()).toBe('mac-local');
  });

  it('derives from hostname when MACHINE_ID is not set', () => {
    delete process.env.MACHINE_ID;
    const id = getMachineId();
    // Should be lowercase, alphanumeric+hyphens, derived from os.hostname()
    expect(id).toMatch(/^[a-z0-9-]+$/);
    expect(id.length).toBeGreaterThan(0);
  });

  it('sanitizes hostname to valid ID format', () => {
    delete process.env.MACHINE_ID;
    // hostname() may contain dots, underscores — getMachineId strips them
    const id = getMachineId();
    expect(id).not.toMatch(/[^a-z0-9-]/);
  });
});
```

- [ ] **Step 2: Run tests — expected FAIL**

- [ ] **Step 3: Implement machine identity**

Create `packages/control-plane/src/sync/machine-identity.ts`:

```typescript
import * as os from 'node:os';

import { sql } from 'drizzle-orm';

import type { Database } from '../db/index.js';

/**
 * Get the machine ID for this node. Uses MACHINE_ID env var (same as worker
 * registration) or derives from hostname. No separate file-based identity.
 */
export function getMachineId(): string {
  const envId = process.env.MACHINE_ID;
  if (envId) return envId;

  return os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) || 'unknown';
}

/**
 * Upsert this node into the sync_nodes registry with is_self=true.
 * Safe to call before sync tables exist.
 */
export async function upsertSelfNode(
  db: Database,
  machineId: string,
  tailscaleIp?: string,
): Promise<void> {
  const hostname = os.hostname();
  await db.execute(
    sql`INSERT INTO sync_nodes (id, hostname, tailscale_ip, role, is_self, last_seen)
        VALUES (${machineId}, ${hostname}, ${tailscaleIp ?? null}, 'full', true, now())
        ON CONFLICT (id) DO UPDATE SET
          hostname = EXCLUDED.hostname,
          tailscale_ip = EXCLUDED.tailscale_ip,
          is_self = true,
          last_seen = now()`,
  );
}
```

- [ ] **Step 4: Run tests — expected PASS (3 tests)**
- [ ] **Step 5: Build**
- [ ] **Step 6: Commit**

```bash
git add packages/control-plane/src/sync/machine-identity.ts packages/control-plane/src/sync/machine-identity.test.ts
git commit -m "feat(mesh): add machine identity — getMachineId + upsertSelfNode (uses MACHINE_ID env)"
```

---

### Task 4: Pool Connection Hook for Node ID

**Files:**
- Modify: `packages/control-plane/src/db/connection.ts`
- Modify: `packages/control-plane/src/db/connection.test.ts`

This is the critical integration point. `app.node_id` must be set on every physical PG connection so triggers can read it. With `pg.Pool`, session variables are per-connection, not per-request. The correct approach: `pool.on('connect')`.

- [ ] **Step 1: Add `sessionNodeId` option to `CreateDbOptions`**

In `packages/control-plane/src/db/connection.ts`, modify `CreateDbOptions` (line 8-17):

```typescript
export type CreateDbOptions = {
  /** Maximum number of connections in the pool. */
  max?: number;
  /** Minimum number of idle connections maintained. */
  min?: number;
  /** Time (ms) a client can sit idle before being closed. */
  idleTimeoutMillis?: number;
  /** Time (ms) to wait for a connection before throwing. */
  connectionTimeoutMillis?: number;
  /** Mesh node ID — set as app.node_id on every new pool connection for sync triggers. */
  sessionNodeId?: string;
};
```

- [ ] **Step 2: Wire pool.on('connect') in createDb**

Replace the `createDb` function body (starts at line 19). Keep the function signature and return type, only change the body:

```typescript
export function createDb(databaseUrl: string, options: CreateDbOptions = {}) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? 20,
    min: options.min ?? 2,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 10_000,
  });

  // Set mesh node ID on every new physical connection.
  // This allows the sync_capture_change() trigger to identify which node
  // produced each change. Safe to call before sync tables exist.
  if (options.sessionNodeId) {
    const sanitized = options.sessionNodeId.replace(/'/g, "''");
    pool.on('connect', (client: pg.PoolClient) => {
      client.query(`SELECT set_config('app.node_id', '${sanitized}', false)`).catch(() => {
        // Non-fatal — sync triggers will skip if app.node_id is not set
      });
    });
  }

  return drizzle(pool, { schema });
}
```

- [ ] **Step 3: Add `on` to mock pool and write test for sessionNodeId**

In `packages/control-plane/src/db/connection.test.ts`:

First, add `on` to the `mockPool` object at line 7:

```typescript
const mockPool = { connect: vi.fn(), query: vi.fn(), end: vi.fn(), on: vi.fn() };
```

Then add a new test after the existing test suite:

```typescript
describe('sessionNodeId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers a connect listener when sessionNodeId is provided', () => {
    createDb('postgresql://test:test@localhost/test', { sessionNodeId: 'node-test-abcd' });
    expect(mockPool.on).toHaveBeenCalledWith('connect', expect.any(Function));
  });

  it('does not register a connect listener when sessionNodeId is omitted', () => {
    createDb('postgresql://test:test@localhost/test');
    expect(mockPool.on).not.toHaveBeenCalled();
  });

  it('connect listener calls set_config with the node ID', async () => {
    createDb('postgresql://test:test@localhost/test', { sessionNodeId: 'node-test-abcd' });

    // Get the registered callback and invoke it with a mock client
    const connectCallback = mockPool.on.mock.calls[0][1];
    const mockClient = { query: vi.fn().mockResolvedValue(undefined) };
    await connectCallback(mockClient);

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("set_config('app.node_id', 'node-test-abcd'"),
    );
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd packages/control-plane && pnpm vitest run src/db/connection.test.ts`
Expected: all existing + new tests PASS

- [ ] **Step 5: Build**

Run: `pnpm --filter @agentctl/control-plane build`

- [ ] **Step 6: Commit**

```bash
git add packages/control-plane/src/db/connection.ts packages/control-plane/src/db/connection.test.ts
git commit -m "feat(mesh): set app.node_id on every pool connection via pool.on('connect')"
```

---

### Task 5: Wire Machine ID into Startup

**Files:**
- Modify: `packages/control-plane/src/index.ts:203-222`

- [ ] **Step 1: Import machine identity functions**

At the top of `packages/control-plane/src/index.ts`, add:

```typescript
import { getMachineId, upsertSelfNode } from './sync/machine-identity.js';
```

- [ ] **Step 2: Get machineId before createDb**

In the `main()` function, before the `if (DATABASE_URL)` block (~line 220), add:

```typescript
  // --- Mesh identity (reuses MACHINE_ID env var from worker registration) ---
  const machineId = getMachineId();
  logger.info({ machineId }, 'Mesh machine identity initialized');
```

- [ ] **Step 3: Pass machineId to createDb**

Change the `createDb` call at line 222 from:

```typescript
    db = createDb(DATABASE_URL);
```

to:

```typescript
    db = createDb(DATABASE_URL, { sessionNodeId: machineId });
```

- [ ] **Step 4: Upsert self node after DB is ready**

After the migration block (~line 260, after migrations run or are skipped), add:

```typescript
    // Register this mesh node in sync_nodes with is_self=true
    try {
      await upsertSelfNode(db, machineId, process.env.TAILSCALE_IP);
    } catch {
      logger.debug('sync_nodes table not available yet — skipping node registration');
    }
```

- [ ] **Step 5: Build**

Run: `pnpm --filter @agentctl/control-plane build`
Expected: clean build

- [ ] **Step 6: Commit**

```bash
git add packages/control-plane/src/index.ts
git commit -m "feat(mesh): wire machine identity into startup — machineId passed to createDb"
```

---

### Task 6: Database Schema + Migration

**Files:**
- Modify: `packages/control-plane/src/db/schema.ts` (add 3 new table definitions + sync_id column)
- Create: `packages/control-plane/drizzle/0021_mesh_change_log.sql`

**CRITICAL:** Migration goes in `packages/control-plane/drizzle/` (the repo's real migration directory). Numbered `0021` (after latest `0020_add_mobile_push_devices.sql`). All DDL uses IF NOT EXISTS / DROP IF EXISTS for idempotent replay-on-boot.

- [ ] **Step 1: Add Drizzle schema definitions**

At the end of `packages/control-plane/src/db/schema.ts` (after the `settings` table ~line 376):

```typescript
// ---------------------------------------------------------------------------
// Mesh Sync — Change log, conflict tracking, and node registry
// ---------------------------------------------------------------------------

export const syncNodes = pgTable('sync_nodes', {
  id: text('id').primaryKey(),
  hostname: text('hostname').notNull(),
  tailscaleIp: text('tailscale_ip'),
  role: text('role').notNull().default('full'),
  lastSeen: timestamp('last_seen', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const syncChangeLog = pgTable(
  'sync_change_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    nodeId: text('node_id').notNull(),
    tableName: text('table_name').notNull(),
    rowId: text('row_id').notNull(),
    operation: text('operation').notNull(),
    payload: jsonb('payload'),
    vclock: jsonb('vclock').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    synced: boolean('synced').notNull().default(false),
  },
  // NOTE: The migration creates partial indexes (WHERE synced = false, WHERE status = 'pending')
  // which Drizzle's schema API does not natively support. The indexes below are plain (non-partial)
  // in the Drizzle schema for type-safety only — the actual partial indexes come from the SQL migration.
  // This intentional divergence is acceptable; drizzle-kit push/pull is not used for migrations.
  (table) => [
    index('idx_change_log_table_row').on(table.tableName, table.rowId),
  ],
);

export const syncConflicts = pgTable(
  'sync_conflicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tableName: text('table_name').notNull(),
    rowId: text('row_id').notNull(),
    localVclock: jsonb('local_vclock').notNull(),
    localPayload: jsonb('local_payload'),
    remoteVclock: jsonb('remote_vclock').notNull(),
    remotePayload: jsonb('remote_payload'),
    remoteNodeId: text('remote_node_id').notNull(),
    status: text('status').notNull().default('pending'),
    resolution: text('resolution'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // NOTE: The migration creates idx_conflicts_pending as a partial index (WHERE status = 'pending').
  // Drizzle schema API does not support partial index predicates, so no index is declared here.
  // The actual index comes from the SQL migration only.
);
```

Also add `sync_id` to the existing `agentActions` table definition (~line 322-335). Add after `approvedBy`:

```typescript
    /** Globally unique ID for mesh sync (bigserial PK is not globally unique). */
    syncId: uuid('sync_id').defaultRandom(),
```

- [ ] **Step 2: Create migration**

Create `packages/control-plane/drizzle/0021_mesh_change_log.sql`:

```sql
-- Mesh P1: Change log + vector clock infrastructure
-- All DDL is idempotent (IF NOT EXISTS / DROP IF EXISTS) for replay-on-boot safety.

-- ============================================================================
-- 1. New tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_nodes (
  id          TEXT PRIMARY KEY,
  hostname    TEXT NOT NULL,
  tailscale_ip TEXT,
  role        TEXT NOT NULL DEFAULT 'full',
  last_seen   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_change_log (
  id          BIGSERIAL PRIMARY KEY,
  node_id     TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  operation   TEXT NOT NULL,
  payload     JSONB,
  vclock      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced      BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_change_log_unsynced
  ON sync_change_log (synced, created_at) WHERE synced = false;
CREATE INDEX IF NOT EXISTS idx_change_log_table_row
  ON sync_change_log (table_name, row_id);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name      TEXT NOT NULL,
  row_id          TEXT NOT NULL,
  local_vclock    JSONB NOT NULL,
  local_payload   JSONB,
  remote_vclock   JSONB NOT NULL,
  remote_payload  JSONB,
  remote_node_id  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  resolution      TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conflicts_pending
  ON sync_conflicts (status) WHERE status = 'pending';

-- ============================================================================
-- 2. Add sync_id UUID to agent_actions (bigserial PK is not globally unique)
-- ============================================================================

ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS
  sync_id UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_actions_sync_id
  ON agent_actions (sync_id);

-- ============================================================================
-- 3. Generic trigger function
--    Reads PK column name from TG_ARGV[0].
--    Uses advisory lock to serialize concurrent vclock increments.
--    Skips if app.sync_applying = 'true' (prevents loops during remote apply).
--    Skips if app.node_id is not set (graceful degradation).
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_capture_change() RETURNS trigger AS $$
DECLARE
  v_node_id     TEXT;
  v_pk_col      TEXT;
  v_row_id      TEXT;
  v_payload     JSONB;
  v_vclock      JSONB;
  v_prev_vclock JSONB;
BEGIN
  -- Guard: skip during remote-apply to prevent infinite sync loops
  IF current_setting('app.sync_applying', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Guard: skip if no node identity is set (trigger is a no-op before mesh init)
  v_node_id := current_setting('app.node_id', true);
  IF v_node_id IS NULL OR v_node_id = '' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Read PK column name from trigger argument
  v_pk_col := TG_ARGV[0];

  -- Extract row ID and payload using dynamic column reference
  IF TG_OP = 'DELETE' THEN
    EXECUTE format('SELECT ($1).%I::text', v_pk_col) INTO v_row_id USING OLD;
    v_payload := NULL;
  ELSE
    EXECUTE format('SELECT ($1).%I::text', v_pk_col) INTO v_row_id USING NEW;
    v_payload := to_jsonb(NEW);
  END IF;

  -- Serialize concurrent vclock increments for the same logical row.
  -- hashtext() returns int4, cast to bigint for the single-key overload.
  PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME || ':' || v_row_id)::bigint);

  -- Read latest vector clock for this row
  SELECT vclock INTO v_prev_vclock
    FROM sync_change_log
    WHERE table_name = TG_TABLE_NAME AND row_id = v_row_id
    ORDER BY id DESC LIMIT 1;

  v_prev_vclock := COALESCE(v_prev_vclock, '{}'::jsonb);

  -- Increment this node's component
  v_vclock := jsonb_set(
    v_prev_vclock,
    ARRAY[v_node_id],
    to_jsonb(COALESCE((v_prev_vclock->>v_node_id)::int, 0) + 1)
  );

  -- Record the change
  INSERT INTO sync_change_log (node_id, table_name, row_id, operation, payload, vclock)
  VALUES (v_node_id, TG_TABLE_NAME, v_row_id, TG_OP, v_payload, v_vclock);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. Attach triggers to all 15 synced tables (no api_accounts — local-only)
--    DROP + CREATE for idempotent replay-on-boot.
--    PK column name is passed as the trigger argument.
-- ============================================================================

-- Append-only tables (4 tables)
DROP TRIGGER IF EXISTS sync_capture ON agent_actions;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON agent_actions FOR EACH ROW EXECUTE FUNCTION sync_capture_change('sync_id');

DROP TRIGGER IF EXISTS sync_capture ON session_handoffs;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON session_handoffs FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON native_import_attempts;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON native_import_attempts FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON run_handoff_decisions;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON run_handoff_decisions FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

-- Mutable tables (11 tables — agent_runs, rc_sessions, managed_sessions moved here from append-only)
DROP TRIGGER IF EXISTS sync_capture ON agents;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON agents FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON machines;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON machines FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON agent_runs;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON agent_runs FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON rc_sessions;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON rc_sessions FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON managed_sessions;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON managed_sessions FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON project_account_mappings;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON project_account_mappings FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON settings;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON settings FOR EACH ROW EXECUTE FUNCTION sync_capture_change('key');

DROP TRIGGER IF EXISTS sync_capture ON runtime_config_revisions;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON runtime_config_revisions FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON memory_scopes;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON memory_scopes FOR EACH ROW EXECUTE FUNCTION sync_capture_change('scope');

DROP TRIGGER IF EXISTS sync_capture ON memory_facts;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON memory_facts FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON memory_edges;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON memory_edges FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');
```

- [ ] **Step 3: Build control-plane**

Run: `pnpm --filter @agentctl/control-plane build`
Expected: clean build

- [ ] **Step 4: Commit**

```bash
git add packages/control-plane/src/db/schema.ts packages/control-plane/drizzle/0021_mesh_change_log.sql
git commit -m "feat(mesh): add sync tables schema + trigger migration (drizzle/0021)"
```

---

### Task 7: Sync-Apply Transaction Helper (P2 contract)

**Files:**
- Create: `packages/control-plane/src/sync/apply-guard.ts`
- Create: `packages/control-plane/src/sync/apply-guard.test.ts`

This is a **P2 contract** — it establishes the transaction pattern that P2's remote-apply path will use. P1 does not use it at runtime.

- [ ] **Step 1: Create the helper**

Create `packages/control-plane/src/sync/apply-guard.ts`:

```typescript
import { sql } from 'drizzle-orm';

import type { Database } from '../db/index.js';

/**
 * Execute a function within a transaction where sync triggers are disabled.
 *
 * Used by P2 sync protocol to apply remote changes without re-triggering
 * the sync_capture_change() trigger. SET LOCAL scoping ensures the guard
 * resets at transaction end even on error.
 *
 * This is a P2 contract — P1 establishes the pattern, P2 implements the
 * actual remote-apply logic inside this wrapper.
 */
export async function withSyncApplyGuard<T>(
  db: Database,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL app.sync_applying = 'true'`));
    return fn(tx as unknown as Database);
  });
}
```

- [ ] **Step 2: Write a basic test**

Create `packages/control-plane/src/sync/apply-guard.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';

import { withSyncApplyGuard } from './apply-guard.js';

describe('withSyncApplyGuard', () => {
  it('calls the function within a transaction', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    const mockTx = { execute: mockExecute } as unknown;
    const mockDb = {
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
    } as unknown;

    const result = await withSyncApplyGuard(
      mockDb as Parameters<typeof withSyncApplyGuard>[0],
      async () => 'done',
    );

    expect(result).toBe('done');
    expect(mockExecute).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Run test, build, commit**

Run: `cd packages/control-plane && pnpm vitest run src/sync/apply-guard.test.ts`
Expected: PASS

```bash
git add packages/control-plane/src/sync/apply-guard.ts packages/control-plane/src/sync/apply-guard.test.ts
git commit -m "feat(mesh): add withSyncApplyGuard transaction helper (P2 contract)"
```

---

### Task 8: Change Log Cleanup Job (Separate Queue)

The existing `agent-tasks` queue is typed to `AgentTaskJobData` / `AgentTaskJobName` and cannot accept foreign job types without polluting the union. Instead, create a lightweight **separate BullMQ queue** for sync maintenance.

**Files:**
- Create: `packages/control-plane/src/sync/change-log-cleanup.ts`
- Create: `packages/control-plane/src/sync/sync-maintenance-worker.ts`
- Modify: `packages/control-plane/src/index.ts`

- [ ] **Step 1: Create cleanup function**

Create `packages/control-plane/src/sync/change-log-cleanup.ts`:

```typescript
import { and, eq, lt, sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { syncChangeLog } from '../db/schema.js';

const DEFAULT_RETENTION_DAYS = 30;

/**
 * Delete old synced change log entries beyond the retention period.
 * Only deletes entries where synced = true (already pulled by all peers).
 * Returns the number of deleted rows.
 */
export async function cleanupSyncedChanges(
  db: Database,
  logger: Logger,
  retentionDays: number = DEFAULT_RETENTION_DAYS,
): Promise<number> {
  const cutoff = sql`now() - ${`${retentionDays} days`}::interval`;

  const result = await db
    .delete(syncChangeLog)
    .where(and(eq(syncChangeLog.synced, true), lt(syncChangeLog.createdAt, cutoff)))
    .returning({ id: syncChangeLog.id });

  const count = result.length;
  if (count > 0) {
    logger.info({ deletedCount: count, retentionDays }, 'Cleaned up old sync change log entries');
  }

  return count;
}
```

- [ ] **Step 2: Create sync maintenance worker**

Create `packages/control-plane/src/sync/sync-maintenance-worker.ts`:

```typescript
import type { ConnectionOptions } from 'bullmq';
import { Queue, Worker } from 'bullmq';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';

import { cleanupSyncedChanges } from './change-log-cleanup.js';

export const SYNC_MAINTENANCE_QUEUE = 'sync-maintenance';

type SyncMaintenanceJobData = Record<string, never>;
type SyncMaintenanceJobName = 'sync:cleanup';

/**
 * Register the daily sync cleanup repeatable job.
 * Safe to call multiple times — BullMQ deduplicates by repeat key.
 */
export async function registerSyncMaintenanceJobs(
  connection: ConnectionOptions,
): Promise<Queue<SyncMaintenanceJobData, void, SyncMaintenanceJobName>> {
  const queue = new Queue<SyncMaintenanceJobData, void, SyncMaintenanceJobName>(
    SYNC_MAINTENANCE_QUEUE,
    { connection },
  );

  await queue.add('sync:cleanup', {}, {
    repeat: { pattern: '0 3 * * *' },
    removeOnComplete: true,
    removeOnFail: 5,
  });

  return queue;
}

/**
 * Create a BullMQ worker that processes sync maintenance jobs.
 */
export function createSyncMaintenanceWorker(opts: {
  connection: ConnectionOptions;
  db: Database;
  logger: Logger;
}): Worker<SyncMaintenanceJobData, void, SyncMaintenanceJobName> {
  const { connection, db, logger } = opts;

  return new Worker<SyncMaintenanceJobData, void, SyncMaintenanceJobName>(
    SYNC_MAINTENANCE_QUEUE,
    async (job) => {
      if (job.name === 'sync:cleanup') {
        await cleanupSyncedChanges(db, logger);
      }
    },
    { connection, concurrency: 1 },
  );
}
```

- [ ] **Step 3: Wire into index.ts**

In `packages/control-plane/src/index.ts`, add import:

```typescript
import { createSyncMaintenanceWorker, registerSyncMaintenanceJobs } from './sync/sync-maintenance-worker.js';
```

After the existing task worker creation block (~line 270, after `createTaskWorker({...})`), add:

```typescript
    // --- Sync maintenance (separate queue, not on the agent-tasks type) ---
    let syncQueue: Awaited<ReturnType<typeof registerSyncMaintenanceJobs>> | null = null;
    let syncWorker: ReturnType<typeof createSyncMaintenanceWorker> | null = null;
    if (db && redisConnection) {
      try {
        syncQueue = await registerSyncMaintenanceJobs(redisConnection);
        syncWorker = createSyncMaintenanceWorker({ connection: redisConnection, db, logger });
        logger.info('Sync maintenance worker started (daily cleanup at 3 AM)');
      } catch (err) {
        logger.debug({ err }, 'Sync maintenance worker not started (sync tables may not exist)');
      }
    }
```

The variable is `redisConnection` (line 204 of `index.ts`) — the same `IORedis` instance passed to `createTaskQueue(redisConnection)` at line 403.

Then add cleanup to the graceful shutdown handler (after `taskQueue.close()` at ~line 473):

```typescript
      if (syncWorker) await syncWorker.close();
      if (syncQueue) await syncQueue.close();
```

- [ ] **Step 4: Build**

Run: `pnpm --filter @agentctl/control-plane build`
Expected: clean build

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/sync/change-log-cleanup.ts packages/control-plane/src/sync/sync-maintenance-worker.ts packages/control-plane/src/index.ts
git commit -m "feat(mesh): add sync maintenance queue with daily change log cleanup"
```

---

### Task 9: Integration Tests (Trigger Verification)

**Files:**
- Create: `packages/control-plane/src/sync/change-log.integration.test.ts`

These tests require a real PostgreSQL database with migration `drizzle/0021` applied. They are skipped in CI if `DATABASE_URL` is not set.

- [ ] **Step 1: Write integration tests**

Create `packages/control-plane/src/sync/change-log.integration.test.ts`:

```typescript
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb } from '../db/connection.js';
import { extractRows } from '../db/index.js';

/**
 * Integration tests for the sync_change_log trigger.
 * Requires a real PostgreSQL database with migration drizzle/0021 applied.
 * Set DATABASE_URL env var to run. Skipped if not available.
 *
 * NOTE: agents.machine_id is FK to machines.id, so we create a test machine first.
 * agents table columns: id, machine_id, name, type, runtime, status, project_path, ...
 * (NO 'trigger' column — that's the RunTrigger type in agent_runs, not agents.)
 */
const DATABASE_URL = process.env.DATABASE_URL;

type ChangeLogRow = {
  node_id: string;
  table_name: string;
  row_id: string;
  operation: string;
  vclock: Record<string, number>;
  payload: Record<string, unknown> | null;
};

describe.skipIf(!DATABASE_URL)('sync_change_log trigger (integration)', () => {
  let db: ReturnType<typeof createDb>;
  const testMachineId = 'test-machine-sync';

  beforeAll(async () => {
    db = createDb(DATABASE_URL!, { sessionNodeId: 'node-test-0001' });
    // Create a test machine so agents FK constraint is satisfied
    await db.execute(
      sql`INSERT INTO machines (id, hostname, tailscale_ip, os, arch)
          VALUES (${testMachineId}, 'test-host', '100.64.0.99', 'darwin', 'arm64')
          ON CONFLICT (id) DO NOTHING`,
    );
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM sync_change_log WHERE node_id = 'node-test-0001'`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM sync_change_log WHERE node_id = 'node-test-0001'`);
    await db.execute(sql`DELETE FROM agents WHERE machine_id = ${testMachineId}`);
    await db.execute(sql`DELETE FROM machines WHERE id = ${testMachineId}`);
    // Close the pool to prevent Vitest from hanging on open handles
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  it('captures INSERT into agents table with correct vclock', async () => {
    const agentId = crypto.randomUUID();
    await db.execute(
      sql`INSERT INTO agents (id, machine_id, name, type, status, project_path)
          VALUES (${agentId}, ${testMachineId}, 'test-agent', 'autonomous', 'registered', '/tmp/test')`,
    );

    const result = await db.execute(
      sql`SELECT node_id, table_name, row_id, operation, vclock, payload
          FROM sync_change_log
          WHERE table_name = 'agents' AND row_id = ${agentId}
          ORDER BY id DESC LIMIT 1`,
    );
    const rows = extractRows<ChangeLogRow>(result);

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].node_id).toBe('node-test-0001');
    expect(rows[0].operation).toBe('INSERT');
    expect(rows[0].vclock).toEqual({ 'node-test-0001': 1 });
    expect(rows[0].payload).toBeDefined();

    await db.execute(sql`DELETE FROM agents WHERE id = ${agentId}`);
  });

  it('increments vclock on UPDATE', async () => {
    const agentId = crypto.randomUUID();
    await db.execute(
      sql`INSERT INTO agents (id, machine_id, name, type, status, project_path)
          VALUES (${agentId}, ${testMachineId}, 'test-agent', 'autonomous', 'registered', '/tmp/test')`,
    );
    await db.execute(
      sql`UPDATE agents SET name = 'updated-agent' WHERE id = ${agentId}`,
    );

    const result = await db.execute(
      sql`SELECT operation, vclock FROM sync_change_log
          WHERE table_name = 'agents' AND row_id = ${agentId}
          ORDER BY id ASC`,
    );
    const rows = extractRows<ChangeLogRow>(result);

    expect(rows.length).toBe(2);
    expect(rows[0].vclock).toEqual({ 'node-test-0001': 1 });
    expect(rows[1].vclock).toEqual({ 'node-test-0001': 2 });
    expect(rows[1].operation).toBe('UPDATE');

    await db.execute(sql`DELETE FROM agents WHERE id = ${agentId}`);
  });

  it('skips change log when sync_applying is true', async () => {
    const agentId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL app.sync_applying = 'true'`));
      await tx.execute(
        sql`INSERT INTO agents (id, machine_id, name, type, status, project_path)
            VALUES (${agentId}, ${testMachineId}, 'sync-guard-test', 'autonomous', 'registered', '/tmp/test')`,
      );
    });

    const result = await db.execute(
      sql`SELECT * FROM sync_change_log
          WHERE table_name = 'agents' AND row_id = ${agentId} AND node_id = 'node-test-0001'`,
    );
    const rows = extractRows<ChangeLogRow>(result);

    expect(rows.length).toBe(0);

    await db.execute(sql`DELETE FROM agents WHERE id = ${agentId}`);
  });
});
```

- [ ] **Step 2: Apply migration to dev-1 and run tests**

```bash
psql "postgresql://hahaschool@127.0.0.1:5433/agentctl_dev1" -f packages/control-plane/drizzle/0021_mesh_change_log.sql
DATABASE_URL="postgresql://hahaschool@127.0.0.1:5433/agentctl_dev1" pnpm --filter @agentctl/control-plane vitest run src/sync/change-log.integration.test.ts
```

Expected: 3 tests PASS (or skipped if no DATABASE_URL)

- [ ] **Step 3: Commit**

```bash
git add packages/control-plane/src/sync/change-log.integration.test.ts
git commit -m "test(mesh): add integration tests for sync trigger — capture, vclock, sync-apply guard"
```

---

### Task 10: Push Branch + Create PR

- [ ] **Step 1: Final build check**

```bash
pnpm --filter @agentctl/shared build && pnpm --filter @agentctl/control-plane build
```

- [ ] **Step 2: Push branch**

```bash
git push -u origin agent/claude/feat/mesh-p1-change-log
```

- [ ] **Step 3: Create PR**

```bash
gh pr create --base main --title "feat(mesh): P1 — change log + vector clock infrastructure (§33.1)" --body "$(cat <<'EOF'
## Summary
Foundation for mesh multi-master sync (§33.1):

- **Vector clock utilities** — `vcDominates`, `vcMerge`, `vcCompare` (12 unit tests)
- **Sync types** — `ChangeLogEntry`, `SyncConflict`, `SyncNode`, `TABLE_SYNC_CONFIG`, `TABLE_PK_COLUMN`
- **Machine identity** — `getMachineId()` uses MACHINE_ID env, `pool.on('connect')` for `app.node_id` (3 unit tests)
- **Database schema** — `sync_change_log`, `sync_conflicts`, `sync_nodes` + `agent_actions.sync_id`
- **PG trigger** — `sync_capture_change()` with TG_ARGV[0] PK, advisory lock, sync-apply guard
- **15 trigger attachments** — 4 append-only + 11 mutable (handles `settings.key`, `memory_scopes.scope`, `agent_actions.sync_id`)
- **Sync-apply helper** — `withSyncApplyGuard()` transaction contract for P2
- **Cleanup job** — daily BullMQ job, 30-day retention

Spec: docs/superpowers/specs/2026-03-30-mesh-p1-change-log-vector-clock-design.md
Plan: docs/superpowers/plans/2026-03-30-mesh-p1-change-log-vector-clock.md
Review: 3 rounds Codex (GPT 5.4 xhigh) adversarial review to parity

## Test plan
- [ ] 12 vector clock unit tests pass
- [ ] 3 machine identity unit tests pass
- [ ] 1 apply-guard unit test passes
- [ ] `pnpm --filter @agentctl/shared build` clean
- [ ] 3 pool connection tests pass (connect listener, no listener, set_config call)
- [ ] 1 apply-guard unit test passes
- [ ] 3 integration tests pass (trigger capture, vclock increment, sync-apply guard)
- [ ] `pnpm --filter @agentctl/control-plane build` clean
- [ ] Migration runs cleanly on dev DB

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
