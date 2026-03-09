# AgentCTL

AgentCTL is a monorepo for running and operating AI coding agents across multiple machines.
It combines a control plane, per-machine worker daemon, web operator UI, shared protocol/types,
deployment assets, and supporting scripts in one repository.

The long-term product vision includes mobile-first remote control and multi-provider routing.
Today, the most complete operator surface in this repo is the web app in `packages/web`,
backed by the Fastify control plane and the machine-local worker.

## What Is In This Repo Today

- `packages/control-plane`: Fastify API, WebSocket/SSE endpoints, BullMQ scheduling, Drizzle/PostgreSQL persistence, Swagger docs.
- `packages/agent-worker`: per-machine daemon for agent execution, audit reporting, worktree lifecycle, and control-plane callbacks.
- `packages/web`: Next.js operator UI for dashboard, sessions, agents, machines, discover, logs, and settings.
- `packages/mobile`: Expo/React Native package for the future mobile client. Present, but less complete than the web UI.
- `packages/shared`: shared types, protocol contracts, crypto helpers, validation utilities.
- `infra/`: Docker, PM2, LiteLLM, Tailscale, Vector/ClickHouse, ZAP, and fleet config.
- `scripts/`: CLI utilities, provisioning helpers, migration/deploy helpers, import tools.

## Current Capabilities

- Register machines and track worker heartbeats.
- Create, start, stop, signal, and inspect agents and sessions.
- Operate the system through a web UI with dashboard, logs, machine views, and settings.
- Persist agent, machine, run, and audit state in PostgreSQL.
- Schedule repeatable jobs with BullMQ and Redis.
- Route model traffic through LiteLLM and manage account-related settings in the UI.
- Search imported memory and session-related context from the control plane.
- Deploy with Docker, PM2, GitHub Actions, and Tailscale-based fleet workflows.

## Repository Layout

```text
agentctl/
├── packages/
│   ├── agent-worker/
│   ├── control-plane/
│   ├── mobile/
│   ├── shared/
│   └── web/
├── infra/
│   ├── docker/
│   ├── litellm/
│   ├── pm2/
│   ├── tailscale/
│   ├── vector/
│   └── zap/
├── scripts/
├── docs/
└── .github/workflows/
```

## Quick Start

### 1. Prerequisites

- Node.js 20+
- pnpm 8+
- Docker Desktop or local Redis/PostgreSQL installs

### 2. Install dependencies

```bash
git clone https://github.com/hahaschool/agentctl.git
cd agentctl
pnpm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

For local development, the minimum useful settings are usually:

```bash
DATABASE_URL=postgresql://agentctl:agentctl@localhost:5432/agentctl
REDIS_URL=redis://localhost:6379
CONTROL_URL=http://localhost:8080
CONTROL_PLANE_URL=http://localhost:8080
MACHINE_ID=machine-local
```

See [`.env.example`](.env.example) for the full list.

### 4. Start backing services

From the repository root:

```bash
docker compose -f infra/docker/docker-compose.dev.yml up -d
```

This brings up local Redis, PostgreSQL, and LiteLLM for development.

### 5. Start the main processes

In separate terminals:

```bash
pnpm dev:control
pnpm dev:worker
pnpm --filter @agentctl/web dev
```

Default local endpoints:

- Control plane: `http://localhost:8080`
- Swagger / API docs: `http://localhost:8080/api/docs`
- Web UI: `http://localhost:5173`
- Worker health: `http://localhost:9000/health`

### 6. Smoke-check the stack

```bash
curl http://localhost:8080/health
curl http://localhost:9000/health
```

## Useful Commands

### Root

```bash
pnpm build
pnpm check
pnpm test
pnpm test:packages
```

### Package-specific

```bash
pnpm --filter @agentctl/control-plane dev
pnpm --filter @agentctl/agent-worker dev
pnpm --filter @agentctl/web dev
pnpm --filter @agentctl/mobile start
```

### CLI utilities

The repo includes a TypeScript CLI in `scripts/agentctl.ts`.

Examples:

```bash
npx tsx scripts/agentctl.ts help
npx tsx scripts/agentctl.ts health
npx tsx scripts/agentctl.ts status
npx tsx scripts/agentctl.ts machines
npx tsx scripts/agentctl.ts agents
```

Other operational scripts live in [`scripts/`](scripts/), including:

- machine bootstrap
- deploy/migration helpers
- Claude history and memory importers
- fleet provisioning utilities

## Testing And Validation

This repo uses:

- Vitest for package and script tests
- Playwright specs in `packages/web/e2e`
- Biome for formatting and lint-style checks
- TypeScript builds as the main typecheck gate

Typical commands:

```bash
pnpm test:packages
pnpm test:scripts
pnpm --filter @agentctl/web test
pnpm --filter @agentctl/web exec playwright test
pnpm --filter @agentctl/control-plane build
```

Avoid depending on exact test counts in this README; they change frequently.

## Deployment And Ops

The repo already includes:

- CI, security audit, image build, deploy, rollback, and migration-check workflows under [`.github/workflows/`](.github/workflows/)
- Dockerfiles and compose files under [`infra/docker/`](infra/docker/)
- PM2 configs under [`infra/pm2/`](infra/pm2/)
- Tailscale ACL and setup docs under [`infra/tailscale/`](infra/tailscale/)
- Vector/ClickHouse log pipeline assets under [`infra/vector/`](infra/vector/)

For production setup details, start with [QUICKSTART](docs/QUICKSTART.md) and [SECURITY_RUNBOOK](docs/SECURITY_RUNBOOK.md).

## Documentation Map

- [Architecture](docs/ARCHITECTURE.md)
- [Quickstart](docs/QUICKSTART.md)
- [Agent Quickstart](docs/QUICKSTART-AGENT.md)
- [Roadmap](docs/ROADMAP.md)
- [Lessons Learned](docs/LESSONS_LEARNED.md)
- [Research](docs/RESEARCH.md)
- [Reference Index](docs/REFERENCE_INDEX.md)
- [Threat Model](docs/THREAT_MODEL.md)
- [Security Runbook](docs/SECURITY_RUNBOOK.md)

## README Scope

This README is intentionally high-level.
It should answer:

- what the repo contains
- which package to start with
- how to run the system locally
- where to find the authoritative deeper docs

It should not try to be the full API reference, deployment runbook, or roadmap changelog.

## License

Private repository. All rights reserved.
