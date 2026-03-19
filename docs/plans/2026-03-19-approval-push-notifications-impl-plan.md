# Approval Push Notifications Implementation Plan

> Goal: execute roadmap `21.2 iOS Push Notifications for Pending Approvals` without disrupting the current beta workflow.

## Architecture

Use Expo Push Service as the first real iOS push transport. The control plane owns device registration + dispatch; the mobile app owns permission/token registration and tap routing into the shipped `Approvals` tab.

## Assumptions

- Current product scope is single-operator. Approval pushes can target all active registered devices.
- `21.1` inbox/operator surface remains the only landing UI.
- No workflow or CD changes are required beyond environment secrets/config for the control plane.

## Task 1: Extend shared contracts

**Files**

- Modify: `packages/shared/src/types/webhook.ts`
- Modify: `packages/shared/src/types/index.ts`
- Create: `packages/shared/src/types/mobile-push-device.ts`

**Work**

- Add `approval.pending` to the shared notification event surface.
- Add a shared `MobilePushDevice` type and any small request/response payload types needed by the control plane and mobile app.

**Verification**

- `pnpm --filter @agentctl/shared build`
- Focused shared tests if the event/type unions already have direct coverage.

## Task 2: Add control-plane device registry

**Files**

- Create migration for `mobile_push_devices`
- Create DB schema/store for mobile push devices
- Create `packages/control-plane/src/api/routes/mobile-push-devices.ts`
- Register the new route in the API server

**Work**

- Add an upsert route that records `userId`, `platform`, `provider`, `pushToken`, `appId`, and `lastSeenAt`.
- Add a deactivation path for invalidated tokens, either explicit or store-only.

**Verification**

- Focused Fastify route/store tests
- `pnpm --filter @agentctl/control-plane test -- ...mobile-push-devices...`

## Task 3: Add Expo push dispatcher in control plane

**Files**

- Create: `packages/control-plane/src/notifications/expo-push-dispatcher.ts`
- Modify: `packages/control-plane/src/intelligence/notification-router.ts`
- Modify: `packages/control-plane/src/api/routes/permission-requests.ts`

**Work**

- Implement Expo push message delivery with success / retryable / permanent-failure outcomes.
- On `POST /api/permission-requests`, dispatch an `approval.pending` notification after the DB write succeeds.
- On permanent invalid-token results, disable the device in the registry.

**Verification**

- Focused dispatcher unit tests
- Focused permission-request route tests proving push dispatch is invoked on create

## Task 4: Add mobile token registration bootstrap

**Files**

- Modify: `packages/mobile/package.json`
- Modify: `packages/mobile/app.json`
- Create: `packages/mobile/src/services/push-registration.ts`
- Modify: `packages/mobile/src/context/app-context.tsx`
- Modify: `packages/mobile/App.tsx`

**Work**

- Add Expo notification dependencies.
- Resolve the Expo/EAS `projectId`.
- Request notification permission and obtain an Expo push token.
- Upsert the device with the control plane when `baseUrl` and `authToken` are configured.

**Verification**

- Focused mobile service tests with mocked Expo APIs
- `pnpm --filter @agentctl/mobile build`

## Task 5: Add notification tap routing into Approvals

**Files**

- Modify: `packages/mobile/App.tsx`
- Modify: `packages/mobile/src/navigation/tab-navigator.tsx`
- Create small helper(s) for notification-response parsing if needed

**Work**

- Register the notification-response listener early.
- Route `approval.pending` / `route=approvals` payloads into the `Approvals` tab.
- Keep the route surface minimal (`agentctl://approvals`).

**Verification**

- Focused unit tests for notification-response parsing / route selection

## Task 6: Roadmap + operational follow-through

**Files**

- Modify: `docs/ROADMAP.md`
- Modify: `docs/plans/2026-03-19-approval-push-notifications-design.md`
- Modify: `docs/plans/2026-03-19-approval-push-notifications-impl-plan.md`

**Work**

- Mark `21.2` delivered only after:
  - mobile device registration is live
  - control-plane `approval.pending` push dispatch is live
  - tap routing reaches the `Approvals` inbox
- Document any required control-plane env vars / credentials for Expo push delivery.

**Verification**

- `git diff --check`
- Targeted lint/test/build commands only for touched packages

## Execution Notes

- Keep beta stable: do all work in `dev-*` or isolated worktrees only.
- Do not block on a broader auth/user model; current approval notifications are operator-scoped.
- Prefer focused verification over full-repo reruns.
