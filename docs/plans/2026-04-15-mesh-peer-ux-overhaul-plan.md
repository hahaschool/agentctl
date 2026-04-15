# Mesh Peer UX Overhaul Plan

**Status:** In Progress — backend ping diagnostics and peer edit landed
**Roadmap:** 33.7 Mesh Peer UX Overhaul
**Created:** 2026-04-15

## Context

The 2026-04-15 beta mesh setup exposed three operator-facing gaps in `/mesh-peers`:

- A peer configured with `https://...:8080` against an HTTP-only control plane only reported `unreachable`.
- Existing peer rows can be pinged or deleted, but not edited, forcing direct CLI/API upserts for simple scheme fixes.
- Adding a peer requires manually typing identity and connection fields that can mostly be discovered from Tailscale plus `/health`.

`syncIntervalMs` is not discoverable infrastructure data; it should remain an operator policy with a default and an editable review step.

## Delivered

1. Backend ping diagnostics *(PR #550)*.
   - Ping failures are classified into stable categories.
   - `sync_nodes` stores `last_ping_error` and `last_ping_status_code`.
   - Peer rows and ping responses include the persisted diagnostics.

2. Existing peer editing *(PR #551)*.
   - `/mesh-peers` can edit an existing peer in-place through the existing idempotent upsert API.
   - The edit path preserves the backend role contract and keeps self-peer rows protected.

## Scope

1. Render actionable failure details.
   - Show the error category next to the peer status pill.
   - Include the specific reason in ping failure toasts.
   - Keep wording focused on what to fix: scheme mismatch, refused port, timeout, DNS, or HTTP status.

2. Add Tailscale discovery.
   - Implement `GET /api/sync/peers/discover` behind the same auth/rate-limit posture as other sync routes.
   - Use `tailscale status --json` without interpolating user-controlled shell fragments.
   - Filter to `tag:mesh-node`, probe `http://<tailscaleIp>:8080/health`, and return discovered identity/address/key data for peers not already registered.

3. Add manual Probe.
   - Implement `GET /api/sync/peers/probe?target=...`.
   - Reuse the existing sync URL SSRF blocklist and IP/hostname validation rules.
   - Probe `/health` for `machineId` and `nodePublicKey`; derive `syncUrl` from the validated target, and fill `hostname`/`tailscaleIp` from the user-entered target or Tailscale status data where available.
   - Default `syncUrl` to `http://<target>:8080`; keep HTTPS available for public endpoints.

4. Cover the remaining browser flows.
   - Add `/mesh-peers` Playwright coverage for discover, probe, and detailed ping-failure rendering.
   - Keep tests backend-independent where practical; use a dedicated two-node fixture only if the route behavior cannot be mocked safely.

## Non-Goals

- Do not change dev-1/dev-2, beta, production deployment, or promotion workflows.
- Do not implement bidirectional registration here; that is tracked in `2026-04-15-mesh-bidirectional-registration-plan.md`.
- Do not weaken existing sync-peer SSRF protections.

## Verification

- Focused backend route tests for ping error classification, discovery filtering, and probe validation.
- Focused web unit or component tests for edit/probe state where Playwright setup cost is unnecessary.
- `pnpm --filter @agentctl/web test:e2e -- e2e/mesh-peers.spec.ts --project=chromium` or the repo-equivalent focused command after the UI flows land.
- `pnpm build`, lint, and relevant control-plane tests for backend changes.
