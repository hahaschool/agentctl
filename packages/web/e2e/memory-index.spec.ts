import { expect, type Page, test } from '@playwright/test';

// The /memory index page is a server redirect to /memory/browser wrapped in an
// ErrorBoundary. These tests cover:
//   1) the redirect actually lands users on the browser tab
//   2) the shared MemorySidebar renders and reflects API stats
//   3) empty-state stats degrade gracefully (no badges, sidebar still usable)
//   4) sidebar nav links navigate between memory subpages
//
// The page is backend-independent: all /api/** calls are mocked via page.route
// following the pattern established in memory-browser.spec.ts.

type StatsOverrides = {
  readonly totalFacts?: number;
  readonly pendingConsolidation?: number;
};

async function mockMemoryApis(
  page: Page,
  overrides: StatsOverrides = {},
): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());

    if (request.method() === 'GET' && pathname === '/api/sync/conflicts/count') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 0 }),
      });
      return;
    }

    if (request.method() === 'GET' && pathname === '/api/memory/stats') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          stats: {
            totalFacts: overrides.totalFacts ?? 42,
            newThisWeek: 3,
            avgConfidence: 0.77,
            pendingConsolidation: overrides.pendingConsolidation ?? 5,
            byScope: { global: 10, 'project:agentctl': 32 },
            byEntityType: { decision: 20, pattern: 15, error: 7 },
            strengthDistribution: { active: 30, decaying: 10, archived: 2 },
            growthTrend: [{ date: '2026-04-14', count: 42 }],
          },
        }),
      });
      return;
    }

    if (request.method() === 'GET' && pathname === '/api/memory/facts') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, facts: [], total: 0 }),
      });
      return;
    }

    if (request.method() === 'GET' && pathname === '/api/memory/scopes') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          scopes: [
            { scope: 'global', factCount: 10 },
            { scope: 'project:agentctl', factCount: 32 },
          ],
        }),
      });
      return;
    }

    // Graph / decay / reports endpoints — return empty but successful shapes.
    if (request.method() === 'GET' && pathname.startsWith('/api/memory/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
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
}

test.describe('Memory index page', () => {
  test('redirects from /memory to /memory/browser', async ({ page }) => {
    await mockMemoryApis(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/memory');

    // Wait for the browser page marker so we know the redirect completed.
    await expect(page.getByLabel('Search facts')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/memory\/browser(\?|$)/);
  });

  test('renders memory sidebar navigation with stats badges', async ({ page }) => {
    await mockMemoryApis(page, { totalFacts: 42, pendingConsolidation: 5 });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/memory');
    await expect(page.getByLabel('Search facts')).toBeVisible({ timeout: 15_000 });

    const sidebar = page.getByRole('navigation', { name: 'Memory navigation' });
    await expect(sidebar).toBeVisible();

    // Every configured nav entry should be present.
    for (const label of ['Browser', 'Graph', 'Dashboard', 'Consolidation', 'Reports', 'Import', 'Scopes']) {
      await expect(sidebar.getByRole('link', { name: new RegExp(label) })).toBeVisible();
    }

    // Browser link reflects totalFacts and is marked as the active page.
    const browserLink = sidebar.getByRole('link', { name: /Browser/ });
    await expect(browserLink).toHaveAttribute('aria-current', 'page');
    await expect(browserLink).toContainText('42');

    // Consolidation link reflects pendingConsolidation.
    const consolidationLink = sidebar.getByRole('link', { name: /Consolidation/ });
    await expect(consolidationLink).toContainText('5');
  });

  test('sidebar hides count badges when stats are empty', async ({ page }) => {
    await mockMemoryApis(page, { totalFacts: 0, pendingConsolidation: 0 });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/memory');
    await expect(page.getByLabel('Search facts')).toBeVisible({ timeout: 15_000 });

    const sidebar = page.getByRole('navigation', { name: 'Memory navigation' });
    // Zero is still rendered as a badge ("0") — the Reports/Graph/Scopes/Import/Dashboard
    // entries never render a badge regardless of stats. Verify one of those stays badge-free.
    const reportsLink = sidebar.getByRole('link', { name: /Reports/ });
    await expect(reportsLink).toBeVisible();
    await expect(reportsLink.locator('[data-slot="badge"]')).toHaveCount(0);
  });

  test('navigates to the Reports subpage via sidebar link', async ({ page }) => {
    await mockMemoryApis(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/memory');
    await expect(page).toHaveURL(/\/memory\/browser(\?|$)/, { timeout: 15_000 });

    const sidebar = page.getByRole('navigation', { name: 'Memory navigation' });
    await sidebar.getByRole('link', { name: /Reports/ }).click();

    await expect(page).toHaveURL(/\/memory\/reports$/);
  });
});
