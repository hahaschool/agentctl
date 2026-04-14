# Webhook Deliveries Retry E2E Plan

Status: In progress in PR #488 on 2026-04-14
Owner: Codex
Roadmap: §16.1, §20.5, §20.9

## Context

PR #467 shipped the webhook delivery-history UI over `GET /api/webhooks/:id/deliveries`, PR #475 added browser coverage for loading, populated, empty/error, and expanded-row paths, and PR #445 moved the backend-independent `/webhooks` slice into CI.

The remaining browser gap is the operator recovery path after the delivery-list request exhausts React Query's automatic retry budget. The UI already exposes an error state and manual **Retry** action; this plan adds a focused regression so that behavior stays covered without requiring a live control plane.

## Scope

- Add one Playwright scenario in `packages/web/e2e/webhook-deliveries.spec.ts`.
- Reuse the existing `/api/webhooks/:id/deliveries` mock route and make failure count explicit per webhook id.
- Cover the production retry budget by returning three failed GET responses before the manual retry succeeds.
- Avoid production code changes unless the test exposes a real UI bug.

## Acceptance Criteria

- Opening deliveries for the retry fixture issues three failed delivery-list GET requests.
- The delivery-list error state shows the backend message `Delivery history unavailable`.
- Clicking **Retry** sends another GET request and renders the recovered delivery row.
- The recovered row shows the expected event, failed status, HTTP status, and attempt count.
- Focused Playwright, lint, and diff-check verification pass before PR handoff.

## Verification

Planned commands:

```bash
WEB_PORT=5385 pnpm --filter @agentctl/web exec playwright test e2e/webhook-deliveries.spec.ts
pnpm lint
git diff --check
```
