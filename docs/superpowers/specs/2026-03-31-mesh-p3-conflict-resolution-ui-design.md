# Mesh P3: Conflict Resolution UI — Design Spec (v3)

**Date:** 2026-03-31 (revised after Codex cross-review)
**Parent:** §33 Mesh Architecture
**Depends on:** P2 (sync creates conflicts)

## Key Design Decision (from cross-review)

**Convergence guarantee:** Every resolution MUST write a merged vclock (element-wise max of local + remote) to `sync_change_log`. Without this, the same remote version will re-conflict on next sync.

---

## 1. Resolution Flow (convergence-safe)

### "Keep Local"

1. `PUT /api/sync/conflicts/:id/resolve` with `{ resolution: 'local' }`
2. Backend:
   - Compute merged clock: `vcMerge(localVclock, remoteVclock)`
   - Write new `sync_change_log` entry with merged clock, operation='UPDATE', payload=localPayload
   - Set conflict `status = 'resolved'`, `resolution = 'local'`, `resolved_at = now()`
3. The new sync_change_log entry with the merged clock will propagate to the remote peer on next sync, informing it that this version supersedes both.

### "Keep Remote"

1. Same endpoint with `{ resolution: 'remote' }`
2. Backend:
   - Apply remote payload to target table via `withSyncApplyGuard()`
   - Compute merged clock: `vcMerge(localVclock, remoteVclock)`
   - Write new `sync_change_log` entry with merged clock + remote payload
   - Set conflict resolved

### "Manual Merge"

1. Same endpoint with `{ resolution: 'merged', payload: {...} }`
2. Backend: same as "Keep Remote" but uses user-provided payload instead

## 2. Conflicts Page

Route: `/conflicts`

- Header with pending count badge
- Filter: by table, by peer, by status
- List: table name, row ID, both node IDs, created timestamp

## 3. Conflict Detail View

- Side-by-side JSON diff (local vs remote payload, fields highlighted)
- Vector clock display for debugging
- Actions: "Keep Local" | "Keep Remote" | "Edit & Merge"

### Delete Conflicts

When one side's payload is `null` (a DELETE), the UI shows:
- Left/Right panel: "Record deleted on {nodeName}" instead of JSON
- Actions: "Keep Deleted" (apply the delete locally) | "Restore" (keep the non-null payload)
- Both actions write merged vclock for convergence

## 4. Sidebar Badge

Red badge on "Conflicts" nav item showing pending count. Polled every 60s.

## 5. File Changes

Same as v1 plus convergence logic in the resolve endpoint.
