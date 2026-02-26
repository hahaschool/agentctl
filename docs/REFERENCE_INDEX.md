# Reference Index

All external tools, repositories, and documentation referenced in this project's research.

---

## Agent Runtimes & SDKs

| Resource | URL | Notes |
|----------|-----|-------|
| Claude Agent SDK (TS) | `npm install @anthropic-ai/claude-agent-sdk` | v0.2.51+, wraps Claude Code CLI |
| Claude Agent SDK (Python) | `pip install claude-agent-sdk` | v0.1.39+, same CLI wrapper pattern |
| Claude Code Docs - Headless | https://code.claude.com/docs/en/headless | `-p`, `--output-format`, `--resume` |
| Claude Code Docs - Hooks | https://code.claude.com/docs/en/hooks | PreToolUse, PostToolUse, Stop, Notification |
| Claude Code Docs - Workflows | https://code.claude.com/docs/en/common-workflows | Worktrees, parallel agents, CI/CD |
| Claude Code CHANGELOG | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md | Feature tracking |
| Claude Code SDK (Swift) | https://github.com/jamesrochabrun/ClaudeCodeSDK | Community Swift wrapper for iOS |
| Codex CLI | https://github.com/openai/codex | Rust rewrite, sandbox, MCP server |

## Agent Orchestration Platforms

| Resource | URL | Notes |
|----------|-----|-------|
| OpenClaw Gateway Architecture | https://docs.openclaw.ai/concepts/architecture | WebSocket daemon on :18789 |
| OpenClaw Cron Jobs | https://docs.openclaw.ai/automation/cron-jobs | croner library, 3 schedule types |
| OpenClaw Heartbeat | https://docs.openclaw.ai/automation/heartbeat | Dual-layer, 250ms merge window |
| OpenClaw System Prompt Study | https://github.com/seedprod/openclaw-prompts-and-skills | Prompt engineering patterns |
| NanoClaw | https://github.com/qwibitai/nanoclaw | ~500 lines, container isolation |
| NanoClaw DeepWiki | https://deepwiki.com/qwibitai/nanoclaw | Architecture deep dive |
| NanoClaw Security Model | https://github.com/qwibitai/nanoclaw/blob/main/docs/SECURITY.md | Mount blocklist, IPC protocol |
| OpenClutch | https://clutch.md | Orchestration layer for OpenClaw |
| AgentMesh | https://github.com/MinimalFuture/AgentMesh | Multi-agent Python platform, MCP support |

## iOS Remote Control

| Resource | URL | Notes |
|----------|-----|-------|
| Happy Coder | https://happy.engineering | Free, E2E encrypted, QR pairing |
| Happy Coder GitHub | https://github.com/slopus/happy | Expo/React Native source |
| Happy Coder Features | https://happy.engineering/docs/features/ | Voice control, multi-session |
| VibeTunnel | https://vibetunnel.sh | macOS menu bar, Tailscale integration |
| claude-code-web | https://github.com/vultuk/claude-code-web | Multi-session web UI |
| claude-remote | https://github.com/jamierpond/claude-remote | Mobile-first, Cloudflare tunnel |

## Memory Systems

| Resource | URL | Notes |
|----------|-----|-------|
| Mem0 | https://github.com/mem0ai/mem0 | Apache 2.0, hybrid memory, $24M funded |
| Mem0 Docs | https://docs.mem0.ai | Self-hosted + cloud options |
| claude-mem | https://github.com/thedotmack/claude-mem | SQLite + ChromaDB, AGPL license |
| claude-mem Database Docs | https://docs.claude-mem.ai/architecture/database | Schema: 4 tables + FTS5 |
| claude-mem Export/Import | https://docs.claude-mem.ai/usage/export-import | npx tsx scripts/export-memories.ts |
| claude-brain (.mv2) | https://github.com/memvid/claude-brain | Single portable file, Rust core |
| Memvid V2 Blog | https://memvid.com/blog/introducing-memvid-v2-portable-deterministic-memory-for-ai | .mv2 format spec |
| Zep / Graphiti | https://www.getzep.com | Temporal knowledge graph, sub-200ms |
| Letta / MemGPT | https://github.com/letta-ai/letta | OS-inspired memory paging |
| LangMem | https://github.com/langchain-ai/langmem | Cognitive science model, MIT |

## Multi-Provider Routing

| Resource | URL | Notes |
|----------|-----|-------|
| LiteLLM | https://github.com/BerriAI/litellm | 100+ providers, OpenAI-compatible |
| LiteLLM Docs - Routing | https://docs.litellm.ai/docs/routing | Fallback chains, load balancing |
| OpenRouter | https://openrouter.ai | SaaS, 300+ models, auto-failover |
| Portkey Gateway | https://github.com/Portkey-AI/gateway | Circuit breakers, Apache 2.0 |
| Anthropic Rate Limits | https://docs.anthropic.com/en/api/rate-limits | Per-org, tier-based |
| Anthropic Pricing | https://platform.claude.com/docs/en/about-claude/pricing | Per-model token costs |

## Networking

| Resource | URL | Notes |
|----------|-----|-------|
| Tailscale | https://tailscale.com | WireGuard mesh, free for 3 users / 100 devices |
| Tailscale Pricing | https://tailscale.com/pricing | Personal plan sufficient |
| Tailscale Serve | https://tailscale.com/docs/features/tailscale-serve | Internal service exposure |
| Tailscale Funnel | https://tailscale.com/docs/features/tailscale-funnel | Public exposure (use sparingly) |
| Tailscale ACLs | https://tailscale.com/kb/1018/acls | JSON policy format |
| Tailscale Docker | https://tailscale.com/kb/1282/docker | Sidecar pattern |
| Headscale | https://github.com/juanfont/headscale | Self-hosted Tailscale control |

## Scheduling & Orchestration

| Resource | URL | Notes |
|----------|-----|-------|
| Temporal.io | https://temporal.io | Durable workflow execution |
| Temporal AI Agent Blog | https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal | Patterns |
| Temporal Ambient Agents | https://temporal.io/blog/orchestrating-ambient-agents-with-temporal | Agent lifecycle |
| Temporal Schedules | https://docs.temporal.io/schedule | Cron with overlap policies |
| Temporal Docker Compose | https://github.com/temporalio/docker-compose | Self-hosting |
| temporal-ai-agent | https://github.com/temporal-community/temporal-ai-agent | Reference implementation |
| BullMQ | https://github.com/taskforcesh/bullmq | Redis-based, TypeScript |
| Inngest | https://www.inngest.com | Event-driven, serverless |
| Trigger.dev | https://trigger.dev | TypeScript background jobs |
| PM2 | https://github.com/Unitech/pm2 | Process manager, auto-restart |

## Workspace & Code Sync

| Resource | URL | Notes |
|----------|-----|-------|
| agent-worktree | https://github.com/nekocode/agent-worktree | `wt new -s claude` automation |
| Git Worktrees for AI Agents | https://devcenter.upsun.com/posts/git-worktrees-for-parallel-ai-coding-agents/ | Patterns guide |
| Mutagen | https://github.com/mutagen-io/mutagen | Docker volume sync, bidirectional |
| Syncthing | https://syncthing.net | P2P, no iOS support |

## Monitoring & Observability

| Resource | URL | Notes |
|----------|-----|-------|
| xterm.js | https://github.com/xtermjs/xterm.js | Terminal in browser, WebGL renderer |
| Vector | https://github.com/vectordotdev/vector | Log pipeline, Rust, replaces ELK |
| Grafana Loki | https://grafana.com/oss/loki/ | Log aggregation (simple path) |
| Prometheus | https://prometheus.io | Metrics collection |
| Langfuse | https://github.com/langfuse/langfuse | LLM observability, open source |
| Helicone | https://helicone.ai | LLM cost tracking |

## Security

| Resource | URL | Notes |
|----------|-----|-------|
| Claude Code Sandbox | https://github.com/anthropic-experimental/sandbox-runtime | bubblewrap/Seatbelt |
| gVisor | https://gvisor.dev | User-space kernel for containers |
| Docker Sandboxes | https://docs.docker.com/ai/sandboxes/ | MicroVMs with private daemons |
| AIO Sandbox | https://github.com/agent-infra/sandbox | All-in-one agent sandbox |

## Claude Code Session Data

| Resource | URL | Notes |
|----------|-----|-------|
| Session JSONL Format | https://gist.github.com/samkeen/dc6a9771a78d1ecee7eb9ec1307f1b52 | Data structures |
| Conversation History Guide | https://kentgigger.com/posts/claude-code-conversation-history | Hidden history usage |
| DuckDB Log Analysis | https://liambx.com/blog/claude-code-log-analysis-with-duckdb | Analyzing sessions |
| claude-conversation-extractor | Search npm registry | JSONL → Markdown/JSON/HTML |

## Related Architecture References

| Resource | URL | Notes |
|----------|-----|-------|
| Anthropic Agent SDK Docs (TS) | https://platform.claude.com/docs/en/agent-sdk/typescript | Official reference |
| Anthropic Agent SDK V2 (TS) | https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview | Unstable preview |
| Claude Code Task vs Subagents | https://amitkoth.com/claude-code-task-tool-vs-subagents/ | When to use which |
| Parallel Claude Code Worktrees | https://wmedia.es/en/tips/claude-code-worktrees-parallel-tasks | 3 Claudes at once |
| NanoClaw Architecture Analysis | https://fumics.in/posts/2026-02-02-nanoclaw-agent-architecture | 500 lines vs 50 modules |
| SSE vs WebSocket Performance | https://www.timeplus.com/post/websocket-vs-sse | Benchmark comparison |
