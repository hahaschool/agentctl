# Mesh Peering UX & Reliability Overhaul — §33.12

> Created: 2026-04-16
> Status: Planned
> Priority: P0
> Depends on: §33.7 (peer UX), §33.8 (bidirectional registration)

## Motivation

Adding a mesh peer today requires SSH to each machine to set env vars (`TAILSCALE_IP`, `SYNC_PEER_REGISTRATION_TOKEN`), rebuild (`pnpm build`), restart PM2, then debug from the web UI. This conflicts with the project vision of **remote fleet management from iPhone/iPad**.

### 2026-04-16 live fleet exercise (laptop + macmini) — post-mortem

| Step | Failure | Root Cause | Fix | Still open? |
|------|---------|------------|-----|-------------|
| Discover peers | 0 candidates | `tailscale` binary not in macOS PATH | PR #599 added macOS binary path candidates to `resolveTailscaleBin()` | **No** — code fix shipped |
| Add peer | ONE-WAY, no error | macmini PM2 `env` block shadowed `SYNC_PEER_REGISTRATION_TOKEN` | PR #596 added token to PM2 explicit env | **No** — but root cause persists: PM2 `env` blocks override `process.env`, so every new env var needs manual PM2 config updates |
| Reverse registration | `INVALID_SYNC_URL` | `selfSyncUrl` was `http://localhost:8080` — no Tailscale IP wired | PR #602 added `TAILSCALE_IP` env → selfSyncUrl | **Partially** — requires manually setting `TAILSCALE_IP` in `.env.mesh` on each machine |
| Version display | Stale version banner | `LOCAL_APP_VERSION` hardcoded in web bundle | PR #603 added `useLocalVersion()` fetching from `/api/version-compat` | **No** — `version-bump.sh` also updates the constant now |
| Macmini reverse reg | Failed silently | `TAILSCALE_IP=127.0.0.1` in `.env.mesh` (human config error) | Manual sed fix on the machine | **Yes** — auto-detection would eliminate this class of error entirely |

**Key insight:** 4 of 5 failures were code bugs already fixed by PRs #596/#599/#602/#603. The remaining gap is **configuration brittleness** — operators must SSH to set env vars, and any typo (like `127.0.0.1` instead of the real Tailscale IP) fails silently. This plan targets that structural gap.

## Current State (what already works)

Before scoping new work, acknowledge what the existing implementation handles:

| Capability | Status | Where |
|-----------|--------|-------|
| selfSyncUrl from TAILSCALE_IP env var | Done | `index.ts:489-491` — `TAILSCALE_IP` env → `CONTROL_PLANE_URL` fallback |
| Tailscale binary resolution | Done | `peer-discovery.ts:104-133` — `resolveTailscaleBin()` with macOS/Linux candidates |
| Peer discovery via Tailscale | Done | `GET /api/sync/peers/discover` — shells out to `tailscale status --json` |
| Health probe before adding peer | Done | `MeshPeersPage.tsx:318-365` — probe gates Save, auto-fills machineId/hostname/publicKey |
| Reverse registration on add | Done | `sync-peers.ts:1050-1064` — `tryReverseRegistration()` runs after local insert, result included in response |
| Reverse registration status in UI | Done | `MeshPeersPage.tsx:416-423` — success/failure toasts after add; "One-way" badge + Retry button on rows |
| Error persistence | Done | `reverse_registration_status`, `reverse_registration_error` columns in `sync_nodes` (migration 0026) |
| Token validation (timing-safe) | Done | `sync-peers.ts:207-211` — SHA-256 + `timingSafeEqual` |
| Ed25519 signature auth | Done | `peer-registration.ts` — 60s timestamp window, nonce, signature verification |
| Version observability | Done | `/health` returns `appVersion`/`gitSha`/`schemaVersion`; mesh-peers shows per-peer version drift |
| Probe/discover endpoints | Done | `GET /api/sync/peers/probe?target=<url>`, `GET /api/sync/peers/discover` |
| Rate limiting on registration | Done | 10 req/60s on `/register` endpoint |

**What's missing** (this plan's scope):

1. **Auto-detection of Tailscale IP** — currently requires manual `TAILSCALE_IP` env var per machine
2. **DB-stored mesh config** — token/IP override live in env vars, requiring SSH + PM2 restart to change
3. **Settings UI for mesh config** — operators cannot configure mesh identity from the web UI
4. **Pre-flight token compatibility check** — probe checks reachability but not whether both sides have matching tokens
5. **Actionable error messages** — backend returns descriptive error codes, but the frontend shows generic messages or raw error strings
6. **Automatic retry** — failed reverse registrations require manual "Retry" click per peer

## Design Principles

1. **Zero SSH for normal peering operations** — all config via web UI after initial install
2. **Auto-detect, manual override** — `tailscale ip -4` auto-detect by default, explicit override available in Settings
3. **Synchronous feedback** — the add-peer response already includes reverse registration status; extend this to surface actionable context
4. **Progressive disclosure** — summary badge → expandable detail → actionable fix suggestion
5. **DB config with env-var fallback** — env vars remain as overrides for headless/scripted setups; DB is the primary config path for web UI users

## Scope

### Phase 1: Tailscale IP Auto-Detection (P0)

**Goal:** Eliminate the manual `TAILSCALE_IP` env var requirement. This is the #1 cause of peering failures (wrong IP, forgotten env var, PM2 env shadowing).

#### 1.1 Auto-detect Tailscale IP at CP startup

**Current:** `selfSyncUrl` uses `TAILSCALE_IP` env var if set, otherwise falls back to `CONTROL_PLANE_URL` (often `http://localhost:8080`, which is unreachable from peers).

**Change:** Insert `tailscale ip -4` auto-detection between the env var and the localhost fallback.

New resolution chain:
1. `TAILSCALE_IP` env var (explicit override — highest priority)
2. `tailscale ip -4` via existing `resolveTailscaleBin()` from `peer-discovery.ts`
3. `CONTROL_PLANE_URL` env var (last resort)

Implementation:
- New function `detectTailscaleIp()` in `peer-discovery.ts` — runs `tailscale ip -4`, caches result for process lifetime (Tailscale IP doesn't change unless re-auth)
- Called once during `buildServerOptions()` in `index.ts`
- Log at startup: `info: selfSyncUrl resolved to http://100.113.212.131:8080 (source: tailscale-cli)` or `(source: env-var)` or `(source: control-plane-url-fallback)`
- **Timeout:** 3 seconds for `tailscale ip -4` — if Tailscale is down or not installed, fall through gracefully

Edge cases:
- **Tailscale not installed:** `resolveTailscaleBin()` returns `'tailscale'` (PATH fallback), `execSync` throws → catch → fall through to `CONTROL_PLANE_URL`
- **Tailscale installed but not connected:** `tailscale ip -4` exits non-zero → catch → fall through
- **Docker containers:** Tailscale CLI typically not available inside containers → fall through to `CONTROL_PLANE_URL` (Docker deployments should set `TAILSCALE_IP` explicitly in compose env)

#### 1.2 Expose selfSyncUrl on `/health`

**Current:** `/health` returns `machineId`, `nodePublicKey`, `appVersion`, `gitSha`, `schemaVersion`. Does NOT return `selfSyncUrl`.

**Change:** Add `selfSyncUrl` and `selfSyncUrlSource` to the `/health` response. Useful for remote debugging and probe auto-fill.

```typescript
// Added to health response:
selfSyncUrl?: string;             // e.g. "http://100.113.212.131:8080"
selfSyncUrlSource?: string;       // "env-var" | "tailscale-cli" | "control-plane-url"
```

This feeds into the existing probe flow — when machine A probes machine B's `/health`, machine A can show the resolved sync URL in the probe results.

### Phase 2: DB-Stored Mesh Config + Settings UI (P0)

**Goal:** All mesh configuration editable from the web UI. No env file editing, no PM2 restarts.

#### 2.1 Extend `settings` table with mesh config keys

**Current:** The `settings` table exists (migration 0000) and is used for `default_account_id` and `failover_policy` via `GET/PUT /api/settings/defaults`.

**Change:** Store mesh config as rows in the existing `settings` table with a `mesh_` key prefix. No new migration needed — the `settings` table already supports arbitrary key/value pairs.

Keys:
| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `mesh_tailscale_ip_override` | string \| null | null (auto-detect) | Manual Tailscale IP override |
| `mesh_sync_url_override` | string \| null | null (derived from IP+port) | Manual sync URL override |
| `mesh_registration_token` | string \| null | null (falls back to env var) | Bootstrap token for peer registration |

**Why not a new `mesh_config` table?** The settings table already exists, has CRUD endpoints, and adding 3 keys doesn't warrant a new migration + schema + API surface. Keep it simple.

**Security:** The registration token is stored as-is (same as the current env var approach — it's a shared bootstrap secret, not a user credential). The `/api/settings` endpoints are already behind authentication. If the operator wants encryption at rest, they configure PG-level encryption — consistent with how `CREDENTIAL_ENCRYPTION_KEY` and other secrets are handled.

**Startup config resolution order** (for each setting):
1. DB value (if non-null) — takes priority, editable from UI
2. Env var (if set) — override for headless/scripted deploys
3. Auto-detect / hardcoded default

**Change propagation:** Token and IP override changes take effect on the next request that reads them. No restart required because:
- Token: `getRegistrationToken()` already reads from config on each request — extend it to check DB first
- IP override: cached in memory but `PUT /api/mesh/config` invalidates the cache

#### 2.2 `GET/PUT /api/mesh/config` endpoints

New endpoints (separate from generic `/api/settings` to keep mesh config cohesive):

- `GET /api/mesh/config` — returns current mesh identity + config:
  ```typescript
  {
    machineId: string;
    hostname: string;
    tailscaleIp: string | null;       // resolved value
    tailscaleIpSource: "db" | "env" | "auto-detect" | null;
    syncUrl: string;                   // resolved value
    syncUrlSource: "db" | "env" | "derived";
    registrationTokenConfigured: boolean;  // never expose the actual token
    registrationTokenSource: "db" | "env" | null;
    publicKey: string | null;          // Ed25519 public key (truncated in UI, full here)
  }
  ```
- `PUT /api/mesh/config` — update mesh settings:
  ```typescript
  {
    tailscaleIpOverride?: string | null;   // null clears → revert to auto-detect
    syncUrlOverride?: string | null;       // null clears → revert to derived
    registrationToken?: string | null;     // null clears → falls back to env var
  }
  ```
  - Validates IP format, URL format (same SSRF checks as peer URLs)
  - Returns the resolved config after update (same shape as GET)

#### 2.3 Settings → Mesh section in web UI

New "Mesh" tab or section on `/settings` page:

- **Machine ID** — read-only (from `/api/mesh/config`)
- **Tailscale IP** — shows resolved value + source badge ("auto-detected" / "env override" / "manual override"), with editable input for manual override
- **Sync URL** — shows resolved value + source badge, with editable input for manual override
- **Registration Token** — password-masked input. Shows "Configured (from DB)" / "Configured (from env var)" / "Not configured" status. "Generate random" button creates a 32-byte hex token. "Copy" button for pasting to the other machine's Settings.
- **Public Key** — read-only, truncated display + copy-to-clipboard

"Save" calls `PUT /api/mesh/config`, shows success/error toast. No restart required.

#### 2.4 Token management UX

- **Generate** button creates `crypto.randomBytes(32).toString('hex')` client-side
- **Copy-to-clipboard** for pasting into the other machine's Settings UI
- Warning banner if token is empty: "Registration token not set — reverse registration will be skipped when adding peers"
- Warning if token changes while active peers exist: "Changing the token will break reverse registration with existing peers unless they update their token too"

### Phase 3: Add Peer Flow Improvements (P0)

**Goal:** Surface actionable context when peering fails. The mechanical flow (add locally → reverse register → report result) already works; the gap is error clarity and pre-flight validation.

#### 3.1 Pre-flight token compatibility check

**Current:** The probe checks reachability and extracts identity, but doesn't verify token compatibility. An operator can successfully probe a peer, click Add, and then get a reverse registration failure because tokens don't match.

**Change:** Add a token status indicator to the probe results:

- New field in probe response: `registrationTokenConfigured: boolean` — whether the remote peer has a registration token set (derived from presence of the `/api/sync/peers/register` endpoint accepting requests vs returning 503)
- In the Add Peer dialog, after a successful probe, show:
  ```
  ✓ Remote is reachable (v0.5.6, schema 27)
  ✓ Registration token configured on remote
  ──────────────────────────────────
  [Add Peer]
  ```
  Or:
  ```
  ✓ Remote is reachable (v0.5.6, schema 27)
  ✗ Remote has no registration token — reverse registration will fail
  ──────────────────────────────────
  [Add Peer Anyway]  [Open Settings → Mesh]
  ```

Implementation: The probe endpoint (`GET /api/sync/peers/probe`) already calls the remote's `/health`. Extend it to also attempt a lightweight check against the remote's registration endpoint (e.g., `HEAD /api/sync/peers/register` or derive from a new `/health` field `registrationEnabled: boolean`). The simpler approach is adding `registrationEnabled` to the `/health` response — one extra boolean, no extra HTTP request during probe.

#### 3.2 Actionable error messages for reverse registration

**Current:** The backend returns descriptive error codes (`PEER_REGISTRATION_DISABLED`, `PEER_REGISTRATION_TOKEN_INVALID`, etc.) with explanatory messages. But the frontend shows either a generic toast ("reverse registration failed — retry from the peer row") or the raw backend error string.

**Change:** Map error codes to actionable, operator-friendly messages in the frontend:

| Backend Error Code | Current Frontend Display | Improved Frontend Display |
|---|---|---|
| `PEER_REGISTRATION_DISABLED` | Raw: "Peer registration requires SYNC_PEER_REGISTRATION_TOKEN" | "Remote peer has no registration token configured. Open **Settings → Mesh** on the remote machine to set one." |
| `PEER_REGISTRATION_TOKEN_MISSING` | Raw: "X-Sync-Registration-Token header is required" | "This node has no registration token configured. Open **Settings → Mesh** to set one." |
| `PEER_REGISTRATION_TOKEN_INVALID` | Raw: "Peer registration token is invalid" | "Token mismatch — the tokens on this node and the remote peer don't match. Check **Settings → Mesh** on both machines." |
| `INVALID_SYNC_URL` | Raw: "syncUrl must be a valid URL..." | "This node's Sync URL (`<url>`) is not reachable from the remote peer. Check **Settings → Mesh → Tailscale IP**." |
| Connection refused | "Probe failed" | "Could not connect to `<url>`. Is the remote control plane running? Check `pm2 list` on the remote machine." |
| Timeout | "Probe failed" | "Remote peer at `<url>` did not respond within 5 seconds. Check Tailscale connectivity: `tailscale ping <ip>`." |

Implementation: A `mapReverseRegistrationError(errorCode: string, errorMessage: string, context: { syncUrl?: string }): string` helper in a new `packages/web/src/lib/mesh-errors.ts`, called from both the add-peer success handler and the retry handler.

#### 3.3 Automatic retry with backoff for failed reverse registrations

**Current:** Failed reverse registrations require manual "Retry" click per peer row. No automatic retry.

**Change:** After a failed reverse registration (either on initial add or on manual retry), schedule automatic background retries on the **backend**:

- Schedule: 30s → 60s → 120s → stop (3 retries, exponential backoff)
- Implementation: In-memory retry queue in the CP process (not BullMQ — this is lightweight, transient state that doesn't need persistence across restarts)
- On success: update `reverse_registration_status` to `'ok'`, clear retry state
- On final failure: update status to `'failed'`, persist last error
- Peer row in UI shows retry state: "Retrying (2/3, next in 45s)" via polling the peer list (already polls every 30s)

**Why backend, not frontend?**
- Retries should happen even if the browser is closed
- Frontend polling already refreshes peer status every 30s, so it'll pick up the result naturally
- CP process restart clears the in-memory queue — acceptable because the operator can always manually retry from the UI

### Phase 4: Operational Improvements (P1)

#### 4.1 Self-identity card on `/mesh-peers`

**Current:** The operator must navigate between `/health` (to see their own identity) and `/mesh-peers` (to manage peers). No consolidated view of "who am I in this mesh?"

**Change:** New `SelfIdentityCard` component at the top of `/mesh-peers`:

- **Machine ID** + **Hostname** — identifies this node
- **Tailscale IP** — resolved value + source badge (auto-detect / env / manual override)
- **Sync URL** — the URL other peers use to reach this node
- **Public Key** — truncated + copy button
- **Registration Token** — "Configured" / "Not configured" (link to Settings → Mesh if not configured)

Data source: `GET /api/mesh/config` (from Phase 2.2). **If Phase 2 hasn't shipped yet**, read from `/health` (which already exposes machineId, nodePublicKey, and soon selfSyncUrl from Phase 1.2).

#### 4.2 Stale peer cleanup

- Peers with `last_seen` older than 7 days get a "Stale" badge
- Bulk cleanup action: "Remove N stale peers"
- No auto-removal — manual confirmation required (operators may intentionally have offline peers)

#### 4.3 Version-bump script: keep `LOCAL_APP_VERSION` in sync

**Current state:** `version-bump.sh` already updates `LOCAL_APP_VERSION` via sed (lines 69-76). The `useLocalVersion()` hook fetches the live value at runtime and uses the constant only as a loading-state fallback. This is working correctly.

**Remaining issue:** The constant is currently `v0.5.1` but the repo is on `v0.5.1` — it's only stale when the operator forgets to run `version-bump.sh`. No code change needed; this is operational discipline.

**Decision:** No code change. Document in QUICKSTART.md that `version-bump.sh` is the canonical release path and it handles all version constants.

## Implementation Order

```
Phase 1 (no prereqs — can start immediately)
├── 1.1 Auto-detect Tailscale IP        [S: 1-3h]   ← highest impact / lowest effort
└── 1.2 selfSyncUrl on /health          [XS: <1h]

Phase 2 (no prereqs — can start in parallel with Phase 1)
├── 2.1 Settings table mesh config keys  [S: 1-3h]
├── 2.2 GET/PUT /api/mesh/config         [M: 3-8h]   ← depends on 2.1
├── 2.3 Settings → Mesh UI              [M: 3-8h]   ← depends on 2.2
└── 2.4 Token management UX             [S: 1-3h]   ← depends on 2.3

Phase 3 (depends on Phase 2 for token-from-DB; probe improvements can start earlier)
├── 3.1 Pre-flight token compat check   [S: 1-3h]   ← depends on 2.2 (for registrationEnabled on /health)
├── 3.2 Actionable error messages        [S: 1-3h]   ← no prereqs (frontend-only mapping)
└── 3.3 Retry with backoff              [M: 3-8h]   ← no prereqs (backend in-memory queue)

Phase 4 (P1 — after core flow is solid)
├── 4.1 Self-identity card              [S: 1-3h]   ← depends on 1.2 or 2.2
├── 4.2 Stale peer cleanup             [S: 1-3h]   ← no prereqs
└── 4.3 Version-bump constant          [—: no change needed]
```

**Critical path:** 1.1 → deploy to fleet → validates auto-detection. In parallel: 2.1 → 2.2 → 2.3 → 3.1.

**Total estimated effort:** ~25-45 hours across all phases.

## Testing Strategy

Each phase must include tests before merge:

| Phase | Unit Tests | Integration Tests | E2E (Playwright) |
|-------|-----------|------------------|-------------------|
| 1.1 Auto-detect | `detectTailscaleIp()` with mocked `execSync` (installed/not-installed/timeout) | — | — |
| 1.2 /health selfSyncUrl | Health route handler test asserting new fields | — | — |
| 2.1-2.2 Config API | `GET/PUT /api/mesh/config` with DB assertions | Config resolution order (DB > env > auto-detect) | — |
| 2.3-2.4 Settings UI | — | — | Settings → Mesh render, edit, save, generate token |
| 3.1 Token compat | Probe response shape test with registrationEnabled | — | Add peer dialog shows token status after probe |
| 3.2 Error messages | `mapReverseRegistrationError()` unit tests for each code | — | Add peer with bad token shows actionable message |
| 3.3 Retry | Retry queue unit tests (schedule, backoff, max attempts, success stops retries) | — | — |
| 4.1 Identity card | — | — | `/mesh-peers` shows self-identity card with correct values |
| 4.2 Stale cleanup | — | — | Stale badge renders, bulk cleanup action |

## Migration & Upgrade Path

**Existing env-var deployments (the current fleet) are unaffected:**

1. Env vars continue to work as before. DB config is checked first, but if no DB values are set, the env var chain kicks in exactly as today.
2. After upgrading, the operator can optionally move to DB config by visiting Settings → Mesh and saving values there. Once saved to DB, the env vars become optional overrides.
3. If an operator sets a value in both DB and env var, **DB wins** (the UI-configured value takes priority). The Settings UI shows the source ("from DB" / "from env var") so there's no ambiguity.
4. To revert to env-var-only config: clear the DB values via Settings → Mesh (set fields to empty), and the env vars take over again.

## Non-Goals

- **mDNS / Bonjour discovery** — Tailscale already provides discovery; no second layer needed
- **Certificate-based mutual auth** — Ed25519 signatures + Tailscale WireGuard are sufficient
- **Multi-hop proxy** — all peers must be directly reachable via Tailscale
- **Automatic token distribution** — the operator must explicitly share the token between machines (security boundary)
- **Mesh health dashboard (replication lag, conflict rate charts)** — useful but large scope (L effort); better as its own §33.13 item
- **Bidirectional connection test** — valuable but requires the remote to probe back to this node, which is a complex networking feature; defer to §33.13

## Success Criteria

1. A new operator can add a peer **entirely from the web UI** — no SSH, no env files, no PM2 restarts (assuming initial install is done)
2. "Discover → Add → Bidirectional" takes **< 30 seconds** with clear success/failure feedback at every step
3. Every reverse registration failure shows an **actionable error message** pointing to the specific fix (Settings → Mesh, check token, check Tailscale connectivity)
4. Tailscale IP is **auto-detected** — the `TAILSCALE_IP` env var becomes an optional override only
5. The operator can see their **node identity** (machine ID, sync URL, token status) from the web UI without SSH
