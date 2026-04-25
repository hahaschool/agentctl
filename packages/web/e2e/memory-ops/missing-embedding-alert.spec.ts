import { expect, type Page, type Route, test } from '@playwright/test';

const VIEWS_WITH_ALERT = [
  '/memory/browser',
  '/memory/dashboard',
  '/memory/drawers',
  '/memory/maintenance',
  '/memory/reports',
  '/memory/synthesis',
  '/memory/graph',
  '/memory/consolidation',
] as const;

const VIEWS_WITHOUT_ALERT = ['/memory/import', '/memory/scopes'] as const;

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockMemoryApis(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const { pathname } = url;

    if (method === 'GET' && pathname === '/api/memory/providers') {
      await fulfillJson(route, { providers: [] });
      return;
    }
    if (method === 'GET' && pathname === '/api/memory/facts') {
      await fulfillJson(route, { ok: true, facts: [], drawerResults: [], total: 0 });
      return;
    }
    if (method === 'GET' && pathname === '/api/memory/stats') {
      await fulfillJson(route, {
        ok: true,
        stats: {
          totalFacts: 0,
          newThisWeek: 0,
          avgConfidence: 0,
          pendingConsolidation: 0,
          byScope: {},
          byEntityType: {},
          strengthDistribution: { active: 0, decaying: 0, archived: 0 },
          growthTrend: [],
        },
      });
      return;
    }
    if (method === 'GET' && pathname === '/api/memory/decay/stats') {
      await fulfillJson(route, {
        ok: true,
        stats: {
          strengthDistribution: { low: 0, mediumLow: 0, mediumHigh: 0, high: 0 },
          pinnedCount: 0,
          archivedCount: 0,
        },
      });
      return;
    }
    if (method === 'GET' && pathname === '/api/memory/consolidation') {
      await fulfillJson(route, { ok: true, items: [], total: 0 });
      return;
    }
    if (method === 'GET' && pathname === '/api/memory/reports') {
      await fulfillJson(route, { ok: true, reports: [], total: 0 });
      return;
    }
    if (method === 'GET' && pathname === '/api/memory/drawers') {
      await fulfillJson(route, { ok: true, drawers: [], total: 0 });
      return;
    }
    if (method === 'GET' && pathname === '/api/memory/scopes') {
      await fulfillJson(route, { ok: true, scopes: [] });
      return;
    }
    if (method === 'GET' && pathname === '/api/sync/conflicts/count') {
      await fulfillJson(route, { count: 0 });
      return;
    }
    if (method === 'GET' && pathname === '/api/permission-requests') {
      await fulfillJson(route, []);
      return;
    }
    if (method === 'GET' && pathname === '/api/agents') {
      await fulfillJson(route, []);
      return;
    }
    if (method === 'GET' && pathname === '/api/sessions') {
      await fulfillJson(route, { sessions: [], total: 0, limit: 50, offset: 0, hasMore: false });
      return;
    }
    if (method === 'GET' && pathname === '/api/runtime-sessions') {
      await fulfillJson(route, { sessions: [], count: 0 });
      return;
    }
    if (method === 'GET' && pathname === '/api/settings/accounts') {
      await fulfillJson(route, []);
      return;
    }

    await fulfillJson(route, method === 'GET' ? {} : {});
  });
}

test.describe('Missing embedding provider alert coverage', () => {
  for (const path of VIEWS_WITH_ALERT) {
    test(`shows the alert on ${path}`, async ({ page }) => {
      await mockMemoryApis(page);
      await page.goto(path);
      await expect(
        page.getByRole('alert').filter({ hasText: /No embedding provider/ }),
      ).toBeVisible();
    });
  }

  for (const path of VIEWS_WITHOUT_ALERT) {
    test(`does not show the provider alert on ${path}`, async ({ page }) => {
      await mockMemoryApis(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('alert').filter({ hasText: /No embedding provider/ })).toHaveCount(
        0,
      );
    });
  }
});
