import { expect, test } from '@playwright/test';

const MOCK_TIERS = [
  {
    name: 'dev-1',
    label: 'Dev 1',
    status: 'running',
    services: [
      {
        name: 'control-plane',
        port: 8080,
        memoryMb: 512,
        uptimeSeconds: 7_200,
        restarts: 0,
        healthy: true,
      },
    ],
    config: {
      cpPort: 8080,
      workerPort: 8090,
      webPort: 5173,
      database: 'agentctl_dev_1',
      redisDb: 1,
    },
  },
  {
    name: 'dev-2',
    label: 'Dev 2',
    status: 'degraded',
    services: [
      {
        name: 'control-plane',
        port: 8081,
        memoryMb: 768,
        uptimeSeconds: 3_600,
        restarts: 1,
        healthy: true,
      },
    ],
    config: {
      cpPort: 8081,
      workerPort: 8091,
      webPort: 5174,
      database: 'agentctl_dev_2',
      redisDb: 2,
    },
  },
  {
    name: 'beta',
    label: 'Beta',
    status: 'running',
    services: [
      {
        name: 'control-plane',
        port: 9000,
        memoryMb: 640,
        uptimeSeconds: 10_800,
        restarts: 0,
        healthy: true,
      },
    ],
    config: {
      cpPort: 9000,
      workerPort: 9010,
      webPort: 5175,
      database: 'agentctl_beta',
      redisDb: 3,
    },
  },
] as const;

test.describe('Deployment page', () => {
  test('renders tier data and uses the selected source tier for preflight', async ({ page }) => {
    let releasePreflight: (() => void) | null = null;
    const preflightPaused = new Promise<void>((resolve) => {
      releasePreflight = resolve;
    });

    await page.route('**/api/deployment/tiers', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tiers: MOCK_TIERS }),
      });
    });

    await page.route('**/api/deployment/history**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ records: [], total: 0 }),
      });
    });

    await page.route('**/api/deployment/promote/preflight', async (route) => {
      await preflightPaused;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ready: true,
          checks: [
            { name: 'Build', status: 'pass' },
            { name: 'Tests', status: 'pass' },
            { name: 'Lint', status: 'pass' },
            { name: 'Health', status: 'pass' },
          ],
        }),
      });
    });

    await page.goto('/deployment');

    await expect(page.getByRole('heading', { name: /^deployment$/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: /promote to beta/i })).toBeVisible();
    await expect(page.getByText('db:agentctl_dev_1')).toBeVisible();
    await expect(page.getByText('db:agentctl_dev_2')).toBeVisible();
    await expect(page.getByText('db:agentctl_beta')).toBeVisible();
    await expect(page.getByText('No promotions yet')).toBeVisible();

    const sourceTierSelect = page.locator('#source-tier-select');
    await expect(sourceTierSelect).toHaveValue('dev-1');
    await expect(sourceTierSelect.locator('option')).toHaveText(['Dev 1 (dev-1)', 'Dev 2 (dev-2)']);
    await expect(sourceTierSelect.locator('option[value="beta"]')).toHaveCount(0);

    const promoteButton = page.getByRole('button', { name: /^promote to beta$/i });
    await expect(promoteButton).toBeDisabled();

    await sourceTierSelect.selectOption('dev-2');

    const preflightRequestPromise = page.waitForRequest((request) => {
      return (
        request.url().includes('/api/deployment/promote/preflight') && request.method() === 'POST'
      );
    });

    await page.getByRole('button', { name: /^run preflight$/i }).click();
    await expect(page.getByRole('button', { name: /running/i })).toBeVisible();

    const preflightRequest = await preflightRequestPromise;
    expect(preflightRequest.postDataJSON()).toEqual({ source: 'dev-2' });

    releasePreflight?.();

    await expect(page.getByRole('button', { name: /^run preflight$/i })).toBeVisible();
    await expect(promoteButton).toBeEnabled();
  });
});
