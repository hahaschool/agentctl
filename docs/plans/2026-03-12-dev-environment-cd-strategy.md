# Dev / Beta / Prod Environment Isolation & CD Strategy

> Date: 2026-03-12
> Status: Draft (v2 — incorporates Codex gpt-5.4/xhigh review feedback)
> Scope: Local multi-tier development environment isolation + continuous deployment gates

## Problem

AI agent development sessions (Claude Code, Codex) restart services on the developer's machine, disrupting the locally running beta/daily-use instance. There is no separation between "the environment agents are developing in" and "the environment the developer is using."

## Goals

1. **Agent dev work never disrupts the developer's running services**
2. **Multiple dev environments can coexist** (parallel agent worktrees)
3. **Promotion requires explicit approval** (dev → beta gated)
4. **Future-proof for remote deployment** (beta → prod on cloud)
5. **Minimal infrastructure overhead** (no Docker/k8s for local dev)

## Non-Goals

- Production deployment (no remote users yet, no auth/multi-user)
- Docker orchestration for local dev (overkill at this stage)
- Full CI/CD pipeline rebuild (existing 9 workflows stay)

---

## Architecture: Port-Offset Tiers + PM2 Beta

### Tier Layout

| Tier | CP (PORT) | Worker (WORKER_PORT) | Web | PG Database | Redis DB | Managed By |
|------|-----------|---------------------|-----|-------------|----------|------------|
| **beta** | :8080 | :9000 | :5173 | `agentctl` | 0 | PM2 |
| **dev-1** | :8180 | :9100 | :5273 | `agentctl_dev1` | 1 | `pnpm dev` |
| **dev-2** | :8280 | :9200 | :5373 | `agentctl_dev2` | 2 | `pnpm dev` |
| **dev-N** | :8080+N×100 | :9000+N×100 | :5173+N×100 | `agentctl_devN` | N | `pnpm dev` |

**Port conflict note:** Port 9100 is used by Prometheus node_exporter on some systems. If Prometheus is installed locally, use offset 150 instead (9150, 8230, 5323). The env-up script checks for conflicts before starting.

### Why This Approach

**Considered alternatives:**
- **Docker Compose per tier**: Too heavy for local dev, slow rebuild cycles, complicates debugging
- **Separate machines/VMs**: Overkill when port isolation suffices
- **Namespace-based (process groups)**: Fragile, no standard tooling
- **launchd (macOS) / systemd (Linux)**: Good for prod, but PM2 is already in the repo and cross-platform

**Port-Offset wins because:**
- Zero new dependencies (just env vars)
- Each tier is a full stack with its own database — no shared state contamination
- PM2 keeps beta stable with auto-restart; dev tiers are ephemeral
- Trivial to add more dev tiers (agent just picks next offset)
- Existing CI/CD workflows need minimal changes

---

## Prerequisite: De-Hardcode Ports in Application Code

> **This is the critical prerequisite.** Without it, dev tiers will cross-talk with beta.

The current codebase has hardcoded port references that must be made configurable:

### Control Plane (`packages/control-plane/src/index.ts`)
- Already reads `PORT` env var (default: 8080) — **no change needed**

### Agent Worker (`packages/agent-worker/src/index.ts`)
- Already reads `WORKER_PORT` env var (default: 9000) — **no change needed**
- Already reads `CONTROL_URL` env var — **set per tier** to point to correct CP port

### Web App — Hardcoded Values to Fix

| File | Current | Fix |
|------|---------|-----|
| `packages/web/package.json` scripts | `--port 5173` hardcoded | Read from `WEB_PORT` env var |
| `packages/web/next.config.ts` rewrites | `http://localhost:8080` hardcoded | Read from `NEXT_PUBLIC_API_URL` env var |
| `packages/web/src/hooks/use-websocket.ts:114,119` | `ws://localhost:8080/api/ws` | Read from `NEXT_PUBLIC_WS_URL` env var |
| `packages/web/src/components/InteractiveTerminal.tsx:98` | `ws://localhost:8080/api/machines/...` | Read from `NEXT_PUBLIC_WS_URL` env var |
| `packages/web/src/app/api/oauth/callback/route.ts:16` | `http://localhost:8080` fallback | Already reads `CONTROL_PLANE_URL` env — OK |

### Task Worker Dispatch
| File | Current | Fix |
|------|---------|-----|
| `packages/control-plane/src/scheduler/task-worker.ts:375` | May hardcode worker port 9000 | Use registered worker URL from DB instead |

### Scripts and Tooling
Run a repo-wide grep for `:8080`, `:9000`, `:5173`, `localhost:8080`, `localhost:9000` in all `scripts/`, `infra/`, and test fixtures. Any hardcoded reference must either:
- Be replaced with env var interpolation, OR
- Be documented as intentionally beta-only (e.g., CI test fixtures)

---

## Implementation

### Phase 0: De-Hardcode Ports (MUST DO FIRST)

1. **Web package.json**: Change `"dev"` and `"start"` scripts to read `WEB_PORT`:
   ```json
   "dev": "next dev --port ${WEB_PORT:-5173}",
   "start": "next start --port ${WEB_PORT:-5173}"
   ```
   (Or use a small wrapper script since package.json doesn't expand env vars natively.)

2. **next.config.ts**: Make rewrite destination configurable:
   ```typescript
   const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
   // rewrites use apiUrl instead of hardcoded string
   ```

3. **use-websocket.ts**: Use `NEXT_PUBLIC_WS_URL` env var:
   ```typescript
   const wsBase = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8080';
   return `${wsBase}/api/ws`;
   ```

4. **InteractiveTerminal.tsx**: Same pattern as use-websocket.ts.

5. **task-worker.ts**: Ensure worker dispatch reads the registered worker URL from the database, not a hardcoded port.

### Phase 1: Environment Files

Create tier-specific env files at the repo root:

```
.env.beta          # Current production-like config (ports 8080/9000/5173)
.env.dev-1         # First dev tier (ports 8180/9100/5273)
.env.dev-2         # Second dev tier (ports 8280/9200/5373)
.env.template      # Documented template with all variables
```

Each env file uses the **actual env var names** the code reads:

```bash
# .env.dev-1 example
TIER=dev-1

# Control Plane
PORT=8180
HOST=0.0.0.0
DATABASE_URL=postgresql://localhost:5433/agentctl_dev1
REDIS_URL=redis://localhost:6379/1

# Agent Worker
WORKER_PORT=9100
CONTROL_URL=http://localhost:8180

# Web App
WEB_PORT=5273
NEXT_PUBLIC_API_URL=http://localhost:8180
NEXT_PUBLIC_WS_URL=ws://localhost:8180

# Observability
LOG_DIR=./logs/dev-1
TIER_LABEL=dev-1
```

**Key rule:** `.env` (the default) becomes a symlink to `.env.beta`. This means:
- Existing `pnpm dev` without changes runs beta
- Agents source `.env.dev-N` before starting their tier

**Safety guardrail:** `env-up.sh` refuses to start if `TIER` is unset or empty. Agent scripts MUST explicitly `source .env.dev-N` — there is no fallback to `.env` to prevent accidentally targeting beta. The `.env → .env.beta` symlink only affects manual `pnpm dev` by the developer.

### Phase 2: Database Isolation

Each tier gets its own PostgreSQL database on the same server (port 5433):

```sql
CREATE DATABASE agentctl;           -- beta (existing)
CREATE DATABASE agentctl_dev1;      -- dev-1
CREATE DATABASE agentctl_dev2;      -- dev-2
```

**Security hardening:**
- Create per-tier PG roles with least-privilege grants (dev roles cannot touch beta DB)
- Lower per-tier connection pool max to 10 (default is 20) — prevents 3 tiers from exhausting the 100-connection PG default

**Migration strategy:**
- Migrations run per-database using the `DATABASE_URL` from the tier's env file
- A helper script `scripts/env-migrate.sh` runs `drizzle-kit migrate` against a specified tier
- Beta migrations require explicit `--tier beta` flag (safety gate)
- `env-promote.sh` includes a **schema parity check**: compares the target tier's schema hash against the source to detect drift before applying migrations
- For concurrent agent branches with conflicting migrations: merge to main resolves conflicts; the promote script runs migrations in the order defined by the migration files' numeric prefixes

### Phase 3: PM2 Beta Process Management

```javascript
// infra/pm2/ecosystem.beta.config.cjs
module.exports = {
  apps: [
    {
      name: 'agentctl-cp-beta',
      script: 'packages/control-plane/dist/server.js',
      env: {
        PORT: 8080,
        DATABASE_URL: 'postgresql://localhost:5433/agentctl',
        REDIS_URL: 'redis://localhost:6379/0',
        TIER_LABEL: 'beta',
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
    },
    {
      name: 'agentctl-worker-beta',
      script: 'packages/agent-worker/dist/server.js',
      env: {
        WORKER_PORT: 9000,
        CONTROL_URL: 'http://localhost:8080',
        TIER_LABEL: 'beta',
      },
      instances: 1,
      autorestart: true,
    },
    {
      name: 'agentctl-web-beta',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: 'packages/web',
      env: {
        WEB_PORT: 5173,
        NEXT_PUBLIC_API_URL: 'http://localhost:8080',
        NEXT_PUBLIC_WS_URL: 'ws://localhost:8080',
        TIER_LABEL: 'beta',
      },
      autorestart: true,
    },
  ],
};
```

Beta runs from **built artifacts** (`dist/`), not `pnpm dev`. This means:
- No file watchers competing with dev tiers
- Stable, restartable via `pm2 start ecosystem.beta.config.cjs`
- Dev tiers use `pnpm dev` with hot reload as usual

### Phase 4: Lifecycle Scripts

```bash
# scripts/env-up.sh <tier>
# Starts a tier (validates ports are free, loads env, starts services)

# scripts/env-down.sh <tier>
# Stops a tier (graceful shutdown, releases lock)

# scripts/env-promote.sh <source-tier> <target-tier>
# Promotes code: builds, runs migrations, restarts target tier PM2 processes
```

`env-promote.sh` is the critical script — it:
1. Takes a **full `pg_dump`** backup of the target database (schema + data, compressed)
2. Validates migration history: checks that target's applied migrations are a prefix of source's (no divergence)
3. Runs `pnpm build` from the source branch/worktree
4. Checks schema parity (drizzle introspect diff between source and target)
5. Runs migrations on the target tier's database (within a transaction where possible)
6. Restarts PM2 processes for the target tier
7. Validates health endpoints respond on target ports
8. Rolls back on failure: restore full pg_dump + restart previous build artifacts (kept in `.promote-backup/`)

### Phase 5: Agent Worktree Integration

When an agent spawns a worktree for development:

1. The orchestrator assigns the next available dev tier (dev-1, dev-2, ...)
2. The worktree gets its own `.env.dev-N` with unique ports + database
3. The agent runs `pnpm dev` in its worktree — completely isolated
4. When done, the agent's PR includes any migration files
5. Promotion to beta happens only after PR merge + explicit approval

**Tier locking (crash-safe):**
- Use `flock(2)` (via `flock` command) on `/tmp/agentctl-tier-locks/dev-N.lock` for atomic acquisition
- `env-up.sh` holds the flock FD open for the lifetime of the tier process (exec under flock)
- When the process dies, the OS automatically releases the flock — no PID-based stale-lock checking needed
- Pattern: `exec 200>/tmp/agentctl-tier-locks/dev-N.lock; flock -n 200 || exit 1` — non-blocking, fails immediately if tier is in use
- Metadata (agent ID, timestamp) is written to the lock file for debugging, but lock ownership is purely fd-based
- For future multi-machine: migrate to Redis `SETNX` with TTL or PG advisory locks

### Phase 6: GitHub Actions CD Gate (Future)

When we're ready for automated promotion:

```yaml
# .github/workflows/promote-beta.yml
name: Promote to Beta
on:
  workflow_dispatch:
    inputs:
      source_branch:
        description: 'Branch to promote'
        required: true
  pull_request:
    types: [closed]
    branches: [main]

jobs:
  promote:
    if: github.event.pull_request.merged == true || github.event_name == 'workflow_dispatch'
    runs-on: self-hosted  # Mac Mini / local runner
    environment: beta      # Requires approval in GitHub settings
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: ./scripts/env-promote.sh main beta
```

This is **not implemented now** — it's the path forward when we add a self-hosted runner on the Mac Mini.

---

## Observability

### Log Isolation

Each tier tags every log line with `TIER_LABEL` (via pino's `base` option):

```typescript
const logger = pino({ base: { tier: process.env.TIER_LABEL ?? 'unknown' } });
```

- Logs go to `LOG_DIR` per tier (e.g., `./logs/dev-1/`, `./logs/beta/`)
- The existing Vector → ClickHouse pipeline adds `tier` as a field, enabling cross-tier queries
- Debug command: `scripts/env-logs.sh <tier>` tails logs for a specific tier
- Cross-tier debugging: query ClickHouse with `WHERE tier IN ('beta', 'dev-1') AND run_id = '...'`

### Resource Monitoring

On a 16GB Mac, running 2+ full stacks can cause memory pressure. Recommendations:
- Cap PG connection pool at 10 per tier (set `DB_POOL_MAX=10` in dev env files)
- Dev tiers should not run `pnpm build` concurrently (the env-up script serializes builds via flock)
- PM2 `max_memory_restart: '512M'` on beta processes to prevent runaway memory

---

## Multi-Machine Extension (Future)

When agentctl moves to multi-machine deployment:

- Each machine runs its own tier set (beta on the primary, dev-N on worker machines)
- Tiers are scoped to `host+tier` (e.g., `mac-mini:beta`, `ec2-1:dev-1`)
- Beta spanning multiple machines requires service discovery (Tailscale MagicDNS + registered URLs in PG)
- Promotion becomes: build on CI → deploy artifacts to target machine via `ssh` + `rsync` over Tailscale → restart PM2
- This is out of scope for the current plan but the tier model extends naturally

---

## User Action Items

These are things the developer (you) needs to do manually:

### One-Time Setup (15 minutes)

1. **Create dev databases:**
   ```bash
   psql -p 5433 -c "CREATE DATABASE agentctl_dev1;"
   psql -p 5433 -c "CREATE DATABASE agentctl_dev2;"
   ```

2. **Review and adjust `.env.beta`** after we create it (verify your current settings are captured)

3. **Install PM2 globally** (if not already):
   ```bash
   npm install -g pm2
   ```

4. **Start beta tier via PM2:**
   ```bash
   pm2 start infra/pm2/ecosystem.beta.config.cjs
   pm2 save  # Persist across reboots
   ```

### Ongoing Usage

- **Your daily workflow stays the same** — beta runs on the standard ports (8080/9000/5173)
- **When agents are developing:** They use dev-1, dev-2, etc. — you won't notice
- **To see agent dev work:** Open `http://localhost:5273` (dev-1) or `http://localhost:5373` (dev-2)
- **To promote after PR merge:** Run `./scripts/env-promote.sh main beta`

### When Moving to Cloud

- Add a self-hosted GitHub Actions runner on the deployment target
- Enable the `promote-beta.yml` workflow
- Add the `beta` environment with protection rules in GitHub repo settings
- Eventually: add `prod` tier with the same pattern but on a remote machine via Tailscale

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Port conflict with other services | env-up.sh checks port availability before starting; fallback offset available |
| Hardcoded ports cause cross-talk | Phase 0 de-hardcodes all ports; env vars drive all connections |
| Beta data corruption from bad migration | Schema parity check + pg_dump backup before promote; rollback on failure |
| Dev tier left running, eating resources | flock-based locks auto-release on process death; stale-lock reaper in env-up.sh |
| Database drift between tiers | Schema hash comparison in promote script; migrations ordered by numeric prefix |
| PG connection pool exhaustion | Per-tier pool cap of 10; 3 tiers = 30 connections (well under PG default of 100) |
| Memory pressure on 16GB Mac | PM2 max_memory_restart; dev tiers serialize builds; monitor with `pm2 monit` |
| Redis DB isolation incomplete | Acceptable for local dev (shared memory/eviction); upgrade to separate Redis instances for prod |

---

## Implementation Priority

| Phase | Effort | Blocks |
|-------|--------|--------|
| 0. De-hardcode ports | 2-3 hours | Nothing — start here |
| 1. Env files + port config | 1-2 hours | Phase 0 |
| 2. Database isolation | 30 min | Phase 1 |
| 3. PM2 beta config | 1 hour | Phase 1 |
| 4. Lifecycle scripts | 2-3 hours | Phases 1-3 |
| 5. Agent worktree integration | 2-3 hours | Phase 4 |
| 6. GitHub Actions CD | 1-2 hours | Self-hosted runner setup |

**Total: ~10-15 hours of implementation work** (Phases 0-5 can be done by agents)

Phase 6 depends on the user setting up a self-hosted runner, which is a future step.

---

## Codex Review Log

**Round 1 (gpt-5.4 / xhigh):** 5 findings — 1 critical (env var mismatch + hardcoded ports), 2 high (lockfile race, migration underspec), 2 medium (pool exhaustion, log isolation). All addressed in v2.

**Round 2 (gpt-5.4 / high):** 3/5 pass, 2/5 fail (scripts not covered in Phase 0, stale-lock PID reuse risk), 2 new issues (pg_dump schema-only insufficient, .env symlink guardrail). All addressed in v2.1:
- Added scripts/tooling grep requirement to Phase 0
- Replaced PID-based stale-lock with pure fd-based flock (OS auto-releases)
- Changed pg_dump to full backup (schema + data)
- Added migration history validation
- Added TIER env var guardrail in env-up.sh
