# Mesh P1: Change Log + Vector Clock — Implementation Plan (v2, post-Codex review)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trigger-based change tracking with vector clocks to 16 synced PostgreSQL tables, establishing the foundation for multi-master mesh sync.

**Architecture:** PostgreSQL triggers capture every INSERT/UPDATE/DELETE into a `sync_change_log` table with vector clock metadata. A `sync_nodes` table tracks node identity. TypeScript utilities provide vector clock comparison/merge logic. Node identity is set per-connection via `pool.on('connect')` in `connection.ts`. Advisory locks serialize concurrent vector clock increments.

**Tech Stack:** PostgreSQL triggers (PL/pgSQL), Drizzle ORM (schema), TypeScript (vector clock logic), Vitest (tests)

**Spec:** `docs/superpowers/specs/2026-03-30-mesh-p1-change-log-vector-clock-design.md`

**Codex Review:** 3 rounds, all FAILs resolved. Key fixes from review:
- Migration in `drizzle/0021_*` (not `src/db/migrations/0005_*`)
- Trigger PK via `TG_ARGV[0]` (not hardcoded `id`)
- `pool.on('connect')` for `app.node_id` (not per-request hook)
- Advisory lock for concurrent vclock safety
- `agent_actions` gets `sync_id UUID` column (not PK change)
- Sync-apply transaction helper documented for P2

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

- [ ] **Step 2: Run tests — expected FAIL**

Run: `cd packages/shared && pnpm vitest run src/vector-clock.test.ts`

- [ ] **Step 3: Implement**

Create `packages/shared/src/vector-clock.ts`:

```typescript
/** Maps nodeId → logical counter. */
export type VectorClock = Record<string, number>;

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

export function vcMerge(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };
  for (const [k, v] of Object.entries(b)) {
    result[k] = Math.max(result[k] ?? 0, v);
  }
  return result;
}

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

- [ ] **Step 4: Re-export**

In `packages/shared/src/types/index.ts` add:
```typescript
export type { VectorClock } from '../vector-clock.js';
```

In `packages/shared/src/index.ts` add:
```typescript
export { vcCompare, vcDominates, vcMerge } from './vector-clock.js';
export type { VectorClock } from './vector-clock.js';
```

- [ ] **Step 5: Run tests — expected PASS (12 tests)**
- [ ] **Step 6: `pnpm --filter @agentctl/shared build`**
- [ ] **Step 7: Commit** `feat(mesh): add VectorClock type and comparison utilities`

---

### Task 2: Sync Types (Shared)

**Files:**
- Create: `packages/shared/src/types/sync.ts`
- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1: Create sync types**

Create `packages/shared/src/types/sync.ts` — same as v1 plan but with these fixes:
- `TABLE_SYNC_CONFIG` includes `sync_change_log`, `sync_nodes`, `sync_conflicts` as `'local-only'`
- `agent_actions` stays `'append-only'` (will use `sync_id` UUID column added in Task 3)
- `SYNCED_TABLES` count is 16 (7 append-only + 9 mutable)

- [ ] **Step 2: Re-export from `types/index.ts`**
- [ ] **Step 3: Build shared**
- [ ] **Step 4: Commit** `feat(mesh): add sync types — ChangeLogEntry, SyncConflict, SyncNode, TABLE_SYNC_CONFIG`

---

### Task 3: Database Schema + Migration

**Files:**
- Modify: `packages/control-plane/src/db/schema.ts`
- Create: `packages/control-plane/drizzle/0021_mesh_change_log.sql`

**CRITICAL: Migration goes in `drizzle/` directory (numbered 0021), NOT `src/db/migrations/`.**

- [ ] **Step 1: Add Drizzle schema for 3 new tables** (`syncNodes`, `syncChangeLog`, `syncConflicts`) in `schema.ts`

- [ ] **Step 2: Create migration `drizzle/0021_mesh_change_log.sql`**

Key differences from v1:
- Use `DROP TRIGGER IF EXISTS ... ; CREATE TRIGGER ...` for idempotency
- Trigger function uses `TG_ARGV[0]` for PK column name
- Advisory lock for concurrent safety
- Add `sync_id UUID` column to `agent_actions`

```sql
-- Mesh P1: Change log + vector clock infrastructure

-- 1. Tables (IF NOT EXISTS for idempotency)
CREATE TABLE IF NOT EXISTS sync_nodes ( ... );
CREATE TABLE IF NOT EXISTS sync_change_log ( ... );
CREATE TABLE IF NOT EXISTS sync_conflicts ( ... );

-- 2. Add sync_id to agent_actions (bigserial PK is not globally unique)
ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS
  sync_id UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_actions_sync_id
  ON agent_actions (sync_id);

-- 3. Trigger function — reads PK column from TG_ARGV[0]
CREATE OR REPLACE FUNCTION sync_capture_change() RETURNS trigger AS $$
DECLARE
  v_node_id TEXT;
  v_pk_col TEXT;
  v_row_id TEXT;
  v_payload JSONB;
  v_vclock JSONB;
  v_prev_vclock JSONB;
BEGIN
  IF current_setting('app.sync_applying', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_node_id := current_setting('app.node_id', true);
  IF v_node_id IS NULL OR v_node_id = '' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- PK column name passed as trigger argument
  v_pk_col := TG_ARGV[0];

  IF TG_OP = 'DELETE' THEN
    EXECUTE format('SELECT ($1).%I::text', v_pk_col) INTO v_row_id USING OLD;
    v_payload := NULL;
  ELSE
    EXECUTE format('SELECT ($1).%I::text', v_pk_col) INTO v_row_id USING NEW;
    v_payload := to_jsonb(NEW);
  END IF;

  -- Advisory lock to serialize concurrent vclock increments for the same row
  PERFORM pg_advisory_xact_lock(
    hashtextextended(TG_TABLE_NAME, 0),
    hashtextextended(v_row_id, 0)
  );

  SELECT vclock INTO v_prev_vclock
    FROM sync_change_log
    WHERE table_name = TG_TABLE_NAME AND row_id = v_row_id
    ORDER BY id DESC LIMIT 1;

  v_prev_vclock := COALESCE(v_prev_vclock, '{}'::jsonb);

  v_vclock := jsonb_set(
    v_prev_vclock,
    ARRAY[v_node_id],
    to_jsonb(COALESCE((v_prev_vclock->>v_node_id)::int, 0) + 1)
  );

  INSERT INTO sync_change_log (node_id, table_name, row_id, operation, payload, vclock)
  VALUES (v_node_id, TG_TABLE_NAME, v_row_id, TG_OP, v_payload, v_vclock);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 4. Attach triggers (DROP + CREATE for idempotency)
-- PK column name passed as argument

-- Append-only (PK = 'id')
DROP TRIGGER IF EXISTS sync_capture ON agent_runs;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON agent_runs FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON rc_sessions;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON rc_sessions FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON managed_sessions;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON managed_sessions FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON session_handoffs;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON session_handoffs FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON native_import_attempts;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON native_import_attempts FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON run_handoff_decisions;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON run_handoff_decisions FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

-- agent_actions uses sync_id (not bigserial id)
DROP TRIGGER IF EXISTS sync_capture ON agent_actions;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON agent_actions FOR EACH ROW EXECUTE FUNCTION sync_capture_change('sync_id');

-- Mutable (PK = 'id' unless noted)
DROP TRIGGER IF EXISTS sync_capture ON agents;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON agents FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON machines;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON machines FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON api_accounts;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON api_accounts FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON project_account_mappings;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON project_account_mappings FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

-- settings PK = 'key'
DROP TRIGGER IF EXISTS sync_capture ON settings;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON settings FOR EACH ROW EXECUTE FUNCTION sync_capture_change('key');

DROP TRIGGER IF EXISTS sync_capture ON runtime_config_revisions;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON runtime_config_revisions FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

-- memory_scopes PK = 'scope'
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
- [ ] **Step 4: Commit** `feat(mesh): add sync tables schema + trigger migration (drizzle/0021)`

---

### Task 4: Node Identity + Pool Integration

**Files:**
- Create: `packages/control-plane/src/sync/node-identity.ts`
- Create: `packages/control-plane/src/sync/node-identity.test.ts`
- Modify: `packages/control-plane/src/db/connection.ts`
- Modify: `packages/control-plane/src/index.ts` (pass nodeId to createDb)

- [ ] **Step 1: Write tests for getOrCreateNodeId** (same as v1 — 4 tests)
- [ ] **Step 2: Implement `getOrCreateNodeId` and `upsertSyncNode`** (same as v1)

- [ ] **Step 3: Modify `createDb` to accept `sessionNodeId` option**

In `packages/control-plane/src/db/connection.ts`, add to `CreateDbOptions`:
```typescript
/** Mesh node ID — set as app.node_id on every new pool connection for sync triggers. */
sessionNodeId?: string;
```

In `createDb`, after pool creation:
```typescript
if (options.sessionNodeId) {
  const nodeId = options.sessionNodeId.replace(/'/g, "''");
  pool.on('connect', (client) => {
    client.query(`SELECT set_config('app.node_id', '${nodeId}', false)`);
  });
}
```

- [ ] **Step 4: Wire nodeId in `index.ts` before `createDb`**

In `packages/control-plane/src/index.ts`, before the `createDb` call:
```typescript
import { getOrCreateNodeId, upsertSyncNode } from './sync/node-identity.js';

const agentctlConfigDir = process.env.AGENTCTL_CONFIG_DIR
  ?? path.join(process.env.HOME ?? '/tmp', '.agentctl');
const nodeId = getOrCreateNodeId(agentctlConfigDir);
logger.info({ nodeId }, 'Mesh node identity initialized');
```

Then pass `sessionNodeId: nodeId` to the `createDb` call.

After DB is created, upsert the node:
```typescript
try { await upsertSyncNode(db, nodeId, process.env.TAILSCALE_IP); } catch { /* sync tables may not exist */ }
```

- [ ] **Step 5: Run tests — expected PASS**
- [ ] **Step 6: Build control-plane**
- [ ] **Step 7: Commit** `feat(mesh): wire node identity into pool connect + startup`

---

### Task 5: Sync-Apply Transaction Helper (for P2)

**Files:**
- Create: `packages/control-plane/src/sync/apply-guard.ts`

- [ ] **Step 1: Create the helper**

```typescript
import { sql } from 'drizzle-orm';

import type { Database } from '../db/index.js';

/**
 * Execute a function within a transaction where sync triggers are disabled.
 * Used by P2 sync protocol to apply remote changes without re-triggering capture.
 * SET LOCAL scoping ensures the guard resets at transaction end even on error.
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

- [ ] **Step 2: Build + commit** `feat(mesh): add withSyncApplyGuard transaction helper for P2`

---

### Task 6: Cleanup Job

**Files:**
- Create: `packages/control-plane/src/sync/change-log-cleanup.ts`

- [ ] **Step 1: Create cleanup function** (same logic as v1)
- [ ] **Step 2: Register as BullMQ repeatable job**

In `packages/control-plane/src/index.ts` or the scheduler setup, add:
```typescript
await taskQueue.add('sync-cleanup', {}, {
  repeat: { pattern: '0 3 * * *' }, // daily at 3 AM
  removeOnComplete: true,
  removeOnFail: 5,
});
```

And handle in the task worker:
```typescript
if (job.name === 'sync-cleanup') {
  await cleanupSyncedChanges(db, logger);
  return;
}
```

- [ ] **Step 3: Build + commit** `feat(mesh): add daily sync change log cleanup job`

---

### Task 7: Push Branch + Create PR

- [ ] **Step 1: Push** `git push -u origin agent/claude/feat/mesh-p1-change-log`
- [ ] **Step 2: Create PR** with full summary referencing spec and Codex review rounds
