# Mesh Fleet Rollout + Peer Update Plan

**Status:** Planned
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
but operator UI warnings and two-node proof still gate fleet rollout.

## Scope

1. Activate the Docker fleet path.
   - Replace placeholder `infra/machines.yml` entries with real fleet entries
     for Docker-managed machines only.
   - Validate with the existing fleet bootstrap dry-run tooling.
   - Add build provenance and deployment-side attestation verification.
   - Exercise `deploy-fleet.yml` first in dry-run, then canary mode.

2. Add a PM2 mesh peer update path.
   - Add `scripts/peer-update.sh`.
   - Add a `pnpm agentctl peer update` subcommand.
   - Resolve target release, verify provenance, checkout the tag, run mesh
     migrations, build, reload PM2, poll `/health`, and roll back on failure.
   - Emit a structured result suitable for UI display.

3. Add opt-in schedulers.
   - Provide disabled-by-default macOS `launchd` and Linux `systemd` timer
     templates.
   - Document the update window and operator enablement steps.

4. Add operator UI.
   - `/settings` shows mesh auto-update status for the current node.
   - `/mesh-peers` offers a reachable-peer "Update" action.
   - "Update available" banners point to dry-run instructions until the action
     is fully wired.

5. Define rollback.
   - Docker rollback uses the existing rollback workflow.
   - PM2 rollback returns to a previously verified tag and reloads PM2.
   - Persist local update history for audit and rollback eligibility.

## Non-Goals

- No default-on unattended updates.
- No beta promotion workflow changes in this slice.
- No bespoke signing system unless GitHub build attestations are insufficient.

## Verification

- CLI dry-run tests for the PM2 update flow.
- Unit tests for release/tag/provenance checks and rollback state handling.
- Focused UI coverage for settings state and peer update affordances.
- Two-node fixture after 33.9/33.10 lands: drift appears, compatibility gate
  rejects unsafe envelopes, and dry-run update reports planned steps without
  mutating state.
