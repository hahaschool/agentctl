# Mesh P2: Sync Protocol + API — Design Spec (v3)

**Date:** 2026-03-31 (revised after Codex cross-review)
**Parent:** §33 Mesh Architecture
**Depends on:** P1 (change log), P4 (peer registry + auth + cursors)

## Key Design Decisions (from cross-review)

1. **Directional cursors:** `sync_peer_cursors.pulled_cursor` / `acked_cursor` (from P4), not a single `sync_cursor`
2. **Revised table classification:** `agent_runs`, `rc_sessions`, `managed_sessions` are MUTABLE (they receive status updates). Only truly insert-only tables are append-only.
3. **Advisory locks during apply:** Same `hashtext(table:row)::bigint` pattern from P1 triggers
4. **Peer auth:** Signed request envelope verified via Ed25519 public key (from P4)
5. **Non-`id` PKs:** Apply logic uses `TABLE_PK_COLUMN` mapping from P1 shared types
6. **api_accounts excluded:** Credentials are local-only (decided in P4 v2)

## Revised Table Classification

| Type | Tables | Count |
|------|--------|-------|
| **Append-only** | `agent_actions`, `session_handoffs`, `native_import_attempts`, `run_handoff_decisions` | 4 |
| **Mutable** | `agents`, `machines`, `agent_runs`, `rc_sessions`, `managed_sessions`, `project_account_mappings`, `settings`, `runtime_config_revisions`, `memory_scopes`, `memory_facts`, `memory_edges` | 11 |
| **Local-only** | `machine_runtime_state`, `api_accounts`, `sync_change_log`, `sync_nodes`, `sync_conflicts`, `sync_peer_cursors` | 6 |

**Total synced: 15** (4 append-only + 11 mutable). `api_accounts` is local-only (encrypted credentials don't auto-replicate).

---

## 1. Sync API Endpoints

### `GET /api/sync/changes`

Pull changes from this node. **Requires signed request (P4 peer auth).**

Query params: `since` (cursor), `limit` (default 500, max 5000)

**Auth:** Signed envelope in `X-Sync-Auth` header: `base64({ machineId, method, path, bodyHash, issuedAt, nonce, signature })`. For GET requests, `bodyHash` is empty string hash.

Response:
```typescript
{
  changes: ChangeLogEntry[];
  cursor: number;        // last entry id
  hasMore: boolean;
}
```

### `POST /api/sync/ack`

Acknowledge cursor. **Requires signed request.**

Body: `{ machineId: string; cursor: number }`

Updates `sync_peer_cursors.acked_cursor` for the calling peer.

## 2. Sync Loop

Per reachable peer, at `sync_interval_ms`:

```
cursor = sync_peer_cursors.pulled_cursor for this peer

loop:
  GET peer.sync_url/api/sync/changes?since=cursor&limit=500
    (signed with local key)

  for each change in response.changes:
    applyChange(change)   // inside advisory lock + withSyncApplyGuard tx

  cursor = response.cursor
  UPDATE sync_peer_cursors SET pulled_cursor = cursor

  POST peer.sync_url/api/sync/ack { machineId: self, cursor }

  if !response.hasMore: break
```

**Batch failure rule:** If any change in a batch fails to apply, stop processing, record error, and retry the batch from the last successful cursor on next interval.

## 3. Apply Logic

### Append-Only

```
1. Check if row exists by PK (using TABLE_PK_COLUMN mapping)
2. If exists → skip
3. If not → INSERT inside withSyncApplyGuard() transaction
4. Write remote change to local sync_change_log with remote vclock
```

### Mutable

```
1. Acquire advisory lock: pg_advisory_xact_lock(hashtext(table:rowId)::bigint)
2. Read latest local vclock from sync_change_log
3. vcCompare(remote, local):
   - a_dominates → remote is newer, apply (UPSERT inside withSyncApplyGuard)
   - b_dominates → local is newer, skip
   - equal → skip (already have it)
   - conflict → INSERT into sync_conflicts, do NOT apply
4. If applied, write merged vclock (vcMerge) to local sync_change_log
```

### DELETE handling

For `operation = 'DELETE'`:
- Append-only: skip (deletes don't happen on these tables)
- Mutable: same vclock comparison. If remote dominates, DELETE the row inside withSyncApplyGuard

## 4. Synced Marker

An entry is safe to mark `synced = true` when ALL known peers have ACKed past it:

```sql
UPDATE sync_change_log SET synced = true
  WHERE id <= (
    SELECT COALESCE(MIN(acked_cursor), 0)
    FROM sync_peer_cursors
    WHERE local_node_id = {selfId}
  )
  AND synced = false;
```

## 5. Catch-Up on Reconnect

When P4 health check detects `unreachable → reachable`:
1. Reset `sync_interval_ms` to 30000
2. Immediately trigger sync loop (don't wait for interval)
3. Pagination handles large catch-ups (500 per batch)

## 6. File Changes

| File | Change |
|------|--------|
| `packages/control-plane/src/api/routes/sync.ts` | GET /changes, POST /ack (with auth middleware) |
| `packages/control-plane/src/sync/sync-loop.ts` | Per-peer loop with cursor management |
| `packages/control-plane/src/sync/apply-change.ts` | applyAppendOnly, applyMutable, applyDelete |
| `packages/control-plane/src/sync/apply-guard.ts` | Already exists from P1 |
| `packages/shared/src/types/sync.ts` | Update TABLE_SYNC_CONFIG with revised classification |
| `packages/control-plane/src/api/server.ts` | Register sync routes |

## 7. Testing

- **Unit:** applyAppendOnly skip/insert, applyMutable dominate/skip/conflict, DELETE handling
- **Unit:** Cursor advancement, batch failure rules
- **Integration:** Two-DB sync simulation, conflict detection
