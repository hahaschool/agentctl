# Approval Push Notifications Design

> Scope: roadmap `21.2 iOS Push Notifications for Pending Approvals`

## Goal

Add true background push delivery for pending permission approvals on iOS, with a tap path that lands the operator in the existing mobile `Approvals` inbox.

## Constraints

- `21.1` already shipped the mobile approval inbox, badge, and resolve flow in-app.
- The mobile app currently has no `expo-notifications` dependency, no device-token lifecycle, and no notification response listener.
- The control plane already models notification channels with a `push` channel, but the router currently only logs push intent; there is no device registry or dispatcher.
- The current product behaves like a single-operator system. Control-plane auth records auth method/key suffix, but it does not resolve a durable user identity that can safely own approval notifications.
- Beta promotion is manually gated. This slice must not change the existing `dev-* -> beta` workflow or auto-promote anything.

## Relevant Existing Pieces

- Mobile app scheme already exists: `agentctl://...` in `packages/mobile/app.json`.
- Mobile approval inbox already exists: `packages/mobile/src/ui-screens/pending-approvals-screen.tsx`.
- Control plane already persists pending approvals: `packages/control-plane/src/api/routes/permission-requests.ts`.
- Notification routing priorities already classify `approval.pending` as `high`: `packages/control-plane/src/intelligence/notification-router.ts`.
- Notification preferences already include a `push` channel in shared types: `packages/shared/src/types/intelligence.ts`.

## External Requirements

Based on current Expo documentation:

- iOS push delivery is best added through Expo Push Service for this codebase, not direct APNs, because the app already uses Expo and needs a server-side relay anyway.
- `getExpoPushTokenAsync()` should be called with the Expo/EAS `projectId`.
- Notification-response listeners on iOS should be registered early so taps from a terminated app are not missed.

## Options Considered

### Option A — Direct APNs tokens + APNs provider

Pros:
- Lowest long-term vendor abstraction.

Cons:
- Requires APNs key management, direct provider implementation, and more platform-specific setup immediately.
- Overkill for a single Expo-based app at this stage.

### Option B — Expo Push Service relay via control plane

Pros:
- Fits the existing Expo app shell.
- Keeps the required relay server inside the control plane.
- Gives us one consistent payload format and a smaller first implementation.

Cons:
- Adds Expo-specific provider coupling.
- Still needs token storage and delivery retry/error handling.

### Option C — Keep foreground SSE / polling only

Pros:
- No server-side delivery infra.

Cons:
- Does not solve the actual background-alerting gap.
- iOS can kill background sockets, so this does not satisfy `21.2`.

## Decision

Choose **Option B**.

Implement an Expo Push Service relay inside the control plane, backed by a small device registry and an early mobile notification bootstrap. Keep the current system explicitly **single-operator scoped** for this slice: approval-pending pushes may target all registered active devices until a durable user model lands.

## Chosen Design

### 1. Shared Contracts

- Extend shared notification event types to include `approval.pending`.
- Add a shared `MobilePushDevice` type for API/store responses.
- Keep `NotificationChannel = 'push'` as-is; do not add a second mobile-specific channel.

### 2. Control-Plane Device Registry

Add a new `mobile_push_devices` table with:

- `id`
- `user_id`
- `platform` (`ios`)
- `provider` (`expo`)
- `push_token`
- `app_id` / bundle identifier
- `last_seen_at`
- `disabled_at`
- `created_at`
- `updated_at`

Rules:

- Upsert on `(provider, push_token)` or another stable unique key.
- Mark tokens inactive on delivery failures that Expo reports as permanently invalid.
- Store `user_id`, but treat it as an operator label for now rather than a secure multi-user claim.

### 3. Control-Plane Push Dispatch

Add an `ExpoPushDispatcher` service:

- Input: event type + payload + device list
- Output: delivery results with success / permanent failure / retryable failure

Hook it into permission-request creation:

1. `POST /api/permission-requests` persists the pending request.
2. After persistence, the control plane resolves active iOS Expo devices.
3. It sends a notification message with:
   - title/body for the approval request
   - `data.type = 'approval.pending'`
   - `data.requestId`
   - `data.route = 'approvals'`

For this slice, route to **all active registered devices**. That matches the current single-operator product behavior and avoids inventing a fake ownership model inside `permission_requests`.

### 4. Mobile Registration + Tap Handling

Add a mobile bootstrap service that:

- Requests notification permission
- Resolves the Expo `projectId`
- Obtains an Expo push token
- Registers/upserts that token with the control plane

Add early notification-response handling:

- Register a response listener near app startup
- When payload `data.route === 'approvals'`, navigate to the `Approvals` tab
- Keep the deep-link surface minimal: `agentctl://approvals`

### 5. Preference Behavior

Current notification preferences already model `push`, but approval requests do not currently carry a reliable target user. For `21.2`:

- Do **not** block the first slice on a broader auth/user project.
- Route approval-pending pushes to all active devices.
- Leave per-user push preference enforcement as a later follow-up once notification targets can be resolved correctly.

## Non-Goals

- Android push delivery
- Direct APNs provider implementation
- Background JavaScript processing for approval decisions
- Solving multi-user auth / identity ownership for approvals
- Notification settings UI changes on mobile

## Risks

- Expo push token registration depends on a valid Expo/EAS project configuration and iOS credentials.
- Push delivery can fail permanently for stale tokens; the control plane must prune them.
- Early listener registration is easy to get wrong on iOS, especially for cold-start taps.
- The temporary single-operator routing model is correct for current product shape but not for future multi-user tenancy.

## Files Likely To Change

- `packages/shared/src/types/webhook.ts`
- `packages/shared/src/types/index.ts`
- `packages/control-plane/drizzle/*mobile_push_devices*.sql`
- `packages/control-plane/src/db/*mobile-push-devices*.ts`
- `packages/control-plane/src/api/routes/*mobile-push-devices*.ts`
- `packages/control-plane/src/notifications/expo-push-dispatcher.ts`
- `packages/control-plane/src/api/routes/permission-requests.ts`
- `packages/mobile/package.json`
- `packages/mobile/app.json`
- `packages/mobile/App.tsx`
- `packages/mobile/src/context/app-context.tsx`
- `packages/mobile/src/navigation/tab-navigator.tsx`
- `packages/mobile/src/services/*push*.ts`

## Verification Strategy

- Focused control-plane tests for the new device route/store and approval-triggered push dispatch.
- Focused mobile tests for token registration bootstrap and approval-route tap handling.
- No full device-lab / E2E sweep in the first slice.
