# Lessons Learned & Critical Pitfalls

This document captures non-obvious insights from our research. Read this before making any architectural decision.

---

## Agent Runtime

### Claude Agent SDK wraps Claude Code CLI, not the Messages API
The SDK spawns `claude` CLI as a child process. This means:
- You get ALL built-in tools (Read, Write, Edit, Bash, Glob, Grep, Task, WebSearch) for free
- You inherit Claude Code's prompt caching, context compaction, and tool loop
- You need Claude Code installed (`npm install -g @anthropic-ai/claude-code`) on every machine
- The `--dangerously-skip-permissions` flag is required for headless use, making container isolation critical

### Max 10 concurrent subagents per session
Claude Code's Task tool caps at 10 parallel subagents, each with its own 200K context window. Subagents cannot spawn their own subagents (one level only). Design task decomposition accordingly.

### Session resume is fragile
`--resume <session_id>` works only if the JSONL file exists at `~/.claude/projects/<path>/<session>.jsonl`. Moving between machines requires copying this file. Better approach: treat sessions as disposable, inject relevant context from Mem0 into each new session.

### The `--output-format stream-json` is essential for monitoring
Without it, Claude Code outputs ANSI terminal sequences that are painful to parse. `stream-json` gives structured events: `{"type": "assistant", "message": {...}, "session_id": "..."}`.

---

## Memory

### claude-mem uses AGPL license
Cannot use claude-mem code directly in a proprietary project. Extract data only; reimplement the memory compression logic yourself or use Mem0 (Apache 2.0).

### Mem0 extracts atomic facts, not summaries
Mem0 doesn't store raw conversation text. It extracts discrete facts like "User prefers TypeScript" or "Project uses PostgreSQL 16". This is better for cross-session relevance but means you lose nuanced context. Supplement with session summaries in .mv2 files.

### JSONL session files can be enormous
A long Claude Code session can produce 50MB+ JSONL files. The import script must stream-parse, not `JSON.parse(readFileSync())`. Use `readline` or `ndjson` parser.

### Memory injection placement matters
Put memory context AFTER the system prompt but BEFORE the user's task. Claude Code's CLAUDE.md system goes: system prompt → CLAUDE.md → user prompt. Memory should integrate into CLAUDE.md or be injected via `--append-system-prompt`.

---

## Networking

### Tailscale MagicDNS hostnames must be unique per tailnet
If two machines register as "mac-mini", chaos ensues. Use descriptive names: `mac-mini-office`, `ec2-us-east-1`, `laptop-mbp-2024`.

### Tailscale Serve (not Funnel) for internal dashboards
Serve exposes services only within the tailnet, with automatic identity headers (`Tailscale-User-Login`). Funnel exposes to public internet. Never use Funnel for agent control surfaces.

### iOS Tailscale app works but has battery implications
The Tailscale iOS app maintains a VPN tunnel. It uses battery. For the mobile client, consider using Tailscale only when the app is active, not as a persistent background connection.

### Docker containers need sidecar pattern for Tailscale
`--network=host` doesn't work well. Use the sidecar pattern: run `tailscale/tailscale` container alongside the agent container with `network_mode: service:tailscale`.

### Tailscale `active` state lags by minutes after a node dies
`tailscale status` can still show a peer as `active; offers exit node; relay "..."` with stale tx/rx counters long after the node is asleep, crashed, or power-cycled. Do not use TS status alone to conclude "the machine is alive" — always cross-check with `tailscale ping`, ICMP, and an application-layer probe (TCP / HTTP). If all three fail while TS says active, the coord server just hasn't observed the loss yet.

---

## Fleet Upgrades

### Remote peer upgrade bricked macmini, 2026-04
**Incident:** Operator clicked "Update" on the macmini peer in the mesh-peers page. The peer was on v0.5.6; local CP was on v0.8.0. After the remote upgrade the peer stopped responding: `tailscale ping`, ICMP, TCP:22, and TCP:8080 all timed out. The node stayed offline until physical intervention. UI still showed the peer as `active` via TS coord for days.

**Root cause chain:**
1. `scripts/peer-update.sh` (invoked by `POST /api/sync/peers/:id/update`) ran: `git fetch` → `git reset --hard origin/main` → `pnpm install` → `pnpm build` → `pm2 reload agentctl-beta`.
2. It did **NOT** run `pnpm drizzle-kit migrate`, unlike the canonical `scripts/env-promote.sh` promotion path which does (step 4 of env-promote).
3. The beta PM2 config sets `SKIP_MIGRATIONS=true`, so the new CP also did not migrate on startup.
4. Crossing v0.5.6 → v0.8.0 added migrations 0028–0032 (mesh_local_config, sync_nodes.last_schema_ahead_*, memory_drawers, etc.). The new CP's first query hit a missing column, PM2 tried to restart, crash-looped, went to `errored`.
5. The script had no post-reload health probe, so it returned exit 0 and reported success.
6. Separately, the Mac Mini went to sleep (macOS default), which killed ICMP/SSH too. That is what made it look "completely dead" rather than just "CP down".

**The two bugs (both root causes):**
- **B1:** Remote upgrade path (`peer-update.sh`) did not run DB migrations. The sanctioned local deploy path (`env-promote.sh`) does. The two paths drifted.
- **B2:** The script had no health check after `pm2 reload`. A failing PM2 reload (or a crashing new CP) silently returned "success".

**Fix shipped (this commit):**
1. `peer-update.sh` now runs `pnpm drizzle-kit migrate` before `pm2 reload` (AGENTCTL_SKIP_MIGRATIONS=1 escape hatch).
2. Polls `AGENTCTL_PEER_HEALTH_URL` (default `http://127.0.0.1:8080/health`) for up to `AGENTCTL_PEER_HEALTH_TIMEOUT_SEC` seconds (default 90).
3. On probe timeout, runs a complete rollback: `git reset` + `pnpm install` + `pnpm build` + `pm2 reload` — not just `git reset` like before.
4. Optional `AGENTCTL_PEER_MAX_VERSION_SKEW` guard refuses to auto-upgrade a peer that is more than N minor versions behind (the upgrade surface area grows non-linearly).
5. `scripts/peer-update-sh.test.ts` guards the invariants so a future refactor can't silently drop these steps.

**Physical recovery playbook (what to do when a peer is already bricked):**
1. At the machine: wake it / power-cycle it. Confirm macOS is logged in and Tailscale status in the menu bar is green.
2. Local SSH or terminal: `cd /path/to/agentctl && git log --oneline -3` to see which SHA it is on.
3. `pm2 list` — expect `agentctl-cp-beta` in `errored` or stopped.
4. `pm2 logs agentctl-cp-beta --lines 50` — look for Postgres "column ... does not exist" to confirm the migration skew hypothesis.
5. `DATABASE_URL="$BETA_DB_URL" pnpm --filter @agentctl/control-plane exec drizzle-kit migrate`
6. `pm2 reload agentctl-beta && curl http://127.0.0.1:8080/health` — should return 200.
7. If git SHA is already on new main, you're done. If not, run `./scripts/peer-update.sh` manually (now safe).

**General lessons:**
- **Deploy paths must not drift.** If `env-promote.sh` and `peer-update.sh` both bring code online, they must run the same superset of steps (or one must delegate to the other). Enforce via a content-level test.
- **`pm2 reload` is not a health check.** It sends SIGUSR2 and returns. Always poll the app's own health endpoint with a deadline before declaring success.
- **Rollback must be complete.** `git reset --hard PREVIOUS_SHA` leaves `node_modules` and `dist/` from the new version. A partial rollback is often worse than no rollback — it leaves the node in a state neither the old nor the new process can start from.
- **Large version skew is risk-amplifying.** A peer 7 patch versions behind survives auto-update; a peer 2+ minors behind crosses many migrations and config changes. Default to warn/refuse on large skews.
- **`SKIP_MIGRATIONS=true` in PM2 is a sharp tool.** It is safe only when an external deploy path runs migrations first. Every path that reloads PM2 without running migrations is a latent brick.

---

## Scheduling

### BullMQ cron is good enough for 90% of cases
Don't reach for Temporal.io until you need: durable multi-hour workflows, human approval gates, or fan-out/fan-in patterns. BullMQ handles cron, retry with backoff, rate limiting, and priority queues. Operational overhead is just Redis.

### Temporal requires separate server infrastructure
Minimum: 2-4 vCPUs, 4-8GB RAM + PostgreSQL. Docker Compose available at `github.com/temporalio/docker-compose`. Self-hosted costs ~$25/month on modest infra vs Temporal Cloud at $100+/month.

### The heartbeat cost trap
OpenClaw defaults to 30-minute heartbeats, each costing ~$0.02 with Sonnet. That's $0.96/day or $29/month PER AGENT just for heartbeats. Mitigation: run heartbeat checks on Haiku ($0.001/check), only spawning expensive models when action is needed.

### Overlap policy matters for cron agents
If a cron job is still running when the next trigger fires: BullMQ default skips (good). Temporal has 5 policies: SKIP, BUFFER_ONE, BUFFER_ALL, CANCEL_OTHER, ALLOW_ALL. Choose SKIP unless you explicitly want queuing.

---

## Multi-Provider Routing

### Rate limits are per-organization, not per-key
Multiple API keys from the same Anthropic org share rate limits. To actually multiply throughput, you need separate organizations with separate billing. Creating orgs solely to circumvent limits may violate ToS—read the terms.

### Claude Max ($100-200/mo) gives ZERO API credits
Max plan is for claude.ai and Claude Code CLI usage only. It does not increase API rate limits or provide API credits. API billing is entirely separate and pay-as-you-go.

### Prompt caching is the single most impactful optimization
Cached input tokens don't count toward ITPM (input tokens per minute) rate limits. With 80% cache hit rate you get: 5x effective input capacity AND 90% cost reduction on cached tokens. Design system prompts and CLAUDE.md for cacheability (put stable content first, variable content last).

### LiteLLM cooldown can cascade
If provider A fails and cools down for 60s, all traffic shifts to provider B. If B is undersized and also fails, both cool down simultaneously = total outage. Set `cooldown_time` conservatively (30s) and ensure at least one provider can handle full load.

### Batch API gives 50% discount with separate rate limits
For tasks that don't need real-time responses (nightly code reviews, batch refactoring), use the Batch API. It has its own separate rate limits and costs 50% less.

---

## Git Worktree

### Worktrees embed absolute paths—they cannot cross machines
A worktree created on Machine A cannot be used on Machine B. The `.git` file inside each worktree contains an absolute path. Cross-machine migration: commit → push → fetch on target → create new worktree.

### The bare repo pattern is essential for multi-worktree setups
Without it, your "main" checkout is special (it holds the git objects). With the bare repo pattern, ALL working directories are worktrees, making them symmetrical:
```
project/
├── .bare/           # All git objects, refs, config
├── .git             # File containing "gitdir: ./.bare"
├── main/            # main branch (a worktree)
├── agent-1/         # agent branch (a worktree)
└── agent-2/         # another agent branch (a worktree)
```

### Frequent rebase prevents merge hell
Multiple agents touching related files will have integration conflicts. Pattern: small task → frequent `git rebase origin/main` → immediate squash merge. Don't let agents run for hours without rebasing.

### Add `.claude/worktrees/` to .gitignore
Claude Code creates worktrees at `.claude/worktrees/`. These should not be committed. Also add `.trees/` if using the manual bare-repo pattern.

---

## Security

### `--dangerously-skip-permissions` is required for headless operation
There's no way around it for automated agents. This is why container isolation (gVisor + seccomp + AppArmor) is non-negotiable, not optional.

### Agents can exfiltrate data via DNS, HTTP, or git push
Even with `--network=none` in Docker, agents can exfiltrate via git push if the repo has a remote. For maximum security: read-only repo mounts + write to a separate output directory + review before merge.

### Hook timeout is 60 seconds by default
If your `PreToolUse` audit hook takes too long (e.g., calling an external service), it will timeout and the tool use will proceed without the hook's decision. Keep hooks fast and local.

### Container privilege escalation is the main threat
An agent with `Bash` tool access inside a container with `--privileged` or `SYS_ADMIN` capability can escape to the host. Always: `--cap-drop=ALL`, `--security-opt no-new-privileges`, `--pids-limit=100`.

---

## iOS Mobile Client

### Don't render raw terminal output on mobile
Happy Coder (11.7K GitHub stars) parses Claude Code's structured JSON output and renders as native mobile components (chat bubbles, code blocks, diffs). Raw terminal rendering (xterm.js) is unreadable on small screens. Reserve xterm.js for desktop web dashboard only.

### E2E encryption must not require user key management
Happy Coder uses QR code pairing + TweetNaCl. The mobile device scans a QR from the machine, establishing a shared secret. No passwords, no key files, no PKI. Copy this pattern.

### Push notifications need a relay server
APNs requires a server-side component. The relay server receives agent events, determines notification priority, and sends via APNs. This relay can be the control plane's API server or a separate lightweight service.

### WebSocket reconnection on mobile is unreliable
iOS aggressively kills background WebSocket connections. Use: foreground WebSocket for active use + push notifications for background alerts + SSE reconnection on app resume (EventSource auto-reconnects).

---

## Monitoring & Observability

### Vector replaces both Logstash and Filebeat
Don't install the entire ELK stack. Vector (single Rust binary) handles: file tailing, parsing, transformation, and shipping to ClickHouse/Loki. Zerodha cut logging costs by 57% migrating from ELK to Vector + ClickHouse.

### SSE is better than WebSocket for monitoring dashboards
SSE provides automatic reconnection, HTTP/2 multiplexing (hundreds of streams over one connection), and works through all proxies/firewalls. Use WebSocket only for interactive terminal takeover.

### Agent cost attribution needs per-turn tracking
Each Claude Code turn reports `total_cost_usd` in its JSON output. Track this per-turn (not per-session) to catch cost spikes early. A runaway agent can burn $50+ in a single session.

---

## General

### Start with NanoClaw's simplicity, not OpenClaw's complexity
NanoClaw is ~500 lines doing single-process orchestration with filesystem IPC and SQLite persistence. OpenClaw is 50+ modules with a gateway WebSocket daemon. Start simple, add complexity only when the simpler approach hits measured limits.

### The "unified platform" is the novel contribution
Every individual component exists and works well. The gap is the integration layer: a single control plane tying fleet management, mobile control, shared memory, and cost-optimized routing together. Don't try to reinvent any component—compose them.

### Test with 2 machines before scaling to N
The jump from 1 machine to 2 exposes all the hard problems (networking, state sync, split-brain, clock skew). The jump from 2 to N is incremental. Get 2-machine working flawlessly first.
