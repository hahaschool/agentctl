# Mesh P3: Conflict Resolution UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a /conflicts page where users can view and resolve sync conflicts (keep local, keep remote, or manual merge) with convergence-safe vclock handling.

**Architecture:** Backend CRUD + resolve endpoint on sync_conflicts. Frontend page with list view, detail modal with side-by-side JSON diff, resolve actions. Every resolution writes a merged vclock to sync_change_log for convergence.

**Tech Stack:** Fastify (routes), React + TanStack Query (frontend), Vitest

**Spec:** `docs/superpowers/specs/2026-03-31-mesh-p3-conflict-resolution-ui-design.md` (v3)
**Depends on:** P2 (sync creates conflicts)

---

### Task 1: Conflict Resolution API

**Files:**
- Create: `packages/control-plane/src/api/routes/sync-conflicts.ts`
- Modify: `packages/control-plane/src/api/server.ts`

- [ ] **Step 1: Create route plugin**

Endpoints:
- `GET /api/sync/conflicts` — list conflicts with optional `?status=pending&table=agents` filters
- `GET /api/sync/conflicts/:id` — get single conflict detail
- `PUT /api/sync/conflicts/:id/resolve` — resolve conflict

Resolve handler:
```typescript
// Body: { resolution: 'local' | 'remote' | 'merged', payload?: Record<string, unknown> }
// 1. Fetch conflict from DB
// 2. Compute mergedVclock = vcMerge(localVclock, remoteVclock)
// 3. If 'remote' or 'merged': apply payload via withSyncApplyGuard
// 4. Write new sync_change_log entry with mergedVclock
// 5. Mark conflict as resolved
```

For DELETE conflicts (one side's payload is null):
- `resolution: 'local'` with null local payload = keep deleted
- `resolution: 'remote'` with non-null remote payload = restore the row

- [ ] **Step 2: Register routes, build, commit**

---

### Task 2: Conflicts Page + Components

**Files:**
- Create: `packages/web/src/app/conflicts/page.tsx`
- Create: `packages/web/src/views/ConflictsPage.tsx`
- Create: `packages/web/src/components/ConflictDiffView.tsx`
- Modify: `packages/web/src/components/Sidebar.tsx` (add badge)
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/queries.ts`

- [ ] **Step 1: Add API methods** — listConflicts, getConflict, resolveConflict
- [ ] **Step 2: Create ConflictsPage** — list view with status/table filters
- [ ] **Step 3: Create ConflictDiffView** — side-by-side JSON with field-level diff highlighting. For delete conflicts, show "Record deleted on {node}" message.
- [ ] **Step 4: Add sidebar badge** — pending conflict count, polled every 60s
- [ ] **Step 5: Build all, commit**

---

### Task 3: Push + PR

```bash
git push -u origin agent/claude/feat/mesh-p3-conflict-ui
gh pr create --base main --title "feat(mesh): P3 — conflict resolution UI (§33.3)"
```
