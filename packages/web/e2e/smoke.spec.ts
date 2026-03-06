import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Smoke tests — lightweight checks that core pages render and navigation works.
// These do NOT require the control plane or worker to be running.
// ---------------------------------------------------------------------------

test.describe('Page smoke tests', () => {
  test('dashboard page loads and shows "Command center" heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /command center/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('sessions page loads', async ({ page }) => {
    await page.goto('/sessions');
    await expect(page.getByText(/sessions/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('agents page loads', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.getByRole('heading', { name: /agents/i })).toBeVisible({ timeout: 15_000 });
  });

  test('settings page loads and shows Settings heading', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('discover page loads', async ({ page }) => {
    await page.goto('/discover');
    await expect(page.getByRole('heading', { name: /discover/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('logs page loads', async ({ page }) => {
    await page.goto('/logs');
    await expect(page.getByRole('heading', { name: /logs/i })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Keyboard shortcut navigation', () => {
  test('pressing "2" navigates to machines page', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Press "2" to navigate to machines
    await page.keyboard.press('2');

    // Should navigate to /machines
    await expect(page).toHaveURL(/\/machines/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /machines/i })).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe('Sidebar navigation', () => {
  test('sidebar renders with all nav items', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Verify the sidebar contains links to all main pages
    const expectedLinks = ['Dashboard', 'Sessions', 'Agents', 'Machines', 'Discover', 'Logs'];

    for (const linkName of expectedLinks) {
      await expect(
        page.getByRole('link', { name: linkName }).first(),
      ).toBeVisible({ timeout: 5_000 });
    }

    // Settings link may be at the bottom of the sidebar
    await expect(page.getByRole('link', { name: /settings/i }).first()).toBeVisible({
      timeout: 5_000,
    });
  });
});
