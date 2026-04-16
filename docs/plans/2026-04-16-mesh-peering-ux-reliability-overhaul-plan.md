# Mesh Peering UX & Reliability Overhaul — §33.12

> Created: 2026-04-16
> Status: Planned
> Priority: P0
> Depends on: §33.7 (peer UX), §33.8 (bidirectional registration)

## Motivation

Adding a mesh peer today requires:

1. SSH to each machine → edit `.env.mesh` / `.env.beta` → add `SYNC_PEER_REGISTRATION_TOKEN` + `TAILSCALE_IP`
2. Rebuild (`pnpm build`) + restart PM2 on every machine
3. Open web UI → Discover → Add → hope reverse registration works
4. If it fails, debug by reading PM2 logs

This is antithetical to the project vision of **remote fleet management from iPhone/iPad**. The peering flow should be completable entirely from the web UI without SSH access. Every failure should be immediately visible and actionable.

### Concrete failures observed on 2026-04-16 live fleet (laptop + macmini):

| Step | Failure | Root Cause | How long to diagnose |
|------|---------|------------|---------------------|
| Discover peers | 0 candidates found | `tailscale` binary not in PATH on macOS | 30 min (PR #599) |
| Add peer | ONE-WAY badge, no error | macmini missing `SYNC_PEER_REGISTRATION_TOKEN` in PM2 env | 20 min SSH debugging (PR #596) |
| Reverse registration | `INVALID_SYNC_URL` | `selfSyncUrl` was `http://localhost:8080` | 40 min (PR #602) |
| Version display | "mixed versions" banner | Hardcoded `LOCAL_APP_VERSION` constant stale | 15 min (PR #603) |
| Macmini reverse reg | Failed silently | `TAILSCALE_IP=127.0.0.1` in `.env.mesh` | 10 min SSH fix |

Total: ~2 hours of debugging for what should be a 30-second "click Add, both sides connected" flow.

## Design Principles

1. **Zero SSH required for normal peering operations** — all config via web UI
2. **Auto-detect everything possible** — Tailscale IP, machine ID, public key
3. **Synchronous feedback** — never fire-and-forget; every action reports success/failure immediately
4. **Progressive disclosure of errors** — summary badge → expandable detail → actionable fix
5. **Database-stored config** — not env vars; survives restarts without PM2 ecosystem edits

## Scope

### Phase 1: Auto-Detection & Self-Identity (P0)

**Goal:** Eliminate manual `TAILSCALE_IP` env var; show the operator their node's identity.

#### 1.1 Auto-detect Tailscale IP at startup

- On CP startup, run `tailscale ip -4` (using the existing `resolveTailscaleBin()` from `peer-discovery.ts`) to discover the local Tailscale IPv4 address
- Use this as `selfTailscaleIp` and derive `selfSyncUrl = http://<tailscaleIp>:<PORT>` when Tailscale is available
- Fallback chain: `TAILSCALE_IP` env var → `tailscale ip -4` auto-detect → `CONTROL_PLANE_URL`
- Cache the result (Tailscale IP doesn't change unless the node re-authenticates)
- Log the resolved `selfSyncUrl` at startup: `info: selfSyncUrl resolved to http://100.113.212.131:8080 (source: tailscale-cli)`

#### 1.2 Self-identity card on `/mesh-peers`

- New `SelfIdentityCard` component above the peer table
- Shows: Machine ID, Hostname, Tailscale IP (auto-detected vs manual override), Sync URL, Public Key (truncated + copy button), Registration Token status (configured / not configured)
- Read from existing `/health` + new `/api/mesh/config` endpoint
- Operator can see at a glance whether their node is correctly configured for peering

#### 1.3 Self-identity on `/health` endpoint

- Add `selfSyncUrl` to the `/health` response (useful for debugging, probe auto-fill)
- Already exposes `machineId` and `nodePublicKey`; adding the sync URL completes the picture

### Phase 2: Settings UI for Mesh Config (P0)

**Goal:** All mesh configuration editable from the web UI; no env file editing.

#### 2.1 `mesh_config` table

- New table or extend `settings` table with mesh-specific keys:
  - `tailscale_ip_override` — manual override (nullable, auto-detect used when null)
  - `sync_url_override` — manual override (nullable, derived from IP+port when null)
  - `registration_token` — the shared bootstrap token for peer registration
  - `auto_update_enabled` — whether launchd/systemd timer is active
  - `pm2_ecosystem` — PM2 ecosystem name for self-update
- All values readable via `GET /api/mesh/config`, writable via `PUT /api/mesh/config`
- Startup: read DB config first, fall back to env vars, fall back to auto-detect
- Changes take effect immediately (no restart required) for:
  - Token changes → next reverse registration uses new token
  - IP override → next health report / reverse registration uses new URL
- Changes requiring restart (warn user in UI):
  - Bind address / port changes (if ever added)

#### 2.2 Settings → Mesh section

- New "Mesh" tab or section on `/settings` page
- Fields:
  - **Machine ID** — read-only (derived from hostname, shown for reference)
  - **Tailscale IP** — auto-detected value shown, with manual override input
  - **Sync URL** — derived value shown, with manual override input
  - **Registration Token** — password-masked input, with generate-random button
  - **Public Key** — read-only, copy-to-clipboard button
- "Save" persists to `mesh_config` table, applies immediately
- Status indicator: "Mesh identity active" (green) / "Incomplete — configure token to enable peering" (yellow)

#### 2.3 Token management UX

- Generate button creates a cryptographically random 32-byte hex token
- Copy-to-clipboard for pasting into the other machine's Settings
- Or: QR code display for scanning from mobile (stretch goal)
- Warning if token is empty: "Registration token not set — reverse registration will be skipped"

### Phase 3: Add Peer Flow Redesign (P0)

**Goal:** Adding a peer establishes bidirectional peering in one step with real-time feedback.

#### 3.1 Synchronous add-and-register flow

Current flow:
```
POST /api/sync/peers (add locally) → fire-and-forget reverse registration → maybe fails silently
```

New flow:
```
POST /api/sync/peers (add locally)
  → probe remote /health (verify reachable)
  → POST remote /api/sync/peers/register (reverse registration)
  → return { localResult, reverseResult } in response
```

- The response includes both the local upsert result AND the reverse registration result
- Frontend displays both results immediately: "Added locally ✓ | Registered on remote ✓" or "Added locally ✓ | Remote registration failed: TOKEN_MISSING"
- No more fire-and-forget; the user knows immediately whether bidirectional peering succeeded

#### 3.2 Pre-flight checks in Add Peer dialog

Before saving, the dialog performs live checks:

1. **Probe remote `/health`** — verify reachable, extract identity
2. **Check token compatibility** — new endpoint `GET /api/sync/peers/register/preflight?target=<url>` returns whether the remote requires a token and whether this node has one configured
3. **Check schema compatibility** — compare local vs remote `schemaVersion`

Display results inline:
```
✓ Remote is reachable (v0.5.6, schema 27)
✓ Registration token configured on both sides
✓ Schema versions compatible
──────────────────────────────────
[Add Peer]
```

Or with issues:
```
✓ Remote is reachable (v0.5.6, schema 27)
✗ Remote requires registration token — configure in Settings → Mesh
⚠ Remote is 1 schema version ahead — consider updating this node first
──────────────────────────────────
[Add Peer Anyway]  [Configure Token]
```

#### 3.3 Better error messages for reverse registration failures

Map every error code to an actionable message:

| Error | Current message | Improved message |
|-------|----------------|-----------------|
| `PEER_REGISTRATION_DISABLED` | "503 Service Unavailable" | "Remote peer has no registration token configured. Ask the remote operator to set one in Settings → Mesh." |
| `PEER_REGISTRATION_TOKEN_MISSING` | "401 Unauthorized" | "This node's registration token doesn't match the remote peer's. Check Settings → Mesh on both machines." |
| `PEER_REGISTRATION_TOKEN_INVALID` | "403 Forbidden" | "Token mismatch — the tokens on this node and the remote peer don't match." |
| `INVALID_SYNC_URL` | "400 Bad Request" | "This node's Sync URL (http://localhost:8080) is not reachable from the remote peer. Check Settings → Mesh → Tailscale IP." |
| Connection refused | "Failed to reach peer" | "Could not connect to <url>. Is the remote control plane running?" |
| Timeout | "Failed to reach peer" | "Remote peer at <url> did not respond within 5 seconds." |

#### 3.4 Retry with backoff for failed reverse registrations

- After add-peer, if reverse registration fails, schedule automatic retries: 30s, 60s, 120s, then stop
- Show retry status on the peer row: "Retrying reverse registration (attempt 2/4, next in 45s)"
- Manual retry button remains available
- Stop retrying after 4 attempts; show permanent "Failed — manual intervention required" badge

### Phase 4: Operational Improvements (P1)

#### 4.1 Stale peer cleanup

- Peers not seen for >7 days get a "Stale" badge with a "Remove" suggestion
- Bulk cleanup action: "Remove N stale peers"
- Optional auto-remove after configurable threshold (default: disabled)

#### 4.2 Mesh health dashboard

- Extend existing `MeshHealthSummary` with:
  - Replication lag per peer (time since last successful sync)
  - Conflict rate (conflicts/hour)
  - Schema version distribution chart
- Alert banner when replication is stuck (no sync for >10 minutes on an always-on peer)

#### 4.3 Peer connection test

- New "Test Connection" button in Add Peer dialog (separate from Probe)
- Tests bidirectional connectivity: this node → remote AND remote → this node
- Detects asymmetric firewall/NAT issues before they cause one-way peering

#### 4.4 Version-bump script updates `LOCAL_APP_VERSION`

- `scripts/version-bump.sh` should update `LOCAL_APP_VERSION` in `mesh-version.ts`
- Or better: remove the constant entirely now that `useLocalVersion()` hook fetches at runtime (PR #603)
- Keep the constant only as a loading-state fallback, auto-updated by version-bump

## Implementation Order

| Phase | Priority | Effort | Prereqs |
|-------|----------|--------|---------|
| 1.1 Auto-detect Tailscale IP | P0 | S | None |
| 1.2 Self-identity card | P0 | S | 1.1 |
| 1.3 Self-identity on /health | P0 | XS | None |
| 2.1 mesh_config table | P0 | M | None |
| 2.2 Settings → Mesh section | P0 | M | 2.1 |
| 2.3 Token management UX | P0 | S | 2.2 |
| 3.1 Synchronous add-and-register | P0 | M | 2.1 |
| 3.2 Pre-flight checks | P0 | M | 3.1 |
| 3.3 Better error messages | P0 | S | 3.1 |
| 3.4 Retry with backoff | P1 | M | 3.1 |
| 4.1 Stale peer cleanup | P1 | S | None |
| 4.2 Mesh health dashboard | P2 | L | None |
| 4.3 Bidirectional connection test | P1 | M | 3.2 |
| 4.4 Version-bump constant cleanup | P1 | XS | PR #603 |

**Sizing:** XS = < 1 hour, S = 1-3 hours, M = 3-8 hours, L = 1-2 days

## Non-Goals

- **mDNS / Bonjour discovery** — Tailscale already provides discovery; no need for a second discovery layer
- **Certificate-based mutual auth** — Ed25519 signatures + Tailscale WireGuard are sufficient for the current threat model
- **Multi-hop proxy** — all peers must be directly reachable via Tailscale; relay topology is out of scope
- **Automatic token distribution** — the operator must explicitly share the token between machines (security boundary)

## Success Criteria

After this work is complete:

1. A new operator can add a peer **entirely from the web UI** — no SSH, no env files, no PM2 restarts
2. "Discover → Add → Bidirectional" takes **< 30 seconds** with clear success/failure feedback
3. Every failure state has an **actionable error message** visible in the UI
4. The operator can see their **node identity** (machine ID, sync URL, token status) from the Settings page
5. Tailscale IP is **auto-detected** — the `TAILSCALE_IP` env var becomes an optional override only
