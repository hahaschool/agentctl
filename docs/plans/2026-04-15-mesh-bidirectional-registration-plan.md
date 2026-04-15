# Mesh Bidirectional Registration Plan

**Status:** In Progress — reverse-registration endpoint, machine provenance, auto reverse-registration, and one-way retry UI landed; two-node replication proof remains
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

3. Auto reverse-registration on peer add and retry UI *(PR #564)*.
   - `POST /api/sync/peers` now attempts a signed outbound registration against
     the target peer after the local peer row is created or updated.
   - The outcome is persisted as `reverse_registration_status`,
     `reverse_registration_error`, and `reverse_registration_at` on
     `sync_nodes`; errors are redacted and truncated before storage.
   - `/mesh-peers` shows a one-way badge for failed rows and exposes a Retry
     action backed by `POST /api/sync/peers/:peerId/register-reverse`.

## Scope

1. Prove end-to-end cross-node visibility.
   - Add an integration or Playwright-backed two-node fixture that registers A with B, upserts a machine on A, runs at least one sync tick, and asserts the machine appears on B with provenance.
   - Add a failure-path case where the handshake is unavailable and the UI shows the one-way warning/retry state.

2. Add mesh health summary.
   - Summarize bidirectional, one-way, and stale peer counts in the
     `/mesh-peers` header.
   - Row detail can reuse `sync_peer_cursors` once 33.7's remaining
     diagnostics surface is wired.

## Non-Goals

- Do not ship machine-row provenance UI without the backing schema/data path.
- Do not bypass peer-auth signature validation for convenience during discovery or registration; solve first-registration with an explicit bootstrap trust model instead.
- Do not touch beta promotion, production deployment, dev-1, or dev-2 workflows.

## Verification

- Control-plane route tests for valid/invalid `register-peer` signatures, reverse-row upsert behavior, old-peer fallback, retry outcomes, and rate limits landed across PRs #552/#564.
- Store/migration tests for machine provenance and reverse-registration columns landed across PRs #554/#564.
- Sync-loop integration coverage proving node B pulls machine rows from node A after bidirectional registration.
- Focused `/mesh-peers` and `/machines` browser coverage for one-way retry, origin badges, and the remaining two-node failure path.
