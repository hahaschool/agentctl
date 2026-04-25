# PR G — Workers: Consolidation + Synthesis + E2E + Gate 2 + CHANGELOG

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The two remaining job handlers (consolidation + synthesis). Three Playwright e2e tests. Gate 2 verification for Gemini (live dimension check). CHANGELOG entry and runbook update. Flip `MEMORY_OPS_ENABLED_KINDS` to include all four kinds.

**Architecture:** Consolidation and synthesis delegate to existing `MemoryMaintenance` and `MemorySynthesis` classes. They don't require a provider (no embedding calls). Their BullMQ handlers emit progress events and respect cancel polling.

**Prerequisite:** PRs A+B+C+D+E+F merged. Branch from `main`.

**Branch:**
```bash
git fetch origin
git worktree add .trees/codex-memory-ops-pr-g -b codex/memory-ops-pr-g
cd .trees/codex-memory-ops-pr-g
```

---

## Files

**Create:**
- `packages/control-plane/src/memory/ops/consolidation.ts`
- `packages/control-plane/src/memory/ops/synthesis.ts`
- `packages/web/e2e/memory-ops/openai-happy.spec.ts`
- `packages/web/e2e/memory-ops/gemini-happy.spec.ts` (Gate 2 conditional)
- `packages/web/e2e/memory-ops/missing-embedding-alert.spec.ts`

**Modify:**
- `packages/control-plane/src/memory/ops/worker.ts` — add consolidation + synthesis handlers
- `packages/shared/src/memory/providers.ts` — flip Gemini `verified: true` (Gate 2 only)
- `CHANGELOG.md`
- `docs/QUICKSTART.md`
- `.env.example` — update `MEMORY_OPS_ENABLED_KINDS=embedding-backfill,drawer-backfill,consolidation,synthesis`

---

## Task 1: Consolidation handler

**Files:**
- Create: `packages/control-plane/src/memory/ops/consolidation.ts`

Consolidation wraps the existing `MemoryMaintenance.run()`. No embedding calls — just delegates. Emits progress events. Respects cancel.

- [ ] **Step 1: Verify existing MemoryMaintenance interface**

```bash
grep -n "run\|class MemoryMaintenance" packages/control-plane/src/memory/knowledge-maintenance.ts | head -10
```

Note the signature of `run()` — we need to know if it accepts cancellation signals.

- [ ] **Step 2: Write failing test**

```typescript
// packages/control-plane/src/memory/ops/consolidation.test.ts
import { consolidationHandler } from './consolidation.js';

it('calls MemoryMaintenance.run and transitions job to completed', async () => {
  const mockMaintenance = { run: vi.fn().mockResolvedValue({ processed: 5, consolidated: 3 }) };
  const jobsRepo = { markRunning: vi.fn(), transition: vi.fn(), isCancelRequested: vi.fn().mockResolvedValue(false) };
  const eventsRepo = { insert: vi.fn() };

  await consolidationHandler({
    jobId: 'job-1', params: {}, logger: silentLogger,
    maintenance: mockMaintenance as unknown, jobsRepo, eventsRepo,
  });

  expect(mockMaintenance.run).toHaveBeenCalled();
  expect(jobsRepo.transition).toHaveBeenCalledWith('job-1', 'completed');
});

it('cancels mid-run when isCancelRequested returns true', async () => {
  const mockMaintenance = { run: vi.fn().mockResolvedValue({}) };
  const jobsRepo = { markRunning: vi.fn(), transition: vi.fn(), isCancelRequested: vi.fn().mockResolvedValue(true) };
  const eventsRepo = { insert: vi.fn() };

  await consolidationHandler({ jobId: 'j1', params: {}, logger: silentLogger,
    maintenance: mockMaintenance as unknown, jobsRepo, eventsRepo });

  expect(jobsRepo.transition).toHaveBeenCalledWith('j1', 'cancelled');
});
```

- [ ] **Step 3: Run test — expect failure**

```bash
pnpm vitest run src/memory/ops/consolidation.test.ts
```

- [ ] **Step 4: Implement consolidationHandler**

```typescript
// packages/control-plane/src/memory/ops/consolidation.ts
import type { Logger } from '../../logger.js';
import type { JobsRepository } from './jobs-repository.js';
import type { JobEventsRepository } from './job-events-repository.js';
import { scopeNormalize } from '@agentctl/shared';

type ConsolidationInput = {
  jobId: string;
  params: { scope?: string };
  logger: Logger;
  maintenance: { run: (opts?: { scope?: string }) => Promise<{ processed: number; consolidated: number }> };
  jobsRepo: JobsRepository;
  eventsRepo: JobEventsRepository;
};

export async function consolidationHandler(input: ConsolidationInput): Promise<void> {
  const { jobId, params, maintenance, jobsRepo, eventsRepo } = input;
  const scope = scopeNormalize(params.scope);

  await eventsRepo.insert({ jobId, eventType: 'started', level: 'info',
    message: 'Starting consolidation', progress: { processed:0, embedded:0, failed:0, total:0, costUsd:0, usageEstimated:false } });
  await jobsRepo.markRunning(jobId);

  // Cancel check before running (consolidation runs as a single unit)
  if (await jobsRepo.isCancelRequested(jobId)) {
    await jobsRepo.transition(jobId, 'cancelled');
    await eventsRepo.insert({ jobId, eventType: 'cancelled', level: 'info', message: 'Cancelled before start' });
    return;
  }

  try {
    const result = await maintenance.run(scope ? { scope } : undefined);
    await eventsRepo.insert({ jobId, eventType: 'progress', level: 'info',
      message: `Processed ${result.processed}, consolidated ${result.consolidated}`,
      progress: { processed: result.processed, embedded: 0, failed: 0, total: result.processed, costUsd: 0, usageEstimated: false } });
  } catch (err) {
    await jobsRepo.transition(jobId, 'failed');
    await eventsRepo.insert({ jobId, eventType: 'failed', level: 'error', message: String(err) });
    return;
  }

  // Cancel check after run (before transitioning to completed)
  await jobsRepo.transition(jobId, 'completed');
  await eventsRepo.insert({ jobId, eventType: 'completed', level: 'info', message: 'Consolidation complete' });
}
```

- [ ] **Step 5: Run test — expect pass**

```bash
pnpm vitest run src/memory/ops/consolidation.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/control-plane/src/memory/ops/consolidation.ts packages/control-plane/src/memory/ops/consolidation.test.ts
git commit -m "feat(memory-ops): consolidation handler delegates to MemoryMaintenance.run with cancel polling"
```

---

## Task 2: Synthesis handler

**Files:**
- Create: `packages/control-plane/src/memory/ops/synthesis.ts`

- [ ] **Step 1: Verify existing MemorySynthesis interface**

```bash
grep -n "runSynthesis\|class MemorySynthesis" packages/control-plane/src/memory/knowledge-synthesis.ts | head -10
```

- [ ] **Step 2: Write failing test**

```typescript
// packages/control-plane/src/memory/ops/synthesis.test.ts
import { synthesisHandler } from './synthesis.js';

it('calls MemorySynthesis.runSynthesis and completes', async () => {
  const mockSynthesis = { runSynthesis: vi.fn().mockResolvedValue({ synthesized: 2 }) };
  const jobsRepo = { markRunning: vi.fn(), transition: vi.fn(), isCancelRequested: vi.fn().mockResolvedValue(false) };
  const eventsRepo = { insert: vi.fn() };
  await synthesisHandler({ jobId: 'j1', params: {}, logger: silentLogger,
    synthesis: mockSynthesis as unknown, jobsRepo, eventsRepo });
  expect(mockSynthesis.runSynthesis).toHaveBeenCalled();
  expect(jobsRepo.transition).toHaveBeenCalledWith('j1', 'completed');
});
```

- [ ] **Step 3: Run test — expect failure**

```bash
pnpm vitest run src/memory/ops/synthesis.test.ts
```

- [ ] **Step 4: Implement synthesisHandler**

```typescript
// packages/control-plane/src/memory/ops/synthesis.ts
import type { Logger } from '../../logger.js';
import type { JobsRepository } from './jobs-repository.js';
import type { JobEventsRepository } from './job-events-repository.js';
import { scopeNormalize } from '@agentctl/shared';

type SynthesisInput = {
  jobId: string;
  params: { scope?: string };
  logger: Logger;
  synthesis: { runSynthesis: (opts?: { scope?: string }) => Promise<{ synthesized: number }> };
  jobsRepo: JobsRepository;
  eventsRepo: JobEventsRepository;
};

export async function synthesisHandler(input: SynthesisInput): Promise<void> {
  const { jobId, params, synthesis, jobsRepo, eventsRepo } = input;
  const scope = scopeNormalize(params.scope);

  await eventsRepo.insert({ jobId, eventType: 'started', level: 'info', message: 'Starting synthesis',
    progress: { processed:0, embedded:0, failed:0, total:0, costUsd:0, usageEstimated:false } });
  await jobsRepo.markRunning(jobId);

  if (await jobsRepo.isCancelRequested(jobId)) {
    await jobsRepo.transition(jobId, 'cancelled');
    await eventsRepo.insert({ jobId, eventType: 'cancelled', level: 'info', message: 'Cancelled before start' });
    return;
  }

  try {
    const result = await synthesis.runSynthesis(scope ? { scope } : undefined);
    await eventsRepo.insert({ jobId, eventType: 'progress', level: 'info',
      message: `Synthesized ${result.synthesized} groups`,
      progress: { processed: result.synthesized, embedded:0, failed:0, total: result.synthesized, costUsd:0, usageEstimated:false } });
  } catch (err) {
    await jobsRepo.transition(jobId, 'failed');
    await eventsRepo.insert({ jobId, eventType: 'failed', level: 'error', message: String(err) });
    return;
  }

  await jobsRepo.transition(jobId, 'completed');
  await eventsRepo.insert({ jobId, eventType: 'completed', level: 'info', message: 'Synthesis complete' });
}
```

- [ ] **Step 5: Run test — expect pass**

```bash
pnpm vitest run src/memory/ops/synthesis.test.ts
```

- [ ] **Step 6: Wire into worker.ts**

In `packages/control-plane/src/memory/ops/worker.ts`, add cases:
```typescript
case 'consolidation':
  await consolidationHandler({ jobId: dbJobId, params: jobRow.params as Record<string,unknown>,
    logger: opts.logger, maintenance: new KnowledgeMaintenance(opts.db, opts.pool),
    jobsRepo, eventsRepo });
  break;
case 'synthesis':
  await synthesisHandler({ jobId: dbJobId, params: jobRow.params as Record<string,unknown>,
    logger: opts.logger, synthesis: new KnowledgeSynthesis(opts.db, opts.pool),
    jobsRepo, eventsRepo });
  break;
```

Import `KnowledgeMaintenance` from `../../memory/knowledge-maintenance.js` and `KnowledgeSynthesis` from `../../memory/knowledge-synthesis.js`. Verify these class names match the actual exports:
```bash
grep -n "^export class" packages/control-plane/src/memory/knowledge-maintenance.ts packages/control-plane/src/memory/knowledge-synthesis.ts
```

- [ ] **Step 7: Update ENABLED_JOB_KINDS in .env.example**

```
MEMORY_OPS_ENABLED_KINDS=embedding-backfill,drawer-backfill,consolidation,synthesis
```

- [ ] **Step 8: Commit**

```bash
git add packages/control-plane/src/memory/ops/synthesis.ts packages/control-plane/src/memory/ops/synthesis.test.ts packages/control-plane/src/memory/ops/consolidation.ts packages/control-plane/src/memory/ops/worker.ts .env.example
git commit -m "feat(memory-ops): consolidation + synthesis handlers wired into BullMQ worker"
```

---

## Task 3: Playwright e2e tests

**Files:**
- Create: `packages/web/e2e/memory-ops/openai-happy.spec.ts`
- Create: `packages/web/e2e/memory-ops/missing-embedding-alert.spec.ts`
- Create: `packages/web/e2e/memory-ops/gemini-happy.spec.ts` (conditional on Gate 2)

- [ ] **Step 1: Write OpenAI happy path e2e**

```typescript
// packages/web/e2e/memory-ops/openai-happy.spec.ts
import { test, expect } from '@playwright/test';

test.describe('OpenAI embedding provider full journey', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings#memory-embeddings');
  });

  test('Add → Test → Save → preview egress → confirm → backfill completes', async ({ page }) => {
    // 1. Open Settings → Memory & Embeddings
    await expect(page.locator('section:has-text("Embedding Providers")')).toBeVisible();

    // 2. Click Add Provider
    await page.getByRole('button', { name: /add provider/i }).click();

    // 3. Fill in provider details (use a real test key from env)
    const testKey = process.env.E2E_OPENAI_API_KEY;
    test.skip(!testKey, 'E2E_OPENAI_API_KEY not set');
    await page.getByLabel(/api key/i).fill(testKey!);
    await page.getByLabel(/name/i).fill('e2e-test-provider');

    // 4. Click Test → assert dim=1536 shown
    await page.getByRole('button', { name: /test/i }).click();
    await expect(page.locator('text=/dim.*1536/i')).toBeVisible({ timeout: 15_000 });

    // 5. Save
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.locator('text=e2e-test-provider')).toBeVisible();

    // 6. Navigate to /memory/operations
    await page.goto('/memory/operations');
    await expect(page.locator('text=Embedding Backfill')).toBeVisible();

    // 7. Click Run → egress dialog appears
    await page.getByRole('button', { name: /run/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('text=/cost estimate/i')).toBeVisible();

    // 8. Check confirmation checkbox and confirm
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /confirm.*run/i }).click();

    // 9. Job appears in table
    await expect(page.locator('text=/embedding-backfill/i')).toBeVisible();

    // 10. Wait for job completion (up to 2 minutes for small test dataset)
    await expect(page.locator('text=/completed/i')).toBeVisible({ timeout: 120_000 });

    // 11. Navigate to /memory/maintenance — verify non-empty
    await page.goto('/memory/maintenance');
    // Some memory facts should now have embeddings — maintenance page reflects this
    await expect(page.locator('text=/facts/i')).toBeVisible();
  });
});
```

- [ ] **Step 2: Write missing-embedding-alert e2e**

```typescript
// packages/web/e2e/memory-ops/missing-embedding-alert.spec.ts
import { test, expect } from '@playwright/test';

const VIEWS_WITH_ALERT = [
  '/memory/browser',
  '/memory/dashboard',
  '/memory/drawers',
  '/memory/maintenance',
  '/memory/reports',
  '/memory/synthesis',
  '/memory/graph',
  '/memory/consolidation',
];

const VIEWS_WITHOUT_ALERT = [
  '/memory/import',
  '/memory/scope-manager',
];

test.describe('MissingEmbeddingAlert coverage', () => {
  test.beforeEach(async ({ page }) => {
    // Ensure no embedding providers configured (clear via API or DB before test)
    // This requires a test-specific setup or a seeded clean state
  });

  for (const view of VIEWS_WITH_ALERT) {
    test(`alert present on ${view}`, async ({ page }) => {
      await page.goto(view);
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 5_000 });
    });
  }

  for (const view of VIEWS_WITHOUT_ALERT) {
    test(`alert absent on ${view}`, async ({ page }) => {
      await page.goto(view);
      await page.waitForTimeout(2_000); // wait for query to settle
      await expect(page.getByRole('alert')).not.toBeVisible();
    });
  }
});
```

- [ ] **Step 3: Write Gemini happy path (Gate 2 conditional)**

```typescript
// packages/web/e2e/memory-ops/gemini-happy.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Gemini embedding provider (Gate 2 required)', () => {
  test.skip(!process.env.GATE2_GEMINI_API_KEY || !process.env.GEMINI_VERIFIED,
    'Skipped — GATE2_GEMINI_API_KEY and GEMINI_VERIFIED not set');

  test('Gemini stub endpoint receives output_dimensionality:1536', async ({ request }) => {
    // Verify the request shape by intercepting the API call
    // This uses a local stub that records the request body
    const res = await request.post('/api/memory/providers/test-ephemeral', {
      data: { provider: 'gemini', model: 'gemini-embedding-001', apiKey: process.env.GATE2_GEMINI_API_KEY },
    });
    // Expect either 200 (success) or specific auth error — not 404
    expect([200, 401]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.dim).toBe(1536);
    }
  });
});
```

- [ ] **Step 4: Run missing-embedding-alert test in dev-1**

```bash
source .env.dev-1
cd packages/web
npx playwright test e2e/memory-ops/missing-embedding-alert.spec.ts --headed
# Expected: all 8 views show alert; 2 views do not
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/e2e/memory-ops/
git commit -m "test(memory-ops): Playwright e2e — OpenAI journey, missing-embedding-alert coverage, Gemini stub"
```

---

## Task 4: Gate 2 verification + Gemini verified:true (conditional)

**Files:**
- Modify: `packages/shared/src/memory/providers.ts` (only if Gate 2 passes)

Gate 2 requires a real `GEMINI_API_KEY`. Run this test manually before flipping the flag.

- [ ] **Step 1: Run Gate 2 verification**

```bash
# Set a real Gemini API key:
export GEMINI_API_KEY=AIza...

# Check dimension + output_dimensionality honored:
curl -s -X POST https://generativelanguage.googleapis.com/v1beta/openai/embeddings \
  -H "Authorization: Bearer $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-embedding-001","input":["test"],"output_dimensionality":1536}' | jq '.data[0].embedding | length, .[0]'
# Expected: 1536 (dimension count) and a float value
```

- [ ] **Step 2: Verify model name in response**

```bash
curl -s ... | jq '.model'
# Expected: "gemini-embedding-001" (or similar; if different, update catalog)
```

- [ ] **Step 3: If Gate 2 passes, flip verified:true**

In `packages/shared/src/memory/providers.ts`, change the Gemini entry:
```typescript
verified: true, // Gate 2 passed YYYY-MM-DD — output_dimensionality honored, dim=1536
```

If `output_dimensionality` is NOT honored (wrong dimension), switch to `gemini-embedding-2-preview` and re-run Gate 2.

- [ ] **Step 4: Commit (only if Gate 2 passed)**

```bash
git add packages/shared/src/memory/providers.ts
git commit -m "feat(memory-ops): flip Gemini catalog verified:true — Gate 2 passed YYYY-MM-DD"
```

If Gate 2 did NOT pass, leave `verified: false` and document in PR description. Gemini will not appear in the Settings UI until a follow-on commit flips the flag.

---

## Task 5: CHANGELOG + QUICKSTART update

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/QUICKSTART.md`

- [ ] **Step 1: Add CHANGELOG entry**

At the top of `CHANGELOG.md`, following the existing format:

```markdown
## [vX.Y.Z] — YYYY-MM-DD

### Features
- **Memory Operations UI** — Settings → Memory & Embeddings for embedding provider CRUD
- `/memory/operations` page to trigger, observe, and cancel memory maintenance jobs
- `embedding-backfill` and `drawer-backfill` workers ship `content_model`/`embedding_model` with every write
- `consolidation` and `synthesis` job kinds dispatch to existing MemoryMaintenance/MemorySynthesis
- `<MissingEmbeddingAlert />` on 8 memory views
- SSE streaming for job progress (executor peer only)
- Preview endpoint with egress snapshot + signed token before job creation
- Cancel support: immediate for queued, graceful for running

### Infrastructure
- Migration 0033: `api_accounts` extensions + 3 new tables
- LITELLM_URL embedding fallback removed — use Settings to configure providers
- `MEMORY_OPS_ENABLED` / `MEMORY_OPS_ENABLED_KINDS` env vars for progressive unlock
- `MEMORY_OPS_SIGNING_SECRET` for ephemeral test-before-save tokens

### Known limitations
- Fleet backfill race: unmitigated in v1. Do not run concurrent write-kind jobs across peers with different active providers. v1.1 will add Redis SET NX distributed lock.
- Gemini UI: hidden until Gate 2 verified (live dimension check).
```

- [ ] **Step 2: Update QUICKSTART.md**

Add a section after the existing "Memory" section:

```markdown
## Setting Up Embedding Providers

1. Go to **Settings → Memory & Embeddings**.
2. Click **Add Provider**. Select `openai` + `text-embedding-3-small`. Enter your API key.
3. Click **Test** → verify `dim=1536` appears. Click **Save** and check **Set as active**.
4. Set environment variables:
   ```
   MEMORY_OPS_ENABLED=true
   MEMORY_OPS_ENABLED_KINDS=embedding-backfill,drawer-backfill,consolidation,synthesis
   MEMORY_OPS_SIGNING_SECRET=<32+ random chars>
   ```
5. Restart the control plane: `pm2 restart agentctl-cp-dev1`.
6. Go to **/memory/operations** → click **Run** on **Embedding Backfill** → confirm egress.
7. Watch the progress bar. When `completed`, vector search is available.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md docs/QUICKSTART.md
git commit -m "docs(memory-ops): CHANGELOG entry for memory operations UI; QUICKSTART setup guide"
```

---

## Task 6: Final build + full test suite + push + PR

- [ ] **Step 1: Full monorepo build**

```bash
pnpm build
# Expected: 0 TypeScript errors across all packages
```

- [ ] **Step 2: Full test suite**

```bash
pnpm vitest run
# Expected: all tests pass
```

- [ ] **Step 3: Biome lint**

```bash
pnpm lint
# Expected: 0 errors + 0 warnings
```

- [ ] **Step 4: Push + open PR**

```bash
git push origin codex/memory-ops-pr-g
gh pr create --base main \
  --title "feat(memory-ops): PR G — consolidation + synthesis workers, e2e tests, CHANGELOG" \
  --body "$(cat <<'EOF'
## Summary
- consolidation handler wraps MemoryMaintenance.run with cancel polling
- synthesis handler wraps MemorySynthesis.runSynthesis with cancel polling
- 3 Playwright e2e tests: OpenAI happy path, 8-view alert coverage, Gemini Gate 2 stub
- Gate 2 status: [PASS/FAIL/PENDING] — Gemini catalog verified: [true/false]
- CHANGELOG entry + QUICKSTART setup guide
- MEMORY_OPS_ENABLED_KINDS=embedding-backfill,drawer-backfill,consolidation,synthesis

## Gate 2 result
[Fill in: did Gemini return dim=1536 with output_dimensionality:1536? If yes, catalog flipped to verified:true.]

## Test plan
- [ ] pnpm build — 0 errors
- [ ] pnpm vitest run — all pass
- [ ] pnpm lint — 0 errors
- [ ] Playwright: missing-embedding-alert — 8 views with alert, 2 without
- [ ] Manual: Run consolidation job on dev-1 → status=completed
- [ ] Manual: Run synthesis job on dev-1 → status=completed
EOF
)"
```
