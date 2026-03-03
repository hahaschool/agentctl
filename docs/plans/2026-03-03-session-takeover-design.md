# Design: Claude Code Session Takeover via Remote Control

> Date: 2026-03-03
> Status: Draft
> Priority: Critical — user's #1 request

## Problem

AgentCTL currently spawns Claude Code as a **subprocess** via `@anthropic-ai/claude-agent-sdk`. This is wrong for the user's primary use case: **taking over and controlling existing, already-running Claude Code sessions** from a remote device (iPhone/iPad).

The user wants:
1. Attach to an already-running Claude Code session from iOS
2. Send commands, grant permissions, monitor output remotely
3. Seamlessly switch between local terminal and mobile control
4. Future: session handoff between Claude Code and Codex

## Key Discovery: Claude Code Remote Control (Feb 24, 2026)

Anthropic launched a built-in **Remote Control** feature that does exactly what AgentCTL needs:

### How It Works

**Architecture: Outbound Polling Model**
- CLI runs `claude remote-control` or `/remote-control` (in-session)
- The local process registers with the Anthropic API and polls for work
- **No inbound ports** — outbound-only connections (same pattern as Tailscale/ngrok)
- The Anthropic API acts as a relay, routing messages between remote client and local session
- Data flows bidirectionally over the relay, but TCP connections are always initiated by endpoints

**Two Entry Points:**
1. `claude remote-control` — standalone bridge process, spawns child Claude processes per remote session
2. `/remote-control` or `/rc` — attaches to an existing interactive Claude session

**Communication Protocols:**
- CLI → Anthropic: HTTPS polling ("got any new messages?")
- Anthropic → CLI: SSE (Server-Sent Events) for streaming back results
- Phone → Anthropic: Regular HTTPS + SSE (same as claude.ai chat)

**API Endpoints (Anthropic Environments API):**
- `POST /v1/environments/bridge` — register/deregister
- `GET /v1/environments/{id}/work/poll` — long-poll for work
- `POST /v1/sessions/{id}/events` — send events

**Session Management:**
- Session URL + QR code for connecting from other devices
- Sessions listed in claude.ai/code with computer icon + green dot when online
- `/rename` to name sessions for easy discovery
- Auto-reconnect on network recovery
- 10-minute server-side TTL (resets on each poll)

**Security Model:**
- OAuth-only authentication (Max plan required, Pro coming soon)
- Multiple short-lived credentials scoped to single purposes
- Only chat messages and tool results flow through relay
- Files, MCP servers, env vars, project settings stay local
- All traffic over TLS

### What This Means for AgentCTL

**The relay is NOT a network tunnel** — it's an application-level message bridge. It forwards structured messages (chat prompts, tool execution results, status updates), not raw TCP. This means Remote Control is confined to the Claude Code conversation model.

## Revised Architecture

### Option A: Leverage Built-in Remote Control (Recommended)

Instead of spawning Claude Code as a subprocess, AgentCTL should **orchestrate Remote Control sessions**:

```
┌─────────────┐                    ┌────────────────────┐
│  iOS App    │◄──── HTTPS/SSE ───►│  Anthropic Relay   │
│  (AgentCTL) │                    │  (claude.ai/code)  │
└─────────────┘                    └────────┬───────────┘
                                            │
                                   HTTPS polling + SSE
                                            │
┌─────────────────────────────────────────────┐
│  Agent Worker Machine                       │
│                                             │
│  ┌─────────────────┐  ┌──────────────────┐  │
│  │ AgentCTL Worker  │  │ Claude Code CLI  │  │
│  │                  │──│ (remote-control) │  │
│  │ • Start sessions │  │ • Polls relay    │  │
│  │ • Monitor health │  │ • Executes tools │  │
│  │ • Report status  │  │ • Streams output │  │
│  └─────────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────┘
```

**Worker's role changes from "run agent" to "manage agent lifecycle":**
1. Start `claude remote-control` processes (or `claude --resume <id> /rc`)
2. Capture the session URL / QR code
3. Monitor process health (is it still running? is it polling?)
4. Report session URLs back to control plane
5. Auto-restart on failure
6. Manage multiple concurrent sessions

**iOS app's role changes to "native Remote Control client":**
1. Connect directly to Anthropic relay (same as claude.ai/code)
2. Display session list from both Anthropic and AgentCTL
3. Send prompts, grant permissions
4. Render streamed output natively (not terminal emulation)

### Option B: Custom Relay (Self-Hosted Alternative)

For Enterprise/self-hosted use where Anthropic's relay isn't available:

```
┌─────────────┐                    ┌────────────────────┐
│  iOS App    │◄──── WebSocket ───►│  AgentCTL Control  │
│  (AgentCTL) │                    │  Plane (relay)     │
└─────────────┘                    └────────┬───────────┘
                                            │
                                    Tailscale mesh
                                            │
                                   ┌────────┴───────────┐
                                   │  Agent Worker       │
                                   │  Claude Code CLI    │
                                   │  (stdin/stdout IPC) │
                                   └────────────────────┘
```

This requires implementing our own relay, which is essentially what the current WebSocket route (`ws.ts`) + SSE proxy already do. The worker would interact with Claude Code via stdin/stdout piping (the `sdk-runner.ts` approach, improved).

### Option C: Hybrid (Recommended for MVP)

Use Anthropic's Remote Control for the happy path, with AgentCTL providing:
- Fleet management (which sessions on which machines)
- Auto-start sessions based on triggers (cron, webhook, manual)
- Health monitoring and auto-recovery
- Session metadata and naming
- Cross-machine session discovery
- Future: Codex integration via similar pattern

## Implementation Plan

### Phase 1: Remote Control Integration (MVP)

**1.1 Worker: Session Manager**

Replace `sdk-runner.ts` subprocess spawning with Remote Control management:

```typescript
// packages/agent-worker/src/runtime/rc-session-manager.ts

export class RcSessionManager {
  // Start a new Remote Control session
  async startSession(config: SessionConfig): Promise<RcSession> {
    // Spawn: claude remote-control --project <path>
    // Parse session URL from stdout
    // Return session metadata
  }

  // Attach remote control to an existing Claude Code session
  async attachToSession(sessionId: string): Promise<RcSession> {
    // Spawn: claude --resume <sessionId> then send /rc
    // Parse session URL
  }

  // List active remote control sessions
  async listSessions(): Promise<RcSession[]> {
    // Parse claude session list or track internally
  }

  // Health check: is the RC process still polling?
  async checkHealth(sessionId: string): Promise<SessionHealth> {
    // Check process alive + last poll timestamp
  }
}
```

**1.2 Control Plane: Session Registry**

New database table and API endpoints:

```sql
CREATE TABLE IF NOT EXISTS "rc_sessions" (
  "id" text PRIMARY KEY,
  "agent_id" text NOT NULL REFERENCES "agents"("id"),
  "machine_id" text NOT NULL REFERENCES "machines"("id"),
  "session_url" text,
  "status" text NOT NULL DEFAULT 'starting',
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "last_heartbeat" timestamptz,
  "metadata" jsonb DEFAULT '{}'
);
```

New API endpoints:
- `GET /api/sessions` — list all RC sessions across fleet
- `POST /api/sessions` — start a new RC session on a specific machine
- `GET /api/sessions/:id` — get session details including URL
- `DELETE /api/sessions/:id` — stop an RC session
- `POST /api/sessions/:id/attach` — attach RC to existing session

**1.3 iOS App: Session Browser**

New screens:
- Session list (shows all active RC sessions with connection status)
- Session detail (deep link to claude.ai/code or embed WebView)
- Quick start (one-tap to create new session on best available machine)

### Phase 2: Enhanced Control

**2.1 Auto-Enable Remote Control**

Configure worker to auto-enable RC for all sessions:
```bash
# In Claude Code config
claude config set remote_control_auto_enable true
```

**2.2 Session Discovery**

Worker periodically scans for Claude Code sessions and reports to control plane:
```typescript
// Parse ~/.claude/projects/*/sessions.json
// Report new/ended sessions
```

**2.3 Health Dashboard**

Control plane aggregates session health across fleet:
- Which machines have active sessions
- Session age, last activity, output summary
- Auto-restart stale sessions

### Phase 3: Codex Integration (Future)

**3.1 Codex CLI Integration**

Similar pattern — Codex CLI may expose its own remote control or API:
```typescript
export class CodexSessionManager {
  async startSession(config: CodexConfig): Promise<CodexSession>;
  async listSessions(): Promise<CodexSession[]>;
}
```

**3.2 Session Handoff**

Transfer context between Claude Code and Codex within the same logical session:
1. Export Claude Code conversation context (CLAUDE.md + recent messages)
2. Import into Codex session with context
3. Track lineage: Session A (Claude) → Session B (Codex) → Session C (Claude)

## Migration from Current Architecture

### What Changes

| Component | Current | New |
|-----------|---------|-----|
| `sdk-runner.ts` | Spawns Claude Code subprocess via SDK | Spawns `claude remote-control` process |
| `agent-instance.ts` | Manages SDK subprocess lifecycle | Manages RC process lifecycle + session URL |
| Worker API | `/api/agents/:id/start` spawns subprocess | `/api/agents/:id/start` starts RC session |
| iOS connection | Direct WebSocket to worker | Connect to Anthropic relay via session URL |
| IPC mechanism | Filesystem JSON files | RC relay (HTTPS polling + SSE) |

### What Stays the Same

- Control plane API structure
- BullMQ task scheduling
- Database schema (agents, machines, runs)
- Health monitoring / heartbeats
- Fleet management (Tailscale mesh)
- Memory system (Mem0)
- Git worktree isolation

## Requirements

- Claude Code v2.1.52+ (Remote Control support)
- Claude Max subscription (Pro support coming soon)
- API keys NOT supported for Remote Control — must use OAuth

## Open Questions

1. **Can Remote Control be programmatically driven?** — The documented flow requires interactive QR/URL sharing. Can AgentCTL programmatically connect to a session via the Environments API?
2. **Rate limits on Environments API?** — How many concurrent RC sessions per account?
3. **Enterprise plan support?** — Currently only Max tier. When will Team/Enterprise be supported?
4. **Codex remote control?** — Does OpenAI's Codex CLI have any similar remote control feature?
5. **Auto-enable via config?** — Can `remote_control_auto_enable` be set programmatically?

## References

- [Claude Code Remote Control Docs](https://code.claude.com/docs/en/remote-control)
- [Deep Dive: How Remote Control Works](https://dev.to/chwu1946/deep-dive-how-claude-code-remote-control-actually-works-50p6)
- [Remote Control Implementation Details (Gist)](https://gist.github.com/sorrycc/9b9ac045d5329ac03084a465345b59c3)
- [Claude-Code-Remote (3rd party)](https://github.com/JessyTsui/Claude-Code-Remote) — email/discord/telegram control
- [OpenCode Remote Control Feature Request](https://github.com/anomalyco/opencode/issues/15236)
