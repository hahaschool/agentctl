# Terminal Takeover Gap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let operators attach an interactive terminal to the real running Claude managed session so they can unblock auth prompts and other stdin-driven waits without spawning a separate shell or Remote Control sidecar.

**Architecture:** The codebase already has two adjacent but insufficient pieces: generic machine terminal PTY infrastructure and Claude Remote Control manual takeover. The remaining gap is a runtime-session-scoped PTY bridge for the managed `claude -p --output-format stream-json` process, plus control-plane/web wiring that exposes that bridge from the runtime session panel. Initial scope should stay Claude-only and reuse the existing runtime-session identifiers rather than inventing a second terminal lifecycle.

**Tech Stack:** Fastify WebSocket routes, `node-pty`, existing worker `CliSessionManager`, control-plane worker proxy routes, React/Next.js runtime session UI, Vitest, Playwright.

---

## Audit Summary

- Already shipped:
  - Generic PTY terminals on a machine via [terminal.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/agent-worker/src/api/routes/terminal.ts) and [InteractiveTerminal.tsx](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/web/src/components/InteractiveTerminal.tsx).
  - Machine-level terminal proxying via [terminal.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/control-plane/src/api/routes/terminal.ts).
  - Claude Remote Control manual takeover via [manual-takeover.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/control-plane/src/api/routes/manual-takeover.ts), [manual-takeover.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/agent-worker/src/api/routes/manual-takeover.ts), and [RuntimeSessionPanel.tsx](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/web/src/views/RuntimeSessionPanel.tsx).
  - A placeholder session-terminal WebSocket in [sessions.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/agent-worker/src/api/routes/sessions.ts) that replays output and sends input by stopping the session and spawning `--resume`.
- Not yet shipped:
  - Direct PTY attachment to the still-running managed Claude CLI process.
  - A runtime-session-scoped control-plane proxy for that attach flow.
  - Runtime session UI that opens an interactive terminal for the current managed session instead of a generic machine shell or a Claude Remote Control URL.
- Scope decision:
  - Keep the first implementation limited to Claude managed sessions backed by [cli-session-manager.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/agent-worker/src/runtime/cli-session-manager.ts).
  - Do not expand this slice to Codex parity, generic machine terminals, or a broader session transport refactor unless the PTY spike proves that the current Claude `-p` path cannot support direct attach.

## Task 1: Prove and encapsulate PTY-backed Claude session transport

**Files:**
- Modify: [cli-session-manager.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/agent-worker/src/runtime/cli-session-manager.ts)
- Modify: [cli-session-manager.test.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/agent-worker/src/runtime/cli-session-manager.test.ts)
- Reference: [terminal-manager.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/agent-worker/src/runtime/terminal-manager.ts)

**Step 1: Write the failing transport tests**

- Add tests that describe the new behavior:
  - a running Claude session exposes terminal attach metadata or a writable terminal handle
  - input can be forwarded to the live PTY without spawning a resume session
  - resize events update the PTY dimensions
  - session cleanup tears down the PTY handle on exit/kill
- Keep one regression test proving the existing JSON event parsing still works when the session runs under the new transport.

**Step 2: Run the focused worker tests and confirm they fail**

Run:

```bash
pnpm --filter @agentctl/agent-worker exec vitest run src/runtime/cli-session-manager.test.ts
```

Expected: FAIL on the new terminal-attach expectations.

**Step 3: Add the minimal PTY-capable session transport**

- Replace the current `stdio: ['ignore', 'pipe', 'pipe']` assumption with a PTY-backed path for Claude managed sessions.
- Preserve the current stream-json parsing contract by feeding PTY output into the same line-buffer/parser path used today.
- Add explicit manager methods for:
  - looking up terminal attachability for a session
  - writing raw input to the running session PTY
  - resizing the PTY
- Keep the scope Claude-only. Do not refactor Codex session management in this slice.

**Step 4: Re-run the focused worker tests**

Run:

```bash
pnpm --filter @agentctl/agent-worker exec vitest run src/runtime/cli-session-manager.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent-worker/src/runtime/cli-session-manager.ts \
  packages/agent-worker/src/runtime/cli-session-manager.test.ts
git commit -m "feat(worker): add PTY-backed Claude session transport"
```

## Task 2: Replace resume-based session terminal attach with live PTY attach

**Files:**
- Modify: [sessions.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/agent-worker/src/api/routes/sessions.ts)
- Modify: [sessions.test.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/agent-worker/src/api/routes/sessions.test.ts)
- Reference: [cli-session-manager.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/agent-worker/src/runtime/cli-session-manager.ts)

**Step 1: Write failing route tests**

- Add coverage for:
  - WebSocket attach to a running session returning buffered output plus live PTY output
  - `{ type: "input" }` frames writing to the current process instead of spawning `resumeSession`
  - `{ type: "resize" }` frames resizing the live terminal
  - meaningful errors for non-attachable sessions or sessions without an active PTY

**Step 2: Run the focused route tests and confirm they fail**

Run:

```bash
pnpm --filter @agentctl/agent-worker exec vitest run src/api/routes/sessions.test.ts
```

Expected: FAIL on the new live-attach assertions.

**Step 3: Update the worker WebSocket endpoint**

- Rework `GET /api/sessions/:sessionId/terminal` so it becomes a live PTY bridge for running Claude sessions.
- Remove the stop-and-resume behavior from this endpoint.
- Keep buffered replay so the operator sees recent output immediately on connect.
- Support at least:
  - `input`
  - `resize`
  - terminal exit / session-ended frames

**Step 4: Re-run focused worker route tests**

Run:

```bash
pnpm --filter @agentctl/agent-worker exec vitest run src/api/routes/sessions.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent-worker/src/api/routes/sessions.ts \
  packages/agent-worker/src/api/routes/sessions.test.ts
git commit -m "feat(worker): bridge live session terminal attach"
```

## Task 3: Add control-plane runtime-session terminal proxy routes

**Files:**
- Create or modify: [runtime-sessions.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/control-plane/src/api/routes/runtime-sessions.ts)
- Create or modify: [runtime-sessions.test.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/control-plane/src/api/routes/runtime-sessions.test.ts)
- Reference: [manual-takeover.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/control-plane/src/api/routes/manual-takeover.ts)
- Reference: [terminal.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/control-plane/src/api/routes/terminal.ts)

**Step 1: Write failing control-plane tests**

- Cover:
  - runtime session id resolves to machine id + native session id
  - non-Claude or non-running sessions are rejected if they are not attachable
  - WebSocket proxy path forwards to the worker session-terminal endpoint

**Step 2: Run the focused control-plane tests and confirm they fail**

Run:

```bash
pnpm --filter @agentctl/control-plane exec vitest run src/api/routes/runtime-sessions.test.ts
```

Expected: FAIL on the new terminal proxy expectations.

**Step 3: Implement the runtime-session proxy**

- Add a runtime-session-scoped terminal route, for example:
  - `GET /api/runtime-sessions/:id/terminal/ws`
- Resolve the managed session to:
  - `machineId`
  - `nativeSessionId`
- Proxy directly to the worker session-terminal WebSocket route.
- Do not route this through the generic machine terminal spawn APIs, because those create a new shell instead of attaching to the current managed session.

**Step 4: Re-run focused control-plane tests**

Run:

```bash
pnpm --filter @agentctl/control-plane exec vitest run src/api/routes/runtime-sessions.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/control-plane/src/api/routes/runtime-sessions.ts \
  packages/control-plane/src/api/routes/runtime-sessions.test.ts
git commit -m "feat(control-plane): proxy runtime session terminal attach"
```

## Task 4: Surface Attach Terminal in the runtime session UI

**Files:**
- Modify: [RuntimeSessionPanel.tsx](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/web/src/views/RuntimeSessionPanel.tsx)
- Modify: [RuntimeSessionPanel.test.tsx](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/web/src/views/RuntimeSessionPanel.test.tsx)
- Modify: [api.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/web/src/lib/api.ts)
- Modify: [queries.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/web/src/lib/queries.ts)
- Reuse: [InteractiveTerminal.tsx](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/web/src/components/InteractiveTerminal.tsx)

**Step 1: Write failing UI tests**

- Add coverage for:
  - an `Attach Terminal` control appears only when the selected runtime session is attachable
  - opening the terminal uses the runtime-session-scoped endpoint, not the machine shell page
  - the existing Remote Control manual takeover controls remain visible and unchanged

**Step 2: Run the focused web tests and confirm they fail**

Run:

```bash
pnpm --filter @agentctl/web exec vitest run src/views/RuntimeSessionPanel.test.tsx src/lib/api.test.ts src/lib/queries.test.ts
```

Expected: FAIL on the new terminal attach assertions.

**Step 3: Implement the runtime session terminal UI**

- Add API/query helpers for runtime session terminal attach.
- Reuse `InteractiveTerminal` in a runtime-session context, or extract a thin shared wrapper if the URL construction needs to support both machine-shell and runtime-session attach modes.
- Add an `Attach Terminal` action near the existing Manual Takeover controls in the runtime session panel.
- Keep the Remote Control wording intact so operators can distinguish:
  - Remote Control sidecar
  - Live PTY attach to the running CLI process

**Step 4: Re-run focused web tests**

Run:

```bash
pnpm --filter @agentctl/web exec vitest run src/views/RuntimeSessionPanel.test.tsx src/lib/api.test.ts src/lib/queries.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/views/RuntimeSessionPanel.tsx \
  packages/web/src/views/RuntimeSessionPanel.test.tsx \
  packages/web/src/lib/api.ts \
  packages/web/src/lib/queries.ts \
  packages/web/src/components/InteractiveTerminal.tsx
git commit -m "feat(web): add runtime session terminal attach"
```

## Task 5: End-to-end verification and roadmap reconciliation

**Files:**
- Modify: [runtime-sessions.spec.ts](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/packages/web/e2e/runtime-sessions.spec.ts)
- Modify: [ROADMAP.md](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/docs/ROADMAP.md)
- Modify: [2026-03-20-terminal-takeover-gap-implementation-plan.md](/Users/hahaschool/agentctl/.trees/codex-336-terminal-takeover-audit/docs/plans/2026-03-20-terminal-takeover-gap-implementation-plan.md)

**Step 1: Add a focused runtime-session terminal e2e scenario**

- Cover a stubbed running Claude runtime session whose terminal attach opens successfully.
- Assert the UI distinguishes:
  - `Start Manual Takeover`
  - `Attach Terminal`

**Step 2: Run the focused e2e**

Run:

```bash
pnpm --filter @agentctl/web exec playwright test e2e/runtime-sessions.spec.ts --grep "Attach Terminal"
```

Expected: PASS

**Step 3: Sync roadmap/docs**

- Update `docs/ROADMAP.md` so 27.3 stops claiming “planned, not yet started”.
- Mark it as partial/in progress with the correct factual split:
  - shipped: machine terminals, InteractiveTerminal, session-output replay, Claude Remote Control manual takeover
  - missing: live PTY attach to the running managed session
- Keep this plan doc linked from the roadmap.

**Step 4: Run final focused verification**

Run:

```bash
git diff --check
pnpm --filter @agentctl/agent-worker exec vitest run src/runtime/cli-session-manager.test.ts src/api/routes/sessions.test.ts
pnpm --filter @agentctl/control-plane exec vitest run src/api/routes/runtime-sessions.test.ts
pnpm --filter @agentctl/web exec vitest run src/views/RuntimeSessionPanel.test.tsx src/lib/api.test.ts src/lib/queries.test.ts
pnpm --filter @agentctl/web exec playwright test e2e/runtime-sessions.spec.ts --grep "Attach Terminal"
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/e2e/runtime-sessions.spec.ts docs/ROADMAP.md docs/plans/2026-03-20-terminal-takeover-gap-implementation-plan.md
git commit -m "docs: sync terminal takeover roadmap status"
```

## Risks and Guardrails

- PTY output may add escape sequences or prompt noise that break the current stream-json parsing assumptions. Validate this first in Task 1 before touching UI or control-plane routes.
- `Attach Terminal` must not silently create a new shell. That would duplicate the already-shipped machine terminal feature and mislead operators.
- Keep the first slice Claude-only. Codex parity can be evaluated only after the Claude PTY path proves stable.
- Remote Control manual takeover remains a separate operator surface and should not be removed or renamed in this plan.
