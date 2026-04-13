import { expect, type Page, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Mocked Memory API responses for the dashboard page
// ---------------------------------------------------------------------------

const STATS_BEFORE = {
  ok: true,
  stats: {
    strengthDistribution: { low: 18, mediumLow: 30, mediumHigh: 50, high: 110 },
    pinnedCount: 7,
    archivedCount: 124,
  },
};

const STATS_AFTER = {
  ok: true,
  stats: {
    strengthDistribution: { low: 0, mediumLow: 30, mediumHigh: 50, high: 110 },
    pinnedCount: 7,
    archivedCount: 142,
  },
};

const RUN_RESULT = {
  ok: true,
  result: { decayed: 33, archived: 18, skipped: 12 },
};

// Generic fallback for the other queries the dashboard issues.
const EMPTY_MEMORY_STATS = {
  ok: true,
  stats: {
    totalFacts: 200,
    newThisWeek: 4,
    avgConfidence: 0.81,
    pendingConsolidation: 0,
    byScope: { 'project:agentctl': 200 },
    byEntityType: { decision: 100, pattern: 100 },
    strengthDistribution: { active: 100, decaying: 60, archived: 40 },
    growthTrend: [
      { date: '2026-04-01', count: 5 },
      { date: '2026-04-02', count: 3 },
    ],
  },
};

const EMPTY_FACTS = { ok: true, facts: [], total: 0 };

async function mockMemoryApis(page: Page): Promise<{
  runCalls: number;
  setStatsAfter: () => void;
}> {
  let statsResponse = STATS_BEFORE;
  let runCalls = 0;

  await page.route('**/api/memory/decay/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(statsResponse),
    });
  });

  await page.route('**/api/memory/decay/run', async (route) => {
    runCalls += 1;
    statsResponse = STATS_AFTER;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(RUN_RESULT),
    });
  });

  // Other dashboard requests must not 404; serve plausible empty payloads.
  await page.route('**/api/memory/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(EMPTY_MEMORY_STATS),
    });
  });

  await page.route('**/api/memory/facts**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(EMPTY_FACTS),
    });
  });

  return {
    get runCalls() {
      return runCalls;
    },
    setStatsAfter: () => {
      statsResponse = STATS_AFTER;
    },
  } as unknown as { runCalls: number; setStatsAfter: () => void };
}

test.describe('Memory decay UI', () => {
  test('triggers decay run, shows toast, and refreshes stats', async ({ page }) => {
    const state = await mockMemoryApis(page);

    await page.goto('/memory/dashboard');

    // Card renders eligible / pinned / archived rows from the stats endpoint.
    await expect(page.getByTestId('memory-decay-card')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('memory-decay-eligible')).toHaveText('18');
    await expect(page.getByTestId('memory-decay-pinned')).toHaveText('7');
    await expect(page.getByTestId('memory-decay-archived')).toHaveText('124');

    // Open the confirmation dialog.
    await page.getByTestId('memory-decay-trigger-button').click();
    await expect(page.getByTestId('memory-decay-confirm-dialog')).toBeVisible();
    await expect(
      page.getByText(/archive stale memories older than the configured threshold/i),
    ).toBeVisible();

    // Confirm — should fire POST /run and surface a success toast.
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/memory/decay/run') &&
          response.request().method() === 'POST',
      ),
      page.getByTestId('memory-decay-confirm-button').click(),
    ]);

    await expect(page.getByText(/Decay complete/i)).toBeVisible({ timeout: 10_000 });

    // Stats card should refresh to the post-run snapshot (eligible drops to 0,
    // archived count goes up).
    await expect(page.getByTestId('memory-decay-eligible')).toHaveText('0', { timeout: 10_000 });
    await expect(page.getByTestId('memory-decay-archived')).toHaveText('142');

    // The "last run" line should show the result the API returned.
    await expect(page.getByTestId('memory-decay-last-result')).toContainText('decayed 33');
    await expect(page.getByTestId('memory-decay-last-result')).toContainText('archived 18');

    expect(state.runCalls).toBe(1);
  });
});
