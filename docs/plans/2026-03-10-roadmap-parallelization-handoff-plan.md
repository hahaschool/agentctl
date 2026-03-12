# Roadmap Parallelization Handoff Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the current roadmap into a safe worktree handoff plan that maximizes parallel execution without causing avoidable merge conflicts in shared runtime code.

**Architecture:** Split work by package boundary first: web-only, security/dispatch, infra/runtime operations, and research. Keep runtime-core changes serialized when they touch the same worker lifecycle files (`agent-instance.ts`, `sdk-runner.ts`, shared event types), because those are the highest-conflict surfaces in the repo right now.

**Tech Stack:** TypeScript, Next.js, Fastify, BullMQ, Drizzle, React Native, pnpm, Git worktrees

---

## Ground Truth

- `git pull --ff-only` on `main` is already up to date.
- `docs/ROADMAP.md` was last updated on `2026-03-10`.
- The repo already uses `.trees/` for worktrees and `.gitignore` already ignores it.
- Existing worktrees are already under `.trees/`, so new handoff work should follow the same convention instead of introducing `.worktrees/`.

## Recommended Parallel Set

These four groups are safe to start in parallel immediately.

### Group 1: P0 Unified Session Browser

**Why now:** Highest-priority roadmap item, already has an implementation plan, and stays almost entirely inside `packages/web`.

**Primary files:**
- `docs/plans/2026-03-10-unified-sessions-ui-impl-plan.md`
- `packages/web/src/views/SessionsPage.tsx`
- `packages/web/src/views/RuntimeSessionsPage.tsx`
- `packages/web/src/views/DashboardPage.tsx`
- `packages/web/src/components/Sidebar.tsx`
- `packages/web/src/app/runtime-sessions/page.tsx`
- Related web tests under `packages/web/src/views/` and `packages/web/src/components/`

**Do not touch:**
- `packages/control-plane/**`
- `packages/agent-worker/**`
- Shared runtime contracts unless absolutely required

**Suggested branch/worktree:**
- Branch: `codex/p0-unified-session-browser`
- Worktree: `.trees/p0-unified-session-browser`

**Verification:**
- `pnpm --filter @agentctl/web test -- src/views/unified-session-model.test.ts src/views/SessionsPage.test.tsx src/views/RuntimeSessionsPage.test.tsx src/views/DashboardPage.test.tsx src/components/Sidebar.test.tsx`
- `pnpm --filter @agentctl/web build`

### Group 2: P1 Dispatch Signature Verification

**Why now:** Self-contained security hardening with minimal overlap with web and UI tasks.

**Primary files:**
- `packages/control-plane/src/scheduler/task-worker.ts`
- `packages/control-plane/src/api/routes/agents.ts`
- `packages/agent-worker/src/api/routes/agents.ts`
- `packages/agent-worker/src/health-reporter.ts`
- `packages/shared/src/crypto/`
- `packages/shared/src/index.ts`
- Tests in `packages/control-plane/src/scheduler/task-worker.test.ts`, `packages/agent-worker/src/api/routes/agents.test.ts`, and new shared crypto tests

**Do not touch:**
- `packages/web/**`
- `packages/mobile/**`
- `packages/agent-worker/src/runtime/agent-instance.ts`
- `packages/agent-worker/src/runtime/sdk-runner.ts`

**Suggested branch/worktree:**
- Branch: `codex/p1-dispatch-signing`
- Worktree: `.trees/p1-dispatch-signing`

**Verification:**
- `pnpm --filter @agentctl/shared test -- src/crypto`
- `pnpm --filter @agentctl/control-plane test -- src/scheduler/task-worker.test.ts src/api/routes/agents.test.ts`
- `pnpm --filter @agentctl/agent-worker test -- src/api/routes/agents.test.ts src/health-reporter.test.ts`

### Group 3: P1 Workdir Safety Tiers

**Why now:** High-priority runtime safety work that can move independently from web and dispatch signing, but it must own the runtime-core lane while it is in flight.

**Primary files:**
- `packages/agent-worker/src/runtime/agent-instance.ts`
- `packages/agent-worker/src/runtime/workdir-safety.ts`
- `packages/agent-worker/src/worktree/worktree-manager.ts`
- `packages/agent-worker/src/api/routes/agents.ts`
- `packages/control-plane/src/api/routes/agents.ts`
- `packages/shared/src/protocol/events.ts`
- Worker/control-plane tests around runtime start and agent APIs

**Do not touch:**
- `packages/web/**` except a minimal approval UI follow-up if explicitly split later
- `packages/agent-worker/src/runtime/sdk-runner.ts` unless the safety flow truly requires it
- `packages/shared/src/types/agent-run.ts`

**Suggested branch/worktree:**
- Branch: `codex/p1-workdir-safety-tiers`
- Worktree: `.trees/p1-workdir-safety-tiers`

**Verification:**
- `pnpm --filter @agentctl/agent-worker test -- src/runtime/agent-instance.test.ts src/api/routes/agents.test.ts`
- `pnpm --filter @agentctl/control-plane test -- src/api/routes/agents.test.ts`

### Group 4: P2 Codex Operational Parity

**Why now:** Independent operational hardening for Codex that does not require the unified sessions UI and can progress without touching the main worker lifecycle path.

**Primary files:**
- `infra/litellm/**`
- `infra/pm2/**`
- `packages/agent-worker/src/runtime/fs-isolation.ts`
- `packages/agent-worker/src/runtime/network-policy.ts`
- `packages/agent-worker/src/runtime/config/`
- Any worker startup/config docs that describe Codex deployment

**Do not touch:**
- `packages/web/src/views/SessionsPage.tsx`
- `packages/control-plane/src/scheduler/task-worker.ts`
- `packages/agent-worker/src/runtime/agent-instance.ts`

**Suggested branch/worktree:**
- Branch: `codex/p2-codex-operational-parity`
- Worktree: `.trees/p2-codex-operational-parity`

**Verification:**
- `pnpm --filter @agentctl/agent-worker test -- src/runtime/fs-isolation.test.ts src/runtime/network-policy.test.ts src/runtime/config/runtime-config-applier.test.ts`
- Any repo-specific PM2 or LiteLLM validation commands added by the implementation

## Runtime-Core Serialized Lane

Only one of these should be active at a time, because they all compete for the same hot files and event contracts.

### Option A: P1 Structured Execution Summary

**Hot files:**
- `packages/agent-worker/src/runtime/agent-instance.ts`
- `packages/control-plane/src/db/schema.ts`
- `packages/control-plane/drizzle/*.sql`
- `packages/shared/src/types/agent-run.ts`
- `packages/shared/src/protocol/events.ts`
- Session detail UI in web/mobile

**Why serialize:** This changes run persistence, event payloads, and stop lifecycle behavior.

**Suggested branch/worktree after Group 3 or instead of it:**
- Branch: `codex/p1-structured-execution-summary`
- Worktree: `.trees/p1-structured-execution-summary`

### Option B: P2 AgentOutputStream

**Hot files:**
- `packages/agent-worker/src/runtime/sdk-runner.ts`
- `packages/agent-worker/src/runtime/agent-instance.ts`
- `packages/agent-worker/src/runtime/claude-runtime-adapter.ts`
- `packages/agent-worker/src/runtime/codex-runtime-adapter.ts`
- `packages/shared/src/protocol/events.ts`

**Why serialize:** This is the foundation for steering, automatic handoff triggers, and future execution-environment work. It will create wide conflicts if run alongside other runtime-core changes.

**Suggested branch/worktree after Group 3 or instead of it:**
- Branch: `codex/p2-agent-output-stream`
- Worktree: `.trees/p2-agent-output-stream`

### Option C: P2 Mid-Execution Steering

**Rule:** Do not start this until AgentOutputStream lands or its contract is otherwise frozen.

## Research / Low-Conflict Lane

This can run at any time without colliding with the groups above.

### Remote Control Spike

**Scope:**
- Compare Claude Code Remote Control relay vs current CLI `-p`
- Capture latency, reliability, cost, and operational complexity
- Produce a recommendation doc and a go/no-go decision

**Primary files:**
- `docs/ROADMAP.md`
- `docs/plans/2026-03-10-astro-agent-patterns-design.md`
- New research or decision doc under `docs/plans/`

**Suggested branch/worktree:**
- Branch: `codex/p2-remote-control-spike`
- Worktree: `.trees/p2-remote-control-spike`

## Defer Until Earlier Groups Land

- `Fork UX Extensions` should wait until `Unified Session Browser` lands, because both affect session-navigation and runtime-session UX.
- `Mobile Session Browser` should wait until the unified web model stabilizes, as the roadmap explicitly treats web unification as the pattern source.
- `Automatic Handoff Triggers` should wait for `AgentOutputStream`.
- `Execution Environment Registry` should wait for `AgentOutputStream`.
- `Memory Continuity` should wait for `Automatic Handoff Triggers`.

## Recommended Handoff Order

If you want the highest-value split with the lowest conflict risk, hand off in this order:

1. `codex/p0-unified-session-browser`
2. `codex/p1-dispatch-signing`
3. `codex/p1-workdir-safety-tiers`
4. `codex/p2-codex-operational-parity`
5. `codex/p2-remote-control-spike`

After Group 3 merges, pick exactly one runtime-core follow-up:

1. `codex/p1-structured-execution-summary`
2. `codex/p2-agent-output-stream`

## Notes For Worktree Creation

- Use `.trees/` as the base directory for new handoff worktrees.
- Keep one feature per worktree.
- Do not start two branches that both need `packages/agent-worker/src/runtime/agent-instance.ts`.
- Do not start `Fork UX Extensions` while `Unified Session Browser` is changing `SessionsPage.tsx`.
