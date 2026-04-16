# Mesh Peering UX & Reliability Overhaul — §33.12

> Created: 2026-04-16
> Revised: 2026-04-16 (v3 — post-review rewrite)
> Status: Planned
> Priority: P0
> Depends on: §33.7 (peer UX), §33.8 (bidirectional registration)

## Motivation

Adding a mesh peer today requires SSH to each machine to set env vars (`TAILSCALE_IP`, `SYNC_PEER_REGISTRATION_TOKEN`), rebuild, restart PM2. A 2026-04-16 live fleet exercise (laptop + macmini) took ~2 hours of debugging for what should be a 30-second flow.

### Post-mortem: what broke, what's fixed, what's still open

| Step | Failure | Root Cause | Fix | Still open? |
|------|---------|------------|-----|-------------|
| Discover peers | 0 candidates | `tailscale` binary not in macOS PATH | PR #599 | **No** |
| Add peer | ONE-WAY, no error | PM2 `env` block shadowed `SYNC_PEER_REGISTRATION_TOKEN` | PR #596 | **Structural** — PM2 env blocks override `process.env`; every new env var needs PM2 config update |
| Reverse registration | `INVALID_SYNC_URL` | `selfSyncUrl` was `http://localhost:8080` | PR #602 | **Partial** — requires manually setting `TAILSCALE_IP` env var per machine |
| Version display | Stale version banner | `LOCAL_APP_VERSION` hardcoded in web bundle | PR #603 | **Yes** — `version-bump.sh` updates the constant but doesn't `git add` it (line 124 omits `mesh-version.ts`) |
| Macmini reverse reg | Failed silently | `TAILSCALE_IP=127.0.0.1` in `.env.mesh` (typo) | Manual sed fix | **Yes** — auto-detection would eliminate this; but env var override currently has highest priority, so a bad env still wins |

**Key insight:** The mechanical flow (add → reverse register → report result) works. The remaining gap is **configuration brittleness** — operators must SSH to set env vars, and any typo fails silently. The deeper structural issues are: the registration token lives in env vars (not editable from web UI), self-identity is frozen at startup (can't change without restart), and reverse registration errors lose their structured error codes before reaching the frontend.

## Current State (what already works)

| Capability | Status | Location |
|-----------|--------|----------|
| selfSyncUrl from TAILSCALE_IP env var | Done | `index.ts:489-491` |
| Tailscale binary resolution (macOS + Linux) | Done | `peer-discovery.ts:104-133` |
| Peer discovery via `tailscale status --json` | Done | `GET /api/sync/peers/discover` |
| Health probe before adding peer (gates Save, auto-fills identity) | Done | `MeshPeersPage.tsx:318-365` |
| Reverse registration on add (result included in response) | Done | `sync-peers.ts:1050-1064` |
| Reverse registration status in UI (toasts + "One-way" badge + Retry) | Done | `MeshPeersPage.tsx:416-423` |
| Error persistence (status + error + timestamp) | Done | migration 0026 columns (raw SQL, not in Drizzle schema) |
| Token validation (timing-safe SHA-256) | Done | `sync-peers.ts:207-211` |
| Ed25519 signature auth (60s timestamp window) | Done | `peer-registration.ts` |
| Rate limiting on registration | Done | 10 req/60s on `/register` |
| Version observability per peer | Done | `/health` + mesh-peers version drift UI |
| Probe/discover endpoints with SSRF protection | Done | `GET /api/sync/peers/probe`, `GET /api/sync/peers/discover` |

## Architectural Constraints (CRITICAL — must respect these)

These constraints were discovered during review and govern every design decision below:

### C1: `settings` table is mesh-synced — CANNOT store local mesh config there

The `settings` table has a sync capture trigger (migration `0021:177-179`) that writes every row change to `sync_change_log` via `to_jsonb(NEW)` (line 99). The table is classified as `mutable` in `shared/types/sync.ts:164`.

**Consequence:** Storing `mesh_registration_token` in `settings` would:
1. Sync the token to every peer via the change log — violating the security boundary
2. Cause key collisions when two nodes write `mesh_tailscale_ip_override` (each machine's IP is different)
3. Leak the raw token into `sync_change_log.payload` JSON

**Decision:** New `mesh_local_config` table, explicitly excluded from sync triggers.

### C2: Self-identity and registration token are frozen at startup

`selfIdentity` is constructed once at `server.ts:801-808` and passed as a static object to the route plugin. `reverseRegistrationToken` is read from env at `server.ts:817-820`. Both are closed over in route handlers.

**Consequence:** "Changes take effect immediately without restart" is impossible with the current architecture.

**Decision:** Introduce a `MeshConfigProvider` that route handlers call on each request to resolve the current identity and token from DB → env → auto-detect. This is the prerequisite for making Settings → Mesh work.

### C3: Reverse registration errors lose their structured error code

`performReverseRegistration()` at `peer-reverse-registration.ts:144-153` receives the remote's JSON error response but squashes it to `HTTP ${status} ${statusText} ${bodySnippet}`. The original `error` code (e.g., `PEER_REGISTRATION_TOKEN_INVALID`) is buried inside the body snippet string.

**Consequence:** The frontend `mapReverseRegistrationError(errorCode, ...)` mapping proposed in v2 is unimplementable — there is no structured `errorCode` to map.

**Decision:** Change the backend contract first: parse the remote's JSON error response, extract `error` and `message` fields, persist them separately as `reverse_registration_error_code` + `reverse_registration_error`. Then the frontend can map codes.

### C4: `/health` is public and rate-limit exempt

`server.ts:269-271` puts `/health` on the rate-limit allowList. Adding `registrationEnabled: boolean` to `/health` would let attackers enumerate which nodes accept peer registration without rate limiting.

**Decision:** Token/registration status goes on the authenticated `GET /api/mesh/config` endpoint, not `/health`.

### C5: `version-bump.sh` doesn't `git add` mesh-version.ts

Line 124 stages `packages/*/package.json packages/web/src/components/Sidebar.tsx CHANGELOG.md` but omits `packages/web/src/lib/mesh-version.ts`. The sed replacement (lines 69-76) runs but the file is left unstaged. Current `LOCAL_APP_VERSION` is `v0.5.1` while packages are at `0.5.6`.

## Scope

### Phase 0: Fix Existing Bugs (P0, prerequisite)

These are real bugs discovered during review that should be fixed before new feature work.

#### 0.1 Fix `version-bump.sh` git add omission

Add `packages/web/src/lib/mesh-version.ts` to the `git add` command at line 124:

```bash
# Before:
git add packages/*/package.json packages/web/src/components/Sidebar.tsx CHANGELOG.md
# After:
git add packages/*/package.json packages/web/src/components/Sidebar.tsx packages/web/src/lib/mesh-version.ts CHANGELOG.md
```

Also update `LOCAL_APP_VERSION` to `v0.5.6` to match current packages.

#### 0.2 Add reverse_registration columns to Drizzle schema

Migration 0026 added `reverse_registration_status`, `reverse_registration_error`, `reverse_registration_at` to `sync_nodes`, but they are NOT declared in `packages/control-plane/src/db/schema.ts`. Route code bypasses Drizzle's type-safe query builder with a raw `SYNC_NODE_COLUMNS` SQL string (`sync-peers.ts:145`).

Risk: `drizzle-kit push` or `drizzle-kit generate` would see these columns as "extra" and could drop them.

Fix: Add the three columns to the `syncNodes` table definition in `schema.ts`. Then migrate the `SYNC_NODE_COLUMNS` raw SQL to use Drizzle's column references where feasible (may be incremental — the raw SQL is deeply embedded).

#### 0.3 Deprecate old discover endpoint

Two discover endpoints exist:
- `GET /api/sync/discover` (`sync-discover.ts`) — no tag filtering, no health probe
- `GET /api/sync/peers/discover` (`sync-peers.ts`) — tag:mesh-node filtering, health probes

The old endpoint is strictly weaker. Mark it `@deprecated` in the schema, log a warning on use, plan removal in the next minor version.

### Phase 1: Tailscale IP Auto-Detection (P0)

**Goal:** Eliminate the manual `TAILSCALE_IP` env var for most setups.

#### 1.1 Auto-detect Tailscale IP at CP startup

New function `detectTailscaleIp()` in `peer-discovery.ts`:
- Runs `tailscale ip -4` via existing `resolveTailscaleBin()`
- Caches result for process lifetime
- **Validates the result:** reject loopback (`127.0.0.0/8`), link-local (`169.254.0.0/16`), all-zeros, non-IPv4. Only accept Tailscale CGNAT range (`100.64.0.0/10`) or explicitly-allowed IPs.
- Timeout: 3 seconds — if Tailscale is down/not installed, fall through gracefully

Resolution chain with **env var validation**:
1. `TAILSCALE_IP` env var — **but validate it**: if it resolves to loopback/link-local/all-zeros, log a warning and skip it (fall through to auto-detect). This prevents the `TAILSCALE_IP=127.0.0.1` failure class.
2. `tailscale ip -4` auto-detect (cached)
3. `CONTROL_PLANE_URL` (last resort)

Log at startup: `info: selfSyncUrl resolved to http://100.113.212.131:8080 (source: tailscale-cli)` / `(source: env-var)` / `(source: control-plane-url-fallback)` / `warn: TAILSCALE_IP=127.0.0.1 is loopback, falling through to auto-detect`

Edge cases:
- **Docker:** Tailscale CLI unavailable → fall through to `CONTROL_PLANE_URL` (Docker deploys should set `TAILSCALE_IP` explicitly)
- **Tailscale not connected:** `tailscale ip -4` exits non-zero → catch → fall through
- **Multiple Tailscale accounts:** `tailscale ip -4` returns the first IPv4 — acceptable for single-user fleet

#### 1.2 Expose selfSyncUrl on `/health` (no token status)

Add to `/health` response:
```typescript
selfSyncUrl?: string;              // "http://100.113.212.131:8080"
selfSyncUrlSource?: string;        // "env-var" | "tailscale-cli" | "control-plane-url"
```

**Explicitly NOT adding:** `registrationEnabled` or any token-related field. `/health` is public and rate-limit exempt (C4). Token status belongs behind auth.

### Phase 2: Local-Only Mesh Config + Dynamic Provider (P0)

**Goal:** All mesh configuration editable from the web UI without restart.

#### 2.1 New `mesh_local_config` table (local-only, NOT synced)

New migration: `0028_mesh_local_config.sql`

```sql
CREATE TABLE IF NOT EXISTS mesh_local_config (
  key   TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- CRITICAL: NO sync trigger. This table is local-only by design.
-- Each machine stores its own identity config; it must NOT replicate.
COMMENT ON TABLE mesh_local_config IS
  'Local-only mesh identity config. Intentionally excluded from sync triggers.';
```

Add to Drizzle schema. Add to the **sync exclusion list** if one exists, or document in `MESH_COMPAT.md` that this table is intentionally not synced.

Keys:
| Key | Type | Purpose |
|-----|------|---------|
| `tailscale_ip_override` | string \| null | Manual Tailscale IP override |
| `sync_url_override` | string \| null | Manual sync URL override |
| `registration_token` | string \| null | Bootstrap token for peer registration |

**Token storage:** Stored as cleartext (same security posture as the current env var approach — it's a shared bootstrap secret, not a user credential). The table is local-only, never enters `sync_change_log`.

#### 2.2 `MeshConfigProvider` — dynamic config resolution

New module: `packages/control-plane/src/mesh/mesh-config-provider.ts`

```typescript
type MeshConfig = {
  tailscaleIp: string | null;
  tailscaleIpSource: 'db' | 'env' | 'auto-detect' | null;
  syncUrl: string;
  syncUrlSource: 'db' | 'env' | 'derived';
  registrationToken: string | null;
  registrationTokenSource: 'db' | 'env' | null;
};

class MeshConfigProvider {
  constructor(private db: Database, private autoDetectedIp: string | null) {}

  async resolve(): Promise<MeshConfig> {
    // 1. Read mesh_local_config from DB
    // 2. Merge with env vars (DB wins when non-null)
    // 3. Apply auto-detected IP when both DB and env are null
    // 4. Derive syncUrl from IP + PORT when no explicit override
  }

  async update(changes: Partial<MeshConfigInput>): Promise<MeshConfig> {
    // Upsert to mesh_local_config, return resolved config
  }
}
```

**Integration:** Replace static `opts.selfIdentity` and `opts.reverseRegistrationToken` in route handlers with calls to `meshConfigProvider.resolve()`. This is the most invasive change — `tryReverseRegistration()`, `authorizePeerRegistration()`, and the `selfIdentity` construction in `server.ts` all need to read from the provider instead of closed-over static values.

**Approach:** Pass `meshConfigProvider` as a route option. On each reverse registration or inbound registration request, call `resolve()` to get the current config. The auto-detected IP is computed once at startup and cached in the provider; DB/env values are read per-request (the DB read is a single-row lookup by key — negligible cost).

#### 2.3 `GET/PUT /api/mesh/config` endpoints

These endpoints are **authenticated** (same auth as `/api/settings`).

`GET /api/mesh/config`:
```typescript
{
  machineId: string;
  hostname: string;
  tailscaleIp: string | null;
  tailscaleIpSource: "db" | "env" | "auto-detect" | null;
  syncUrl: string;
  syncUrlSource: "db" | "env" | "derived";
  registrationTokenConfigured: boolean;   // NEVER expose the actual token value
  registrationTokenSource: "db" | "env" | null;
  publicKey: string | null;
}
```

`PUT /api/mesh/config`:
```typescript
{
  tailscaleIpOverride?: string | null;    // null = clear, revert to auto-detect
  syncUrlOverride?: string | null;        // null = clear, revert to derived
  registrationToken?: string | null;      // null = clear, fall back to env var
}
```

Validation:
- IP: must be valid IPv4, reject loopback/link-local/all-zeros (same validation as Phase 1.1)
- URL: same SSRF checks as peer URLs (`validateSyncUrl`)
- Token: non-empty string if provided; allow null to clear

**Rate limiting:** Apply the global rate limit (not on the `/health` allowlist).

#### 2.4 Settings → Mesh section in web UI

New "Mesh" section on `/settings` page:

- **Machine ID** + **Hostname** — read-only
- **Tailscale IP** — resolved value + source badge ("auto-detected" / "env override" / "manual"), editable input for override
- **Sync URL** — resolved value + source badge, editable input for override
- **Registration Token** — **write-only secret UX**:
  - Shows status: "Configured (DB)" / "Configured (env var)" / "Not configured"
  - Input field for entering a new token (never pre-filled with existing value)
  - "Generate" button: creates `globalThis.crypto.getRandomValues(new Uint8Array(32))` → hex string (NOT `crypto.randomBytes` which is Node.js-only)
  - "Copy" button: only available immediately after Generate or manual input, while the value is still in local component state. Once saved and the dialog closes, the raw token is no longer accessible (write-only).
  - Clear button to remove DB token (falls back to env var)
- **Public Key** — read-only, truncated + copy button
- Warning if token not configured: "Registration token not set — adding this node as a peer on another machine will require manual retry after configuring a matching token on both sides."
- Warning on token change: "Changing the token only affects future reverse registration attempts. Existing peer sync connections use Ed25519 key auth, not the bootstrap token."

"Save" calls `PUT /api/mesh/config`, shows resolved config after save. No restart required (C2 resolved by MeshConfigProvider).

### Phase 3: Structured Error Contract + Frontend Mapping (P0)

**Goal:** Reverse registration failures show actionable, specific fix instructions in the UI.

#### 3.1 Preserve structured error codes from reverse registration

**Backend change** in `peer-reverse-registration.ts`:

Currently `describeHttpError()` returns `HTTP ${status} ${statusText} ${bodySnippet}` — the remote's structured `error` code is buried in the snippet.

Change: When the remote returns JSON with an `error` field, extract and preserve it:

```typescript
type ReverseRegistrationResult = {
  status: 'ok' | 'failed';
  error?: string;           // human-readable (existing)
  errorCode?: string;       // NEW: e.g. "PEER_REGISTRATION_TOKEN_INVALID"
  httpStatus?: number;      // NEW: e.g. 403
};
```

Persist to DB: Add `reverse_registration_error_code` column to `sync_nodes` (migration 0029, and add to Drizzle schema). Update `SYNC_NODE_COLUMNS` raw SQL and `mapSyncPeerRow`.

Update `SyncPeer` shared type to include `reverseRegistrationErrorCode?: string`.

#### 3.2 Frontend error-code-to-actionable-message mapping

New module: `packages/web/src/lib/mesh-errors.ts`

```typescript
export function describeReverseRegistrationError(
  errorCode: string | null | undefined,
  errorMessage: string | null | undefined,
  context: { syncUrl?: string },
): { title: string; action: string } {
  switch (errorCode) {
    case 'PEER_REGISTRATION_DISABLED':
      return {
        title: 'Remote has no registration token',
        action: 'Ask the remote operator to configure a token in Settings → Mesh.',
      };
    case 'PEER_REGISTRATION_TOKEN_INVALID':
      return {
        title: 'Token mismatch',
        action: 'The tokens on this node and the remote don\'t match. Check Settings → Mesh on both machines.',
      };
    case 'PEER_REGISTRATION_TOKEN_MISSING':
      return {
        title: 'No token configured locally',
        action: 'Set a registration token in Settings → Mesh before adding peers.',
      };
    case 'INVALID_SYNC_URL':
      return {
        title: `Sync URL not reachable from remote`,
        action: `This node's Sync URL (${context.syncUrl ?? 'unknown'}) cannot be reached by the remote peer. Check Settings → Mesh → Tailscale IP.`,
      };
    case 'PEER_REGISTRATION_INVALID_SIGNATURE':
      return {
        title: 'Signature verification failed',
        action: 'The Ed25519 signature was rejected. This may indicate a clock skew >60s between nodes. Check system time on both machines.',
      };
    default:
      return {
        title: 'Reverse registration failed',
        action: errorMessage ?? 'Check logs for details.',
      };
  }
}
```

Use in: add-peer success handler (`MeshPeersPage.tsx:416-423`), retry handler (`MeshPeersPage.tsx:1362-1382`), and the `ReverseRegistrationBadge` tooltip.

#### 3.3 Pre-flight token status in probe

Extend the existing probe flow to surface token compatibility **without putting token info on `/health`**.

Approach: After the probe succeeds (remote is reachable), the Add Peer dialog makes a second lightweight request to the local CP:

`GET /api/mesh/config/preflight?targetSyncUrl=<url>`

This endpoint:
1. Reads local config: does this node have a registration token?
2. Attempts a **non-mutating token check** against the remote: sends a minimal `POST /api/sync/peers/register` with a deliberately incomplete body (missing required fields like `machineId`) but WITH the token header. If the remote returns `PEER_REGISTRATION_TOKEN_INVALID` (403), tokens don't match. If it returns `PEER_REGISTRATION_DISABLED` (503), remote has no token. If it returns `INVALID_MACHINE_ID` (400), the token was accepted — tokens match.

**Why this works:** The remote's `authorizePeerRegistration` checks token before body validation. A 400 "missing machineId" means the token gate passed. This avoids needing a new endpoint on the remote side (all existing nodes already have the registration endpoint).

**Rate limiting:** The preflight counts toward the remote's registration rate limit (10/60s). Document this. The preflight is optional — operator can skip it and add the peer directly.

Display in Add Peer dialog after probe:
```
✓ Remote is reachable (v0.5.6, schema 27)
✓ Registration tokens compatible
───────────────────────────────
[Add Peer]
```

Or:
```
✓ Remote is reachable (v0.5.6, schema 27)
✗ Token mismatch — check Settings → Mesh on both machines
───────────────────────────────
[Add Peer Anyway]  [Settings → Mesh]
```

### Phase 4: Backend Retry + Operational Improvements (P1)

#### 4.1 Automatic retry with backoff

After failed reverse registration, schedule retries on the **backend**:

- Schedule: 30s → 60s → 120s → stop (3 retries)
- Implementation: In-memory retry map in the CP process keyed by `peerId`
  - `Map<string, { attempt: number; nextAt: number; timer: ReturnType<typeof setTimeout> }>`
  - Manual retry via UI clears any pending automatic retry for that peer (dedup)
  - Process restart clears the map — acceptable because the operator can manually retry
- On success: update `reverse_registration_status` to `'ok'`, remove from retry map
- On final failure: persist last error, remove from retry map

**Observability:** Add transient fields to the peer list response when the retry map has an entry:
```typescript
// Added to SyncPeer response when a retry is in-flight:
retryAttempt?: number;       // 1, 2, or 3
retryMaxAttempts?: number;   // always 3
retryNextAt?: string;        // ISO timestamp of next attempt
```

These come from the in-memory map, not the DB. If the CP restarts, these fields disappear — the row still shows `reverse_registration_status: 'failed'` and the operator can manually retry.

Frontend: The peer row shows "Retrying (2/3, next in 45s)" when `retryAttempt` is present. The existing 30s poll interval will naturally pick up status changes.

#### 4.2 Self-identity card on `/mesh-peers`

New `SelfIdentityCard` component at the top of `/mesh-peers`:

- Machine ID + Hostname
- Tailscale IP + source badge
- Sync URL
- Public Key (truncated + copy)
- Registration Token status + link to Settings → Mesh

Data source: `GET /api/mesh/config` (Phase 2.3).

#### 4.3 Stale peer cleanup

- Peers with `last_seen` older than 7 days get a "Stale" badge
- Bulk cleanup action: "Remove N stale peers" (confirmation required)
- No auto-removal — manual only

## Implementation Order

```
Phase 0: Bug fixes (can start immediately, independent)
├── 0.1 Fix version-bump.sh git add      [XS: <1h]
├── 0.2 Drizzle schema alignment          [S: 1-3h]
└── 0.3 Deprecate old discover endpoint   [XS: <1h]

Phase 1: Auto-detection (no prereqs)
├── 1.1 detectTailscaleIp() + validation  [S: 1-3h]  ← highest impact / lowest effort
└── 1.2 selfSyncUrl on /health            [XS: <1h]

Phase 2: DB config + dynamic provider (no prereqs, can parallel with Phase 1)
├── 2.1 mesh_local_config table           [S: 1-3h]
├── 2.2 MeshConfigProvider                [M: 3-8h]  ← most invasive change (refactor static opts)
├── 2.3 GET/PUT /api/mesh/config          [S: 1-3h]  ← depends on 2.1, 2.2
└── 2.4 Settings → Mesh UI               [M: 3-8h]  ← depends on 2.3

Phase 3: Error contract + mapping (depends on Phase 2 for preflight)
├── 3.1 Structured error codes in backend [M: 3-8h]  ← no prereqs, can start early
├── 3.2 Frontend error mapping            [S: 1-3h]  ← depends on 3.1
└── 3.3 Pre-flight token check            [M: 3-8h]  ← depends on 2.3

Phase 4: Retry + operational (P1, after core is solid)
├── 4.1 Backend retry with backoff        [M: 3-8h]  ← depends on 3.1 (for structured errors)
├── 4.2 Self-identity card                [S: 1-3h]  ← depends on 2.3
└── 4.3 Stale peer cleanup               [S: 1-3h]  ← no prereqs
```

**Critical path:** Phase 0 (immediate) → Phase 1.1 (deploy to fleet) → Phase 2.1-2.2 (provider refactor) → Phase 2.3-2.4 (Settings UI) → Phase 3.

**Parallelizable:** Phase 0 || Phase 1 || Phase 2.1-2.2 || Phase 3.1 can all run concurrently.

**Total estimated effort:** ~35-55 hours across all phases.

## Testing Strategy

| Item | Unit Tests | Integration Tests | E2E (Playwright) |
|------|-----------|------------------|-------------------|
| 0.1 version-bump.sh | Shell test: run script, verify mesh-version.ts staged | — | — |
| 0.2 Drizzle schema | Compile check: Drizzle types include reverse_registration fields | — | — |
| 0.3 Deprecate discover | Route test: old endpoint returns deprecation warning header | — | — |
| 1.1 Auto-detect IP | `detectTailscaleIp()`: mocked exec (installed/not-installed/timeout/loopback-rejected) | — | — |
| 1.2 /health selfSyncUrl | Health route: assert `selfSyncUrl` and `selfSyncUrlSource` in response | — | — |
| 2.1 mesh_local_config | — | Verify table NOT in sync trigger list; `INSERT` does not create `sync_change_log` entry | — |
| 2.2 MeshConfigProvider | `resolve()`: DB > env > auto-detect priority; `update()`: writes to mesh_local_config | Config change reflected in next `tryReverseRegistration()` without restart | — |
| 2.3 /api/mesh/config | GET/PUT validation, auth required, rate limited, token never in GET response | — | — |
| 2.4 Settings → Mesh | — | — | Render, edit IP, generate token (browser `crypto.getRandomValues`), save, verify source badges |
| 3.1 Structured errors | `performReverseRegistration()`: errorCode/httpStatus extracted from remote JSON | Reverse reg with wrong token → `errorCode: 'PEER_REGISTRATION_TOKEN_INVALID'` persisted | — |
| 3.2 Error mapping | `describeReverseRegistrationError()` for each known code | — | Add peer with bad token shows actionable message in UI |
| 3.3 Preflight | Preflight endpoint: token match (400 from remote), mismatch (403), missing (503) | — | Probe + preflight shows token status in Add Peer dialog |
| 4.1 Retry | Retry map: schedule/backoff/max-attempts/success-stops/manual-clears-auto/dedup | — | — |
| 4.2 Identity card | — | — | `/mesh-peers` shows self-identity card with correct values |
| 4.3 Stale cleanup | — | — | Stale badge renders for >7d peer, bulk cleanup |

**Critical test: sync isolation** — Integration test must verify that writing to `mesh_local_config` does NOT produce a `sync_change_log` entry. This is the most important test in the entire plan.

## Migration & Upgrade Path

1. **Existing env-var deployments (current fleet) are unaffected.** Env vars continue to work. The `MeshConfigProvider` checks DB first, then env, then auto-detect. If no DB values exist, behavior is identical to today.
2. **Bad TAILSCALE_IP values are now warned.** Phase 1.1 validates env var values and falls through to auto-detect when they're loopback/link-local. Operators see a startup warning log.
3. **Opt-in migration to DB config.** After upgrading, operators can visit Settings → Mesh and save values. Once in DB, the env vars become optional overrides (DB wins when non-null).
4. **Reverting to env-only.** Clear DB values via Settings → Mesh (set to empty/null). Env vars take over.
5. **Token transition.** Changing the token in Settings → Mesh only affects future reverse registration attempts. Existing sync channels use Ed25519 peer auth, not the bootstrap token. No disruption to active sync.

## Non-Goals

- **Mesh health dashboard (replication lag, conflict rate charts)** — useful but L-effort; track as §33.13
- **Bidirectional connection test (remote probes back to this node)** — complex networking; track as §33.13
- **mDNS / Bonjour discovery** — Tailscale already provides discovery
- **Certificate-based mutual auth** — Ed25519 + Tailscale WireGuard sufficient
- **Automatic token distribution** — operator must explicitly share the token (security boundary)
- **Token encryption at rest in PostgreSQL** — same security posture as env vars; if the operator wants encryption at rest, configure PG-level TDE

## Deferred Work (related but out of scope)

- **Update stale §33.7-33.11 plan documents** — Review found 6+ features marked "undelivered" that are actually shipped. Separate docs-only PR.
- **Two-node test fixture (shared)** — Both §33.8 and §33.11 need this. Design once, share.
- **Old discover endpoint removal** — Phase 0.3 deprecates it; actual removal in a future minor version after confirming no consumers.

## Success Criteria

1. A new operator can add a peer **entirely from the web UI** — no SSH, no env files, no PM2 restarts (after initial install)
2. `TAILSCALE_IP=127.0.0.1` in an env file **does not break peering** — auto-detection falls through with a warning
3. Every reverse registration failure shows the **specific error code** and an **actionable fix instruction** pointing to Settings → Mesh or a specific diagnostic step
4. Mesh config stored in `mesh_local_config` **never appears in `sync_change_log`** — verified by integration test
5. The operator can see their node identity and change their registration token from the web UI, with changes taking effect **without CP restart**
