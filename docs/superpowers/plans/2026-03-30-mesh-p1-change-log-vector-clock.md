# Mesh P1: Change Log + Vector Clock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trigger-based change tracking with vector clocks to 16 synced PostgreSQL tables, establishing the foundation for multi-master mesh sync.

**Architecture:** PostgreSQL triggers capture every INSERT/UPDATE/DELETE into a `sync_change_log` table with vector clock metadata. A `sync_nodes` table tracks node identity. TypeScript utilities provide vector clock comparison/merge logic. A session variable guard prevents sync-apply loops.

**Tech Stack:** PostgreSQL triggers (PL/pgSQL), Drizzle ORM (schema), TypeScript (vector clock logic), Vitest (tests)

**Spec:** `docs/superpowers/specs/2026-03-30-mesh-p1-change-log-vector-clock-design.md`

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
Expected: FAIL — module `./vector-clock.js` not found

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

Add to `packages/shared/src/types/index.ts` after the dispatch-config exports:

```typescript
export type { VectorClock } from '../vector-clock.js';
```

Add to `packages/shared/src/index.ts`:

```typescript
export { vcCompare, vcDominates, vcMerge } from './vector-clock.js';
export type { VectorClock } from './vector-clock.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/shared && pnpm vitest run src/vector-clock.test.ts`
Expected: all 12 tests PASS

- [ ] **Step 6: Build shared**

Run: `pnpm --filter @agentctl/shared build`
Expected: clean build

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

/** Classification of all synced tables. */
export const TABLE_SYNC_CONFIG: Record<string, TableSyncType> = {
  // Append-only: auto-merge, deduplicate by PK
  agent_runs: 'append-only',
  agent_actions: 'append-only',
  rc_sessions: 'append-only',
  managed_sessions: 'append-only',
  session_handoffs: 'append-only',
  native_import_attempts: 'append-only',
  run_handoff_decisions: 'append-only',
  // Mutable: vector clock conflict detection
  agents: 'mutable',
  machines: 'mutable',
  api_accounts: 'mutable',
  project_account_mappings: 'mutable',
  settings: 'mutable',
  runtime_config_revisions: 'mutable',
  memory_scopes: 'mutable',
  memory_facts: 'mutable',
  memory_edges: 'mutable',
  // Local-only: not synced
  machine_runtime_state: 'local-only',
} as const;

/** List of table names that have sync triggers. */
export const SYNCED_TABLES = Object.entries(TABLE_SYNC_CONFIG)
  .filter(([, type]) => type !== 'local-only')
  .map(([name]) => name);
```

- [ ] **Step 2: Re-export from types/index.ts**

Add to `packages/shared/src/types/index.ts`:

```typescript
export type {
  ChangeLogEntry,
  SyncConflict,
  SyncNode,
  TableSyncType,
} from './sync.js';
export { SYNCED_TABLES, TABLE_SYNC_CONFIG } from './sync.js';
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

### Task 3: Database Schema — Sync Tables

**Files:**
- Modify: `packages/control-plane/src/db/schema.ts`
- Create: `packages/control-plane/src/db/migrations/0005_mesh_change_log.sql`

- [ ] **Step 1: Add Drizzle schema definitions**

In `packages/control-plane/src/db/schema.ts`, add at the end of the file (after the `settings` table):

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
  (table) => [
    index('idx_change_log_unsynced').on(table.synced, table.createdAt),
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
  (table) => [index('idx_conflicts_pending').on(table.status)],
);
```

- [ ] **Step 2: Create migration file**

Create `packages/control-plane/src/db/migrations/0005_mesh_change_log.sql`:

```sql
-- Mesh P1: Change log + vector clock infrastructure
-- Creates sync_nodes, sync_change_log, sync_conflicts tables,
-- the generic trigger function, and attaches triggers to 16 synced tables.

-- 1. Node registry
CREATE TABLE IF NOT EXISTS sync_nodes (
  id          TEXT PRIMARY KEY,
  hostname    TEXT NOT NULL,
  tailscale_ip TEXT,
  role        TEXT NOT NULL DEFAULT 'full',
  last_seen   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Change log
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

-- 3. Conflict tracker
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

-- 4. Generic trigger function
CREATE OR REPLACE FUNCTION sync_capture_change() RETURNS trigger AS $$
DECLARE
  v_node_id TEXT;
  v_row_id TEXT;
  v_payload JSONB;
  v_vclock JSONB;
  v_prev_vclock JSONB;
BEGIN
  -- Skip if this is a sync-apply operation (prevents infinite loops)
  IF current_setting('app.sync_applying', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Read current node ID from session variable
  v_node_id := current_setting('app.node_id', true);
  IF v_node_id IS NULL OR v_node_id = '' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Extract row ID and payload
  IF TG_OP = 'DELETE' THEN
    v_row_id := OLD.id::text;
    v_payload := NULL;
  ELSE
    v_row_id := NEW.id::text;
    v_payload := to_jsonb(NEW);
  END IF;

  -- Get previous vector clock for this row (if any)
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

-- 5. Attach triggers to all 16 synced tables
-- Append-only tables
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON agent_runs FOR EACH ROW EXECUTE FUNCTION sync_capture_change();
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON agent_actions FOR EACH ROW EXECUTE FUNCTION sync_capture_change();
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON rc_sessions FOR EACH ROW EXECUTE FUNCTION sync_capture_change();
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON managed_sessions FOR EACH ROW EXECUTE FUNCTION sync_capture_change();
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON session_handoffs FOR EACH ROW EXECUTE FUNCTION sync_capture_change();
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON native_import_attempts FOR EACH ROW EXECUTE FUNCTION sync_capture_change();
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON run_handoff_decisions FOR EACH ROW EXECUTE FUNCTION sync_capture_change();

-- Mutable tables
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON agents FOR EACH ROW EXECUTE FUNCTION sync_capture_change();
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON machines FOR EACH ROW EXECUTE FUNCTION sync_capture_change();
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON api_accounts FOR EACH ROW EXECUTE FUNCTION sync_capture_change();
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON project_account_mappings FOR EACH ROW EXECUTE FUNCTION sync_capture_change();
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON settings FOR EACH ROW EXECUTE FUNCTION sync_capture_change();
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON runtime_config_revisions FOR EACH ROW EXECUTE FUNCTION sync_capture_change();
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON memory_scopes FOR EACH ROW EXECUTE FUNCTION sync_capture_change();
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON memory_facts FOR EACH ROW EXECUTE FUNCTION sync_capture_change();
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON memory_edges FOR EACH ROW EXECUTE FUNCTION sync_capture_change();
```

- [ ] **Step 3: Build control-plane**

Run: `pnpm --filter @agentctl/control-plane build`
Expected: clean build (health.ts worker type was fixed in PR #367)

- [ ] **Step 4: Commit**

```bash
git add packages/control-plane/src/db/schema.ts packages/control-plane/src/db/migrations/0005_mesh_change_log.sql
git commit -m "feat(mesh): add sync_change_log, sync_conflicts, sync_nodes schema + trigger migration"
```

---

### Task 4: Node Identity Module

**Files:**
- Create: `packages/control-plane/src/sync/node-identity.ts`
- Create: `packages/control-plane/src/sync/node-identity.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/control-plane/src/sync/node-identity.test.ts`:

```typescript
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getOrCreateNodeId } from './node-identity.js';

describe('getOrCreateNodeId', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-node-id-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a new node ID file on first call', () => {
    const nodeId = getOrCreateNodeId(tmpDir);
    expect(nodeId).toMatch(/^node-.+-[a-f0-9]{4}$/);
    expect(fs.existsSync(path.join(tmpDir, 'node-id'))).toBe(true);
  });

  it('returns the same ID on subsequent calls', () => {
    const first = getOrCreateNodeId(tmpDir);
    const second = getOrCreateNodeId(tmpDir);
    expect(first).toBe(second);
  });

  it('reads existing node ID from file', () => {
    const filePath = path.join(tmpDir, 'node-id');
    fs.writeFileSync(filePath, 'node-custom-abcd', 'utf8');
    const nodeId = getOrCreateNodeId(tmpDir);
    expect(nodeId).toBe('node-custom-abcd');
  });

  it('creates the directory if it does not exist', () => {
    const nestedDir = path.join(tmpDir, 'nested', 'dir');
    const nodeId = getOrCreateNodeId(nestedDir);
    expect(nodeId).toMatch(/^node-.+-[a-f0-9]{4}$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/control-plane && pnpm vitest run src/sync/node-identity.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement node identity**

Create `packages/control-plane/src/sync/node-identity.ts`:

```typescript
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { sql } from 'drizzle-orm';

import type { Database } from '../db/index.js';

const NODE_ID_FILE = 'node-id';

/**
 * Get or create the persistent node ID for this machine.
 * Stored at `<configDir>/node-id`.
 * Format: `node-<hostname-prefix>-<4-hex>`
 */
export function getOrCreateNodeId(configDir: string): string {
  const filePath = path.join(configDir, NODE_ID_FILE);

  // Try reading existing
  try {
    const existing = fs.readFileSync(filePath, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // File doesn't exist — will create below
  }

  // Generate new node ID
  const hostPrefix = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16) || 'unknown';
  const suffix = crypto.randomBytes(2).toString('hex');
  const nodeId = `node-${hostPrefix}-${suffix}`;

  // Ensure directory exists
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, nodeId, 'utf8');

  return nodeId;
}

/**
 * Set the node ID as a PostgreSQL session variable so the sync trigger can read it.
 * Must be called once per database connection / transaction.
 */
export async function setSessionNodeId(db: Database, nodeId: string): Promise<void> {
  await db.execute(sql.raw(`SET app.node_id = '${nodeId.replace(/'/g, "''")}'`));
}

/**
 * Upsert the current node into the sync_nodes registry.
 */
export async function upsertSyncNode(
  db: Database,
  nodeId: string,
  tailscaleIp?: string,
): Promise<void> {
  const hostname = os.hostname();
  await db.execute(
    sql`INSERT INTO sync_nodes (id, hostname, tailscale_ip, role, last_seen)
        VALUES (${nodeId}, ${hostname}, ${tailscaleIp ?? null}, 'full', now())
        ON CONFLICT (id) DO UPDATE SET
          hostname = EXCLUDED.hostname,
          tailscale_ip = EXCLUDED.tailscale_ip,
          last_seen = now()`,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/control-plane && pnpm vitest run src/sync/node-identity.test.ts`
Expected: all 4 tests PASS

- [ ] **Step 5: Build control-plane**

Run: `pnpm --filter @agentctl/control-plane build`
Expected: clean build

- [ ] **Step 6: Commit**

```bash
git add packages/control-plane/src/sync/node-identity.ts packages/control-plane/src/sync/node-identity.test.ts
git commit -m "feat(mesh): add node identity — getOrCreateNodeId, setSessionNodeId, upsertSyncNode"
```

---

### Task 5: Wire Node ID into Server Startup

**Files:**
- Modify: `packages/control-plane/src/api/server.ts:150-212`

- [ ] **Step 1: Import node identity functions**

At top of `packages/control-plane/src/api/server.ts`, add with the other imports:

```typescript
import { getOrCreateNodeId, setSessionNodeId, upsertSyncNode } from '../sync/node-identity.js';
```

- [ ] **Step 2: Initialize node ID in createServer**

In the `createServer` function body (after the Fastify instance creation, before the first `app.addHook`), add:

```typescript
  // --- Mesh node identity ---
  const agentctlConfigDir = process.env.AGENTCTL_CONFIG_DIR
    ?? path.join(process.env.HOME ?? '/tmp', '.agentctl');
  const nodeId = getOrCreateNodeId(agentctlConfigDir);
  logger.info({ nodeId, configDir: agentctlConfigDir }, 'Mesh node identity initialized');

  // Register this node and set session variable for sync triggers
  if (db) {
    try {
      await upsertSyncNode(db, nodeId, process.env.TAILSCALE_IP);
      await setSessionNodeId(db, nodeId);
    } catch (err) {
      logger.warn({ err }, 'Failed to initialize mesh node identity in database (sync tables may not exist yet)');
    }
  }
```

Add the `path` import at the top if not already present:

```typescript
import * as path from 'node:path';
```

- [ ] **Step 3: Set node ID on each request's DB connection**

Add a new `onRequest` hook after the existing request-id hook (~line 205):

```typescript
  // --- Mesh: set node ID on each request for sync triggers ---
  app.addHook('onRequest', async () => {
    if (db) {
      try {
        await setSessionNodeId(db, nodeId);
      } catch {
        // Non-fatal — sync triggers will skip if no node_id is set
      }
    }
  });
```

- [ ] **Step 4: Build control-plane**

Run: `pnpm --filter @agentctl/control-plane build`
Expected: clean build

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/api/server.ts
git commit -m "feat(mesh): wire node identity into server startup and request hooks"
```

---

### Task 6: Integration Tests — Trigger Verification

**Files:**
- Create: `packages/control-plane/src/sync/change-log.integration.test.ts`

- [ ] **Step 1: Write integration test**

Create `packages/control-plane/src/sync/change-log.integration.test.ts`:

```typescript
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb, type Database } from '../db/connection.js';

/**
 * Integration tests for the sync_change_log trigger.
 * Requires a real PostgreSQL database with migration 0005 applied.
 *
 * Set DATABASE_URL env var to run. Skipped if not available.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('sync_change_log trigger (integration)', () => {
  let db: Database;

  beforeAll(async () => {
    db = createDb(DATABASE_URL!);
    // Set node ID for the trigger
    await db.execute(sql.raw(`SET app.node_id = 'node-test-0001'`));
  });

  afterAll(async () => {
    // Cleanup test data
    await db.execute(sql`DELETE FROM sync_change_log WHERE node_id = 'node-test-0001'`);
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM sync_change_log WHERE node_id = 'node-test-0001'`);
  });

  it('captures INSERT into agents table', async () => {
    const agentId = crypto.randomUUID();
    await db.execute(
      sql`INSERT INTO agents (id, machine_id, name, type, trigger, status, project_path)
          VALUES (${agentId}, 'test-machine', 'test-agent', 'manual', 'manual', 'registered', '/tmp/test')`,
    );

    const [log] = await db.execute(
      sql`SELECT * FROM sync_change_log
          WHERE table_name = 'agents' AND row_id = ${agentId} AND node_id = 'node-test-0001'
          ORDER BY id DESC LIMIT 1`,
    );

    expect(log).toBeDefined();
    expect(log.operation).toBe('INSERT');
    expect(log.vclock).toEqual({ 'node-test-0001': 1 });
    expect(log.payload).toBeDefined();

    // Cleanup
    await db.execute(sql`DELETE FROM agents WHERE id = ${agentId}`);
  });

  it('increments vclock on UPDATE', async () => {
    const agentId = crypto.randomUUID();
    await db.execute(
      sql`INSERT INTO agents (id, machine_id, name, type, trigger, status, project_path)
          VALUES (${agentId}, 'test-machine', 'test-agent', 'manual', 'manual', 'registered', '/tmp/test')`,
    );
    await db.execute(
      sql`UPDATE agents SET name = 'updated-agent' WHERE id = ${agentId}`,
    );

    const logs = await db.execute(
      sql`SELECT * FROM sync_change_log
          WHERE table_name = 'agents' AND row_id = ${agentId}
          ORDER BY id ASC`,
    );

    expect(logs.length).toBe(2);
    expect(logs[0].vclock).toEqual({ 'node-test-0001': 1 });
    expect(logs[1].vclock).toEqual({ 'node-test-0001': 2 });
    expect(logs[1].operation).toBe('UPDATE');

    // Cleanup
    await db.execute(sql`DELETE FROM agents WHERE id = ${agentId}`);
  });

  it('skips change log when sync_applying is true', async () => {
    await db.execute(sql.raw(`SET LOCAL app.sync_applying = 'true'`));

    const agentId = crypto.randomUUID();
    await db.execute(
      sql`INSERT INTO agents (id, machine_id, name, type, trigger, status, project_path)
          VALUES (${agentId}, 'test-machine', 'sync-test', 'manual', 'manual', 'registered', '/tmp/test')`,
    );

    await db.execute(sql.raw(`RESET app.sync_applying`));

    const logs = await db.execute(
      sql`SELECT * FROM sync_change_log
          WHERE table_name = 'agents' AND row_id = ${agentId} AND node_id = 'node-test-0001'`,
    );

    expect(logs.length).toBe(0);

    // Cleanup
    await db.execute(sql`DELETE FROM agents WHERE id = ${agentId}`);
  });
});
```

- [ ] **Step 2: Run integration test (requires DB)**

Run against dev-1 database:
```bash
DATABASE_URL="postgresql://hahaschool@127.0.0.1:5433/agentctl_dev1" cd packages/control-plane && pnpm vitest run src/sync/change-log.integration.test.ts
```

Note: This requires migration 0005 to be applied first:
```bash
psql "postgresql://hahaschool@127.0.0.1:5433/agentctl_dev1" -f packages/control-plane/src/db/migrations/0005_mesh_change_log.sql
```

Expected: all 3 tests PASS (or skipped if no DATABASE_URL)

- [ ] **Step 3: Commit**

```bash
git add packages/control-plane/src/sync/change-log.integration.test.ts
git commit -m "test(mesh): add integration tests for sync trigger — insert, vclock increment, sync-apply guard"
```

---

### Task 7: Change Log Cleanup Job

**Files:**
- Create: `packages/control-plane/src/sync/change-log-cleanup.ts`

- [ ] **Step 1: Create cleanup module**

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

- [ ] **Step 2: Build control-plane**

Run: `pnpm --filter @agentctl/control-plane build`
Expected: clean build

- [ ] **Step 3: Commit**

```bash
git add packages/control-plane/src/sync/change-log-cleanup.ts
git commit -m "feat(mesh): add sync change log cleanup — prune synced entries older than 30 days"
```

---

### Task 8: Push Branch + Create PR

**Files:** None (git operations only)

- [ ] **Step 1: Push branch**

```bash
git push -u origin agent/claude/feat/mesh-p1-change-log
```

- [ ] **Step 2: Create PR**

```bash
gh pr create --base main --title "feat(mesh): P1 — change log + vector clock infrastructure" --body "$(cat <<'EOF'
## Summary
Foundation for mesh multi-master sync (§33.1):

- **Vector clock utilities** — `vcDominates`, `vcMerge`, `vcCompare` with 12 unit tests
- **Sync types** — `ChangeLogEntry`, `SyncConflict`, `SyncNode`, `TABLE_SYNC_CONFIG`
- **Database schema** — `sync_change_log`, `sync_conflicts`, `sync_nodes` tables
- **PG trigger** — `sync_capture_change()` on 16 synced tables (7 append-only + 9 mutable)
- **Node identity** — `getOrCreateNodeId()`, `setSessionNodeId()`, `upsertSyncNode()`
- **Server integration** — node ID wired into startup + per-request hooks
- **Sync-apply guard** — `app.sync_applying` session variable prevents trigger loops
- **Cleanup job** — prune synced entries older than 30 days

Spec: docs/superpowers/specs/2026-03-30-mesh-p1-change-log-vector-clock-design.md

## Test plan
- [ ] 12 vector clock unit tests pass
- [ ] 4 node identity unit tests pass
- [ ] 3 integration tests pass (trigger capture, vclock increment, sync-apply guard)
- [ ] `pnpm --filter @agentctl/shared build` clean
- [ ] `pnpm --filter @agentctl/control-plane build` clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
