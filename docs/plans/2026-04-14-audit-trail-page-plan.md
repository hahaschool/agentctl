# Audit Trail Page Plan

Date: 2026-04-14
Status: Delivered in PR #507 (`main@d3fb1a0b`); plan registered in PR #509 (`main@b0464f2c`); browser-depth follow-up delivered in PR #513 (`main@5eb844ff`); backend summary contract repaired in PR #743 (`main@0a29dc69`)
Owner: Claude/Codex coordination lane

## Context

Audit actions and summaries were already available through the control-plane audit APIs and the Logs page Audit Trail tab. Operators still lacked a direct navigation target for audit review, which made forensics discoverability weaker than the roadmap's dedicated audit surface implied.

PR #507 closed that gap by extracting the audit trail into a dedicated `/audit` page that reuses the existing audit query layer and audit action row component, then adding a sidebar entry so operators can reach audit history without first opening Logs.

Post-delivery contract note: PR #743 corrected the backend `GET /api/audit/summary` response to match the web frontend contract (`toolBreakdown`, `actionTypeBreakdown`, `avgDurationMs`). Earlier plan language that described audit summaries as already aligned should be read as UI/query reuse only, not as proof that the backend summary shape was correct before #743.

## Scope

- Add the `/audit` App Router page and render the new `AuditPage` view.
- Reuse the existing audit action and summary query contracts.
- Preserve filtering, search, sort, pagination, empty/error states, and refresh posture from the Logs audit surface.
- Add focused Vitest/RTL coverage with mocked audit queries so the page can be verified without a live control plane.
- Add a sidebar navigation entry for Audit.

## Non-Goals

- No audit database, route, retention, or replay behavior changes.
- No new Playwright coverage in this slice.
- No beta/prod promotion, PM2, CD, or environment-script changes.

## Delivered Files

- `packages/web/src/app/audit/page.tsx`
- `packages/web/src/components/Sidebar.tsx`
- `packages/web/src/views/AuditPage.tsx`
- `packages/web/src/views/AuditPage.test.tsx`
- `packages/web/e2e/audit.spec.ts`
- `docs/ROADMAP.md`

## Validation

- PR #507 GitHub checks covered lint, build, unit tests, and security audit before merge.
- Post-merge `main@d3fb1a0b` checks passed: CI, Security Audit, and Build & Publish Docker Images.
- Plan registration landed in PR #509; post-merge `main@b0464f2c` checks passed: CI `24405567418`, Security Audit `24405567419`, and Build & Publish Docker Images `24405567447`.
- Backend-independent `/audit` Playwright coverage landed in PR #513; PR checks passed before merge, and post-merge `main@5eb844ff` checks passed: CI `24407474324`, Security Audit `24407474322`, and Build & Publish Docker Images `24407474278`.
- Backend summary contract repair landed in PR #743 after CI, CodeQL, Security Audit, container scans, and control-plane tests passed.
- Local docs sync validation: `git diff --check`.

## Follow-Up

- Keep the Logs tab and dedicated `/audit` page behavior aligned when audit filters or row rendering change.
- Align the mobile `AuditSummary` client type with the post-#743 backend/web contract if mobile keeps using `GET /api/audit/summary`.
