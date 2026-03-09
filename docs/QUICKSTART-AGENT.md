# AgentCTL Setup — Agent Instructions

Machine-executable setup instructions. Run commands in order. All paths are relative to the repository root.

## Prerequisites Check

```bash
node -v    # Must be 20+
pnpm -v    # Must be 8+
git --version
pg_isready || echo "PostgreSQL not running"
redis-cli ping || echo "Redis not running"
```

## Install

```bash
git clone https://github.com/hahaschool/agentctl.git
cd agentctl
pnpm install
pnpm build
pnpm test
```

## Environment Setup

```bash
cp .env.example .env
```

Required variables in `.env`:

```
DATABASE_URL=postgresql://agentctl:agentctl@localhost:5432/agentctl
REDIS_URL=redis://localhost:6379
```

If PostgreSQL database doesn't exist:

```bash
createdb agentctl   # macOS/Linux with PostgreSQL installed
```

## Start Services

Terminal 1 — Control Plane:

```bash
pnpm dev:control
# Listens on http://localhost:8080
# Auto-runs database migrations on first start
```

Terminal 2 — Agent Worker:

```bash
CONTROL_PLANE_URL=http://localhost:8080 MACHINE_ID=local WORKER_PORT=9000 pnpm dev:worker
# Listens on http://localhost:9000
```

Optional runtime prerequisites on worker machines:

```bash
claude --version || echo "Claude Code CLI not installed"
codex --version || echo "Codex CLI not installed"
```

## Verify

```bash
curl -s http://localhost:8080/health | jq .status          # "ok"
curl -s http://localhost:9000/health | jq .status          # "ok"
curl -s 'http://localhost:8080/health?detail=true' | jq .  # Full dependency status
```

## Dispatch a Task

```bash
curl -s -X POST http://localhost:8080/api/agents/test-agent/start \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"List files in the current directory","model":"sonnet"}' | jq .
```

Agent auto-creates on first start. No pre-registration needed.

## Project Structure

```
packages/shared/          → Shared types, protocol, crypto (126 tests)
packages/control-plane/   → Fastify API + BullMQ scheduler + Drizzle ORM (463 tests)
packages/agent-worker/    → Agent runtime + hooks + IPC + worktree (379 tests)
scripts/agentctl.ts       → CLI tool
infra/docker/             → Dockerfiles + docker-compose.prod.yml
infra/pm2/                → PM2 ecosystem configs
```

## Key Files

- `packages/control-plane/src/index.ts` — Server entry point
- `packages/control-plane/src/api/server.ts` — Fastify server factory
- `packages/control-plane/src/api/routes/` — All HTTP/WS route handlers
- `packages/control-plane/src/api/routes/runtime-config.ts` — Canonical Claude/Codex config rollout
- `packages/control-plane/src/api/routes/runtime-sessions.ts` — Unified runtime session lifecycle
- `packages/control-plane/src/api/routes/handoffs.ts` — Cross-runtime handoff orchestration
- `packages/control-plane/src/scheduler/task-worker.ts` — BullMQ job processor
- `packages/control-plane/src/registry/db-registry.ts` — PostgreSQL CRUD
- `packages/control-plane/src/db/schema.ts` — Drizzle schema including managed sessions and handoffs
- `packages/agent-worker/src/runtime/agent-instance.ts` — Agent lifecycle
- `packages/agent-worker/src/runtime/agent-pool.ts` — Concurrent agent management
- `packages/agent-worker/src/runtime/sdk-runner.ts` — Claude Agent SDK wrapper
- `packages/agent-worker/src/runtime/codex-session-manager.ts` — Codex CLI lifecycle wrapper
- `packages/agent-worker/src/runtime/handoff-controller.ts` — Snapshot export/import orchestration
- `packages/agent-worker/src/runtime/config/runtime-config-applier.ts` — Native runtime config rendering
- `packages/agent-worker/src/hooks/` — Pre/post tool use, audit, stop hooks
- `packages/shared/src/types/` — All TypeScript type definitions
- `packages/shared/src/protocol/` — WebSocket + SSE wire protocol

## Build & Test Commands

```bash
pnpm build                                    # TypeScript compile all packages
pnpm test                                     # Run all tests
pnpm --filter @agentctl/control-plane test    # Run one package
pnpm check                                    # Biome lint
pnpm check:fix                                # Biome auto-fix
pnpm test:coverage                            # Tests with v8 coverage
```

## API Quick Reference

```bash
# Health
GET  /health                          # Simple: {status, timestamp}
GET  /health?detail=true              # Full: {status, timestamp, dependencies}

# Agents
GET  /api/agents                      # List all
POST /api/agents/:id/start            # Start (auto-creates agent)
POST /api/agents/:id/stop             # Stop
GET  /api/agents/:id/stream           # SSE output
POST /api/agents/:id/complete         # Completion callback
POST /api/agents/:id/signal           # Signal trigger

# Scheduler
GET  /api/scheduler/jobs              # List jobs
POST /api/scheduler/jobs/heartbeat    # Create heartbeat job
POST /api/scheduler/jobs/cron         # Create cron job
DELETE /api/scheduler/jobs/:key       # Remove job

# Router
GET  /api/router/models               # Available LLM models

# Memory
POST /api/memory/inject               # Inject memory context

# Runtime Config
GET  /api/runtime-config/defaults
PUT  /api/runtime-config/defaults
POST /api/runtime-config/sync
GET  /api/runtime-config/drift

# Runtime Sessions
GET  /api/runtime-sessions
POST /api/runtime-sessions
POST /api/runtime-sessions/:id/resume
POST /api/runtime-sessions/:id/fork
POST /api/runtime-sessions/:id/handoff

# WebSocket
WS   /api/ws                          # Bidirectional control
     → send: {type:"start_agent", agentId, prompt}
     → send: {type:"stop_agent", agentId}
     → send: {type:"subscribe_agent", agentId}
     → send: {type:"ping"}
```

## Docker Production

```bash
cd infra/docker
export POSTGRES_PASSWORD=secure-password
bash ../../scripts/docker-preflight.sh              # Validate env
docker compose -f docker-compose.prod.yml up -d --build
curl http://localhost:8080/health?detail=true | jq . # Verify
```
