# AgentCTL — Multi-Machine AI Agent Orchestration Platform

## Project Vision

AgentCTL is a unified control plane for remotely orchestrating AI coding agents (Claude Code, Codex, OpenClaw, NanoClaw) across multiple machines (EC2, Mac Mini, Laptop) from iOS devices. It fills a gap that no existing tool covers: fleet-wide agent management with mobile control, shared memory, and fault-tolerant multi-provider routing.

## Core Requirements

1. **iOS Remote Control** — bidirectional real-time control of agents from iPhone/iPad
2. **Multi-Machine Fleet** — manage agents on EC2, Mac Mini, laptops via Tailscale mesh
3. **Multiple Agent Types** — autonomous (long-running) + ad-hoc (one-shot) sessions
4. **Trigger Modes** — heartbeat (periodic), cron (scheduled), manual, ad-hoc
5. **Unified Memory** — PostgreSQL-native hybrid memory with Mem0 / claude-mem bridges during cutover
6. **Workspace Sync** — git worktree isolation per agent, bare-repo pattern for cross-machine
7. **Multi-Provider Failover** — LiteLLM routing across Anthropic Direct + Bedrock + Vertex AI

## Tech Stack

| Layer | Tool | Why |
|-------|------|-----|
| Language | TypeScript (primary), Python (scripts) | Agent SDK is TS-first; Python for data/ML tools |
| Agent Runtime | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) + Codex CLI | Managed Claude/Codex sessions, hooks, handoff, and runtime-specific control surfaces |
| Process Mgmt | PM2 (single-machine) | Auto-restart, boot persistence, ecosystem config |
| Workflow | BullMQ (Redis) for MVP → Temporal.io for scale | Durable scheduling with cron/signals/approval gates |
| API Gateway | LiteLLM Proxy | Multi-provider routing, failover, cost tracking |
| Memory | PostgreSQL-native hybrid memory + Mem0 / claude-mem bridge during cutover | Facts/edges/search are landing in the control plane while older surfaces are still being migrated |
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
                 │      (Fastify)      │
                 │  ┌────────────────┐ │
                 │  │ Task Scheduler │ │  ◄── BullMQ
                 │  │ Agent Registry │ │  ◄── PostgreSQL
                 │  │ Runtime Mgmt   │ │  ◄── sessions + handoff
                 │  │ Memory/Search  │ │  ◄── PG memory + bridges
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
├── .claude/rules/               # Agent-specific rules with trigger-based loading hints
│   ├── git-discipline.md        # always-on: worktree isolation, clean-main, PR-only merges
│   ├── security.md              # always-on: secrets, docker, SQL injection guardrails
│   ├── error-handling.md        # always-on: typed errors, async handling, logging
│   └── code-style.md            # on-demand: TS style, naming, testing conventions
├── packages/
│   ├── control-plane/           # Central orchestration server
│   │   ├── src/
│   │   │   ├── api/             # REST + WebSocket endpoints
│   │   │   ├── scheduler/       # BullMQ job definitions
│   │   │   ├── registry/        # Agent registration & health
│   │   │   ├── memory/          # PG memory layer + Mem0 / claude-mem bridge during cutover
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
- **Error handling**: Always use typed errors with error codes, never bare `throw new Error()`
- **Logging**: Structured JSON via pino, include `agentId`, `machineId`, `taskId` in every log

## Multi-Agent Development Workflow (MANDATORY)

All AI agents (Claude Code, Codex, or any future agent) MUST follow these rules. No exceptions.

### Rule 1: Main Is Sacred

**NEVER write directly to `main`.** Main must always be clean, buildable, and testable. A dirty main breaks the local dev environment for the human operator and every other running agent.

- No `git commit` on main. No `git cherry-pick` onto main. No `git merge` into main from an agent session.
- The ONLY way code reaches main is through a **Pull Request** that passes CI (build + lint + test).
- If you find yourself on main, create a branch IMMEDIATELY before making any changes:
  ```bash
  git checkout -b agent/<id>/<type>/<topic>  # e.g. agent/claude-1/feat/auth-flow
  ```

### Rule 2: Worktree Isolation

Every agent session that writes code MUST run in its own git worktree. This provides filesystem-level isolation — each agent has its own working directory and branch.

```bash
# Preferred: Claude Code native worktree
claude --worktree <name>

# Manual: create worktree for an agent task
git worktree add .trees/<name> -b agent/<id>/<type>/<topic>

# Subagent frontmatter (for dispatched agents):
# isolation: worktree
```

**Read-only tasks** (code review, research, analysis) MAY run on main since they don't write.

**Runtime isolation caveat:** Worktrees isolate files, NOT ports/databases/Docker. If two agents need to run dev servers simultaneously, use different ports or separate database instances.

### Rule 3: Branch Naming Convention

```
agent/<agent-id>/<type>/<topic>

Examples:
  agent/claude-1/feat/collaboration-api
  agent/codex-2/fix/event-store-race
  agent/claude-3/refactor/session-types
  agent/codex-1/docs/api-reference
```

- `<agent-id>`: identifies which agent session created the branch (e.g., `claude-1`, `codex-2`)
- `<type>`: conventional commit type (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`)
- `<topic>`: kebab-case description of the work
- Agent branches ALWAYS branch FROM `main`. Never from another agent's branch (prevents cascading dependency chains).

### Rule 4: PR-Based Merge Flow

All code enters main through Pull Requests:

```
Agent works in worktree → commits → pushes branch → opens PR → CI passes → merge
```

1. **Agent creates PR** after completing work: `gh pr create --base main`
2. **CI must pass**: build, lint, and test suite (enforced by branch protection)
3. **Squash merge** to keep main history linear and bisectable
4. **Delete branch** after merge: `gh pr merge --squash --delete-branch`

### Rule 5: Merge Serialization (One Agent Merges at a Time)

**Only ONE agent may merge PRs into main at any given time.** This prevents the classic race: PR A passes CI, PR B passes CI, but A+B together break main.

**Protocol:**
1. Before merging, the designated integrator agent checks for other in-flight merges
2. Merge one PR, wait for main CI to pass
3. All other agents with pending PRs must rebase onto the updated main before their merge:
   ```bash
   git fetch origin
   git rebase origin/main
   # resolve conflicts if any, then force-push the branch
   git push --force-with-lease
   ```
4. Proceed to the next PR only after the previous merge's CI is green

**Who is the integrator?** By default, the human operator decides merge order. If an agent is designated as integrator (e.g., via a task instruction), it must serialize merges and verify CI between each one.

### Rule 6: Conflict Prevention via Task Decomposition

The best way to avoid merge conflicts is to prevent them at task assignment time.

| Condition | Strategy |
|-----------|----------|
| Tasks touch different packages | Parallel agents in separate worktrees |
| Tasks share files | Sequential — one agent finishes first |
| Read-only tasks (review, research) | Always safe to parallelize |
| `packages/shared/` changes | **Do these FIRST**, merge to main, then other agents rebase |

**The shared package rule:** `packages/shared/` is imported by every other package. Changes to shared types MUST be merged to main before any agent working on dependent packages starts. This prevents every downstream agent from hitting conflicts.

**Before dispatching parallel agents, list ALL files each task will touch.** If two tasks share ANY file, they must run sequentially.

### Rule 7: Rebase Cadence

Stale branches cause painful merges. Keep branches fresh:

- **Before starting work**: `git fetch origin && git rebase origin/main`
- **Sessions > 1 hour**: rebase every 30-60 minutes
- **Before opening a PR**: always rebase onto latest main
- **If rebase conflicts are complex**: `git rebase --abort && git merge origin/main` (merge commit is acceptable as a fallback)

### Rule 8: Clean State After Every Commit

Every commit must leave the codebase in a state where another agent could pick up the work:

- `pnpm build` passes (no type errors)
- `pnpm lint` passes (no Biome errors)
- All existing tests still pass
- Commit message follows Conventional Commits and describes the "why"
- Push to remote after every logical commit — the remote is the source of truth

### Rule 9: Worktree Cleanup

Stale worktrees waste disk and create confusion:

```bash
# After PR is merged, remove the worktree
git worktree remove .trees/<name>

# Prune any stale worktree references
git worktree prune

# List all active worktrees
git worktree list
```

Agents MUST clean up their worktree after their PR is merged. Never leave orphaned worktrees.

### Rule 10: Cross-Machine Workflow

Worktrees embed absolute paths and cannot be copied between machines. The pattern for cross-machine handoff:

```bash
# Machine A (agent finishes):
git push origin agent/claude-1/feat/auth

# Machine B (pick up the work):
git fetch origin
git worktree add .trees/auth-review agent/claude-1/feat/auth
```

### Quick Reference: What Agents Can and Cannot Do

| Action | Allowed? |
|--------|----------|
| Read files on main | Yes |
| Run tests on main | Yes |
| Commit to main | **NO — NEVER** |
| Create a branch from main | Yes (in a worktree) |
| Push a feature branch | Yes |
| Open a PR | Yes |
| Merge a PR (if designated integrator) | Yes, one at a time |
| Force-push to a feature branch | Yes (`--force-with-lease` only) |
| Force-push to main | **NO — NEVER** |
| Delete a feature branch after merge | Yes |
| Rebase a feature branch on main | Yes (recommended frequently) |

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
4. `docs/KNOWLEDGE_SEDIMENTATION.md` — What should become a lesson, rule, or CLAUDE guidance
5. `docs/QUICKSTART.md` — Step-by-step: from zero to first agent running

## Design Context

### Users

Primary: independent developers managing personal AI agent fleets across multiple machines (laptop, Mac Mini, EC2). Secondary: small teams (2-10) sharing agent clusters, and DevOps engineers managing agent infrastructure. The typical context is remote monitoring and control from iOS devices — checking agent status, steering running sessions, reviewing summaries — while away from the desk.

### Brand Personality

**Cyber · Geeky · Futuristic**

The interface should feel like a command center for AI agents — technical depth without complexity, information density without clutter. Think Warp terminal meets a sci-fi mission control. The emotional register is: confident control, technical mastery, quiet power.

### Aesthetic Direction

- **Dark-first**: `#0a0a0a` base, already established. Dark mode is the primary experience.
- **Primary blue**: `#3b82f6` (Tailwind blue-500) for actions and focus states.
- **Typography**: Geist Sans + Geist Mono — clean, technical, excellent for data-dense UIs.
- **Density**: High information density done well. Tables, metrics, status indicators — not excessive whitespace.
- **Terminal heritage**: The xterm.js integration and monospace elements are a feature, not a compromise. Lean into the terminal aesthetic where it fits.
- **Motion**: Purposeful and minimal. `fadeIn`, `fadeInUp` at 200-300ms. No bouncy/elastic easing, no gratuitous transitions. Respect `prefers-reduced-motion`.

### Anti-References

- **AWS Console**: Information overload, inconsistent patterns, navigation maze. AgentCTL should have clear hierarchy and predictable navigation.
- **Enterprise SaaS**: Blue-white blandness, rounded-card pileups, zero personality. AgentCTL has a distinct identity.
- **Flashy effects**: Gradients, glassmorphism, parallax, decorative animations. Every visual element should serve a purpose.

### Design Principles

1. **Information density over decoration** — Show more data, less chrome. Every pixel should inform or enable action.
2. **Terminal-native feel** — Monospace where it fits (logs, metrics, agent output). The product lives in the developer's world.
3. **Dark-first, light-compatible** — Design for dark mode first, ensure light mode works. Never the reverse.
4. **Purposeful motion only** — Animations communicate state changes (loading, success, error), never decorate. Max 300ms.
5. **Progressive disclosure** — Surface what matters (status, cost, errors), let users drill down. Don't front-load everything.
