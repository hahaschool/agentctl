# Task Auto-Decompose Apply-Failure E2E Plan

Status: Delivered in PR #487 on 2026-04-14
Owner: Codex
Roadmap: §10.5, §20.5

## Context

PR #474 shipped the `/tasks/[id]` auto-decompose action over `POST /api/decompose/preview` and `POST /api/decompose`. PR #478 added backend-independent Playwright coverage for the two-step preview/apply flow and the stale-preview guard, but the apply-failure path was still only represented by the mock plumbing.

The UI already renders `data-testid="auto-decompose-apply-error"` when the apply mutation fails. The missing coverage is a browser-level regression that proves a failed `POST /api/decompose` keeps the dialog open, preserves the generated preview, and allows the operator to try applying again.

## Scope

- Add one focused Playwright scenario in `packages/web/e2e/task-auto-decompose.spec.ts`.
- Reuse the existing mocked `applyMode: 'error'` branch.
- Avoid production code changes unless the test exposes a real UI bug.
- Keep CI/CD workflows untouched so this lane does not overlap active workflow/security claims.

## Acceptance Criteria

- A valid preview is created before apply.
- The apply request hits `POST /api/decompose` exactly once and receives the mocked `APPLY_FAILED` response.
- The dialog remains visible after the 500 response.
- `auto-decompose-apply-error` displays the backend message `Could not persist graph`.
- The proposed preview remains visible and the preview endpoint is not called a second time.
- Focused Playwright, lint, and diff-check verification passed before PR handoff.

## Verification

Verified commands:

```bash
WEB_PORT=5374 pnpm --filter @agentctl/web exec playwright test e2e/task-auto-decompose.spec.ts
pnpm lint
git diff --check
```
