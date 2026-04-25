import type {
  ConsolidationItem,
  ConsolidationStatus,
  MemoryFact,
} from '@agentctl/shared';
import { expect, type Page, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = '2026-04-14T08:00:00.000Z';

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  const source = {
    session_id: 'session-1',
    agent_id: 'agent-1',
    machine_id: 'machine-1',
    turn_index: 1,
    extraction_method: 'manual' as const,
  };
  return {
    id: 'fact-1',
    scope: 'project:agentctl',
    content: 'BullMQ is preferred for MVP scheduling',
    content_model: 'text-embedding-3-small',
    entity_type: 'decision',
    confidence: 0.9,
    strength: 0.8,
    source,
    valid_from: NOW,
    valid_until: null,
    created_at: NOW,
    accessed_at: NOW,
    ...overrides,
    source: overrides.source ?? source,
  };
}

const INITIAL_FACTS: readonly MemoryFact[] = [
  makeFact({
    id: 'fact-contradiction-a',
    content: 'Postgres is the primary datastore for control plane',
  }),
  makeFact({
    id: 'fact-contradiction-b',
    content: 'SQLite is the primary datastore for control plane',
  }),
  makeFact({
    id: 'fact-dup-a',
    content: 'Agent worker polls filesystem IPC at 1000ms intervals',
    entity_type: 'pattern',
  }),
  makeFact({
    id: 'fact-dup-b',
    content: 'NanoClaw agent polls filesystem every 1s for IPC messages',
    entity_type: 'pattern',
  }),
  makeFact({
    id: 'fact-stale',
    content: 'Use Mem0 as the primary memory backend',
    entity_type: 'decision',
    confidence: 0.35,
    strength: 0.2,
  }),
];

function makeItem(overrides: Partial<ConsolidationItem> = {}): ConsolidationItem {
  return {
    id: 'item-default',
    type: 'contradiction',
    severity: 'high',
    factIds: ['fact-contradiction-a', 'fact-contradiction-b'],
    reason: 'Facts disagree about the primary control-plane datastore.',
    suggestion: 'Keep the Postgres statement; delete the SQLite fact.',
    status: 'pending',
    createdAt: NOW,
    ...overrides,
  };
}

const INITIAL_ITEMS: readonly ConsolidationItem[] = [
  makeItem({
    id: 'item-contradiction-1',
    type: 'contradiction',
    severity: 'high',
    factIds: ['fact-contradiction-a', 'fact-contradiction-b'],
    reason: 'Facts disagree about the primary control-plane datastore.',
    suggestion: 'Keep the Postgres statement; delete the SQLite fact.',
  }),
  makeItem({
    id: 'item-duplicate-1',
    type: 'near-duplicate',
    severity: 'medium',
    factIds: ['fact-dup-a', 'fact-dup-b'],
    reason: 'Two facts describe the same NanoClaw IPC polling behaviour.',
    suggestion: 'Merge into a single pattern entry.',
  }),
  makeItem({
    id: 'item-stale-1',
    type: 'stale',
    severity: 'low',
    factIds: ['fact-stale'],
    reason: 'Mem0 decision has very low confidence and is likely outdated.',
    suggestion: 'Archive this stale decision.',
  }),
];

// ---------------------------------------------------------------------------
// API mocks
// ---------------------------------------------------------------------------

type ResolveRequest = {
  readonly id: string;
  readonly action: string;
  readonly status: ConsolidationStatus;
};

type MockState = {
  readonly resolveRequests: ResolveRequest[];
  readonly listCallCount: () => number;
};

async function mockConsolidationApis(page: Page): Promise<MockState> {
  // Mutable, per-test state (isolated per page route registration)
  const itemsById = new Map<string, ConsolidationItem>(
    INITIAL_ITEMS.map((item) => [item.id, item]),
  );
  const resolveRequests: ResolveRequest[] = [];
  let listCalls = 0;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname, searchParams } = url;

    if (request.method() === 'GET' && pathname === '/api/sync/conflicts/count') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 0 }),
      });
      return;
    }

    // Consolidation list
    if (request.method() === 'GET' && pathname === '/api/memory/consolidation') {
      listCalls += 1;
      const status = searchParams.get('status');
      const type = searchParams.get('type');
      let items = Array.from(itemsById.values());
      if (status) {
        items = items.filter((i) => i.status === status);
      }
      if (type) {
        items = items.filter((i) => i.type === type);
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, items, total: items.length }),
      });
      return;
    }

    // Consolidation action
    const actionMatch = pathname.match(/^\/api\/memory\/consolidation\/([^/]+)\/action$/);
    if (request.method() === 'POST' && actionMatch) {
      const id = decodeURIComponent(actionMatch[1]);
      const body = request.postDataJSON() as { action: string; status: ConsolidationStatus };
      resolveRequests.push({ id, action: body.action, status: body.status });
      const current = itemsById.get(id);
      if (current) {
        itemsById.set(id, { ...current, status: body.status });
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    // Facts list (used to resolve factIds referenced by consolidation items)
    if (request.method() === 'GET' && pathname === '/api/memory/facts') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          facts: INITIAL_FACTS,
          total: INITIAL_FACTS.length,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        error: 'UNEXPECTED_E2E_REQUEST',
        message: `${request.method()} ${pathname}`,
      }),
    });
  });

  return {
    resolveRequests,
    listCallCount: () => listCalls,
  };
}

async function openConsolidation(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/memory/consolidation');
  // Refresh is always present after the view mounts (even for empty queues)
  await expect(
    page.getByRole('button', { name: 'Refresh consolidation queue' }),
  ).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Memory consolidation board', () => {
  test('renders pending items with reasons, suggestions, and linked facts', async ({ page }) => {
    await mockConsolidationApis(page);
    await openConsolidation(page);

    await expect(
      page.getByText('Facts disagree about the primary control-plane datastore.'),
    ).toBeVisible();
    await expect(
      page.getByText('Two facts describe the same NanoClaw IPC polling behaviour.'),
    ).toBeVisible();
    await expect(
      page.getByText('Mem0 decision has very low confidence and is likely outdated.'),
    ).toBeVisible();

    // Suggestions render inside each card
    await expect(
      page.getByText('Keep the Postgres statement; delete the SQLite fact.'),
    ).toBeVisible();

    // Fact snippets render content from /api/memory/facts
    await expect(
      page.getByText('Postgres is the primary datastore for control plane'),
    ).toBeVisible();
    await expect(
      page.getByText('SQLite is the primary datastore for control plane'),
    ).toBeVisible();

    // Summary counters: 3 pending total, 1 high severity
    await expect(
      page.getByText(/^\s*3\s+pending\s*$/).first(),
    ).toBeVisible();
    await expect(page.getByText(/^\s*1\s+high\s*$/).first()).toBeVisible();
  });

  test('orders cards by severity (high before medium before low)', async ({ page }) => {
    await mockConsolidationApis(page);
    await openConsolidation(page);

    const reasons = [
      'Facts disagree about the primary control-plane datastore.',
      'Two facts describe the same NanoClaw IPC polling behaviour.',
      'Mem0 decision has very low confidence and is likely outdated.',
    ];

    // Wait until all three reasons are rendered
    for (const r of reasons) {
      await expect(page.getByText(r)).toBeVisible();
    }

    const positions = await Promise.all(
      reasons.map(async (r) => {
        const box = await page.getByText(r).boundingBox();
        expect(box, `bounding box for "${r}"`).not.toBeNull();
        return box?.y ?? 0;
      }),
    );

    // high (idx 0) should be above medium (idx 1), which should be above low (idx 2)
    expect(positions[0]).toBeLessThan(positions[1]);
    expect(positions[1]).toBeLessThan(positions[2]);
  });

  test('filters items by category tab', async ({ page }) => {
    await mockConsolidationApis(page);
    await openConsolidation(page);

    // All three items visible on "All"
    await expect(
      page.getByText('Facts disagree about the primary control-plane datastore.'),
    ).toBeVisible();
    await expect(
      page.getByText('Two facts describe the same NanoClaw IPC polling behaviour.'),
    ).toBeVisible();

    // Switch to Near-Duplicates — only the duplicate card should remain
    await page.getByRole('button', { name: /^Near-Duplicates/ }).click();
    await expect(
      page.getByText('Two facts describe the same NanoClaw IPC polling behaviour.'),
    ).toBeVisible();
    await expect(
      page.getByText('Facts disagree about the primary control-plane datastore.'),
    ).toBeHidden();
    await expect(
      page.getByText('Mem0 decision has very low confidence and is likely outdated.'),
    ).toBeHidden();

    // Orphan Nodes tab has no items — empty state appears
    await page.getByRole('button', { name: /^Orphan Nodes/ }).click();
    await expect(page.getByText('Queue is clear')).toBeVisible();
  });

  test('contradiction resolve opens side-by-side dialog and posts accept on Keep A', async ({
    page,
  }) => {
    const state = await mockConsolidationApis(page);
    await openConsolidation(page);

    const contradictionCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: 'Facts disagree about the primary control-plane datastore.' });

    // Clicking "Resolve…" should open the side-by-side preview dialog
    await contradictionCard.getByRole('button', { name: 'Accept suggestion' }).click();

    // Both conflicting facts should appear in the dialog
    await expect(page.getByTestId('side-by-side-facts')).toBeVisible();
    await expect(page.getByText('Fact A')).toBeVisible();
    await expect(page.getByText('Fact B')).toBeVisible();

    // Select Fact A and confirm
    await page.getByText('Fact A').click();
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/memory/consolidation/item-contradiction-1/action') &&
          response.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Keep Fact A' }).click(),
    ]);

    expect(state.resolveRequests[0]).toMatchObject({
      id: 'item-contradiction-1',
      action: 'accept',
      status: 'accepted',
    });
  });

  test('near-duplicate merge flow opens dialog, shows merge preview, and confirms', async ({
    page,
  }) => {
    const state = await mockConsolidationApis(page);
    await openConsolidation(page);

    const dupCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: 'Two facts describe the same NanoClaw IPC polling behaviour.' });

    // Clicking "Merge…" should open the preview dialog
    await dupCard.getByRole('button', { name: 'Accept suggestion' }).click();

    await expect(page.getByTestId('side-by-side-facts')).toBeVisible();

    // Confirm merge button should be disabled until a fact is selected
    await expect(page.getByRole('button', { name: 'Confirm merge' })).toBeDisabled();

    // Select Fact B
    await page.getByText('Fact B').click();

    // Confirm merge should be enabled after selection
    await expect(page.getByRole('button', { name: 'Confirm merge' })).toBeEnabled();

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/memory/consolidation/item-duplicate-1/action') &&
          response.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Confirm merge' }).click(),
    ]);

    expect(state.resolveRequests[0]).toMatchObject({
      id: 'item-duplicate-1',
      action: 'accept',
      status: 'accepted',
    });
  });

  test('contradiction "Keep both" maps to skip action', async ({ page }) => {
    const state = await mockConsolidationApis(page);
    await openConsolidation(page);

    const contradictionCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: 'Facts disagree about the primary control-plane datastore.' });

    await contradictionCard.getByRole('button', { name: 'Accept suggestion' }).click();
    await expect(page.getByTestId('side-by-side-facts')).toBeVisible();

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/memory/consolidation/item-contradiction-1/action') &&
          response.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Keep both facts' }).click(),
    ]);

    expect(state.resolveRequests[0]).toMatchObject({
      id: 'item-contradiction-1',
      action: 'skip',
      status: 'skipped',
    });
  });

  test('cancelling the merge dialog leaves the card in place', async ({ page }) => {
    await mockConsolidationApis(page);
    await openConsolidation(page);

    const contradictionCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: 'Facts disagree about the primary control-plane datastore.' });

    await contradictionCard.getByRole('button', { name: 'Accept suggestion' }).click();
    await expect(page.getByTestId('side-by-side-facts')).toBeVisible();

    // Cancel the dialog
    await page.getByRole('button', { name: 'Cancel contradiction resolution' }).click();

    // Dialog should close and the card should still be visible
    await expect(page.getByTestId('side-by-side-facts')).not.toBeVisible();
    await expect(
      page.getByText('Facts disagree about the primary control-plane datastore.'),
    ).toBeVisible();
  });

  test('accept on stale item (single fact) skips dialog and posts directly', async ({ page }) => {
    const state = await mockConsolidationApis(page);
    await openConsolidation(page);

    const staleCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: 'Mem0 decision has very low confidence and is likely outdated.' });

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/memory/consolidation/item-stale-1/action') &&
          response.request().method() === 'POST',
      ),
      staleCard.getByRole('button', { name: 'Accept suggestion' }).click(),
    ]);

    // No dialog should have appeared
    expect(page.getByTestId('side-by-side-facts')).not.toBeVisible();
    expect(state.resolveRequests).toEqual([
      { id: 'item-stale-1', action: 'accept', status: 'accepted' },
    ]);
  });

  test('skip and delete actions send the correct status mapping', async ({ page }) => {
    const state = await mockConsolidationApis(page);
    await openConsolidation(page);

    const duplicateCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: 'Two facts describe the same NanoClaw IPC polling behaviour.' });

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/memory/consolidation/item-duplicate-1/action') &&
          response.request().method() === 'POST',
      ),
      duplicateCard.getByRole('button', { name: 'Skip' }).click(),
    ]);

    const staleCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: 'Mem0 decision has very low confidence and is likely outdated.' });

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/memory/consolidation/item-stale-1/action') &&
          response.request().method() === 'POST',
      ),
      staleCard.getByRole('button', { name: 'Delete' }).click(),
    ]);

    // Both "skip" and "delete" map to status "skipped" per the view mutation
    expect(state.resolveRequests).toEqual([
      { id: 'item-duplicate-1', action: 'skip', status: 'skipped' },
      { id: 'item-stale-1', action: 'delete', status: 'skipped' },
    ]);
  });

  test('refreshes the queue when the refresh button is clicked', async ({ page }) => {
    const state = await mockConsolidationApis(page);
    await openConsolidation(page);

    // Wait for any lingering background fetches (e.g. facts) so the base count is stable
    await expect(
      page.getByText('Facts disagree about the primary control-plane datastore.'),
    ).toBeVisible();
    const before = state.listCallCount();

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/memory/consolidation') &&
          response.request().method() === 'GET',
      ),
      page.getByRole('button', { name: 'Refresh consolidation queue' }).click(),
    ]);

    expect(state.listCallCount()).toBeGreaterThan(before);
  });
});
