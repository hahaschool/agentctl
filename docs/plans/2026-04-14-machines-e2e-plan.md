# Machines List and Detail E2E Plan

## Status

Implemented in PR #499. CI gating follow-up in PR #516 adds the backend-independent
`machines.spec.ts` slice to the focused web `test:e2e:ci` allowlist.

## Scope

Add backend-independent Playwright coverage for the `/machines` list and `/machines/[id]` detail
operator surfaces without touching the terminal-specific flows covered by `machines-terminal.spec.ts`.

## Coverage

- Render fleet list summary counts, stale heartbeat badges, compact mode, search, and status filters.
- Render machine detail cards for identity, status, capabilities, runtime auth/install state, memory stats, agents, and recent sessions.
- Verify worker-node matching by hostname and Tailscale IP while excluding nodes from other machines.
- Mock every `/api/**` request so the spec needs only the Next.js dev server and does not touch dev-1/dev-2 or beta-stage services.

## Validation

- `WEB_PORT=5391 pnpm --filter @agentctl/web exec playwright test e2e/machines.spec.ts`
- `WEB_PORT=5391 pnpm --filter @agentctl/web test:e2e:ci`
- `pnpm lint`
- `git diff --check`
