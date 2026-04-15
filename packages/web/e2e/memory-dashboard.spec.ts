import type { MemoryFact } from '@agentctl/shared';
import { expect, type Page, test } from '@playwright/test';

const NOW = '2026-04-14T08:00:00.000Z';

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  const source = {
    session_id: 'session-dashboard',
    agent_id: 'agent-dashboard',
    machine_id: 'machine-dashboard',
    turn_index: 2,
    extraction_method: 'manual' as const,
  };

  return {
    id: 'fact-dashboard-1',
    scope: 'project:agentctl',
    content: 'Memory dashboard smoke keeps the route shell wired to live cards',
    content_model: 'text-embedding-3-small',
    entity_type: 'decision',
    confidence: 0.91,
    strength: 0.84,
    source,
    valid_from: NOW,
    valid_until: null,
    created_at: NOW,
    accessed_at: NOW,
    ...overrides,
    source: overrides.source ?? source,
  };
}

async function mockMemoryDashboardApis(page: Page): Promise<void> {
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

    if (request.method() === 'GET' && pathname === '/api/memory/stats') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          stats: {
            totalFacts: 128,
            newThisWeek: 12,
            avgConfidence: 0.86,
            pendingConsolidation: 4,
            byScope: { 'project:agentctl': 92, global: 36 },
            byEntityType: { decision: 51, pattern: 44, error: 18, concept: 15 },
            strengthDistribution: { active: 91, decaying: 24, archived: 13 },
            growthTrend: [
              { date: '2026-04-12', count: 97 },
              { date: '2026-04-13', count: 114 },
              { date: '2026-04-14', count: 128 },
            ],
          },
        }),
      });
      return;
    }

    if (
      request.method() === 'GET' &&
      pathname === '/api/memory/facts' &&
      searchParams.get('limit') === '10'
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          facts: [makeFact()],
          total: 1,
        }),
      });
      return;
    }

    if (request.method() === 'GET' && pathname === '/api/memory/decay/stats') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          stats: {
            strengthDistribution: { low: 6, mediumLow: 18, mediumHigh: 44, high: 60 },
            pinnedCount: 9,
            archivedCount: 13,
          },
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
}

test.describe('Memory dashboard route', () => {
  test('renders the sidebar, dashboard content, recent activity, and decay card', async ({
    page,
  }) => {
    await mockMemoryDashboardApis(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/memory/dashboard');

    await expect(page.getByRole('heading', { name: 'Memory Dashboard' })).toBeVisible({
      timeout: 15_000,
    });

    const sidebar = page.getByRole('navigation', { name: 'Memory navigation' });
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole('link', { name: /Dashboard/ })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await expect(page.locator('[data-testid^="kpi-card-"]')).toHaveCount(4);
    await expect(page.getByTestId('kpi-value-Total Facts')).toHaveText('128');
    await expect(page.getByTestId('kpi-value-New This Week')).toHaveText('12');
    await expect(page.getByTestId('kpi-value-Avg Confidence')).toHaveText('86%');
    await expect(page.getByTestId('kpi-value-Pending Consolidation')).toHaveText('4');

    await expect(page.getByText('Recent Activity')).toBeVisible();
    await expect(page.getByTestId('activity-feed')).toBeVisible();
    await expect(page.getByTestId('activity-row-fact-dashboard-1')).toContainText(
      'Memory dashboard smoke keeps the route shell wired to live cards',
    );

    await expect(page.getByTestId('memory-decay-card')).toBeVisible();
    await expect(page.getByText('Memory Decay')).toBeVisible();
    await expect(page.getByTestId('memory-decay-eligible')).toHaveText('6');
  });
});
