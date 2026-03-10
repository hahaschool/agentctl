> ⚠️ **ARCHIVED** — This plan has been fully implemented. Kept for historical reference.

# Design: Claude Code Session Control — Multi-Layer Architecture

> Date: 2026-03-03
> Status: Draft (Revised)
> Priority: Critical — user's #1 request

## Executive Summary

AgentCTL needs to remotely control Claude Code sessions across multiple machines from iOS devices. After evaluating seven approaches, the recommended architecture is a **3-layer strategy** that routes work through the right channel based on billing constraints:

1. **CLI `-p` mode** for Team plan machines (programmatic, no extra billing)
2. **Agent SDK** for autonomous/background agents (API key billing, full SDK features)
3. **tmux + Tailscale** as emergency fallback (zero dependencies, any plan)

The built-in Remote Control feature (`claude remote-control`) is demoted to an optional enhancement because it requires a Max plan ($200/mo per seat), and the user only has one Max seat alongside one Team plan seat.

## Critical Constraint: Plan Billing Topology

| Plan | Seats | Auth Method | Remote Control | CLI `-p` Mode | Agent SDK |
| ------ | ------- | ------------- | ---------------- | --------------- | ----------- |
| Max ($200/mo) | 1 | OAuth | Yes | Yes | No (needs API key) |
| Team ($30/mo) | 1 | OAuth | No | Yes | No (needs API key) |
| API (pay-per-use) | N/A | API key | No | No (needs OAuth) | Yes |

**Implications:**

- **Built-in Remote Control** works on exactly 1 machine (the Max seat). Not viable as primary fleet approach.
- **Agent SDK** (`@anthropic-ai/claude-agent-sdk`) requires `ANTHROPIC_API_KEY` and bills against the API, completely separate from subscription plans. It cannot use Team/Max plan OAuth credentials.
- **CLI `-p` mode** works on any machine where Claude Code is logged in via OAuth (both Max and Team plans). This is the sweet spot: programmatic control billed against the subscription.

## Approach Evaluation

| Approach | Plan Required | Complexity | Structured Output | Session Resume | Verdict |
| ---------- | --------------- | ------------ | ------------------- | ---------------- | --------- |
| Built-in Remote Control | Max only | Low | Yes (relay) | Yes | Limited to 1 seat |
| CLI `-p` mode | Any (OAuth login) | Low | Yes (`stream-json`) | Yes (`--resume`) | **Primary** |
| Agent SDK | API key (separate billing) | Medium | Yes (SDK events) | Yes (session mgmt) | **Background agents** |
| Happy Coder pattern | Any | Medium | Yes (custom relay) | Partial | Reference for iOS UX |
| tmux + SSH + Tailscale | Any | Low | No (terminal scraping) | Yes (tmux attach) | **Fallback** |
| MCP Bridge | Any | High | Yes | No | Wrong direction (model-to-tool) |
| Direct API | API key | Very High | Yes | Manual | Too much reimplementation |

Eliminated approaches:

- **ACP (IBM)** — Not an Anthropic product. Irrelevant.
- **MCP Bridge** — MCP is designed for model-to-tool communication, not user-to-model. Would require Claude to poll for commands, which is unnatural and fragile.
- **Direct API** — Reimplements everything Claude Code already provides (tool execution, file management, context handling). No advantage over the SDK.

## Recommended Architecture: 3-Layer Strategy

```text
┌──────────────────┐
│  iOS App          │
│  (React Native)   │
│                   │
│  Session List     │
│  Command Input    │
│  Output Viewer    │
└────────┬─────────┘
         │ WebSocket (E2E encrypted)
         ▼
┌──────────────────────────────────────────┐
│  AgentCTL Control Plane                   │
│                                           │
│  ┌──────────────┐  ┌──────────────────┐  │
│  │ Session       │  │ Task Scheduler   │  │
│  │ Registry      │  │ (BullMQ)         │  │
│  └──────┬───────┘  └────────┬─────────┘  │
│         │                   │             │
│         ▼                   ▼             │
│  ┌──────────────────────────────────┐    │
│  │ Dispatch Router                   │    │
│  │ • Team plan machine? → CLI -p     │    │
│  │ • Background/autonomous? → SDK    │    │
│  │ • Fallback needed? → tmux         │    │
│  └──────────────┬───────────────────┘    │
└─────────────────┼────────────────────────┘
                  │ Tailscale mesh
                  ▼
┌────────────────────────────────────────────┐
│  Agent Worker Machine                       │
│                                             │
│  Layer 1: CLI -p Mode (Team/Max plan)       │
│  ┌────────────────────────────────────────┐ │
│  │ claude -p "prompt"                     │ │
│  │   --output-format stream-json          │ │
│  │   --resume <session-id>                │ │
│  │   --allowedTools "Read,Edit,Bash"      │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  Layer 2: Agent SDK (API key billing)       │
│  ┌────────────────────────────────────────┐ │
│  │ const agent = new Agent({              │ │
│  │   model: "claude-sonnet-4-20250514",   │ │
│  │   apiKey: ANTHROPIC_API_KEY,           │ │
│  │   tools: [...],                        │ │
│  │ });                                    │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  Layer 3: tmux Fallback                     │
│  ┌────────────────────────────────────────┐ │
│  │ tmux send-keys -t session "prompt" C-m │ │
│  │ tmux capture-pane -t session -p        │ │
│  └────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

### Layer 1: CLI `-p` Mode (Primary)

The `claude` CLI with `-p` / `--print` flag runs non-interactively and bills against the logged-in user's subscription plan (Team or Max). This is the most cost-effective approach for the fleet.

Key flags:

- `-p "prompt"` / `--print "prompt"` — non-interactive, single prompt
- `--output-format stream-json` — structured streaming JSON output
- `--resume <session-id>` — resume a previous session (preserves context)
- `--continue` — continue the most recent session
- `--allowedTools "Read,Edit,Bash,Glob,Grep"` — auto-approve specific tools (no permission prompts)
- `--max-turns N` — limit conversation turns for autonomous runs

Session lifecycle:

```text
1. Start new session:
   claude -p "implement feature X" --output-format stream-json
   → Returns session-id in output

2. Resume with follow-up:
   claude -p "now add tests" --resume <session-id> --output-format stream-json
   → Continues in same context

3. Continue most recent:
   claude -p "fix the failing test" --continue --output-format stream-json
```

stream-json output format:

Each line is a JSON object with a `type` field. Key types:

- `assistant` — Claude's text response chunks
- `tool_use` — tool invocation (file read, edit, bash, etc.)
- `tool_result` — tool execution result
- `result` — final result with session ID, cost info, token usage

When to use: Any interactive or ad-hoc session where the user wants to send prompts and see results. Works on all machines with Claude Code logged in via OAuth.

### Layer 2: Agent SDK (Background/Autonomous)

The `@anthropic-ai/claude-agent-sdk` provides full programmatic control with hooks, MCP servers, and subagent support. It requires an `ANTHROPIC_API_KEY` and bills against API usage (separate from subscription).

When to use:

- Long-running autonomous agents (heartbeat/cron triggers)
- Background tasks that don't need interactive control
- Tasks requiring custom hooks (PreToolUse, PostToolUse, Stop)
- Multi-step workflows with programmatic branching

Trade-off: Extra cost (API billing), but provides richer programmatic control than CLI `-p` mode.

### Layer 3: tmux + Tailscale (Emergency Fallback)

Run Claude Code inside a tmux session. AgentCTL reads pane output and injects keystrokes over SSH via Tailscale.

When to use:

- CLI `-p` mode is unavailable or broken
- Need to attach to a session that was started manually in a terminal
- Debugging production issues where structured output isn't parsing

Limitations: No structured output. Terminal scraping is fragile. Permission dialogs require heuristic parsing.

## Built-in Remote Control (Optional Enhancement)

The built-in `claude remote-control` feature (launched Feb 24, 2026) is a well-designed relay system, but it is **limited to Max plan seats**.

How it works:

- CLI registers with Anthropic API via outbound HTTPS polling
- Anthropic relay bridges messages between remote client and local session
- Session URL / QR code for connecting from other devices
- Sessions visible at claude.ai/code with live status indicator

AgentCTL integration (Max seat only):

- Worker can start `claude remote-control` on the Max-plan machine
- Capture session URL and register in control plane
- iOS app can deep-link to claude.ai/code for that session
- This provides the richest UX (native claude.ai interface) but only for 1 machine

Not recommended as primary approach because:

1. Max plan required ($200/mo per seat)
2. Only 1 Max seat available, fleet has multiple machines
3. Cannot scale to multi-machine without multiple Max seats

## Current Implementation Status

> Updated: 2026-03-03

All three layers of the architecture are implemented with tests. The system is ready for integration testing on real machines.

### Completed Components

| Component | Location | Tests | Status |
| --- | --- | --- | --- |
| `CliSessionManager` | `agent-worker/src/runtime/cli-session-manager.ts` | 50+ tests | Done |
| Worker session routes | `agent-worker/src/api/routes/sessions.ts` | 25+ tests | Done, wired into server |
| Control plane session routes | `control-plane/src/api/routes/sessions.ts` | 30+ tests | Done, wired into server |
| Session DB migration | `control-plane/drizzle/0004_add_rc_sessions.sql` | — | Done |
| `RcSessionManager` | `agent-worker/src/runtime/rc-session-manager.ts` | 14 tests | Done (Max plan only) |
| Mobile `SessionScreen` | `mobile/src/ui-screens/session-screen.tsx` | — | Done |
| Mobile `SessionApi` | `mobile/src/services/session-api.ts` | — | Done |
| Mobile `DashboardScreen` | `mobile/src/ui-screens/dashboard-screen.tsx` | — | Done |
| Mobile `AgentListScreen` | `mobile/src/ui-screens/agent-list-screen.tsx` | — | Done |
| Mobile `TabNavigator` | `mobile/src/navigation/tab-navigator.tsx` | — | Done (5 tabs) |
| Mobile `App.tsx` entry | `mobile/App.tsx` | — | Done |

### Architecture Flow (As Built)

```text
iOS App (React Native)
  │
  ├─ SessionScreen → SessionApi → Control Plane POST/GET /api/sessions
  ├─ DashboardScreen → ApiClient → Control Plane GET /health, /api/agents
  └─ AgentListScreen → DashboardPresenter → Control Plane GET /api/agents

Control Plane (/api/sessions)
  │
  ├─ POST / → Insert DB row → Dispatch to worker POST /api/sessions
  ├─ POST /:id/resume → Update DB → Dispatch to worker POST /api/sessions/:id/resume
  ├─ POST /:id/message → Forward to worker POST /api/sessions/:id/message
  └─ DELETE /:id → Update DB → Notify worker DELETE /api/sessions/:id

Worker (/api/sessions)
  │
  ├─ POST / → CliSessionManager.startSession() → spawn claude -p
  ├─ POST /:id/resume → CliSessionManager.resumeSession() → spawn claude -p --resume
  ├─ POST /:id/message → CliSessionManager.resumeSession() (same as resume)
  ├─ DELETE /:id → CliSessionManager.stopSession() → SIGTERM/SIGKILL
  ├─ GET /discover → CliSessionManager.discoverLocalSessions() → read ~/.claude/projects/
  └─ GET /:id/stream → SSE stream with buffered event replay + live subscription
```

### Remaining Work

1. **Layer router / dispatch logic** — Control plane should select the right layer (CLI `-p` vs SDK vs tmux) based on machine capabilities and request type
2. **Session discovery aggregation** — Control plane endpoint that fans out `GET /discover` to all online workers and merges results
3. **E2E encryption** — TweetNaCl relay between iOS app and control plane WebSocket
4. **Push notifications** — APNs integration for permission_request events
5. **Codex integration** — Phase 10 in roadmap, same architecture pattern

## Open Questions

1. **`stream-json` schema stability** — Is the `--output-format stream-json` format documented with a stability guarantee, or could it change between CLI versions?
2. **Concurrent CLI `-p` sessions** — Are there limits on how many concurrent `claude -p` processes can run under a single OAuth login?
3. **Session ID persistence** — Does `--resume <session-id>` work across machine reboots, or is the session state ephemeral?
4. **Team plan rate limits** — What are the rate limits for Team plan usage via CLI `-p` mode? Are they the same as interactive usage?
5. **SDK + OAuth hybrid** — Will the Agent SDK ever support OAuth/subscription auth instead of API keys?

## References

- [Claude Code CLI Flags](https://docs.anthropic.com/en/docs/claude-code) — `-p`, `--output-format`, `--resume`, `--allowedTools`
- [Claude Code Remote Control Docs](https://code.claude.com/docs/en/remote-control) — Max plan feature
- [Happy Coder](https://github.com/nomadics9/happy-coder) — Open-source iOS + CLI wrapper with E2E encrypted relay
- [Claude-Code-Remote (JessyTsui)](https://github.com/JessyTsui/Claude-Code-Remote) — Hook-based relay for Telegram/email/Discord
- [CloudCLI (siteboon)](https://github.com/nicobailon/cloudcli) — Web UI for Claude Code sessions
- [Deep Dive: How Remote Control Works](https://dev.to/chwu1946/deep-dive-how-claude-code-remote-control-actually-works-50p6)
- [Remote Control Implementation Details (Gist)](https://gist.github.com/sorrycc/9b9ac045d5329ac03084a465345b59c3)
- [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) — Requires API key, separate billing
