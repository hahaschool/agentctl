# Agent Settings E2E Plan

## Status

Delivered in PR #495.

## Scope

Add backend-independent Playwright coverage for `/agents/[id]/settings`, complementing PR #492's agent detail coverage and PR #494's agents index coverage.

## Coverage

- Render the settings shell, breadcrumb/back navigation, tab strip, and config preview sidebar.
- Capture `PATCH /api/agents/:id` from General tab edits.
- Capture Model & Prompts tab updates for max turns, initial prompt, default prompt, and system prompt.
- Capture Runtime Config tab updates for Codex sandbox, approval policy, reasoning effort, and model provider overrides.
- Keep every `/api/**` request mocked so the spec runs with only the Next.js dev server and does not touch dev-1/dev-2 or beta-stage services.

## Validation

- `WEB_PORT=5389 pnpm --filter @agentctl/web exec playwright test e2e/agent-settings.spec.ts`
- `git diff --check`
- `pnpm lint`
