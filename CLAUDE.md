# AgentCTL — Multi-Machine AI Agent Orchestration Platform

## Project Vision

AgentCTL is a unified control plane for remotely orchestrating AI coding agents (Claude Code, Codex, OpenClaw, NanoClaw) across multiple machines (EC2, Mac Mini, Laptop) from iOS devices. It fills a gap that no existing tool covers: fleet-wide agent management with mobile control, shared memory, and fault-tolerant multi-provider routing.

## Core Requirements

1. **iOS Remote Control** — bidirectional real-time control of agents from iPhone/iPad
2. **Multi-Machine Fleet** — manage agents on EC2, Mac Mini, laptops via Tailscale mesh
3. **Multiple Agent Types** — autonomous (long-running) + ad-hoc (one-shot) sessions
4. **Trigger Modes** — heartbeat (periodic), cron (scheduled), manual, ad-hoc
5. **Unified Memory** — cross-device memory system importing from Claude Code history + claude-mem
6. **Workspace Sync** — git worktree isolation per agent, bare-repo pattern for cross-machine
7. **Multi-Provider Failover** — LiteLLM routing across Anthropic Direct + Bedrock + Vertex AI

## Tech Stack

| Layer | Tool | Why |
|-------|------|-----|
| Language | TypeScript (primary), Python (scripts) | Agent SDK is TS-first; Python for data/ML tools |
| Agent Runtime | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) | Wraps Claude Code CLI, supports hooks/MCP/subagents |
| Process Mgmt | PM2 (single-machine) | Auto-restart, boot persistence, ecosystem config |
| Workflow | BullMQ (Redis) for MVP → Temporal.io for scale | Durable scheduling with cron/signals/approval gates |
| API Gateway | LiteLLM Proxy | Multi-provider routing, failover, cost tracking |
| Memory | Mem0 (cross-device) + CLAUDE.md (Git) + .mv2 (portable) | Hybrid: vector + graph + key-value |
| Networking | Tailscale | Zero-config mesh, MagicDNS, built-in SSH, iOS app |
| Monitoring | SSE streams + xterm.js (desktop) / parsed JSON (mobile) | Real-time agent output rendering |
| iOS Client | React Native (Expo) following Happy Coder pattern | E2E encrypted relay, push notifications |
| Database | PostgreSQL (control plane) + SQLite (per-agent local) | Durable state + lightweight per-machine storage |
| Logging | Vector → ClickHouse | Structured agent action audit trail |

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  iPhone/iPad │     │   EC2       │     │  Mac Mini   │
│  (React      │◄───►│  (Workers)  │◄───►│  (Workers)  │
│   Native)    │     │             │     │             │
└──────┬───────┘     └──────┬──────┘     └──────┬──────┘
       │                    │                    │
       │         ┌──────────┴──────────┐         │
       └────────►│   Control Plane     │◄────────┘
                 │  (FastAPI/Express)   │
                 │  ┌────────────────┐ │
                 │  │ Task Scheduler │ │  ◄── BullMQ/Temporal
                 │  │ Agent Registry │ │  ◄── PostgreSQL
                 │  │ Memory Sync    │ │  ◄── Mem0 API
                 │  │ LLM Router     │ │  ◄── LiteLLM Proxy
                 │  └────────────────┘ │
                 └─────────────────────┘
                         ▲
                    Tailscale Mesh
                   (all machines)
```

## Project Structure

```
agentctl/
├── CLAUDE.md                    # This file
├── .claude/rules/               # Agent-specific rules
│   ├── security.md
│   └── code-style.md
├── packages/
│   ├── control-plane/           # Central orchestration server
│   │   ├── src/
│   │   │   ├── api/             # REST + WebSocket endpoints
│   │   │   ├── scheduler/       # BullMQ job definitions
│   │   │   ├── registry/        # Agent registration & health
│   │   │   ├── memory/          # Mem0 integration + sync
│   │   │   └── router/          # LiteLLM config management
│   │   └── package.json
│   ├── agent-worker/            # Per-machine agent daemon
│   │   ├── src/
│   │   │   ├── runtime/         # Claude Agent SDK wrapper
│   │   │   ├── hooks/           # PreToolUse, PostToolUse, Stop
│   │   │   ├── ipc/             # Filesystem IPC (NanoClaw pattern)
│   │   │   └── worktree/        # Git worktree management
│   │   └── package.json
│   ├── mobile/                  # React Native (Expo) iOS app
│   │   ├── src/
│   │   │   ├── screens/
│   │   │   ├── components/
│   │   │   └── services/        # WebSocket, encryption, push
│   │   └── package.json
│   └── shared/                  # Shared types, utils, protocols
│       ├── src/
│       │   ├── types/
│       │   ├── protocol/        # Wire protocol definitions
│       │   └── crypto/          # TweetNaCl E2E encryption
│       └── package.json
├── infra/
│   ├── tailscale/               # ACL policies, setup scripts
│   ├── litellm/                 # Proxy config, model definitions
│   ├── docker/                  # Dockerfiles, compose files
│   └── pm2/                     # Ecosystem configs per machine
├── scripts/
│   ├── setup-machine.sh         # Bootstrap a new machine into the fleet
│   ├── import-claude-mem.ts     # Import claude-mem SQLite → Mem0
│   ├── import-claude-history.ts # Import JSONL sessions → memory
│   └── bare-repo-init.sh       # Set up bare repo + worktree pattern
├── docs/
│   ├── ARCHITECTURE.md          # Detailed architecture decisions
│   ├── RESEARCH.md              # Consolidated research findings
│   ├── LESSONS_LEARNED.md       # Pitfalls, gotchas, trade-offs
│   ├── REFERENCE_INDEX.md       # External docs, repos, links
│   └── QUICKSTART.md            # Step-by-step setup guide
└── package.json                 # Monorepo root (pnpm workspaces)
```

## Development Conventions

- **Monorepo**: pnpm workspaces, shared `tsconfig.base.json`
- **Formatting**: Biome (replaces ESLint + Prettier)
- **Testing**: Vitest for unit, Playwright for E2E
- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`)
- **Branches**: `main` (stable), `dev` (integration), `agent-{id}/{type}/{desc}` (agent work)
- **Error handling**: Always use typed errors with error codes, never bare `throw new Error()`
- **Logging**: Structured JSON via pino, include `agentId`, `machineId`, `taskId` in every log

## Key Design Decisions

1. **Agent SDK over raw API** — The SDK wraps Claude Code CLI as subprocess, inheriting all built-in tools (Read, Write, Edit, Bash, Glob, Grep, Task) for free. No need to reimplement.
2. **Filesystem IPC over gRPC** — NanoClaw proves JSON files polled at 1000ms intervals are simpler and more debuggable than binary protocols. Start here, upgrade only if latency matters.
3. **BullMQ before Temporal** — Temporal requires separate server + PostgreSQL + schema migrations. BullMQ is Redis-only, good enough for MVP. Migrate when we need durable multi-step workflows or human approval gates.
4. **SSE for monitoring, WebSocket for control** — Agent output is server→client (SSE is perfect). User commands are bidirectional (WebSocket). Don't use WebSocket for everything.
5. **Bare repo + worktree** — All working directories are worktrees under a bare `.bare/` repo. Cross-machine: push branch → pull on target → create new worktree.
6. **Prompt caching is the #1 cost lever** — Cached tokens don't count toward ITPM. 80% cache hit = 5x effective input capacity + 90% cost reduction. Design prompts for cacheability.

## Security Model

- **Network**: Tailscale mesh (WireGuard) + ACL policies restricting agent-worker ports
- **Container**: gVisor runtime (`--runtime=runsc`) + seccomp + AppArmor profiles
- **Agent**: Claude Code sandbox (bubblewrap/Seatbelt) + allowedTools/disallowedTools
- **Audit**: All agent actions logged as structured NDJSON with SHA-256 hashes
- **Secrets**: Never in code/config files. Use Tailscale env vars + machine-local `.env`

## Common Tasks

```bash
# Bootstrap a new machine into the fleet
./scripts/setup-machine.sh

# Start the control plane (dev)
cd packages/control-plane && pnpm dev

# Start an agent worker (dev)
cd packages/agent-worker && pnpm dev

# Import existing claude-mem data
pnpm tsx scripts/import-claude-mem.ts ~/.claude-mem/claude-mem.db

# Import Claude Code conversation history
pnpm tsx scripts/import-claude-history.ts ~/.claude/projects/

# Create a new agent worktree for a task
cd project && git worktree add .trees/agent-1-feature-auth -b agent-1/feature/auth

# Run LiteLLM proxy locally
cd infra/litellm && docker compose up
```

## Important Files to Read First

1. `docs/ARCHITECTURE.md` — Layer-by-layer design with data flow diagrams
2. `docs/LESSONS_LEARNED.md` — Hard-won insights; read before making architectural choices
3. `docs/REFERENCE_INDEX.md` — Categorized links to all external tools and documentation
4. `docs/QUICKSTART.md` — Step-by-step: from zero to first agent running
