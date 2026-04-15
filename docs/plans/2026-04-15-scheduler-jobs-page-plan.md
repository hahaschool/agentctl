# Scheduler Jobs Page Plan

Date: 2026-04-15
Status: Delivered in PR #517 (`main@2c31bcd6`)
Owner: Claude/Codex coordination lane

## Context

Scheduled sessions and loop execution already had backend support through `schedule_config` and scheduler API routes, but operators did not have a direct web surface for viewing or managing scheduler jobs. PR #517 closed the discoverability gap by adding a dedicated `/scheduler` page to the web app and wiring it to the existing scheduler API client.

## Scope

- Add a `/scheduler` App Router page and sidebar navigation entry.
- Add a scheduler API client module that lists jobs, creates heartbeat jobs, and deletes jobs by agent id.
- Render loading, empty, populated, error, and `SCHEDULER_NOT_CONFIGURED` states.
- Add a Create Job dialog for heartbeat jobs with seconds-to-milliseconds interval conversion.
- Add delete confirmation behavior using the derived scheduler agent id.
- Keep dialog reset behavior render-safe by resetting local state from an effect when the dialog closes.
- Add focused Vitest/RTL coverage for not-configured rendering, create payloads, and delete wiring.

## Non-Goals

- No scheduler database, queue, or worker lifecycle changes.
- No new Playwright coverage in this slice.
- No dev-1/dev-2, beta, PM2, or CD behavior changes.
- No broad redesign of adjacent runtime or sessions pages.

## Delivered Files

- `packages/web/src/app/scheduler/page.tsx`
- `packages/web/src/app/scheduler/page.test.tsx`
- `packages/web/src/components/Sidebar.tsx`
- `packages/web/src/lib/api/scheduler.ts`
- `packages/web/src/lib/api.ts`

## Validation

- Local review-fix verification: `pnpm --filter @agentctl/web test -- scheduler`
- Local review-fix verification: `pnpm -w lint`
- Local review-fix verification: `pnpm --filter @agentctl/web build`
- Local review-fix verification: `git diff --check`
- PR #517 checks passed before merge.
- Post-merge `main@2c31bcd6` checks passed: CI `24434540379`, Security Audit `24434540412`, and Build & Publish Docker Images `24434540403`.

## Follow-Up

- Add backend-independent Playwright coverage for the `/scheduler` page if scheduler job management becomes a high-traffic operator workflow.
- Keep the web page aligned with any future scheduler job types beyond heartbeat jobs.
