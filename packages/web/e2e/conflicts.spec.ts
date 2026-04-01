import { expect, type Page, test } from '@playwright/test';

async function interceptConflictsApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/sync/conflicts') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          conflicts: [],
          total: 0,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'NOT_FOUND', message: 'Not found' }),
    });
  });
}

test.describe('Conflicts page', () => {
  test.beforeEach(async ({ page }) => {
    await interceptConflictsApi(page);
    await page.goto('/conflicts');
  });

  test('page loads with Sync Conflicts heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /sync conflicts/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('shows empty state when no conflicts exist', async ({ page }) => {
    await expect(page.getByText('No sync conflicts found.')).toBeVisible({ timeout: 15_000 });
  });

  test('filter dropdowns render', async ({ page }) => {
    await expect(page.getByLabel('Filter by status')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Filter by table')).toBeVisible();
    await expect(page.getByLabel('Filter by peer')).toBeVisible();
  });
});
