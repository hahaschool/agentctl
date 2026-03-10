# Decision Memo: Claude Code Remote Control Relay

> Date: 2026-03-10
> Status: Decision made
> Scope: `2.4 Remote Control Integration (Optional Enhancement) — P2`

## 1. Current state

- `packages/agent-worker/src/runtime/cli-session-manager.ts` is the active Claude session path. It already uses `claude -p`, `--output-format stream-json`, `--resume`, tool allow/deny flags, and worker-side SSE buffering.
- `packages/agent-worker/src/runtime/claude-runtime-adapter.ts` connects Claude managed sessions to the unified `managed_sessions` runtime API.
- `packages/agent-worker/src/runtime/agent-instance.ts`, `sdk-runner.ts`, and `loop-controller.ts` power hooks, audit logging, cost events, loops, and scheduled/autonomous execution.
- `packages/agent-worker/src/runtime/rc-session-manager.ts` is only a narrow spike artifact. It can spawn `claude remote-control` and capture a `claude.ai/code` URL, but it is not wired into `RuntimeRegistry`, `/api/runtime-sessions`, `managed_sessions`, loop control, or scheduler flows.
- The 2026-03-03 archived design assumed Remote Control was Max-only. Current Anthropic docs and the local `claude remote-control --help` output now describe it as available to subscribed Claude accounts rather than Max-only.

## 2. Remote Control relay model

- Anthropic's Remote Control model is human-first: `claude remote-control` connects the local environment to `claude.ai/code`.
- The relay uses outbound connections only and polls for work. The browser and local machine share the same filesystem, internet access, settings, and project config.
- Session constraints are materially different from `-p` automation:
  - only one active remote-control session per directory
  - the local CLI process must stay alive
  - brief network loss can recover, but more than 10 minutes offline times out the session
- The exposed local CLI surface is small: `--name`, `--permission-mode`, `--debug-file`, and `--verbose`. There is no documented local structured event stream comparable to `--output-format stream-json`.

## 3. Comparison vs CLI `-p`

| Dimension | Current CLI `-p` path | Remote Control relay | Assessment |
| --- | --- | --- | --- |
| Latency | Local subprocess with stdout event stream | Extra `claude.ai/code` hop plus outbound polling relay | `-p` is the safer low-latency path for orchestration. Relay may be fine for human takeover, but it is not a latency win for worker-managed automation. |
| Reliability / failure modes | Local process exit, JSON parsing, session-file resume fragility | Adds relay connectivity, browser state, single-active-session-per-directory rule, and timeout after long disconnects | Relay introduces more moving parts and more ways for AgentCTL to lose control of a run. |
| Operational complexity | Already integrated into worker routes, SSE buffers, runtime adapter, and session persistence | Would need a new runtime adapter, session URL lifecycle, control-plane persistence, remote/browser state handling, and observability bridge | Relay is materially more complex than the current path. |
| Cost | Uses existing Claude subscription seats | Also uses Claude subscription seats | No meaningful cost advantage over `-p`. The older "Max-only" cost objection is no longer the main issue. |
| Impact on hooks | Current autonomous path already uses local pre/post/stop hooks via `sdk-runner.ts`; `-p` path still emits worker-side tool/cost events | Native Claude hooks should still run locally, and Anthropic exposes `CLAUDE_CODE_REMOTE` for remote web launches, but AgentCTL would lose its current worker-side hook/audit/event contract unless redesigned | Negative for the current hook model. |
| Impact on loop controller and scheduled sessions | Already aligned with `AgentInstance`, `LoopController`, `ScheduleConfig`, and resume semantics | Human-first remote UI with no worker-local structured event feed; poor fit for unattended loops and scheduled runs | Do not use relay as the loop/scheduler backend. |
| Compatibility with current runtime/session architecture | Matches `managed_sessions`, `nativeSessionId`, SSE/event buffering, and runtime adapters today | Current RC spike only yields a session URL and PID; it does not satisfy the existing managed runtime lifecycle contract | Low compatibility without significant adaptation work. |

## 4. Risks and unknowns

- Anthropic could later add a programmatic Remote Control API, local event feed, or better machine-manageable session lifecycle. That would materially change this decision.
- I did not run a live remote-control session in this spike, so latency is an architectural inference from the published relay model rather than a measured benchmark.
- Remote Control could still be useful as a narrow manual takeover feature, but that is a different problem than replacing `claude -p` as AgentCTL's managed execution path.

## 5. Recommendation

Do not adopt Claude Code Remote Control relay as AgentCTL's primary session control layer for P2.

Keep the current split:

- `claude -p` for managed Claude sessions and runtime-session control
- Agent SDK path for hook-heavy/background execution
- tmux fallback for emergency/manual attachment

Treat Remote Control as a future optional manual takeover surface, not as the orchestration core.

## 6. If adopting later: smallest safe slice

If we revisit this later, the smallest safe slice is not "replace `-p`." It is:

1. Add a separate `ClaudeRemoteControlAdapter` that only starts/stops relay sessions and stores `sessionUrl`.
2. Expose it as an explicit manual takeover action for an existing Claude runtime session.
3. Keep loops, scheduled sessions, hooks, and cost/audit reporting on the existing `-p` or SDK paths.

That keeps the blast radius small and avoids rewriting the runtime/session contract around a human-facing relay.

## 7. If not adopting: what to keep watching

- A documented programmatic Remote Control event stream or session-management API
- First-class resume/fork semantics for relay-managed sessions
- A worker-local status channel that exposes tool use, cost, approvals, and completion signals
- Clearer guarantees around concurrent sessions, reconnect windows, and long-running unattended use

## Evidence used

- Local code: `packages/agent-worker/src/runtime/cli-session-manager.ts`, `rc-session-manager.ts`, `claude-runtime-adapter.ts`, `agent-instance.ts`, `sdk-runner.ts`, `loop-controller.ts`, `packages/control-plane/src/api/routes/runtime-sessions.ts`, `packages/shared/src/types/runtime-management.ts`
- Local CLI: `claude --version` reported `2.1.72`; `claude remote-control --help`; `claude --help`
- Anthropic docs:
  - Remote Control docs
  - Headless / CLI docs for `--print`, `--output-format stream-json`, and `--resume`
  - Hooks docs, including remote environment variables
  - Claude Code release notes noting broader Remote Control availability and relay-related fixes
