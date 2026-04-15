# Mesh Bidirectional Registration Plan

**Status:** Planned
**Roadmap:** 33.8 Mesh Bidirectional Registration + Cross-Node Visibility
**Created:** 2026-04-15

## Context

The 2026-04-15 beta mesh follow-up showed that adding `pinnacle-macmini` on the laptop registered only a one-way peer. The macmini control plane still listed only its self row, so its sync loop had no laptop peer to pull from. As a result, machine rows and other change-log entries authored on the laptop never appeared on the macmini.

The sync protocol can pull changes once peers exist on both sides; the missing piece is bidirectional registration and clear UI feedback when the reverse registration is absent.

## Scope

1. Add a signed reverse-registration endpoint.
   - Implement `POST /api/sync/peers/register`.
   - Require the same sync-route auth and rate-limit posture as other peer write routes.
   - Validate a `register-peer` envelope signed by the caller's Ed25519 key.
   - Have node A include its own `/health` identity and proposed peer fields in the signed envelope; the target may corroborate A's Tailscale IP from request metadata or `tailscale status --json`, but must not infer A's identity from the target's own `/health` response.

2. Auto-register on peer add.
   - After node A creates or updates a peer row, call the target's `/api/sync/peers/register`.
   - Upsert the reverse row on the target with `sync_status = 'unknown'` until the target's own ping succeeds.
   - Return the target's identity to node A so missing public-key fields can be filled safely.

3. Make one-way registration visible.
   - If reverse registration fails, log a warning and surface a UI banner that reverse registration may be incomplete.
   - Add a per-row "Register this CP with peer" action on `/mesh-peers` for manual retry after a peer comes online or after key rotation.

4. Add explicit machine sync provenance.
   - Inspect the current `machines` schema before implementation; do not assume `origin_node_id` exists.
   - Add a provenance field such as `origin_node_id` or `synced_from_machine_id` if needed.
   - Preserve local machine rows as `Local` and render synced rows as `Synced from <peer hostname>` on `/machines`.

5. Prove end-to-end cross-node visibility.
   - Add an integration or Playwright-backed two-node fixture that registers A with B, upserts a machine on A, runs at least one sync tick, and asserts the machine appears on B with provenance.
   - Add a failure-path case where the handshake is unavailable and the UI shows the one-way warning.

## Non-Goals

- Do not ship machine-row provenance UI without the backing schema/data path.
- Do not bypass peer-auth signature validation for convenience during discovery or registration.
- Do not touch beta promotion, production deployment, dev-1, or dev-2 workflows.

## Verification

- Control-plane route tests for valid/invalid `register-peer` signatures, reverse-row upsert behavior, old-peer fallback, and rate limits.
- Store/migration tests for any machine provenance column.
- Sync-loop integration coverage proving node B pulls machine rows from node A after bidirectional registration.
- Focused `/mesh-peers` and `/machines` browser coverage for warning banners, manual register action, and origin badges.

