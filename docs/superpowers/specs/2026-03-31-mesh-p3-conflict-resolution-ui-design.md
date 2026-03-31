# Mesh P3: Conflict Resolution UI — Design Spec

**Date:** 2026-03-31
**Status:** Draft
**Parent:** §33 Mesh Architecture
**Depends on:** P2 (sync protocol creates conflicts)

## Goals

1. `/conflicts` page listing all pending conflicts
2. Side-by-side diff view showing local vs remote payload
3. Resolve actions: keep local, keep remote, or manual merge
4. Conflict count badge in sidebar navigation
5. Auto-resolve option for low-risk conflicts (e.g., lastHeartbeat-only changes)

## Non-Goals

- Three-way merge editor (too complex, diminishing returns)
- Automatic conflict resolution policies (future work)

---

## 1. Conflicts Page

Route: `/conflicts`

**Layout:**
- Header: "Sync Conflicts" with pending count badge
- Filter: by table, by peer, by status (pending/resolved)
- List view: table name, row ID, both node IDs, created timestamp, status

## 2. Conflict Detail

Click a conflict to see:
- **Left panel:** Local payload (JSON, syntax highlighted)
- **Right panel:** Remote payload (JSON, syntax highlighted)
- **Diff view:** Highlight fields that differ between local and remote
- **Vector clocks:** Show both clocks for debugging
- **Actions:** "Keep Local" | "Keep Remote" | "Resolve as Merged" (edit JSON manually)

## 3. Resolution Flow

When user clicks "Keep Local":
1. `PUT /api/sync/conflicts/:id/resolve` with `{ resolution: 'local' }`
2. Backend: set `status = 'resolved'`, `resolution = 'local'`, `resolved_at = now()`
3. No data change needed — local version is already in the table

When user clicks "Keep Remote":
1. Same endpoint with `{ resolution: 'remote' }`
2. Backend: apply remote payload to the target table using `withSyncApplyGuard()`
3. Update vclock to merged clock (element-wise max of both)

## 4. Sidebar Badge

The sidebar nav item "Conflicts" shows a red badge with the count of pending conflicts. Query: `SELECT count(*) FROM sync_conflicts WHERE status = 'pending'`.

Polled every 60s or pushed via SSE if available.

## 5. File Changes

| File | Change |
|------|--------|
| `packages/control-plane/src/api/routes/sync-conflicts.ts` | CRUD + resolve endpoint |
| `packages/web/src/views/ConflictsPage.tsx` | New page |
| `packages/web/src/components/ConflictDiffView.tsx` | Side-by-side JSON diff |
| `packages/web/src/app/conflicts/page.tsx` | Next.js route |
| `packages/web/src/components/Sidebar.tsx` | Add conflict badge |
