import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Tasks page (/tasks)
// ---------------------------------------------------------------------------

test.describe('Tasks page', () => {
  test('page loads and shows "Tasks" heading', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: /tasks/i }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('page shows description text for task graph DAGs', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: /tasks/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/task graph dag/i)).toBeVisible({ timeout: 5_000 });
  });

  test('Spaces link is visible', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: /tasks/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: /spaces/i }).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('Refresh button is visible', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: /tasks/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible({
      timeout: 5_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Spaces page (/spaces)
// ---------------------------------------------------------------------------

test.describe('Spaces page', () => {
  test('page loads and shows "Spaces" heading', async ({ page }) => {
    await page.goto('/spaces');
    await expect(page.getByRole('heading', { name: /spaces/i }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('"New Space" button is visible', async ({ page }) => {
    await page.goto('/spaces');
    await expect(page.getByRole('heading', { name: /spaces/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: /new space/i })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('Tasks link is visible', async ({ page }) => {
    await page.goto('/spaces');
    await expect(page.getByRole('heading', { name: /spaces/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: /tasks/i }).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('Refresh button is visible', async ({ page }) => {
    await page.goto('/spaces');
    await expect(page.getByRole('heading', { name: /spaces/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible({
      timeout: 5_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Deployment page (/deployment)
// ---------------------------------------------------------------------------

test.describe('Deployment page', () => {
  test('page loads and shows "Deployment" heading', async ({ page }) => {
    await page.goto('/deployment');
    await expect(page.getByRole('heading', { name: /deployment/i }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('shows Promote to Beta section', async ({ page }) => {
    await page.goto('/deployment');
    await expect(page.getByRole('heading', { name: /deployment/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: /promote to beta/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('shows Promotion History section', async ({ page }) => {
    await page.goto('/deployment');
    await expect(page.getByRole('heading', { name: /deployment/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/promotion history/i)).toBeVisible({ timeout: 5_000 });
  });

  test('shows preflight checklist items', async ({ page }) => {
    await page.goto('/deployment');
    await expect(page.getByRole('heading', { name: /deployment/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    // The preflight checklist shows Build, Tests, Lint, Health
    await expect(page.getByText('Build')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Tests')).toBeVisible({ timeout: 5_000 });
  });
});
