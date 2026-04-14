# Audit Trail Page Plan

Date: 2026-04-14
Status: Delivered in PR #507 (`main@d3fb1a0b`)
Owner: Claude/Codex coordination lane

## Context

Audit actions and summaries were already available through the control-plane audit APIs and the Logs page Audit Trail tab. Operators still lacked a direct navigation target for audit review, which made forensics discoverability weaker than the roadmap's dedicated audit surface implied.

PR #507 closed that gap by extracting the audit trail into a dedicated `/audit` page that reuses the existing audit query layer and audit action row component, then adding a sidebar entry so operators can reach audit history without first opening Logs.

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
- `docs/ROADMAP.md`

## Validation

- PR #507 GitHub checks covered lint, build, unit tests, and security audit before merge.
- Post-merge `main@d3fb1a0b` checks passed: CI, Security Audit, and Build & Publish Docker Images.
- Local docs sync validation: `git diff --check`.

## Follow-Up

- Add backend-independent `/audit` Playwright coverage if the next browser-depth batch targets audit forensics.
- Keep the Logs tab and dedicated `/audit` page behavior aligned when audit filters or row rendering change.
