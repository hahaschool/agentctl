# Mesh Peer UX Overhaul Plan

**Status:** Delivered — PRs #550/#551/#582/#586/#590/#591 completed diagnostics, editing, discovery/probe, and browser coverage
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

3. Actionable diagnostics UI *(PR #582)*.
   - `/mesh-peers` renders stable failure details for scheme mismatch, refused port, timeout, DNS, and HTTP status cases.
   - Ping failure toasts point operators at the concrete fix instead of only showing `unreachable`.

4. Tailscale discovery, manual probe, and browser coverage *(PRs #586/#590/#591)*.
   - `GET /api/sync/peers/discover` and `GET /api/sync/peers/probe` landed with route tests and SSRF-safe target handling.
   - The add-peer flow can discover/probe peers, auto-fill identity fields, and hint scheme corrections.
   - `mesh-peers.spec.ts` now covers discover/probe and detailed failure rendering.

## Completed Scope

1. Render actionable failure details. *(Delivered in PR #582.)*
   - Show the error category next to the peer status pill.
   - Include the specific reason in ping failure toasts.
   - Keep wording focused on what to fix: scheme mismatch, refused port, timeout, DNS, or HTTP status.

2. Add Tailscale discovery. *(Delivered in PR #586 backend + PR #590 UI.)*
   - Implement `GET /api/sync/peers/discover` behind the same auth/rate-limit posture as other sync routes.
   - Use `tailscale status --json` without interpolating user-controlled shell fragments.
   - Filter to `tag:mesh-node`, probe `http://<tailscaleIp>:8080/health`, and return discovered identity/address/key data for peers not already registered.

3. Add manual Probe. *(Delivered in PR #586 backend + PR #590 UI.)*
   - Implement `GET /api/sync/peers/probe?target=...`.
   - Reuse the existing sync URL SSRF blocklist and IP/hostname validation rules.
   - Probe `/health` for `machineId` and `nodePublicKey`; derive `syncUrl` from the validated target, and fill `hostname`/`tailscaleIp` from the user-entered target or Tailscale status data where available.
   - Default `syncUrl` to `http://<target>:8080`; keep HTTPS available for public endpoints.

4. Cover the browser flows. *(Delivered in PR #591.)*
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
