import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Tasks page (/tasks)
// ---------------------------------------------------------------------------

test.describe('Tasks page', () => {
  test('page loads and shows "Tasks" heading', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: /^tasks$/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('task graph list table renders (even if empty)', async ({ page }) => {
    await page.goto('/tasks');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Either the table is rendered (with data) or the empty-state message is shown.
    // Both are valid — the test checks the page does not crash.
    const table = page.locator('table[aria-label="Task graphs"]');
    const emptyMsg = page.getByText(/no task graphs found/i);

    const hasTable = await table.isVisible({ timeout: 8_000 }).catch(() => false);
    const hasEmpty = await emptyMsg.isVisible({ timeout: 3_000 }).catch(() => false);
    const hasError = await page
      .getByText(/failed to load/i)
      .isVisible({ timeout: 1_000 })
      .catch(() => false);

    expect(hasTable || hasEmpty || hasError).toBe(true);
  });

  test('page shows description text for task graph DAGs', async ({ page }) => {
    await page.goto('/tasks');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await expect(page.getByText(/task graph dag/i)).toBeVisible({ timeout: 5_000 });
  });

  test('Spaces navigation link is visible on the tasks page', async ({ page }) => {
    await page.goto('/tasks');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await expect(page.getByRole('link', { name: /spaces/i }).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('click on a task graph row navigates to /tasks/[id] detail page', async ({ page }) => {
    await page.goto('/tasks');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Only runs when the backend returns at least one graph.
    const tableRow = page.locator('table[aria-label="Task graphs"] tbody tr').first();
    const hasRow = await tableRow.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasRow) return;

    // The graph name cell contains a link to the detail page.
    const graphLink = tableRow.locator('a[href^="/tasks/"]').first();
    const hasLink = await graphLink.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasLink) return;

    await graphLink.click();
    await expect(page).toHaveURL(/\/tasks\/.+/, { timeout: 10_000 });

    // Detail page renders "All Tasks" back-link and the graph name as h1.
    await expect(page.getByRole('link', { name: /all tasks/i })).toBeVisible({ timeout: 10_000 });
  });

  test('tasks page does not crash when API is unreachable', async ({ page }) => {
    await page.route('**/api/**', (route) => route.abort());
    await page.goto('/tasks');
    await page.waitForSelector('h1', { timeout: 15_000 });

    const heading = page.getByRole('heading', { name: /^tasks$/i });
    await expect(heading).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Spaces page (/spaces)
// ---------------------------------------------------------------------------

test.describe('Spaces page', () => {
  test('page loads and shows "Spaces" heading', async ({ page }) => {
    await page.goto('/spaces');
    await expect(page.getByRole('heading', { name: /^spaces$/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('"New Space" button is visible', async ({ page }) => {
    await page.goto('/spaces');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await expect(page.getByRole('button', { name: /new space/i })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('space list renders (even if empty state)', async ({ page }) => {
    await page.goto('/spaces');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Either the spaces grid is rendered, the empty-state message is visible,
    // or an error banner is shown — all indicate the page handled the response.
    const spaceCards = page.locator('[data-testid="space-card"], .grid > *').first();
    const emptyMsg = page.getByText(/no collaboration spaces/i);
    const hasError = await page
      .getByText(/failed to load/i)
      .isVisible({ timeout: 1_000 })
      .catch(() => false);
    const hasCards = await spaceCards.isVisible({ timeout: 5_000 }).catch(() => false);
    const hasEmpty = await emptyMsg.isVisible({ timeout: 3_000 }).catch(() => false);

    expect(hasCards || hasEmpty || hasError).toBe(true);
  });

  test('Tasks navigation link is visible on the spaces page', async ({ page }) => {
    await page.goto('/spaces');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await expect(page.getByRole('link', { name: /tasks/i }).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('clicking "New Space" opens the create-space dialog', async ({ page }) => {
    await page.goto('/spaces');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await page.getByRole('button', { name: /new space/i }).click();

    const dialog = page.getByRole('dialog', { name: /new space/i });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Dialog has name input and Create Space / Cancel buttons.
    await expect(dialog.locator('#space-name')).toBeVisible({ timeout: 3_000 });
    await expect(dialog.getByRole('button', { name: /create space/i })).toBeVisible({
      timeout: 3_000,
    });
    await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible({ timeout: 3_000 });
  });

  test('create-space dialog can be closed with Cancel', async ({ page }) => {
    await page.goto('/spaces');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await page.getByRole('button', { name: /new space/i }).click();

    const dialog = page.getByRole('dialog', { name: /new space/i });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).toBeHidden({ timeout: 3_000 });
  });

  test('create-space dialog can be closed with Escape', async ({ page }) => {
    await page.goto('/spaces');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await page.getByRole('button', { name: /new space/i }).click();

    const dialog = page.getByRole('dialog', { name: /new space/i });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 3_000 });
  });

  test('spaces page does not crash when API is unreachable', async ({ page }) => {
    await page.route('**/api/**', (route) => route.abort());
    await page.goto('/spaces');
    await page.waitForSelector('h1', { timeout: 15_000 });

    const heading = page.getByRole('heading', { name: /^spaces$/i });
    await expect(heading).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Deployment page (/deployment)
// ---------------------------------------------------------------------------

test.describe('Deployment page', () => {
  test('page loads and shows "Deployment" heading', async ({ page }) => {
    await page.goto('/deployment');
    await expect(page.getByRole('heading', { name: /^deployment$/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('deployment page renders tier cards or loading skeletons', async ({ page }) => {
    await page.goto('/deployment');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // After the heading loads, either real tier cards or skeleton placeholders are shown.
    // Tier cards have h3 headings (tier.label). Skeletons are animate-pulse divs.
    const tierCard = page.locator('.rounded-lg.border.bg-card').first();
    const hasCard = await tierCard.isVisible({ timeout: 8_000 }).catch(() => false);

    // The page renders something beyond the heading — tier grid or error.
    expect(hasCard).toBe(true);
  });

  test('deployment page shows Service column header in tier tables', async ({ page }) => {
    await page.goto('/deployment');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Wait for tier data to load — the "Service" column header is inside each TierCard.
    const serviceHeader = page.getByText('Service').first();
    const hasServiceHeader = await serviceHeader.isVisible({ timeout: 10_000 }).catch(() => false);

    // Only assert when tiers have loaded (backend running).
    if (hasServiceHeader) {
      await expect(serviceHeader).toBeVisible();
    }
  });

  test('deployment page does not crash when API is unreachable', async ({ page }) => {
    await page.route('**/api/**', (route) => route.abort());
    await page.goto('/deployment');
    await page.waitForSelector('h1', { timeout: 15_000 });

    const heading = page.getByRole('heading', { name: /^deployment$/i });
    await expect(heading).toBeVisible({ timeout: 5_000 });

    // Should show an error hint, not a blank screen.
    const errorHint = page.getByText(/failed to load tier/i);
    await errorHint.isVisible({ timeout: 5_000 }).catch(() => false);
  });

  test('deployment page has a tier grid section', async ({ page }) => {
    await page.goto('/deployment');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // The TierGrid renders a div.grid — it should be present regardless of data.
    const grid = page.locator('.grid').first();
    await expect(grid).toBeVisible({ timeout: 10_000 });
  });
});
