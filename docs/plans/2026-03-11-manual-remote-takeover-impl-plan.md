# Manual Remote Takeover Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a narrow manual takeover surface that opens an existing Claude managed runtime session in `claude.ai/code` without changing AgentCTL's primary `claude -p` managed-session path.

**Architecture:** Reuse the existing `managed_sessions` row as the product identity and persist active takeover state under `metadata.manualTakeover`. Add dedicated worker + control-plane start/status/stop routes that manage a sidecar `RcSessionManager` process for an existing Claude native session. Surface the feature only in runtime-session detail UIs so it stays clearly separate from handoff and normal run control.

**Tech Stack:** TypeScript, Fastify, Drizzle, React, React Native, Vitest

---

### Task 1: Define the shared manual takeover contract

**Files:**
- Modify: `packages/shared/src/types/runtime-management.ts`
- Modify: `packages/shared/src/types/runtime-management.test.ts`
- Modify: `packages/shared/src/protocol/runtime-management.ts`
- Modify: `packages/shared/src/protocol/runtime-management.test.ts`

**Step 1: Write the failing test**

Add tests that define:

- `ManualTakeoverStatus`
- `ManualTakeoverPermissionMode`
- `ManualTakeoverState`
- `StartManualTakeoverRequest`
- `ManualTakeoverResponse`

Example contract to encode in tests:

```ts
const response: ManualTakeoverResponse = {
  ok: true,
  manualTakeover: {
    workerSessionId: 'rc-1',
    nativeSessionId: 'claude-session-1',
    projectPath: '/tmp/project',
    status: 'online',
    permissionMode: 'default',
    sessionUrl: 'https://claude.ai/code/session-123',
    startedAt: '2026-03-11T10:00:00.000Z',
    lastHeartbeat: '2026-03-11T10:00:10.000Z',
    lastVerifiedAt: '2026-03-11T10:00:10.000Z',
    error: null,
  },
};
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/shared test -- src/types/runtime-management.test.ts src/protocol/runtime-management.test.ts
```

Expected: FAIL because the new types and protocol payloads do not exist yet.

**Step 3: Write minimal implementation**

Add the shared types and request/response payloads in the two shared files. Keep the first slice Claude-only by documenting that the request is valid only for Claude runtime sessions.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/shared test -- src/types/runtime-management.test.ts src/protocol/runtime-management.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/types/runtime-management.ts packages/shared/src/types/runtime-management.test.ts packages/shared/src/protocol/runtime-management.ts packages/shared/src/protocol/runtime-management.test.ts
git commit -m "feat(shared): add manual takeover runtime contracts"
```

### Task 2: Add safe metadata patching for takeover state

**Files:**
- Modify: `packages/control-plane/src/runtime-management/managed-session-store.ts`
- Modify: `packages/control-plane/src/runtime-management/managed-session-store.test.ts`

**Step 1: Write the failing test**

Add tests proving that manual takeover metadata updates do not overwrite unrelated `managed_sessions.metadata` fields.

Example expectation:

```ts
expect(updated.metadata).toEqual({
  reason: 'manual',
  sourceRuntime: 'claude-code',
  manualTakeover: {
    status: 'online',
    workerSessionId: 'rc-1',
  },
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/runtime-management/managed-session-store.test.ts
```

Expected: FAIL because the current `updateStatus()` path overwrites metadata wholesale.

**Step 3: Write minimal implementation**

Add a metadata merge/patch capability, either by:

- introducing a dedicated `patchMetadata()` helper, or
- teaching `updateStatus()` to merge nested `manualTakeover` payloads safely.

Do not change the database schema; reuse the existing JSONB `metadata` column.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/runtime-management/managed-session-store.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/control-plane/src/runtime-management/managed-session-store.ts packages/control-plane/src/runtime-management/managed-session-store.test.ts
git commit -m "feat(control-plane): support merged manual takeover metadata"
```

### Task 3: Wire worker-side Remote Control lifecycle routes

**Files:**
- Modify: `packages/agent-worker/src/runtime/rc-session-manager.ts`
- Modify: `packages/agent-worker/src/runtime/rc-session-manager.test.ts`
- Create: `packages/agent-worker/src/api/routes/manual-takeover.ts`
- Create: `packages/agent-worker/src/api/routes/manual-takeover.test.ts`
- Modify: `packages/agent-worker/src/api/server.ts`
- Modify: `packages/agent-worker/src/api/server.test.ts`

**Step 1: Write the failing test**

Cover:

- start takeover for an existing Claude native session via `--resume <id> --remote-control`
- dedupe/reuse when an RC session already exists for the same native session or project path
- get status for an active RC session
- stop takeover and clear the worker-side session

Example route shape:

```ts
POST /api/runtime-sessions/:sessionId/manual-takeover
GET /api/runtime-sessions/:sessionId/manual-takeover
DELETE /api/runtime-sessions/:sessionId/manual-takeover
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/agent-worker test -- src/runtime/rc-session-manager.test.ts src/api/routes/manual-takeover.test.ts src/api/server.test.ts
```

Expected: FAIL because the worker routes and route registration do not exist yet.

**Step 3: Write minimal implementation**

Implement:

- `RcSessionManager` lookup/reuse by native session ID or project path
- worker route module that starts, reads, and stops RC sessions
- `api/server.ts` wiring for the new route and shared `RcSessionManager` instance

Do not register Remote Control as a `RuntimeAdapter`. This is a sidecar control surface, not a primary runtime.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/agent-worker test -- src/runtime/rc-session-manager.test.ts src/api/routes/manual-takeover.test.ts src/api/server.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent-worker/src/runtime/rc-session-manager.ts packages/agent-worker/src/runtime/rc-session-manager.test.ts packages/agent-worker/src/api/routes/manual-takeover.ts packages/agent-worker/src/api/routes/manual-takeover.test.ts packages/agent-worker/src/api/server.ts packages/agent-worker/src/api/server.test.ts
git commit -m "feat(worker): add manual remote takeover routes"
```

### Task 4: Add control-plane proxy and state synchronization

**Files:**
- Create: `packages/control-plane/src/api/routes/manual-takeover.ts`
- Create: `packages/control-plane/src/api/routes/manual-takeover.test.ts`
- Modify: `packages/control-plane/src/api/server.ts`
- Modify: `packages/control-plane/src/api/server.test.ts`
- Modify: `packages/control-plane/src/api/routes/runtime-sessions.test.ts` if shared helpers need updates

**Step 1: Write the failing test**

Cover:

- `POST /api/runtime-sessions/:id/manual-takeover` rejects non-Claude sessions
- `POST` proxies to the correct worker and stores `metadata.manualTakeover`
- `GET` reconciles stale state when the worker says the RC session is missing
- `DELETE` proxies revoke and persists terminal takeover state

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/manual-takeover.test.ts src/api/server.test.ts
```

Expected: FAIL because the control-plane routes do not exist yet.

**Step 3: Write minimal implementation**

Implement a dedicated control-plane route module under the `/api/runtime-sessions` prefix.

Rules:

- validate `runtime === 'claude-code'`
- validate `nativeSessionId` exists
- reuse `managedSessionStore` as the persistence source
- proxy to worker routes using the managed session's `machineId`
- store the returned takeover state under `metadata.manualTakeover`
- never log the full `sessionUrl`

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/manual-takeover.test.ts src/api/server.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/control-plane/src/api/routes/manual-takeover.ts packages/control-plane/src/api/routes/manual-takeover.test.ts packages/control-plane/src/api/server.ts packages/control-plane/src/api/server.test.ts
git commit -m "feat(control-plane): proxy manual remote takeover state"
```

### Task 5: Add the web operator entry point

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/api.test.ts`
- Modify: `packages/web/src/lib/queries.ts`
- Modify: `packages/web/src/lib/queries.test.ts`
- Modify: `packages/web/src/views/RuntimeSessionPanel.tsx`
- Create: `packages/web/src/views/RuntimeSessionPanel.test.tsx`

**Step 1: Write the failing test**

Cover:

- manual takeover section only renders for Claude runtime sessions
- start button requests a takeover and then shows `Open`, `Copy URL`, and `Revoke`
- existing handoff UI remains unchanged

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/web test -- src/lib/api.test.ts src/lib/queries.test.ts src/views/RuntimeSessionPanel.test.tsx
```

Expected: FAIL because the API helpers and UI section do not exist yet.

**Step 3: Write minimal implementation**

Add:

- API helpers for start/get/stop manual takeover
- query/mutation hooks
- a new `Manual Takeover` card in `RuntimeSessionPanel`

Guardrails:

- show it only for `claude-code`
- keep it separate from handoff controls
- do not expose the takeover URL in list views

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/web test -- src/lib/api.test.ts src/lib/queries.test.ts src/views/RuntimeSessionPanel.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/lib/api.test.ts packages/web/src/lib/queries.ts packages/web/src/lib/queries.test.ts packages/web/src/views/RuntimeSessionPanel.tsx packages/web/src/views/RuntimeSessionPanel.test.tsx
git commit -m "feat(web): add manual remote takeover controls"
```

### Task 6: Add the mobile runtime-session takeover entry

**Files:**
- Modify: `packages/mobile/src/services/runtime-session-api.ts`
- Modify: `packages/mobile/src/services/runtime-session-api.test.ts`
- Modify: `packages/mobile/src/screens/runtime-session-presenter.ts`
- Modify: `packages/mobile/src/screens/runtime-session-presenter.test.ts`
- Modify: `packages/mobile/src/ui-screens/runtime-session-screen.tsx`

**Step 1: Write the failing test**

Cover:

- service helpers call the new manual-takeover endpoints
- presenter loads and mutates takeover state
- the screen shows takeover state and revoke/start actions for Claude sessions

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/mobile test -- src/services/runtime-session-api.test.ts src/screens/runtime-session-presenter.test.ts
```

Expected: FAIL because the new service and presenter methods do not exist yet.

**Step 3: Write minimal implementation**

Add a minimal mobile entry:

- start takeover
- display current takeover status
- open/copy the session URL
- revoke takeover

If opening the URL in-app is awkward, prefer a copy/open-external-browser path and document that choice.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/mobile test -- src/services/runtime-session-api.test.ts src/screens/runtime-session-presenter.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/mobile/src/services/runtime-session-api.ts packages/mobile/src/services/runtime-session-api.test.ts packages/mobile/src/screens/runtime-session-presenter.ts packages/mobile/src/screens/runtime-session-presenter.test.ts packages/mobile/src/ui-screens/runtime-session-screen.tsx
git commit -m "feat(mobile): expose manual remote takeover state"
```

### Task 7: Verify the narrow manual takeover slice end-to-end

**Files:**
- Modify only if verification exposes issues

**Step 1: Run focused package tests**

Run:
```bash
pnpm --filter @agentctl/shared test -- src/types/runtime-management.test.ts src/protocol/runtime-management.test.ts
pnpm --filter @agentctl/control-plane test -- src/runtime-management/managed-session-store.test.ts src/api/routes/manual-takeover.test.ts src/api/server.test.ts
pnpm --filter @agentctl/agent-worker test -- src/runtime/rc-session-manager.test.ts src/api/routes/manual-takeover.test.ts src/api/server.test.ts
pnpm --filter @agentctl/web test -- src/lib/api.test.ts src/lib/queries.test.ts src/views/RuntimeSessionPanel.test.tsx
pnpm --filter @agentctl/mobile test -- src/services/runtime-session-api.test.ts src/screens/runtime-session-presenter.test.ts
```

Expected: PASS.

**Step 2: Run broader build verification**

Run:
```bash
pnpm --filter @agentctl/control-plane build
pnpm --filter @agentctl/agent-worker build
pnpm --filter @agentctl/web build
pnpm --filter @agentctl/mobile build
```

Expected: PASS.

**Step 3: Manual QA**

Verify:

- a Claude runtime session can start a manual takeover
- the returned `sessionUrl` is visible only in the dedicated detail view
- revoke cleans up worker state and persisted metadata
- handoff controls still behave exactly as before
- no loop/scheduler code path changed

**Step 4: Commit**

```bash
git add packages/shared packages/control-plane packages/agent-worker packages/web packages/mobile
git commit -m "feat: add narrow manual remote takeover surface"
```
