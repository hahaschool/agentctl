# Mesh Bidirectional Registration Plan

**Status:** In Progress — reverse-registration endpoint and machine provenance landed
**Roadmap:** 33.8 Mesh Bidirectional Registration + Cross-Node Visibility
**Created:** 2026-04-15

## Context

The 2026-04-15 beta mesh follow-up showed that adding `pinnacle-macmini` on the laptop registered only a one-way peer. The macmini control plane still listed only its self row, so its sync loop had no laptop peer to pull from. As a result, machine rows and other change-log entries authored on the laptop never appeared on the macmini.

The sync protocol can pull changes once peers exist on both sides; the missing piece is bidirectional registration and clear UI feedback when the reverse registration is absent.

## Delivered

1. Signed reverse-registration endpoint *(PR #552)*.
   - `POST /api/sync/peers/register` is route-limited before bootstrap auth.
   - The endpoint requires an explicit registration token and a signed
     `register-peer` envelope.
   - Accepted registrations upsert the reverse peer row as `sync_status = 'unknown'`.

2. Machine-row provenance and badges *(PR #554)*.
   - `machines.origin_node_id` records remote row origin.
   - Sync apply stamps missing remote provenance from the source node.
   - Machine list/detail responses resolve the origin node hostname.
   - `/machines` renders local vs synced-from-peer badges.

## Scope

1. Auto-register on peer add.
   - After node A creates or updates a peer row, call the target's `/api/sync/peers/register`.
   - Upsert the reverse row on the target with `sync_status = 'unknown'` until the target's own ping succeeds.
   - Return the target's identity to node A so missing public-key fields can be filled safely.

2. Make one-way registration visible.
   - If reverse registration fails, log a warning and surface a UI banner that reverse registration may be incomplete.
   - Add a per-row "Register this CP with peer" action on `/mesh-peers` for manual retry after a peer comes online or after key rotation.
   - This action can reuse 33.7 edit/probe affordances if they have landed, but the P0 registration endpoint and warning state do not depend on the full 33.7 UX overhaul.

3. Prove end-to-end cross-node visibility.
   - Add an integration or Playwright-backed two-node fixture that registers A with B, upserts a machine on A, runs at least one sync tick, and asserts the machine appears on B with provenance.
   - Add a failure-path case where the handshake is unavailable and the UI shows the one-way warning.

## Non-Goals

- Do not ship machine-row provenance UI without the backing schema/data path.
- Do not bypass peer-auth signature validation for convenience during discovery or registration; solve first-registration with an explicit bootstrap trust model instead.
- Do not touch beta promotion, production deployment, dev-1, or dev-2 workflows.

## Verification

- Control-plane route tests for valid/invalid `register-peer` signatures, reverse-row upsert behavior, old-peer fallback, and rate limits.
- Store/migration tests for any machine provenance column.
- Sync-loop integration coverage proving node B pulls machine rows from node A after bidirectional registration.
- Focused `/mesh-peers` and `/machines` browser coverage for warning banners, manual register action, and origin badges.
