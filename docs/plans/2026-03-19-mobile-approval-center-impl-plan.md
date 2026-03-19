# Mobile Approval Center Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a mobile approval inbox so users can review and resolve pending permission requests from the app, and expose the unresolved count in navigation.

**Architecture:** Reuse the existing control-plane `permission-requests` API. Add a small mobile API wrapper, a polling presenter, a dedicated approval screen, and tab-badge plumbing. Leave APNs / Expo push delivery for a later slice.

**Tech Stack:** TypeScript, React Native, Expo app shell, Vitest

---

### Task 1: Add mobile permission-request API wrapper

**Files:**
- Create: `packages/mobile/src/services/permission-request-api.ts`
- Create: `packages/mobile/src/services/permission-request-api.test.ts`

**Step 1: Write the failing tests**

Cover:
- list pending requests with `status=pending`
- resolve a request with `approved`
- reject empty IDs or invalid input

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentctl/mobile test -- src/services/permission-request-api.test.ts`

**Step 3: Write minimal implementation**

- Add typed helpers for:
  - `listRequests({ status, agentId, sessionId })`
  - `resolveRequest(id, decision)`

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agentctl/mobile test -- src/services/permission-request-api.test.ts`

**Step 5: Commit**

```bash
git commit -m "feat(mobile): add permission request api client"
```

### Task 2: Add polling presenter for pending approvals

**Files:**
- Create: `packages/mobile/src/screens/pending-approvals-presenter.ts`
- Create: `packages/mobile/src/screens/pending-approvals-presenter.test.ts`

**Step 1: Write the failing tests**

Cover:
- initial empty state
- loads pending requests
- approve/deny refreshes list
- polling refresh updates badge count
- network errors populate presenter error state

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentctl/mobile test -- src/screens/pending-approvals-presenter.test.ts`

**Step 3: Write minimal implementation**

- Presenter state:
  - `requests`
  - `pendingCount`
  - `isLoading`
  - `isResolving`
  - `error`
  - `lastUpdated`
- Poll every 15-30 seconds.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agentctl/mobile test -- src/screens/pending-approvals-presenter.test.ts`

**Step 5: Commit**

```bash
git commit -m "feat(mobile): add pending approvals presenter"
```

### Task 3: Add the mobile Approvals screen

**Files:**
- Create: `packages/mobile/src/ui-screens/pending-approvals-screen.tsx`

**Step 1: Implement the screen**

- Render:
  - empty state
  - loading state
  - error banner
  - list of pending requests
  - approve / deny buttons
  - timeout text
  - pull-to-refresh

**Step 2: Wire it to the presenter**

- Create presenter instance in `useEffect`
- Refresh after successful resolve

**Step 3: Verify via targeted tests or presenter-backed behavior**

Run: `pnpm --filter @agentctl/mobile test -- src/screens/pending-approvals-presenter.test.ts src/services/permission-request-api.test.ts`

**Step 4: Commit**

```bash
git commit -m "feat(mobile): add approvals inbox screen"
```

### Task 4: Expose badge and navigation entry

**Files:**
- Modify: `packages/mobile/src/navigation/tab-navigator.tsx`
- Modify: `packages/mobile/src/navigation/runtime-tab-badge.ts`
- Modify: `packages/mobile/src/navigation/runtime-tab-badge.test.ts`
- Modify: `packages/mobile/src/services/api-client.ts`

**Step 1: Expand badge calculation**

- Include pending approval count in the navigation badge helper.

**Step 2: Add the `Approvals` tab**

- Route it to `PendingApprovalsScreen`
- Show badge count when pending approvals exist

**Step 3: Verify**

Run: `pnpm --filter @agentctl/mobile test -- src/navigation/runtime-tab-badge.test.ts src/screens/pending-approvals-presenter.test.ts src/services/permission-request-api.test.ts`

**Step 4: Commit**

```bash
git commit -m "feat(mobile): surface approval count in navigation"
```

### Task 5: Final verification and roadmap sync

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/plans/2026-03-19-mobile-approval-center-design.md`
- Modify: `docs/plans/2026-03-19-mobile-approval-center-impl-plan.md`

**Step 1: Run focused verification**

```bash
pnpm --filter @agentctl/mobile test -- \
  src/services/permission-request-api.test.ts \
  src/screens/pending-approvals-presenter.test.ts \
  src/navigation/runtime-tab-badge.test.ts
pnpm --filter @agentctl/mobile lint
```

**Step 2: Run diff sanity check**

```bash
git diff --check
```

**Step 3: Update roadmap status**

- Mark delivered subitems that landed in this slice.
- Keep `21.2` push/APNs work open.

**Step 4: Commit**

```bash
git commit -m "docs: sync mobile approval follow-up roadmap"
```
