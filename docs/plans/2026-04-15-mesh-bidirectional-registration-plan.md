# Mesh Bidirectional Registration Plan

**Status:** In Review — reverse-registration, machine provenance, mesh health, live-fleet PM2 env passthrough, two-node replication proof, the opt-in live fixture foundation, and the PR #673 A-to-B machine visibility browser assertion landed; PR #675 adds the remaining 33.8 add-peer/reverse-registration and one-way warning/retry browser assertions
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

4. Mesh health summary and live-fleet env passthrough *(PRs #576/#596)*.
   - `/mesh-peers` surfaces bidirectional, one-way, and stale peer counts.
   - PM2 env passthrough now preserves `SYNC_PEER_REGISTRATION_TOKEN`, closing the live one-way peering failure mode.

5. Two-node replication integration proof *(PR #589)*.
   - The control-plane integration suite proves A -> B and B -> A registration, UPDATE propagation, stale rejection, and apply guards.

6. Opt-in live Playwright fixture foundation *(PR #654)*.
   - `mesh-two-node.fixture.spec.ts` is skipped unless explicit live-node
     environment variables are present.
   - Shared fixture helpers cover primary web/API URLs, peer machine id,
     expected peer version, polling, and `AGENTCTL_PLAYWRIGHT_NO_WEBSERVER=1`
     for externally running nodes.

7. Separately gated A-to-B machine visibility browser assertion *(PR #673)*.
   - The two-node fixture can now be opted into with
     `AGENTCTL_MESH_MACHINE_VISIBILITY_E2E=1`.
   - The assertion opens the secondary node's `/machines` page, searches for a
     primary-authored machine row, and verifies the `Synced from ...`
     provenance badge without adding live-node dependencies to the default E2E
     lane.

8. Remaining 33.8 browser assertions *(PR #675)*.
   - `AGENTCTL_MESH_ADD_PEER_REVERSE_E2E=1` drives the real `/mesh-peers`
     add-peer form, probes the secondary node, verifies token preflight
     compatibility, asserts `reverseRegistrationStatus=ok`, and confirms the
     primary node appears in the secondary peer registry.
   - `AGENTCTL_MESH_ONE_WAY_RETRY_E2E=1` route-shims browser peer-list and
     retry responses so the UI shows the one-way warning and retry failure
     posture without mutating the live peer database.

## Scope

1. Prove end-to-end cross-node visibility.
   - Integration proof is delivered in PR #589.
   - PR #654 created the opt-in fixture foundation.
   - PR #673 added the A-to-B machine visibility browser assertion.
   - PR #675 adds the add-peer/reverse-registration and one-way warning/retry browser assertions.

2. Add mesh health summary. *(Delivered in PR #576.)*
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
- Sync-loop integration coverage proving node B pulls machine rows from node A after bidirectional registration landed in PR #589.
- PR #654 fixture foundation verification: skipped by default without explicit env, documented live-node prerequisites, and no default E2E or beta/dev/prod CD behavior changes.
- The PR #673 A-to-B machine visibility fixture assertion remains default-skipped unless
  `AGENTCTL_MESH_MACHINE_VISIBILITY_E2E=1`,
  `AGENTCTL_MESH_SECONDARY_WEB_URL`,
  `AGENTCTL_MESH_SYNCED_MACHINE_HOSTNAME`, and
  `AGENTCTL_MESH_SYNCED_MACHINE_ORIGIN_LABEL` are set.
- The PR #675 add-peer/reverse-registration and one-way retry fixture assertions remain default-skipped unless
  `AGENTCTL_MESH_ADD_PEER_REVERSE_E2E=1` or
  `AGENTCTL_MESH_ONE_WAY_RETRY_E2E=1` are set.
