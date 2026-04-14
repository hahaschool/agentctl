# Agent Profiles Web UI Plan

Date: 2026-04-14
Status: Delivered in PR #498 (`main@3eebce46`); Playwright follow-up delivered in PR #505
Owner: Claude/Codex coordination lane

## Context

The control plane already shipped AgentProfile and AgentInstance backend support in PR #95, but the web app did not expose an operator-facing `/agent-profiles` surface. PR #498 closed that gap by adding the page, sidebar entry, API-client module, and focused unit coverage on top of the existing backend.

After PR #498 initially failed the web E2E CI lane, the follow-up fix kept `AGENT_RUNTIME_TYPES` and `isAgentRuntimeType` local to the web API module. That prevents the Next dev server used by backend-independent Playwright runs from requiring built `@agentctl/shared` runtime output while preserving shared type imports.

PR #505 added backend-independent Playwright coverage for `/agent-profiles`, including populated table render, empty-state create flow, required-name validation, sanitized comma-list payloads, delete confirmation success, delete API-error handling, and list-error retry recovery.

The PR also added `agent-profiles.spec.ts` to the web `test:e2e:ci` script so the focused backend-independent browser lane now gates both the original `/webhooks` slice and this `/agent-profiles` follow-up.

## Scope

- Add `packages/web/src/lib/api/agent-profiles.ts` and re-export it from the public `@/lib/api` barrel.
- Add the `/agent-profiles` App Router page with loading, error, empty, list, create, and delete-confirm states.
- Wire the sidebar navigation entry so operators can reach the page from the main shell.
- Sanitize create-dialog comma-separated capability and tool-scope fields before sending the API payload.
- Add focused Vitest/RTL coverage for page heading, empty state, list rows, create dialog opening, and create payload normalization.
- Keep runtime constants in the web module so local and CI Next dev runs do not depend on a prebuilt shared package.

## Non-Goals

- No backend schema, store, or route changes; the page uses the existing AgentProfile API.
- No live control-plane dependency in the web unit tests.
- No beta/prod promotion, PM2, CD, or environment-script changes.
- No broader redesign of the agent management surfaces.

## Delivered Files

- `packages/web/src/app/agent-profiles/page.tsx`
- `packages/web/src/app/agent-profiles/page.test.tsx`
- `packages/web/e2e/agent-profiles.spec.ts`
- `packages/web/package.json`
- `packages/web/src/components/Sidebar.tsx`
- `packages/web/src/lib/api.ts`
- `packages/web/src/lib/api/agent-profiles.ts`
- `docs/ROADMAP.md`

## Validation

- `pnpm --filter @agentctl/web test -- agent-profiles`
- `WEB_PORT=5437 pnpm --filter @agentctl/web exec playwright test e2e/agent-profiles.spec.ts --project=chromium --reporter=line`
- `WEB_PORT=5437 pnpm --filter @agentctl/web test:e2e:ci`
- `WEB_PORT=5394 pnpm --filter @agentctl/web exec playwright test e2e/webhooks.spec.ts --project=chromium --reporter=line`
- `pnpm lint`
- `git diff --check HEAD`

## Follow-Up

- Backend-independent Playwright coverage for `/agent-profiles` is now represented by PR #505.
- Keep future web API modules free of runtime imports from unbuilt workspace packages unless the dev server path is verified.
