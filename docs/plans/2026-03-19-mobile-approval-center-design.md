# Mobile Approval Center Design

> Scope: mobile follow-up for `17.4 Agent Permission Approval System`

## Goal

Give the mobile app a real operator surface for pending permission requests before attempting true iOS push delivery.

## Context

- The control plane already exposes `POST/GET/PATCH /api/permission-requests`.
- Web already shows pending approvals in `NotificationBell` and can resolve them.
- Mobile currently only renders raw `approval_needed` SSE lines inside a live agent stream. There is no inbox, badge, or resolve flow.
- Real iOS push is not ready yet because the repo has no device-token model, no Expo/APNs dependency, and no control-plane push dispatcher.

## Options Considered

### Option A — Build APNs / Expo push first

Pros:
- Directly targets the last unchecked roadmap bullet.

Cons:
- Requires new mobile dependency setup, token storage, push delivery service, and deployment secrets.
- Still leaves mobile without a dedicated approval queue UI.
- High risk of landing infra without a usable in-app review surface.

### Option B — Build the mobile approval inbox first

Pros:
- Uses already-shipped control-plane routes.
- Closes the current product gap: users can review and resolve approvals on mobile.
- Creates the natural destination for later push notification deep links.

Cons:
- Does not by itself satisfy true background push delivery.

### Option C — Add only a runtime badge and keep approval details hidden

Pros:
- Very small slice.

Cons:
- Still forces users back to web for the actual decision.
- Too weak for the user-visible gap in 17.4.

## Decision

Choose Option B.

Build a lightweight mobile approval center now, then treat iOS push/APNs as the last-mile infrastructure phase. This preserves momentum, reuses existing APIs, and gives push notifications a meaningful landing surface later.

## Chosen Design

### Surface

- Add a dedicated mobile `Approvals` tab.
- Show pending permission requests with:
  - agent label
  - tool name
  - sanitized tool input preview
  - countdown to timeout
  - Approve / Deny actions
- Keep polling-based freshness for now.

### Data Flow

1. Mobile polls `GET /api/permission-requests?status=pending`.
2. Presenter stores the current list and derives badge count.
3. User taps Approve or Deny.
4. Mobile calls `PATCH /api/permission-requests/:id`.
5. Presenter refreshes the list and badge state.

### Navigation

- Add a new bottom-tab entry so pending approvals are always one tap away.
- Reuse the tab badge to expose unresolved approval count.

### Non-goals for this slice

- Device token registration
- APNs / Expo push delivery
- Deep-link routing from push payloads
- Background notification guarantees

## Files Likely To Change

- `packages/mobile/src/services/api-client.ts`
- `packages/mobile/src/services/permission-request-api.ts`
- `packages/mobile/src/services/permission-request-api.test.ts`
- `packages/mobile/src/screens/pending-approvals-presenter.ts`
- `packages/mobile/src/screens/pending-approvals-presenter.test.ts`
- `packages/mobile/src/ui-screens/pending-approvals-screen.tsx`
- `packages/mobile/src/navigation/tab-navigator.tsx`
- `packages/mobile/src/navigation/runtime-tab-badge.ts`
- `packages/mobile/src/navigation/runtime-tab-badge.test.ts`

## Verification Strategy

- Focused mobile unit tests for the new API wrapper, presenter polling/resolve behavior, and badge calculation.
- `biome check` only on touched mobile files.
- No full-repo or device-level test sweep for this slice.
