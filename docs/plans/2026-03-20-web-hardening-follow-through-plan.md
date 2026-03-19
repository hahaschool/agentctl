# Web Hardening Follow-through Plan

> Goal: turn the next web-regression backlog into three isolated follow-up slices that can run in parallel without taking on the higher-flake terminal/WebSocket surface in the same batch.
>
> Status note: section 24 is now delivered on `main` via PRs #299, #297, #298, and #301. This follow-through batch opens the next visible web-hardening slice for runtime sessions, the settings control center, and the shared permission-request contract boundary.

## Why This Batch

Section 24 closed the immediate `/approvals`, `/deployment`, and CD guardrail follow-ups on `main`. The remaining high-value web hardening is narrower and still user-visible:

- the runtime-session surface inside `/sessions?type=runtime`
- the runtime-centric settings control center at `/settings`
- the web/shared contract edge for permission-request data and actions

One adjacent candidate is intentionally deferred:

- machines / terminal e2e remains out of this batch because terminal/WebSocket coverage is a higher-flake surface than the list/detail/settings and contract paths below

## Parallel Workstreams

### Workstream A — runtime sessions Playwright coverage

**Goal**

Add a focused browser test for the runtime-session surface that proves the unified sessions page can render managed runtime rows, open a runtime detail view, and exercise one safe control path without depending on terminal/WebSocket streaming.

**Likely files**

- `packages/web/e2e/runtime-selector.spec.ts`
- `packages/web/src/views/RuntimeSessionsPage.tsx`
- `packages/web/src/views/RuntimeSessionPanel.tsx`

**Verification**

- Targeted Playwright run for the runtime-session spec only

### Workstream B — settings control center Playwright coverage

**Goal**

Add a focused browser test for `/settings` that covers the runtime control center shell, left-nav section jumps, and one representative operator interaction so the settings IA can change without losing end-to-end coverage.

**Likely files**

- `packages/web/e2e/*.spec.ts`
- `packages/web/src/views/SettingsView.tsx`
- `packages/web/src/views/settings/*.tsx`

**Verification**

- Targeted Playwright run for the new settings spec

### Workstream C — web/shared permission-request contract cleanup

**Goal**

Remove the remaining web-local permission-request type drift so the web API layer, query keys, and approval cards consume the shared contract directly, with only the smallest cleanup needed around UI-specific formatting.

**Likely files**

- `packages/shared/src/types/permission-request.ts`
- `packages/web/src/lib/api.ts`
- `packages/web/src/lib/queries.ts`
- `packages/web/src/components/PermissionRequestCard.tsx`
- `packages/web/src/app/approvals/page.tsx`

**Verification**

- Targeted web/shared unit coverage or typecheck only for the touched permission-request files

## Coordination Notes

- Keep each workstream in its own worktree and coordination-board claim.
- Current split is `codex-307` for runtime sessions, `codex-308` for settings control center, and `codex-309` for permission-request contract cleanup.
- Do not mix machines / terminal e2e into this batch; that follow-up should stay separate until the terminal/WebSocket surface is less flaky.
