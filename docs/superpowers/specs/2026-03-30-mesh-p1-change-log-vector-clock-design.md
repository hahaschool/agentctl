# Mesh P1: Change Log + Vector Clock — Design Spec

**Date:** 2026-03-30
**Status:** Draft
**Parent:** Mesh Architecture (multi-master, offline-first, Tailscale peer sync)
**Scope:** P1 of 6 sub-projects — this spec covers only the change tracking foundation

## Context

AgentCTL is moving from hub-spoke (single control plane) to a mesh architecture where every machine (EC2, Mac Mini, laptop) runs a full CP + Worker and can operate independently offline. When nodes reconnect, they sync via application-layer change tracking over Tailscale HTTP.

This spec defines the **change log** and **vector clock** infrastructure that all subsequent sync sub-projects (P2-P6) build on.

## Goals

1. Track all data mutations across 16 synced tables via PostgreSQL triggers
2. Assign each mutation a vector clock for causal ordering and conflict detection
3. Establish node identity (persistent `nodeId` per machine)
4. Classify tables into append-only (auto-merge) vs mutable (conflict-detect)
5. Prevent sync-apply loops (remote writes don't re-trigger change capture)

## Non-Goals

- Sync protocol / API endpoints (P2)
- Conflict resolution UI (P3)
- Node discovery / peer registry (P4)
- Per-machine CP deployment (P5)
- ACL changes (P6)

---

## 1. Node Identity

Each agentctl instance uses its existing `machineId` (from `MACHINE_ID` env var or hostname) as the sync identity. **No separate nodeId** — unified with the worker registration system.

**Format:** Same as `machines.id` (e.g. `mac-local`, `ec2-worker-1`)

**Storage:**
- **Environment:** `MACHINE_ID` env var (already used by worker registration)
- **DB table:** `sync_nodes` — mirrors `machines.id`, extended with sync-specific fields

```sql
CREATE TABLE sync_nodes (
  id          TEXT PRIMARY KEY,            -- machineId (same as machines.id)
  hostname    TEXT NOT NULL,
  tailscale_ip TEXT,
  role        TEXT NOT NULL DEFAULT 'full', -- 'full' (CP+Worker) | 'worker-only'
  last_seen   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Application startup:** On boot, the CP reads `MACHINE_ID` (or generates from hostname). Sets the PostgreSQL session variable `app.node_id` to this value on every pool connection.

**Application startup:** On boot, the control plane reads `~/.agentctl/node-id`. If it doesn't exist, generates one, writes the file, and upserts into `sync_nodes`. Then sets the PostgreSQL session variable:

```sql
SET app.node_id = 'node-macbook-a1b2';
```

This session variable is read by the change capture trigger.

## 2. Table Classification

| Type | Tables | Sync Strategy | Conflict? |
|------|--------|---------------|-----------|
| **Append-only** | `agent_runs`, `agent_actions`, `rc_sessions`, `managed_sessions`, `session_handoffs`, `native_import_attempts`, `run_handoff_decisions` | Auto-merge: both sides' records kept, deduplicate by PK | Never (PK is UUID, unique per node) |
| **Mutable** | `agents`, `machines`, `api_accounts`, `project_account_mappings`, `settings`, `runtime_config_revisions`, `memory_scopes`, `memory_facts`, `memory_edges` | Vector clock comparison. Concurrent edits → conflict record | Yes — user resolves |
| **Local-only** | `machine_runtime_state`, `sync_change_log`, `sync_nodes`, `sync_conflicts` | Not synced | N/A |

**Total synced tables:** 16 (7 append-only + 9 mutable)

## 3. Change Log Table

```sql
CREATE TABLE sync_change_log (
  id          BIGSERIAL PRIMARY KEY,       -- local monotonic, used as cursor
  node_id     TEXT NOT NULL,               -- which node produced this change
  table_name  TEXT NOT NULL,
  row_id      TEXT NOT NULL,               -- PK of changed row (cast to text)
  operation   TEXT NOT NULL,               -- 'INSERT' | 'UPDATE' | 'DELETE'
  payload     JSONB,                       -- full row snapshot (null for DELETE)
  vclock      JSONB NOT NULL DEFAULT '{}', -- vector clock: {"node-a": 3, "node-b": 1}
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced      BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_change_log_unsynced
  ON sync_change_log (synced, created_at) WHERE synced = false;
CREATE INDEX idx_change_log_table_row
  ON sync_change_log (table_name, row_id);
```

**Design decisions:**
- `payload` is a **full row snapshot**, not a diff. Merge = apply latest snapshot. No need to replay incremental changes.
- `vclock` is JSONB: `{"node-macbook-a1b2": 5, "node-ec2-3f4d": 3}`. Each node increments only its own component.
- `synced` marks entries already pulled by all known peers. Used for incremental fetch and periodic cleanup.
- `id` (BIGSERIAL) is the `since` cursor for pull-based sync. Locally monotonic, not globally unique.

## 4. Conflict Table

For mutable tables, when sync detects concurrent edits (vector clocks are incomparable):

```sql
CREATE TABLE sync_conflicts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name   TEXT NOT NULL,
  row_id       TEXT NOT NULL,
  local_vclock JSONB NOT NULL,
  local_payload JSONB,
  remote_vclock JSONB NOT NULL,
  remote_payload JSONB,
  remote_node_id TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'resolved'
  resolution   TEXT,                            -- 'local' | 'remote' | 'merged'
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conflicts_pending ON sync_conflicts (status) WHERE status = 'pending';
```

## 5. Vector Clock Logic

### Type definition (TypeScript)

```typescript
/** Maps nodeId → logical counter */
export type VectorClock = Record<string, number>;

/** Returns true if a causally dominates b (a happened-after b) */
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

/** Merge two vector clocks (element-wise max) */
export function vcMerge(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };
  for (const [k, v] of Object.entries(b)) {
    result[k] = Math.max(result[k] ?? 0, v);
  }
  return result;
}

/** Compare: 'a_dominates' | 'b_dominates' | 'equal' | 'conflict' */
export function vcCompare(a: VectorClock, b: VectorClock): 'a_dominates' | 'b_dominates' | 'equal' | 'conflict' {
  if (vcDominates(a, b)) return 'a_dominates';
  if (vcDominates(b, a)) return 'b_dominates';
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const equal = [...allKeys].every(k => (a[k] ?? 0) === (b[k] ?? 0));
  return equal ? 'equal' : 'conflict';
}
```

### Write path (trigger)

On every INSERT/UPDATE/DELETE to a synced table:
1. Read the latest `vclock` for this `(table_name, row_id)` from `sync_change_log`
2. Increment `vclock[current_node_id] += 1`
3. Insert into `sync_change_log` with the new vclock

### Sync apply path (P2, but relevant here)

When applying a remote change:
1. Compare remote vclock vs local latest vclock for the same row
2. If remote dominates → apply directly, write to `sync_change_log` with remote vclock (merged)
3. If local dominates → skip (local is newer)
4. If equal → skip (already have it)
5. If conflict (incomparable) → insert into `sync_conflicts`, don't apply

## 6. Trigger Implementation

One generic trigger function for all synced tables:

```sql
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
```

### Attaching triggers to synced tables

```sql
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

## 7. Sync-Apply Guard

When applying remote changes, the application sets a session variable to prevent the trigger from re-capturing:

```typescript
async function applySyncChanges(db: Database, changes: ChangeLogEntry[]): Promise<void> {
  await db.execute(sql`SET LOCAL app.sync_applying = 'true'`);
  try {
    for (const change of changes) {
      // apply INSERT/UPDATE/DELETE to the target table
      // also insert into sync_change_log with the remote vclock (for tracking)
    }
  } finally {
    await db.execute(sql`RESET app.sync_applying`);
  }
}
```

The `SET LOCAL` scoping ensures the guard automatically resets at transaction end even if an error occurs.

## 8. Change Log Cleanup

Old synced entries should be pruned to prevent unbounded growth:

- **Retention policy:** Keep last 30 days of synced entries, keep all unsynced entries indefinitely
- **Cleanup job:** Runs daily (BullMQ scheduled job or PG cron)

```sql
DELETE FROM sync_change_log
  WHERE synced = true AND created_at < now() - INTERVAL '30 days';
```

## 9. File Changes Summary

| File | Change |
|------|--------|
| `packages/shared/src/types/vector-clock.ts` | New: `VectorClock` type, `vcDominates`, `vcMerge`, `vcCompare` |
| `packages/shared/src/vector-clock.test.ts` | New: unit tests for all VC operations |
| `packages/shared/src/types/sync.ts` | New: `ChangeLogEntry`, `SyncConflict`, `SyncNode`, `TableSyncType` |
| `packages/shared/src/types/index.ts` | Re-export new types |
| `packages/control-plane/src/db/schema.ts` | Add `syncChangeLog`, `syncConflicts`, `syncNodes` tables |
| `packages/control-plane/src/db/migrations/0005_mesh_change_log.sql` | Migration: tables + trigger function + all 16 trigger attachments |
| `packages/control-plane/src/sync/node-identity.ts` | New: `getOrCreateNodeId()`, `setSessionNodeId()` |
| `packages/control-plane/src/sync/node-identity.test.ts` | New: unit tests |
| `packages/control-plane/src/api/server.ts` | Call `setSessionNodeId()` on Fastify `onRequest` hook |

## 10. Testing

- **Unit:** `vcDominates`, `vcMerge`, `vcCompare` — exhaustive cases including empty clocks, single-node, multi-node, equal, dominates, conflict
- **Unit:** `getOrCreateNodeId` — creates file on first call, reads from file on second call
- **Integration:** Write to `agents` table → verify `sync_change_log` entry created with correct node_id, table_name, row_id, operation, payload, vclock
- **Integration:** Write twice → verify vclock increments correctly
- **Integration:** Set `app.sync_applying = 'true'` → write → verify NO change_log entry created
- **Integration:** Concurrent edits from two different node_ids → verify vcCompare returns 'conflict'
