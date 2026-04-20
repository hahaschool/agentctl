# Mesh Fleet Rollout + Peer Update Plan

**Status:** In progress — PM2 CLI, opt-in schedulers, settings UI, provenance, rollback, fleet structure, update-available banner, and all three opt-in live two-node fixture slices landed; end-to-end canary dry-run remains
**Roadmap:** 33.11 Fleet Rollout & Peer Auto-Update
**Created:** 2026-04-15

## Context

The existing deployment system covers single-host dev/beta/prod workflows and a
Docker fleet workflow, but the user's current mesh topology is PM2-based:
laptop and macmini run local checkouts, local builds, and PM2 reloads. A mesh
operator still has to update each peer manually.

Rollout work depends on 33.9 for drift visibility and 33.10 for safe
schema/protocol compatibility checks. PR #561 completes the 33.9 drift signal
by persisting peer metadata from on-demand and background pings. PR #557
delivered the backend envelope stamping and apply-side compat gate for 33.10,
but operator UI warnings and two-node proof still gate full fleet rollout.
PR #563 delivered the first manual PM2 peer-update slice: `scripts/peer-update.sh`,
a signed self-update route, route-local Fastify rate limiting before auth,
mutex protection, structured responses, and the `/mesh-peers` Update action.
PRs #571/#572/#577/#580 completed the PM2 operator path with the
`agentctl peer update` CLI, opt-in schedulers, settings UI, and rollback state.
PRs #575/#579/#593 added Docker build provenance, migration gates, and the
fleet structure. PR #582 added the update-available banner. PR #654 added the
opt-in live two-node fixture foundation and first version-drift assertion
without changing default E2E or beta/dev/prod CD behavior. PR #659 added the
separately gated peer-update dry-run fixture assertion over
`/api/mesh/auto-update/dry-run`. PR #668 adds the separately gated
schema-ahead assertion by forcing a `schemaVersion + 2` envelope through the
primary node's apply-side compat gate and asserting the 33.10 badge on
`/mesh-peers`.

## Scope

1. Activate the Docker fleet path.
   - Fleet structure landed in PR #593.
   - Build provenance landed in PR #575.
   - Migration gate landed in PR #579.
   - Remaining: exercise `deploy-fleet.yml` first in dry-run, then canary mode.

2. Add a PM2 mesh peer update path.
   - Delivered in PR #563: `scripts/peer-update.sh`, signed peer-auth
     self-update route, per-route rate limiting before authorization, update
     mutex, structured result payloads, and `/mesh-peers` Update action.
   - Delivered in PRs #571/#580: `pnpm agentctl peer update`, dry-run output,
     release/provenance checks, PM2 reload, health polling, rollback state, and
     structured results suitable for UI display.

3. Add opt-in schedulers. *(Delivered in PR #572.)*
   - Provide disabled-by-default macOS `launchd` and Linux `systemd` timer
     templates.
   - Document the update window and operator enablement steps.

4. Add operator UI. *(Delivered in PRs #577/#582.)*
   - `/settings` shows mesh auto-update status for the current node.
   - Delivered in PR #563: `/mesh-peers` offers a reachable-peer "Update"
     action backed by the signed self-update route.
   - "Update available" banners point to dry-run instructions until the action
     is fully wired.

5. Define rollback. *(Delivered for PM2 in PR #580; Docker keeps the existing rollback workflow.)*
   - Docker rollback uses the existing rollback workflow.
   - PM2 rollback returns to a previously verified tag and reloads PM2.
   - Persist local update history for audit and rollback eligibility.

6. Add live two-node fixture coverage.
   - PR #654 delivered the opt-in fixture foundation and first assertion:
     after one live peer ping, the `/mesh-peers` row and update-available
     banner show the configured peer version.
   - PR #659 delivered the separately gated `agentctl peer update --dry-run`
     assertion: the fixture streams the SSE route, parses the JSON result, and
     verifies reported planned steps are marked `dryRun`.
   - PR #668 delivered the separately gated schema-ahead assertion: the fixture
     injects a synthetic `schemaVersion + 2` envelope into the primary node's
     apply gate, records the same rejection marker as the sync loop, and checks
     the 33.10 badge on `/mesh-peers`.

## Non-Goals

- No default-on unattended updates.
- No beta promotion workflow changes in this slice.
- No bespoke signing system unless GitHub build attestations are insufficient.

## Verification

- PR #563 verification: focused peer-update route tests, `/mesh-peers` UI
  tests, CodeQL pass after route-local rate limiting moved before auth, and
  main CI/Security checks after merge.
- CLI dry-run tests for the PM2 update flow landed across PRs #571/#580.
- Unit tests for release/tag/provenance checks and rollback state handling landed across PRs #571/#575/#580.
- Focused UI coverage for settings state and peer update affordances landed in PR #577.
- PR #654 opt-in live fixture verifies the first drift path: peer ping updates
  the row and update-available banner with the expected peer version.
- PR #659 opt-in dry-run fixture verifies the SSE stream reports
  `pnpm agentctl peer update --dry-run`, exits 0, and marks planned steps as
  dry-run steps.
- PR #668's opt-in schema-ahead fixture verifies the compatibility gate rejects
  unsafe envelopes and surfaces the persisted 33.10 badge.
