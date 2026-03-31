# Mesh P2: Sync Protocol + API — Design Spec

**Date:** 2026-03-31
**Status:** Draft
**Parent:** §33 Mesh Architecture
**Depends on:** P1 (change log + vector clock), P4 (peer registry)

## Context

P1 captures all data mutations into `sync_change_log` with vector clocks. P4 establishes peer discovery and health checking. P2 implements the actual sync protocol: pulling changes from peers, applying them locally, handling conflicts for mutable tables, and auto-merging append-only data.

## Goals

1. Pull-based sync: each node pulls changes from each reachable peer
2. Append-only tables: auto-merge by PK deduplication (no conflicts possible)
3. Mutable tables: vector clock comparison → apply if remote dominates, conflict if concurrent
4. Idempotent: re-pulling the same changes is safe (deduplicated by table+rowId+vclock)
5. Cursor-based incremental sync: each peer tracks `sync_cursor` (last pulled change_log.id)

## Non-Goals

- Push-based real-time sync (pull is sufficient for this fleet)
- Conflict resolution (P3 — this spec just detects and records conflicts)
- Schema migrations across nodes (all nodes must be on same version)

---

## 1. Sync API Endpoints (on every mesh node)

### `GET /api/sync/changes`

Called by a remote peer to pull changes from this node.

**Query params:**
- `since` (required): `change_log.id` cursor — return changes with `id > since`
- `limit` (optional, default 500, max 5000): batch size

**Response:**
```typescript
{
  changes: ChangeLogEntry[];   // ordered by id ASC
  cursor: number;              // id of the last entry returned (for next pull)
  hasMore: boolean;            // true if more changes exist beyond this batch
}
```

**Security:** Only accessible from Tailscale network (checked via request IP or auth token).

### `POST /api/sync/ack`

Called by a remote peer to acknowledge they've processed changes up to a cursor.

**Body:** `{ nodeId: string; cursor: number }`

Updates `sync_nodes.sync_cursor` for the calling peer so the source knows what's been pulled. Used by cleanup to determine when entries are fully synced.

## 2. Sync Loop (per peer)

Each node runs a sync loop per reachable peer:

```
every sync_interval_ms:
  if peer.sync_status != 'reachable': skip

  cursor = peer.sync_cursor  (last processed id)

  loop:
    response = GET peer.sync_url/api/sync/changes?since=cursor&limit=500

    for each change in response.changes:
      apply_change(change)

    cursor = response.cursor
    POST peer.sync_url/api/sync/ack { nodeId: self, cursor }
    update local sync_nodes.sync_cursor = cursor

    if !response.hasMore: break
```

## 3. Change Application Logic

```typescript
async function applyChange(change: ChangeLogEntry, db: Database): Promise<void> {
  const tableType = TABLE_SYNC_CONFIG[change.tableName];

  if (tableType === 'append-only') {
    return applyAppendOnly(change, db);
  }

  if (tableType === 'mutable') {
    return applyMutable(change, db);
  }

  // local-only: skip
}
```

### Append-Only Apply

```
1. Check if row with this PK already exists in the target table
2. If exists → skip (already synced or created locally)
3. If not exists → INSERT using withSyncApplyGuard() to suppress triggers
4. Write to local sync_change_log with the remote vclock (for tracking)
```

No conflict is possible — UUIDs are globally unique.

### Mutable Apply

```
1. Get latest local vclock for (tableName, rowId) from sync_change_log
2. Compare remote vclock vs local vclock using vcCompare():
   - 'b_dominates' (remote is newer) → apply change via withSyncApplyGuard()
   - 'a_dominates' (local is newer) → skip
   - 'equal' → skip (already have this version)
   - 'conflict' → INSERT into sync_conflicts, do NOT apply
3. If applied, write merged vclock to local sync_change_log
```

## 4. Marking Entries as Synced

After a peer ACKs a cursor, the source node can mark those entries:

```sql
UPDATE sync_change_log SET synced = true
  WHERE id <= {acked_cursor}
  AND synced = false;
```

An entry is only safe to delete (by cleanup job) when ALL peers have ACKed past it. The cleanup job in P1 already handles this by only deleting `synced = true` entries older than 30 days.

For multi-peer: `synced` should only be set to `true` when ALL peers have ACKed. Track per-peer cursors in `sync_nodes.sync_cursor` and compute the minimum:

```sql
UPDATE sync_change_log SET synced = true
  WHERE id <= (SELECT MIN(sync_cursor) FROM sync_nodes WHERE NOT is_self AND sync_status != 'unknown')
  AND synced = false;
```

## 5. Catch-Up on Reconnect

When a peer transitions from `unreachable` → `reachable` (detected by P4 health check):
1. Reset `sync_interval_ms` to 30000
2. Immediately trigger a full sync loop (don't wait for next interval)
3. The cursor-based protocol handles catch-up naturally — it pulls all changes since the last known cursor

For a laptop that was offline for days, the first sync may pull thousands of entries. The `limit=500` pagination prevents memory issues.

## 6. File Changes

| File | Change |
|------|--------|
| `packages/control-plane/src/api/routes/sync.ts` | New: `GET /changes`, `POST /ack` |
| `packages/control-plane/src/sync/sync-loop.ts` | New: per-peer sync loop with cursor management |
| `packages/control-plane/src/sync/apply-change.ts` | New: applyAppendOnly, applyMutable |
| `packages/control-plane/src/sync/apply-guard.ts` | Already exists from P1 |
| `packages/control-plane/src/api/server.ts` | Register sync routes |
| `packages/control-plane/src/index.ts` | Start sync loops for each peer |

## 7. Testing

- **Unit:** applyAppendOnly — skip existing, insert new
- **Unit:** applyMutable — dominates apply, dominated skip, conflict record
- **Unit:** cursor management — increment, hasMore pagination
- **Integration:** Two-node sync simulation — insert on node A, pull from node B, verify data appears
- **Integration:** Conflict detection — concurrent edit on both nodes, verify sync_conflicts entry
