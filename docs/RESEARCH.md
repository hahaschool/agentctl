# Research Findings (Consolidated)

Distilled from two rounds of deep-dive research across 100+ sources. This captures only the actionable facts needed for implementation.

---

## Agent Runtimes Compared

### Claude Agent SDK
- NPM: `@anthropic-ai/claude-agent-sdk` (v0.2.51), Python: `claude-agent-sdk` (v0.1.39)
- Wraps Claude Code CLI as subprocess — NOT a direct API client
- Inherits all built-in tools: Read, Write, Edit, Bash, Glob, Grep, Task, WebSearch, WebFetch
- V1 API: `query()` async generator, V2 (unstable): `createSession()` with `send()`/`stream()`
- Supports: resume, fork, ephemeral sessions, custom MCP servers, subagent definitions
- Hooks: PreToolUse (allow/deny/ask), PostToolUse, Stop, SubagentStop, SessionStart, Notification
- Max 10 concurrent subagents, one level deep (no recursive subagents)
- Output formats: `json` (final result only), `stream-json` (real-time events)

### NanoClaw (~500 lines)
- Single-process TypeScript orchestrator with container isolation
- Apple Container (macOS) or Docker (Linux) runtimes
- Filesystem IPC: JSON files in `data/ipc/{folder}/messages/`, polled every 1000ms
- Per-group FIFO queue, max 3 concurrent containers, 120s idle timeout
- SQLite persistence for tasks, sessions, memory
- Task scheduler: cron (cron-parser), interval (ms), once (ISO timestamp), polled every 60s
- Security: mount blocklist (.ssh, .gnupg, .aws, .docker, .env, credentials, private_key)

### OpenClaw (52+ modules)
- WebSocket gateway daemon on :18789, JSON text frames
- Device pairing auth: challenge-response with device tokens
- Cron: croner library, 3 types (at/every/cron), retry with exponential backoff (30s→60m)
- Heartbeat: dual-layer architecture, 250ms merge window, 30min default interval
- 100+ community AgentSkills, 15+ messaging channels

### OpenClutch (clutch.md)
- Next.js + Convex + TypeScript platform built on OpenClaw
- Autonomous work loop: Triage → Work → Review → Merge → Cleanup
- Observatory dashboard with Live/Triage/Analytics tabs
- Real-time cost tracking, agent roles (Dev, Reviewer, PM, Research)

## Memory Systems

### Mem0 (Recommended for cross-device)
- License: Apache 2.0, $24M funded
- Hybrid storage: vector + knowledge graph + key-value
- Extracts atomic facts from conversations, detects contradictions
- Scoped by user_id / agent_id / session_id
- 26% higher accuracy than OpenAI Memory (LOCOMO benchmark)
- Self-hosted: `docker run -p 8080:8080 mem0/mem0:latest`
- REST API + Python/TS SDKs

### claude-mem (Import source only — AGPL)
- SQLite (`~/.claude-mem/claude-mem.db`, WAL mode) + ChromaDB
- 4 tables: sdk_sessions, observations, session_summaries, user_prompts
- FTS5 virtual tables for full-text search
- ChromaDB collection: `cm__claude-mem`, embedding model: all-MiniLM-L6-v2 (ONNX)
- 5 lifecycle hooks capture tool use during sessions
- Export: `npx tsx scripts/export-memories.ts "query" output.json`

### claude-brain / Memvid (.mv2)
- Single binary file, ~70KB empty, <5MB for a year of use
- Embedded WAL (1-64MB), Tantivy BM25 + HNSW vector + temporal indices
- Sub-ms search over 10K+ memories
- Git-committable, portable via simple file copy
- Rust core with Node.js bindings

### Claude Code Native Sessions
- JSONL at `~/.claude/projects/<url-encoded-path>/<session-uuid>.jsonl`
- Each line: type, uuid, parentUuid, timestamp, sessionId, cwd, gitBranch, message
- Token usage embedded in assistant messages under `message.usage`
- `/export` command for current session, `--resume <id>` for continuation

## Multi-Provider Routing

### LiteLLM (Recommended)
- 100+ providers, OpenAI-compatible proxy
- ~12ms median overhead
- Routing strategies: simple-shuffle, least-busy, usage-based, latency-based
- Fallback chains with cooldown mechanism
- Redis for distributed rate limit tracking
- Docker: `docker run -p 4000:4000 ghcr.io/berriai/litellm:main-latest`

### Rate Limits (Anthropic Tier 4, $400 cumulative)
- Claude Sonnet: 4,000 RPM, 2M input TPM, 400K output TPM
- Rate limits are per-organization (not per-key)
- Prompt caching: cached tokens don't count toward ITPM
- Batch API: 50% discount, separate rate limits

### Cross-Provider Stacking
- Anthropic Direct: highest rate limits, cheapest (prompt caching)
- AWS Bedrock: separate rate limits, cross-region possible
- Google Vertex AI: separate rate limits, limited regions
- Combined: 10,000+ RPM theoretical throughput

## Networking

### Tailscale (Recommended)
- Free Personal plan: 3 users, 100 devices
- MagicDNS: automatic hostname resolution across mesh
- Tailscale SSH: passwordless SSH across all machines
- Tailscale Serve: expose services within tailnet only
- Docker: sidecar pattern with `network_mode: service:tailscale`
- iOS: full-featured app, but uses battery for VPN tunnel
- ACLs: tag-based policies for agent-worker isolation

## Scheduling

### BullMQ (MVP)
- Redis-based, TypeScript-first
- Cron: `repeat: { cron: '...' }`, Interval: `repeat: { every: ms }`
- Retry: configurable backoff (fixed, exponential)
- Rate limiting, priority queues, job events
- Dashboard: `bull-board` or `arena`

### Temporal.io (Scale path)
- Deterministic workflow orchestration with non-deterministic Activities
- Schedules: overlap policies (SKIP/BUFFER_ONE/BUFFER_ALL/CANCEL_OTHER/ALLOW_ALL)
- Signals: human-in-the-loop approval
- Self-hosted: 2-4 vCPUs, 4-8GB RAM + PostgreSQL (~$25/mo)
- Used by: OpenAI Codex web agent, Replit Agent 3

## iOS Remote Control

### Happy Coder (Production-ready reference)
- Free, open-source, 11.7K GitHub stars
- Expo/React Native for iOS + Android
- E2E encryption: TweetNaCl, QR code pairing
- Parses structured JSON output → native UI components (not raw terminal)
- Push notifications, voice control, multi-session management
- Install: `npm install -g happy-coder`

### Architecture Pattern
- WebSocket for bidirectional commands (user ↔ agent)
- SSE for monitoring streams (agent → dashboard)
- Push notifications for background alerts (APNs/FCM)
- Auth: QR code pairing + E2E encryption (no passwords)

## Security Stack

| Layer | Tool | Purpose |
|-------|------|---------|
| Network | Tailscale + ACLs | Encrypted mesh, port restrictions |
| Container | gVisor (`--runtime=runsc`) | User-space kernel, syscall interception |
| Syscalls | seccomp profiles | Whitelist-only syscall filtering |
| MAC | AppArmor profiles | File path + binary restrictions |
| Agent | Claude Code sandbox + allowedTools | Built-in bubblewrap/Seatbelt |
| Audit | Structured NDJSON logs + SHA-256 | Tamper-evident action trail |

## Workspace Sync

### Bare Repo + Worktree Pattern
```bash
git clone --bare <url> .bare
echo "gitdir: ./.bare" > .git
git worktree add main main
git worktree add agent-1 -b agent-1/feature/auth
```

### Cross-Machine Pattern
1. Agent works in local worktree
2. Commits + pushes branch to remote
3. Target machine fetches + creates new worktree
4. Worktrees are local-only (absolute paths embedded)

### Key Tools
- agent-worktree (`npm install -g agent-worktree`): automated lifecycle
- Mutagen: real-time bidirectional file sync for Docker containers
