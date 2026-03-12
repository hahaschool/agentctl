# Codex GUI Thread Prompts

Use these prompts from the root project `/Users/hahaschool/agentctl`.

Recommended GUI flow:
1. Open the root project in Codex Desktop.
2. Create a new thread and set it to use `Worktree`.
3. Start from `main`.
4. Paste one prompt per thread.

## Thread 1: Unified Session Browser

```text
First, make sure this worktree is on branch `codex/p0-unified-session-browser`.
If the branch already exists, switch to it.
If it does not exist, create it from `main`.

Then work in this branch only.

Goal:
- Implement roadmap item `4.6 Unified Session Browser — P0`.
- Consolidate `/sessions` and `/runtime-sessions` into one canonical web session browser.

Read first:
- `docs/ROADMAP.md`
- `docs/plans/2026-03-10-unified-sessions-ui-design.md`
- `docs/plans/2026-03-10-unified-sessions-ui-impl-plan.md`

Primary files:
- `packages/web/src/views/SessionsPage.tsx`
- `packages/web/src/views/RuntimeSessionsPage.tsx`
- `packages/web/src/views/DashboardPage.tsx`
- `packages/web/src/components/Sidebar.tsx`
- `packages/web/src/app/runtime-sessions/page.tsx`
- Related tests under `packages/web/src/views/` and `packages/web/src/components/`

Constraints:
- Stay inside `packages/web` unless a tiny shared type addition is absolutely required.
- Do not modify `packages/control-plane/**` or `packages/agent-worker/**`.
- Follow the implementation plan task order where practical.

Execution:
1. Read the implementation plan and identify the first incomplete task.
2. Implement incrementally with tests.
3. Keep changes scoped to the unified sessions work only.
4. Run focused tests from the plan.
5. Run `pnpm --filter @agentctl/web build`.

Success criteria:
- `/sessions` supports `All`, `Agent`, and `Runtime` filtering.
- Runtime-specific detail/actions are reachable from the unified page.
- `/runtime-sessions` redirects to `/sessions?type=runtime`.
- Dashboard/sidebar navigation stops sending users to the old route.

When done, summarize:
- What changed
- Tests run
- Any residual risks or follow-up items
```

## Thread 2: Dispatch Signature Verification

```text
First, make sure this worktree is on branch `codex/p1-dispatch-signing`.
If the branch already exists, switch to it.
If it does not exist, create it from `main`.

Then work in this branch only.

Goal:
- Implement roadmap item `2.7 Dispatch Signature Verification — P1`.
- Add application-layer signing/verification for control-plane dispatches to workers.

Read first:
- `docs/ROADMAP.md`
- `docs/plans/2026-03-10-astro-agent-patterns-design.md`

Primary files:
- `packages/control-plane/src/scheduler/task-worker.ts`
- `packages/control-plane/src/api/routes/agents.ts`
- `packages/agent-worker/src/api/routes/agents.ts`
- `packages/agent-worker/src/health-reporter.ts`
- `packages/shared/src/crypto/`
- `packages/shared/src/index.ts`

Recommended approach:
- Use Ed25519 via the existing shared crypto stack rather than introducing a new signing library if unnecessary.
- Sign dispatch payloads in the control plane before sending to worker start endpoints.
- Verify signatures in the worker before execution.
- Add key distribution support through existing machine registration / worker bootstrap paths.

Constraints:
- Do not touch web/mobile UI.
- Do not refactor `packages/agent-worker/src/runtime/agent-instance.ts` or `sdk-runner.ts`.
- Keep scope limited to signing, verification, and the minimum plumbing needed to deliver that.

Verification:
- `pnpm --filter @agentctl/shared test -- src/crypto`
- `pnpm --filter @agentctl/control-plane test -- src/scheduler/task-worker.test.ts src/api/routes/agents.test.ts`
- `pnpm --filter @agentctl/agent-worker test -- src/api/routes/agents.test.ts src/health-reporter.test.ts`

Success criteria:
- Control plane includes a verifiable signature on dispatch payloads.
- Worker rejects invalid or missing signatures according to the intended policy.
- Public key distribution path is implemented and tested.
- Tests cover happy path and verification failure path.

When done, summarize:
- Signing format chosen
- Files changed
- Tests run
- Any rollout or compatibility caveats
```

## Thread 3: Remote Control Spike

```text
First, make sure this worktree is on branch `codex/p2-remote-control-spike`.
If the branch already exists, switch to it.
If it does not exist, create it from `main`.

Then work in this branch only.

Goal:
- Execute the roadmap spike for `2.4 Remote Control Integration (Optional Enhancement) — P2`.
- Decide whether Claude Code Remote Control relay is worth adopting over the current CLI `-p` approach.

Read first:
- `docs/ROADMAP.md`
- `docs/plans/2026-03-03-session-takeover-design.md`
- `docs/plans/2026-03-10-astro-agent-patterns-design.md`
- `docs/ARCHITECTURE.md`

Output:
- Create a concise decision memo under `docs/plans/` with today’s date in the filename.
- Update `docs/ROADMAP.md` only if the recommendation is clear enough to tighten next actions.

Evaluate explicitly:
- Latency
- Reliability / failure modes
- Operational complexity
- Cost
- Impact on hooks
- Impact on loop controller and scheduled sessions
- Compatibility with current runtime/session architecture

Constraints:
- This is a spike, not a full implementation.
- Do not make invasive production code changes unless needed for a tiny proof-of-concept.
- Prefer documentation, comparison, and a concrete recommendation.

Suggested deliverable structure:
1. Current state
2. Remote Control relay model
3. Comparison vs CLI `-p`
4. Risks and unknowns
5. Recommendation
6. If adopting: smallest safe next implementation slice
7. If not adopting: what to keep watching

Verification:
- Ensure the new plan/memo is internally consistent with the existing roadmap and architecture docs.

When done, summarize:
- Recommendation
- Evidence used
- Whether follow-up implementation should be scheduled now or deferred
```
