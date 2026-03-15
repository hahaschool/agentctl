# CD Pipeline Management Page (`/deployment`)

## Overview

A web page for managing the local tiered deployment (beta + dev tiers). Shows real-time tier/service health, provides gated code promotion from dev tiers to beta, and tracks promotion history.

## Context

AgentCTL runs a local tiered deployment model:
- **beta** (ports 8080/9000/5173) — stable daily-use environment, managed by PM2
- **dev-1** (ports 8180/9100/5273) — isolated agent workspace, separate DB (`agentctl_dev1`)
- **dev-2** (ports 8280/9200/5373) — additional isolated environment, separate DB (`agentctl_dev2`)

Promotion from dev → beta is currently CLI-only via `scripts/env-promote.sh`. There is no UI for viewing tier status, triggering promotions, or reviewing promotion history.

## Goals

1. Visual dashboard showing all tier statuses and per-service health
2. Gated promotion workflow with automated pre-checks before allowing promote
3. Durable promotion history with success/failure tracking
4. Real-time feedback during promotion execution via SSE

## Non-Goals

- Multi-machine deployment management (future work)
- Automatic promotion triggers (cron/webhook — stay manual for now)
- Dev tier lifecycle management (start/stop dev tiers from UI — use `scripts/env-up.sh` for now)

---

## Backend

### Database Schema

**Table: `promotion_history`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK, default gen_random_uuid() |
| `source_tier` | text | e.g., "dev-1" |
| `target_tier` | text | Always "beta" for now |
| `status` | text | pending, running, success, failed |
| `checks` | jsonb | Array of `PreflightCheckResult` |
| `error` | text | Nullable, failure reason |
| `git_sha` | text | Nullable, captured via `git rev-parse HEAD` from REPO_ROOT |
| `started_at` | timestamptz | When promotion was triggered |
| `completed_at` | timestamptz | Nullable, when promotion finished |
| `duration_ms` | integer | Nullable |
| `triggered_by` | text | "web" or "cli" |

**Drizzle schema**: New file `packages/control-plane/src/db/schema-deployment.ts`, re-exported from `packages/control-plane/src/db/index.ts`.

**Migration**: Determine the correct next migration number at implementation time by inspecting `packages/control-plane/drizzle/meta/_journal.json` and the existing `.sql` files. The journal and filesystem may be out of sync — use the highest existing number + 1.

### Tier Config Discovery

New utility: `packages/control-plane/src/utils/tier-config.ts`

Discovers tiers by reading `.env.beta`, `.env.dev-1`, `.env.dev-2` from the **repo root**. The repo root is resolved via the `REPO_ROOT` environment variable (added to PM2 ecosystem config), NOT `process.cwd()` (which points to `packages/control-plane` under PM2).

Parses with `dotenv`. Extracts: `PORT`, `WORKER_PORT`, `WEB_PORT`, `DATABASE_URL`, `REDIS_URL` (Redis DB number parsed from the URL path segment, e.g., `redis://localhost:6379/1` → DB 1), `TIER`, `MACHINE_ID`.

**Secret filtering**: Excludes `CREDENTIAL_ENCRYPTION_KEY`, `DISPATCH_SIGNING_SECRET_KEY`, and any `*_SECRET*` or `*_KEY*` env vars from parsed config. Only port/host/tier metadata is exposed.

Tier configs are cached in memory on first load (they rarely change).

### Source Tier Validation

The `source` parameter in all endpoints is **whitelist-validated** against discovered tier names. Must match `/^dev-\d+$/` AND correspond to an actual `.env.<source>` file. Rejects all other values with 400.

### API Routes

New file: `packages/control-plane/src/api/routes/deployment.ts`

Registered in `server.ts` under prefix `/api/deployment`. Route plugin receives `db` (for promotion_history) and `logger` from server context. Does not need `dbRegistry` or `workerPort`.

#### `GET /api/deployment/tiers`

Returns all configured tiers with service health.

**Implementation**:
1. Load tier configs from `TierConfigLoader`
2. For each tier, probe health endpoints in parallel (5s timeout per probe):
   - CP: `GET http://localhost:{CP_PORT}/health` — parse JSON response for status
   - Worker: `GET http://localhost:{WORKER_PORT}/health` — parse JSON response
   - Web: TCP connect to `{WEB_PORT}` (not HTTP, avoids Next.js redirect issues)
3. For beta tier, also query PM2 JS API for process metrics (memory, uptime, restarts)
4. Dev tiers may have partially running services (started via `env-up.sh`) — unreachable services show as `healthy: false` without error

**Response shape**:
```typescript
type TierStatusResponse = {
  tiers: Array<{
    name: string              // "beta", "dev-1", "dev-2"
    label: string             // "Production-like", "Agent Workspace", etc.
    status: "running" | "degraded" | "stopped"
    services: Array<{
      name: string            // "cp", "worker", "web"
      port: number
      healthy: boolean
      memoryMb?: number
      uptimeSeconds?: number
      restarts?: number
      pid?: number
    }>
    config: {
      cpPort: number
      workerPort: number
      webPort: number
      database: string        // DB name only, e.g. "agentctl_dev1"
      redisDb: number
    }
  }>
}
```

#### `POST /api/deployment/promote/preflight`

Runs pre-checks without promoting. Changed to POST (not GET) because the build check has side effects (writes to `dist/`).

**Pre-checks** (run sequentially):
1. **source_health** — All 3 services in source tier responding to health checks (fast, no side effects)
2. **target_health** — All 3 services in beta tier responding (fast)
3. **migration_parity** — Compare drizzle `meta/_journal.json` entry count vs `__drizzle_migrations` row count in both source and beta DBs. Fails if beta is ahead of filesystem.
4. **build** — Run `pnpm build` as a **spawned child process** (`child_process.spawn`) in the REPO_ROOT directory. Streams stdout/stderr but does not block the event loop. Timeout: 120s.

**Request body**:
```typescript
{ source: string }  // e.g., "dev-1"
```

**Response shape**:
```typescript
type PreflightResponse = {
  ready: boolean
  checks: PreflightCheckResult[]
}

// Shared type used in both preflight and promotion history
type PreflightCheckResult = {
  name: "source_health" | "target_health" | "migration_parity" | "build"
  status: "pass" | "fail" | "running" | "skipped"
  message?: string
  durationMs?: number
}
```

#### `POST /api/deployment/promote`

Triggers a gated promotion. Acquires an in-process mutex before starting (single CP instance). Returns immediately with the promotion record ID; client connects to SSE stream for progress.

**Concurrency control**: An in-process `Mutex` (simple promise-based lock) prevents concurrent promotions. If a promotion is already running, returns 409 Conflict. This is sufficient because the CP is a single Node.js process. The mutex is preferred over a DB status check (which has a TOCTOU race) and over `pg_advisory_lock` (overkill for single-process).

**Request body**:
```typescript
{ source: string }  // e.g., "dev-1"
```

**Response shape**:
```typescript
{ id: string, status: "pending" }  // 202 Accepted
```

**Promotion pipeline** (runs async after response):
1. Insert `promotion_history` row with status=pending, git_sha from `git rev-parse HEAD`
2. Update status=running
3. Run pre-checks (same as preflight). If any fail → status=failed, emit SSE `complete` with error
4. Run `pnpm build` as spawned child process (120s timeout). Stream stdout lines as SSE `step` events
5. Run `pnpm drizzle-kit migrate` against beta DB as spawned child process
6. Restart beta PM2 services via PM2 JS API (`pm2.restart()`)
7. Poll beta health endpoints (5s interval, 30s timeout) until all 3 healthy
8. Update status=success, set completed_at and duration_ms. Emit SSE `complete`

**Rollback on failure**: If the pipeline fails after step 5 (migration succeeded but restart/health failed):
- Attempt `pm2.restart()` again (single retry)
- If still failing, record failure with error "Beta services failed to restart after migration — manual intervention required"
- Do NOT attempt to rollback migrations (irreversible by design — Drizzle migrations are forward-only)
- The SSE `complete` event includes the error and which step failed

#### `GET /api/deployment/promote/:id/stream`

SSE stream for live promotion progress.

**Event types**:
- `check` — `{ name: string, status: PreflightCheckResult['status'], message?: string }`
- `step` — `{ step: "building" | "migrating" | "restarting" | "health_check", message: string }`
- `log` — `{ line: string }` (stdout/stderr from build/migrate)
- `complete` — `{ status: "success" | "failed", durationMs: number, error?: string, failedStep?: string }`

Stream closes after `complete` event. If the promotion is already finished when client connects, immediately sends the final `complete` event and closes.

#### `GET /api/deployment/history?limit=20&offset=0`

Paginated promotion history.

**Response shape**:
```typescript
type HistoryResponse = {
  records: Array<{
    id: string
    sourceTier: string
    targetTier: string
    status: PromotionStatus
    checks: PreflightCheckResult[]
    error?: string
    gitSha?: string
    startedAt: string
    completedAt?: string
    durationMs?: number
    triggeredBy: string
  }>
  total: number
}

type PromotionStatus = "pending" | "running" | "success" | "failed"
```

### PM2 Integration

New utility: `packages/control-plane/src/utils/pm2-client.ts`

Wraps the `pm2` npm package's programmatic API. Connects with `pm2.connect({ noDaemonMode: false })` — this will NOT fork a new PM2 daemon if one isn't running; it fails gracefully.

Methods: `list()`, `describe(name)`, `restart(name)`. Each method connects, executes, and disconnects (short-lived connections to avoid holding the PM2 bus).

If PM2 is not installed or not running, all methods return graceful defaults (empty process lists, `healthy: false`). Errors are logged but don't crash the route.

---

## Frontend

### Route & Navigation

- **Route**: `packages/web/src/app/deployment/page.tsx`
- **Layout**: `packages/web/src/app/deployment/layout.tsx` (pass-through)
- **Sidebar**: Add "Deployment" item to `NAV_ITEMS` in `Sidebar.tsx` after Spaces (last position), keyboard shortcut `0`
- **Icon**: `Rocket` from Lucide

### Page Structure (Option B — Tier Cards + Side Panel)

```
+--------------------------------------------------+----------+
|  Tier Cards (2-col grid)                         | History  |
|  +------------------+ +------------------+       | Panel    |
|  | beta             | | dev-1            |       |          |
|  | CP ● Worker ● W ●| | CP ● Worker ● W ●|       | 17:30 ✓  |
|  | 118MB  2h  0 rst  | | 95MB  45m  2 rst |       | 14:10 ✓  |
|  +------------------+ +------------------+       | 22:15 ✗  |
|  +------------------+                            |          |
|  | dev-2 (stopped)  |                            |          |
|  +------------------+                            |          |
|                                                  |          |
|  Promote Gate                                    |          |
|  +----------------------------------------------+|          |
|  | Source: [dev-1 ▾]                             ||          |
|  | ✓ build  ✓ migration  ✓ source  ✓ target     ||          |
|  | [Run Preflight]  [Promote to Beta]            ||          |
|  +----------------------------------------------+|          |
+--------------------------------------------------+----------+
```

### UI States

- **Loading**: Skeleton cards for tiers, skeleton list for history
- **Error**: Error banner at top if `/api/deployment/tiers` is unreachable (CP not running)
- **Empty history**: "No promotions yet" placeholder with subtle icon
- **Promote button states**: Disabled (checks not run), Disabled (checks failed — show which), Enabled (all pass), Loading (promotion running)
- **Stopped tier**: Card shown dimmed/muted, services all show unhealthy

### Components

All in `packages/web/src/components/deployment/`:

| Component | Purpose |
|-----------|---------|
| `TierCard.tsx` | Single tier status card with service health indicators |
| `TierGrid.tsx` | 2-col grid of TierCards |
| `PromoteGate.tsx` | Source selector, pre-check indicators, promote button |
| `PreflightCheck.tsx` | Single check indicator (icon + label + status) |
| `PromotionHistory.tsx` | Side panel with scrollable promotion records |
| `PromotionRecord.tsx` | Single history entry, expandable for check details |
| `PromotionProgress.tsx` | Modal/overlay showing live SSE promotion progress |

### Page Component

`packages/web/src/views/DeploymentView.tsx` — main view component, following the pattern of SessionsPage/SessionDetailView.

### Data Fetching

TanStack Query hooks in `packages/web/src/lib/api.ts`:

| Hook | Endpoint | Refetch |
|------|----------|---------|
| `useDeploymentTiers()` | `GET /api/deployment/tiers` | Every 10s, `staleTime: 8000`, `refetchIntervalInBackground: false` |
| `usePromotionPreflight()` | `POST /api/deployment/promote/preflight` | Manual trigger via mutation |
| `usePromotionHistory()` | `GET /api/deployment/history` | On page load + after promote completes |
| `usePromoteMutation()` | `POST /api/deployment/promote` | Manual trigger |

SSE stream handled via `EventSource` in `PromotionProgress.tsx`, connected to `/api/deployment/promote/:id/stream`. On `complete` event, invalidate `useDeploymentTiers` and `usePromotionHistory` queries.

---

## Shared Types

New file: `packages/shared/src/types/deployment.ts`

```typescript
export const PROMOTION_STATUSES = ['pending', 'running', 'success', 'failed'] as const
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number]

export const PREFLIGHT_CHECK_NAMES = ['source_health', 'target_health', 'migration_parity', 'build'] as const
export type PreflightCheckName = (typeof PREFLIGHT_CHECK_NAMES)[number]

export const PREFLIGHT_CHECK_STATUSES = ['pass', 'fail', 'running', 'skipped'] as const
export type PreflightCheckStatus = (typeof PREFLIGHT_CHECK_STATUSES)[number]

export type PreflightCheckResult = {
  name: PreflightCheckName
  status: PreflightCheckStatus
  message?: string
  durationMs?: number
}

// Additional exports: TierConfig, TierStatus, ServiceHealth, PromotionRecord, PromotionEvent
```

Re-exported from `packages/shared/src/types/index.ts`.

---

## Error Handling

- Promotion failures recorded in DB with error message, failed step, and partial check results
- SSE stream sends `complete` event with error details and `failedStep` on failure
- PM2 connection failures gracefully degrade — tier shows as "unknown" status, not crash
- Health check timeouts (5s per service) — show as `healthy: false`, no error thrown
- Concurrent promotion prevention via in-process mutex — returns 409 if already running
- Rollback: PM2 restart retry on failure; migrations are not rolled back (forward-only)

## Security

- **Source validation**: Whitelist check — must match known tier names from `.env.*` files
- **Secret filtering**: `TierConfigLoader` strips all `*_KEY*`, `*_SECRET*` env vars before exposing config
- **Database info**: Only DB name exposed (e.g., "agentctl_dev1"), not full connection URL
- **Rate limiting**: Promote endpoint limited to 1 request per 30s (using existing @fastify/rate-limit)
- Local-only access — no auth required for single-developer local deployment
