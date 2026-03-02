# AgentCTL

Multi-machine AI agent orchestration platform. Remotely control Claude Code agents across EC2, Mac Mini, and laptops from iOS devices.

## What is this?

AgentCTL is a unified control plane for orchestrating AI coding agents across multiple machines. It fills a gap no existing tool covers: fleet-wide agent management with mobile control, shared memory, and fault-tolerant multi-provider LLM routing.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  iPhone/iPad │     │   EC2       │     │  Mac Mini   │
│  (React      │◄───►│  (Workers)  │◄───►│  (Workers)  │
│   Native)    │     │             │     │             │
└──────┬───────┘     └──────┬──────┘     └──────┬──────┘
       │                    │                    │
       │         ┌──────────┴──────────┐         │
       └────────►│   Control Plane     │◄────────┘
                 │  (Fastify + BullMQ) │
                 │  ┌────────────────┐ │
                 │  │ Task Scheduler │ │  ◄── BullMQ/Redis
                 │  │ Agent Registry │ │  ◄── PostgreSQL
                 │  │ Memory Sync    │ │  ◄── Mem0
                 │  │ LLM Router     │ │  ◄── LiteLLM Proxy
                 │  └────────────────┘ │
                 └─────────────────────┘
                         ▲
                    Tailscale Mesh
                   (all machines)
```

## Features

- **iOS Remote Control** -- bidirectional real-time WebSocket control from iPhone/iPad
- **Multi-Machine Fleet** -- manage agents on EC2, Mac Mini, laptops via Tailscale mesh
- **Multiple Agent Types** -- autonomous (long-running) + ad-hoc (one-shot) sessions
- **Trigger Modes** -- heartbeat, cron, manual, signal, ad-hoc
- **Unified Memory** -- Mem0 cross-device memory with prompt injection
- **Workspace Isolation** -- git worktree per agent, bare-repo for cross-machine sync; worktree cleanup on shutdown
- **Multi-Provider Failover** -- LiteLLM routing across Anthropic Direct + Bedrock + Vertex AI
- **Audit Trail** -- NDJSON action logs with SHA-256 hashes, batch ingestion API
- **E2E Encryption** -- TweetNaCl for iOS-to-control-plane communication
- **Rate Limiting** -- 100 requests/min per IP (health endpoint exempt)
- **CORS Support** -- configurable per-origin allowlist in production, permissive in development
- **Request ID Tracing** -- every response includes an `X-Request-Id` header for end-to-end tracing
- **Environment Validation** -- startup checks for required services (Redis, PostgreSQL)
- **Graceful Shutdown** -- drains connections and cleans up worktrees on SIGTERM/SIGINT
- **Global Error Handling** -- typed error codes in responses, no stack traces exposed to clients

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (Node.js 20+) |
| Agent Runtime | Claude Agent SDK |
| API Server | Fastify v5 |
| Task Queue | BullMQ (Redis) |
| Database | PostgreSQL (Drizzle ORM) |
| LLM Router | LiteLLM Proxy |
| Memory | Mem0 |
| Networking | Tailscale |
| Process Mgmt | PM2 |
| Code Quality | Biome, Vitest |

## Project Structure

```
agentctl/
├── packages/
│   ├── shared/           # Types, protocol, crypto (TweetNaCl)
│   ├── control-plane/    # Fastify API, BullMQ scheduler, Drizzle ORM
│   └── agent-worker/     # Claude Agent SDK runtime, hooks, IPC, worktrees
├── infra/
│   ├── docker/           # Dockerfiles + compose (dev & prod)
│   ├── litellm/          # LiteLLM proxy config
│   └── pm2/              # PM2 ecosystem configs
├── scripts/
│   ├── agentctl.ts       # CLI tool for fleet management
│   ├── setup-machine.sh  # Machine provisioning
│   └── db-setup.ts       # Database migrations
└── docs/                 # Architecture, research, quickstart
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8.15+
- Redis
- PostgreSQL

### Development Setup

```bash
# Clone and install
git clone https://github.com/hahaschool/agentctl.git
cd agentctl
pnpm install

# Start backing services
cd infra/docker && docker compose -f docker-compose.dev.yml up -d && cd ../..

# Run database migrations
pnpm tsx scripts/db-setup.ts

# Build all packages
pnpm build

# Start control plane (port 8080)
pnpm dev:control

# Start agent worker (port 9000) — in another terminal
pnpm dev:worker
```

### CLI Tool

```bash
# Check control plane health
npx tsx scripts/agentctl.ts health

# List registered machines
npx tsx scripts/agentctl.ts machines

# List registered agents (requires database)
npx tsx scripts/agentctl.ts agents

# Start an agent with a task
npx tsx scripts/agentctl.ts start agent-1 "Fix the login bug in auth.ts"

# Send a signal to a running agent
npx tsx scripts/agentctl.ts signal agent-1 "Also update the tests"

# Search agent memory
npx tsx scripts/agentctl.ts memory search "authentication flow"

# List all scheduled jobs
npx tsx scripts/agentctl.ts schedule list

# Add a heartbeat job (every 30 seconds)
npx tsx scripts/agentctl.ts schedule add-heartbeat agent-1 ec2-us-east-1 30000

# Add a cron job (every 5 minutes)
npx tsx scripts/agentctl.ts schedule add-cron agent-2 mac-mini "*/5 * * * *"

# Remove a scheduled job
npx tsx scripts/agentctl.ts schedule remove agent-1

# Show recent runs for an agent
npx tsx scripts/agentctl.ts runs agent-1 10
```

### Docker Production Deployment

```bash
cd infra/docker
cp ../../.env.example .env  # Edit with your values
docker compose -f docker-compose.prod.yml up -d --build
```

## API Endpoints

### Control Plane (port 8080)

| Method | Endpoint                         | Description                         |
|--------|----------------------------------|-------------------------------------|
| GET    | `/health`                        | Health check                        |
| POST   | `/api/agents/register`           | Register a machine                  |
| POST   | `/api/agents/:id/heartbeat`      | Machine heartbeat                   |
| GET    | `/api/agents`                    | List registered machines            |
| POST   | `/api/agents/agents`             | Create an agent (DB required)       |
| GET    | `/api/agents/agents/list`        | List agents (DB required)           |
| GET    | `/api/agents/agents/:agentId`    | Get agent by ID (DB required)       |
| PATCH  | `/api/agents/agents/:agentId/status` | Update agent status (DB required) |
| GET    | `/api/agents/agents/:agentId/runs`   | Recent runs for agent (DB required) |
| POST   | `/api/agents/:id/start`          | Start an agent task                 |
| POST   | `/api/agents/:id/stop`           | Stop an agent                       |
| POST   | `/api/agents/:id/signal`         | Signal a running agent              |
| POST   | `/api/agents/:id/complete`       | Run completion callback             |
| GET    | `/api/agents/:id/stream`         | SSE output stream (proxied)         |
| WS     | `/api/ws`                        | WebSocket bidirectional control     |
| GET    | `/api/scheduler/jobs`            | List repeatable jobs                |
| POST   | `/api/scheduler/jobs/heartbeat`  | Create heartbeat schedule           |
| POST   | `/api/scheduler/jobs/cron`       | Create cron schedule                |
| DELETE | `/api/scheduler/jobs/:key`       | Remove a scheduled job by key       |
| DELETE | `/api/scheduler/jobs`            | Remove all jobs (?confirm=true)     |
| GET    | `/api/router/models`             | List LLM models                     |
| POST   | `/api/memory/search`             | Search agent memory                 |
| POST   | `/api/audit/actions`             | Batch-ingest audit events           |

### Agent Worker (port 9000)

| Method | Endpoint                    | Description                  |
|--------|-----------------------------|------------------------------|
| GET    | `/health`                   | Worker health + pool stats   |
| GET    | `/api/agents`               | List pool agents             |
| GET    | `/api/agents/stats`         | Aggregate pool statistics    |
| GET    | `/api/agents/:id`           | Get single agent details     |
| POST   | `/api/agents/:id/start`     | Start agent in pool          |
| POST   | `/api/agents/:id/stop`      | Stop agent                   |
| DELETE | `/api/agents/:id`           | Remove agent from pool       |
| GET    | `/api/agents/:id/stream`    | SSE output stream            |

## Testing

```bash
# Run all tests (1796 tests across 74 files)
pnpm test

# Run specific package tests
pnpm --filter @agentctl/shared test
pnpm --filter @agentctl/control-plane test
pnpm --filter @agentctl/agent-worker test
```

## Environment Variables

See [`.env.example`](.env.example) for the full list of configuration variables organized by package.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) -- layer-by-layer design with data flow diagrams
- [Quickstart](docs/QUICKSTART.md) -- from zero to first agent running
- [Lessons Learned](docs/LESSONS_LEARNED.md) -- pitfalls, gotchas, trade-offs
- [Research](docs/RESEARCH.md) -- consolidated research findings
- [Reference Index](docs/REFERENCE_INDEX.md) -- external tools and documentation

## License

Private repository. All rights reserved.
