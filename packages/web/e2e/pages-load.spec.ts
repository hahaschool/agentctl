import { expect, test } from '@playwright/test';

// Verify every page loads without runtime errors.
// Control plane (8080) and worker (9000) must be running.

test.describe.configure({ timeout: 60_000 });

// Warm up: visit dashboard first to trigger Next.js compilation
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto('/', { timeout: 30_000 });
  // Wait for Next.js to finish compiling
  await page.waitForSelector('h1', { timeout: 30_000 });
  await page.close();
});

const pages = [
  { name: 'Dashboard', path: '/', heading: 'Command Center', sel: 'h1' },
  { name: 'Machines', path: '/machines', heading: 'Fleet Machines', sel: 'h1' },
  { name: 'Agents', path: '/agents', heading: 'Agents', sel: 'h1' },
  { name: 'Sessions', path: '/sessions', heading: 'Sessions', sel: 'h2' },
  { name: 'Discover', path: '/discover', heading: 'Discover', sel: 'h1' },
  { name: 'Logs', path: '/logs', heading: 'Logs', sel: 'h1' },
  { name: 'Settings', path: '/settings', heading: 'Settings', sel: 'h1' },
];

for (const { name, path, heading, sel } of pages) {
  test(`${name} page loads without runtime errors`, async ({ page }) => {
    const errors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(path, { timeout: 30_000 });

    // Wait for the page heading to appear (confirms page compiled & rendered)
    await page.waitForSelector(sel, { timeout: 15_000 });

    // Heading should match expected text (not "Page Not Found")
    const text = await page.locator(sel).first().textContent();
    expect(text?.toLowerCase()).toContain(heading.toLowerCase());

    const nestedInteractiveCount = await page.evaluate(() =>
      document.querySelectorAll('button button, button a[href], a[href] button, a[href] a[href]')
        .length,
    );

    // No uncaught runtime errors
    expect(errors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(nestedInteractiveCount).toBe(0);
  });
}

test('Dashboard shows healthy control plane and no DB error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await page.waitForSelector('text=Control Plane', { timeout: 15_000 });

  // Control plane status should be visible
  await expect(page.locator('text=Control Plane')).toBeVisible();

  // "Database not configured" banner should NOT appear
  const dbError = page.getByText('Database not configured');
  await expect(dbError).toHaveCount(0);

  // Should show machine count
  await expect(page.getByText('MACHINES ONLINE')).toBeVisible();

  expect(errors).toEqual([]);
});

test('Machines page renders machine cards without crashes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/machines');
  await page.waitForSelector('h1', { timeout: 15_000 });

  // Wait for data to load
  await page.waitForSelector('text=Total Machines', { timeout: 10_000 });

  expect(errors).toEqual([]);
});

test('Settings page loads all sections', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/settings');
  await page.waitForSelector('h1', { timeout: 15_000 });

  // Should show settings sections
  await expect(page.getByText('API Accounts')).toBeVisible({ timeout: 10_000 });

  expect(errors).toEqual([]);
});
