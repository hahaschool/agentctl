# Memory Browser Provenance Filters Plan

**Date:** 2026-04-14
**Status:** Delivered in PR #486
**Roadmap section:** 4.8 Unified Memory System UI

## Context

The memory facts backend already supports provenance query parameters on
`GET /api/memory/facts`: `sessionId`, `agentId`, and `machineId`. The Memory
Browser detail panel also shows source metadata for a selected fact. The gap is
that `/memory/browser` does not expose these provenance filters in the sidebar or
persist them in URL state, so operators cannot quickly narrow facts to a source
session, agent, or machine from the main browser surface.

## Scope

- Add Session, Agent, and Machine text filters to the Memory Browser sidebar.
- Persist those filters in the Memory Browser URL alongside existing search,
  scope, entity-type, and confidence filters.
- Pass the filters through the existing web API client to `GET /api/memory/facts`.
- Extend focused unit and Playwright coverage for the new provenance filter path.
- Avoid backend schema work unless verification shows the existing query
  parameters are not wired correctly.

## Verification

- `pnpm --filter @agentctl/web test -- BrowserFilterSidebar.test.tsx`
- `pnpm --filter @agentctl/web test -- api.test.ts`
- `pnpm --filter @agentctl/web exec playwright test e2e/memory-browser.spec.ts`
- `pnpm lint`
- `git diff --check`

## Delivery Note

PR #486 adds the provenance filters to `/memory/browser`, keeps them in URL
state, and verifies the path through sidebar unit coverage, web API-client
coverage, and the backend-independent Memory Browser Playwright spec.
