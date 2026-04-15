# Agents List E2E Coverage Plan

Date: 2026-04-14
Status: Delivered in PR #494; CI-gated in PR #518 with shared-package build preflight
Owner: Codex

## Context

PR #492 added backend-independent coverage for `/agents/[id]`, but the `/agents` index still only had smoke-level browser coverage. That page is the operator entry point for list triage, filtering, creating agents, and starting stopped agents, so it needs the same strict mocked-API coverage as the recent feature-depth batch.

## Scope

- Add a backend-independent Playwright spec for `/agents`.
- Mock every `/api/**` request used by the page and create dialog.
- Cover list rendering with machine name mapping, search filtering, status filtering, and filtered counts.
- Cover one-off start wiring to `POST /api/agents/:id/start`.
- Cover create-from-scratch wiring to `POST /api/agents`, including prompt, project path, selected machine, runtime, type, and explicit name.

## Non-Goals

- No backend route changes.
- No live worker/control-plane dependency.
- No broad visual redesign of the agents page.
- No CD or beta/prod runner changes.

## Validation

- `WEB_PORT=<unique> pnpm --filter @agentctl/web exec playwright test e2e/agents-list.spec.ts`
- `WEB_PORT=<unique> pnpm --filter @agentctl/web test:e2e:ci`
- PR #518 extends `test:e2e:ci` to include `agents-list.spec.ts` and builds `@agentctl/shared` before Playwright so cold CI checkouts can compile `/agents` imports.
- `git diff --check`
- `pnpm lint`
