# Agent Detail E2E Coverage Plan

Date: 2026-04-14
Status: Delivered in PR #492; CI-gated in PR #765
Owner: Codex lane `agent/codex-492-agent-detail-e2e`

## Context

The roadmap's §20.5 browser-depth batch has steadily converted high-value web surfaces to backend-independent Playwright coverage. `/agents/[id]` is still a dynamic route with a dense coordination surface: agent metadata, runtime configuration, machine/account lookup, sessions, memory facts, execution summaries, run history, and the start-run mutation.

This lane adds focused browser coverage for the existing agent detail route without changing production behavior unless the test exposes a real bug.

## Scope

- Add `packages/web/e2e/agent-detail.spec.ts`.
- Mock every `/api/**` request the route and app shell make, including agent detail, runs, sessions, machines, accounts, memory facts, shell approval/conflict polls, and `POST /api/agents/:id/start`.
- Cover the happy-path render of details, config, costs, session links, memory summary, run timeline, latest summary, and grouped run history.
- Cover start dialog request wiring with an override prompt and success toast.
- Update `docs/ROADMAP.md` so the shared coordination roadmap reflects the new coverage lane.

## Out of Scope

- Live control-plane or worker execution.
- Broad visual redesign of the agent detail page.
- Beta/dev CD changes.

## Acceptance

- The focused Playwright spec passes with only the Next.js dev server.
- `pnpm lint` remains clean.
- `git diff --check` passes.
- Roadmap/plan registry entries point at this plan.

## Verification

- `pnpm --filter @agentctl/shared build`
- `WEB_PORT=5386 pnpm --filter @agentctl/web exec playwright test e2e/agent-detail.spec.ts`
- PR #765 adds `agent-detail.spec.ts` to the focused web `test:e2e:ci` allowlist.
- `git diff --check`
- `pnpm lint`
