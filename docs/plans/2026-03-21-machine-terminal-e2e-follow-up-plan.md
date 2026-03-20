# Machine Terminal E2E Follow-up Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add stable Playwright coverage for the existing machine terminal page so regressions in the current terminal UI are caught without mixing this slice with §27.3 live managed-session attach.

**Architecture:** Keep this follow-up scoped to the machine terminal route that already exists under `/machines/[id]/terminal`. Use a dedicated Playwright spec with deterministic mocks for machine metadata and terminal connectivity, and only harden the page/component seams if the new browser coverage exposes a real stability gap. Do not route this work through runtime-session live attach, Claude Remote Control takeover, or any worker-side PTY changes.

**Tech Stack:** Playwright, Next.js App Router, existing web test harness/mocks, Vitest for any supporting component/page hardening.

> Status note: Delivered on `main` via PR #346. `packages/web/e2e/machines-terminal.spec.ts` now covers the machine terminal page shell, a stable connect/render path, and the existing spawn-error path using deterministic HTTP/WebSocket mocks. No machine-terminal page hardening was required, so Task 2 was not needed.

---

## Scope Guardrails

- Cover the existing machine terminal page only.
- Reuse or extend the current terminal page / component tests before inventing new app plumbing.
- Do not mix this slice with §27.3 live attach to the running managed Claude CLI.
- Prefer one dedicated Playwright spec over broad smoke coverage unless the implementation proves a shared smoke assertion is genuinely needed.

## Task 1: Add dedicated machine terminal Playwright coverage

**Files:**
- Create: `packages/web/e2e/machines-terminal.spec.ts`
- Reference: `packages/web/e2e/runtime-sessions.spec.ts`
- Reference: `packages/web/src/app/machines/[id]/terminal/page.tsx`

**Step 1: Write the failing browser spec**

- Add a dedicated Playwright spec for the current machine terminal route.
- Cover:
  - terminal page shell renders for a known machine id
  - one stable terminal-connect / terminal-render path using deterministic mocks
  - one minimal error or disconnected-state assertion for the existing machine terminal UI

**Step 2: Run the targeted e2e command and confirm it fails**

Run:

```bash
pnpm --filter @agentctl/web exec playwright test e2e/machines-terminal.spec.ts
```

Expected: FAIL on the new terminal-route assertions until the needed test support or UI hardening is in place.

**Step 3: Implement the minimal test support**

- Add only the smallest browser-test support needed for the machine terminal route to pass reliably.
- Keep the scope inside the existing page/component surface.
- Do not change runtime-session terminal behavior or managed-session attach semantics.

**Step 4: Re-run the targeted e2e command**

Run:

```bash
pnpm --filter @agentctl/web exec playwright test e2e/machines-terminal.spec.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/e2e/machines-terminal.spec.ts
git commit -m "test(web): cover machine terminal page"
```

## Task 2: Harden the machine terminal page surface only if the new spec exposes a real gap

> Outcome: Not needed for PR #346. The dedicated machine-terminal Playwright spec passed without additional page-level changes.

**Files:**
- Modify only if needed: `packages/web/src/app/machines/[id]/terminal/page.tsx`
- Modify only if needed: `packages/web/src/app/machines/[id]/terminal/page.test.tsx`

**Step 1: Add the failing unit-level regression only if the e2e spec reveals an unstable seam**

- Typical triggers:
  - missing loading/error copy on the machine terminal page
  - selector/test-id gaps that force flaky Playwright behavior
  - page-level state wiring that makes the machine terminal route non-deterministic in browser tests

If the browser coverage reveals a gap that would require changing shared
terminal attach/transport behavior or broad `InteractiveTerminal` internals,
stop and spin that work back into §27.3 instead of widening this follow-up.

**Step 2: Run the focused web unit tests and confirm the regression**

Run:

```bash
pnpm --filter @agentctl/web exec vitest run \
  src/app/machines/[id]/terminal/page.test.tsx
```

Expected: FAIL only if a real regression test was added in Step 1.

**Step 3: Implement the minimal page-level hardening**

- Fix only the issue exposed by the new machine-terminal coverage.
- Keep the scope on the machine terminal page contract itself.
- Avoid widening this slice into general terminal refactors or shared attach
  behavior.

**Step 4: Re-run unit tests and the dedicated e2e spec**

Run:

```bash
pnpm --filter @agentctl/web exec vitest run \
  src/app/machines/[id]/terminal/page.test.tsx
pnpm --filter @agentctl/web exec playwright test e2e/machines-terminal.spec.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/app/machines/[id]/terminal/page.tsx \
  packages/web/src/app/machines/[id]/terminal/page.test.tsx
git commit -m "fix(web): harden machine terminal test seams"
```

## Task 3: Keep the follow-up isolated and sync roadmap status after implementation

**Files:**
- Modify: `docs/ROADMAP.md`
- Reference: `docs/plans/2026-03-21-machine-terminal-e2e-follow-up-plan.md`

**Step 1: Verify scope stayed isolated**

- Confirm the implementation PR touched only the machine terminal route / component / e2e surface.
- Confirm it did not modify worker PTY transport, runtime-session live attach, or §27.3 control-plane routing.

**Step 2: Mark the roadmap item accordingly**

- If the machine terminal Playwright slice shipped, update the roadmap item and plan registry entry without changing the meaning of §27.3.
- For PR #346, mark section 29 and this plan as delivered while preserving the historical separation from §27.3 live managed-session attach work.

**Step 3: Run lightweight doc verification**

Run:

```bash
git diff --check
rg -n "machine terminal|terminal e2e|27.3|Last updated" docs/ROADMAP.md docs/plans/2026-03-21-machine-terminal-e2e-follow-up-plan.md
```

Expected: clean diff and matching roadmap/plan references.

**Step 4: Commit**

```bash
git add docs/ROADMAP.md docs/plans/2026-03-21-machine-terminal-e2e-follow-up-plan.md
git commit -m "docs: sync machine terminal e2e follow-up"
```
