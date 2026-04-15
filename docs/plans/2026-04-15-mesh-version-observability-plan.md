# Mesh Version Observability Plan

**Status:** Partial — schema groundwork landed in PR #555, `/health` build metadata landed in PR #556, and version/drift UI landed in PR #558
**Roadmap:** 33.9 Mesh Version Observability
**Created:** 2026-04-15

## Context

Mesh peers currently expose connectivity through `/health`, but not the AgentCTL
application version, build SHA, or shipped schema version. After the v0.3.1 to
v0.4.0 beta promotion, a peer could drift behind or ahead of the local node
without an operator-visible signal.

PR #555 added nullable peer-version columns to `sync_nodes` so later pings can
persist version telemetry without breaking older peers. PR #556 then exposed
local `appVersion`, `gitSha`, and `schemaVersion` on `/health` so peers have a
stable metadata source to read. PR #558 added the operator-facing `/mesh-peers`
version column, mixed-version drift banner, and lazy-loaded sidebar peer-version
tooltip.

## Delivered

1. Add nullable `sync_nodes.peer_version`, `peer_git_sha`, and
   `peer_schema_version` columns.
2. Mirror those columns in the Drizzle schema.
3. Add optional nullable fields to the shared `SyncNode` contract.
4. Keep the change backward-compatible: older peers leave the fields `NULL`.
5. Expose local build metadata on `/health`: `appVersion` from the
   control-plane package metadata, `gitSha` from `GIT_SHA`/`GITHUB_SHA` with an
   `unknown` fallback, and `schemaVersion` from the highest shipped migration
   numeric prefix.
6. Render persisted peer version metadata in `/mesh-peers`, including
   behind/ahead/unknown indicators and a mixed-version drift banner.
7. Add the sidebar footer peer-version tooltip without issuing a global
   background sync-peers request on every route.

## Remaining Scope

1. Capture peer version metadata on ping.
   - Parse `appVersion`, `gitSha`, and `schemaVersion` from peer `/health`.
   - Persist values in the existing nullable `sync_nodes` columns.
   - Keep pings successful when old peers omit the fields.

## Non-Goals

- Do not implement peer auto-update in this slice; it is tracked by
  `2026-04-15-mesh-fleet-rollout-peer-update-plan.md`.
- Do not reject sync envelopes based on version here; that is tracked by
  `2026-04-15-mesh-schema-protocol-compat-plan.md`.
- Do not require all peers to upgrade before pings continue to work.

## Verification

- Control-plane tests for `/health` version fields and old-peer omission.
- Control-plane route tests proving ping persists version fields.
- Shared contract tests for nullable version fields.
- Focused `/mesh-peers` unit or Playwright coverage for version column and drift banner landed in PR #558.
