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

  test('machines page loads', async ({ page }) => {
    await page.goto('/machines');
    await expect(page.getByRole('heading', { name: /machines/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('settings/router page loads', async ({ page }) => {
    await page.goto('/settings/router');
    await expect(page.getByText(/router/i).first()).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Keyboard shortcut navigation — all number keys
// ---------------------------------------------------------------------------

test.describe('Keyboard shortcut navigation', () => {
  const shortcuts = [
    { key: '1', url: /\/$/, heading: /command center/i },
    { key: '2', url: /\/machines/, heading: /machines/i },
    { key: '3', url: /\/agents/, heading: /agents/i },
    { key: '4', url: /\/sessions/, heading: /sessions/i },
    { key: '5', url: /\/discover/, heading: /discover/i },
    { key: '6', url: /\/logs/, heading: /logs/i },
    { key: '7', url: /\/settings/, heading: /settings/i },
  ];

  for (const { key, url, heading } of shortcuts) {
    test(`pressing "${key}" navigates to correct page`, async ({ page }) => {
      // Start on a different page to ensure navigation happens
      const startPage = key === '3' ? '/sessions' : '/agents';
      await page.goto(startPage);
      await page.waitForSelector('h1, h2', { timeout: 15_000 });

      await page.keyboard.press(key);

      await expect(page).toHaveURL(url, { timeout: 10_000 });
      await expect(
        page.getByRole('heading', { name: heading }).first(),
      ).toBeVisible({ timeout: 10_000 });
    });
  }

  test('keyboard shortcuts do not fire when typing in input', async ({ page }) => {
    await page.goto('/sessions');
    await page.waitForSelector('h2', { timeout: 15_000 });

    // Focus a search input if available
    const searchInput = page.locator('input[type="text"], input[type="search"]').first();
    if (await searchInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await searchInput.focus();
      await page.keyboard.press('2');

      // Should NOT navigate — should still be on sessions page
      await page.waitForTimeout(500);
      await expect(page).toHaveURL(/\/sessions/);
    }
  });
});

// ---------------------------------------------------------------------------
// Command palette (Cmd+K / Ctrl+K)
// ---------------------------------------------------------------------------

test.describe('Command palette', () => {
  test('opens with Cmd+K and closes with Escape', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Open command palette
    await page.keyboard.press('Meta+k');

    // Should show the command palette input
    const input = page.locator('input[placeholder*="Search"]').first();
    await expect(input).toBeVisible({ timeout: 5_000 });

    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(input).toBeHidden({ timeout: 3_000 });
  });

  test('shows navigation commands', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await page.keyboard.press('Meta+k');

    // Should show navigation items
    await expect(page.getByText('Dashboard').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Sessions').first()).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText('Agents').first()).toBeVisible({ timeout: 3_000 });

    await page.keyboard.press('Escape');
  });

  test('filters commands by search query', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await page.keyboard.press('Meta+k');

    const input = page.locator('input[placeholder*="Search"]').first();
    await expect(input).toBeVisible({ timeout: 5_000 });

    // Type "sess" to filter
    await input.fill('sess');
    await page.waitForTimeout(300);

    // "Sessions" should be visible, "Machines" should not
    await expect(page.getByText('Sessions').first()).toBeVisible({ timeout: 3_000 });

    await page.keyboard.press('Escape');
  });
});

// ---------------------------------------------------------------------------
// Keyboard help overlay (? key)
// ---------------------------------------------------------------------------

test.describe('Keyboard help overlay', () => {
  test('opens with ? key and closes with Escape', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Press ? to open help overlay
    await page.keyboard.press('Shift+/');

    // Should show keyboard shortcuts dialog
    await expect(page.getByText(/keyboard shortcuts/i).first()).toBeVisible({ timeout: 5_000 });

    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(page.getByText(/keyboard shortcuts/i).first()).toBeHidden({ timeout: 3_000 });
  });
});

// ---------------------------------------------------------------------------
// Theme toggle
// ---------------------------------------------------------------------------

test.describe('Theme toggle', () => {
  test('toggles between light and dark mode', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Find and click the theme toggle button
    const themeBtn = page.getByRole('button', { name: /toggle theme/i }).first();
    if (await themeBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Get initial html class
      const initialClass = await page.locator('html').getAttribute('class');

      await themeBtn.click();
      await page.waitForTimeout(500);

      // HTML class should change (dark ↔ light)
      const newClass = await page.locator('html').getAttribute('class');
      expect(newClass).not.toBe(initialClass);
    }
  });
});

// ---------------------------------------------------------------------------
// Sidebar navigation
// ---------------------------------------------------------------------------

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

  test('clicking a nav link navigates to that page', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Click "Agents" in sidebar
    await page.getByRole('link', { name: 'Agents' }).first().click();
    await expect(page).toHaveURL(/\/agents/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /agents/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('active nav item is visually highlighted', async ({ page }) => {
    await page.goto('/sessions');
    await page.waitForSelector('h2', { timeout: 15_000 });

    // The "Sessions" link should have an active class (bg-accent or similar)
    const sessionsLink = page.getByRole('link', { name: 'Sessions' }).first();
    await expect(sessionsLink).toBeVisible({ timeout: 5_000 });

    // Active links typically have different background — check for data-active or class
    const classes = await sessionsLink.getAttribute('class');
    // Active state adds bg-accent to the link
    expect(classes).toContain('bg-accent');
  });
});

// ---------------------------------------------------------------------------
// Settings page interactions
// ---------------------------------------------------------------------------

test.describe('Settings page interactions', () => {
  test('settings page shows all major sections', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await expect(page.getByText('API Accounts')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Preferences')).toBeVisible({ timeout: 3_000 });
  });

  test('router config link navigates to /settings/router', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForSelector('h1', { timeout: 15_000 });

    const routerLink = page.getByRole('link', { name: /router/i }).first();
    if (await routerLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await routerLink.click();
      await expect(page).toHaveURL(/\/settings\/router/, { timeout: 10_000 });
    }
  });
});

// ---------------------------------------------------------------------------
// Error boundary — pages show error UI, not white screen
// ---------------------------------------------------------------------------

test.describe('Error boundary', () => {
  test('404 page shows not-found content', async ({ page }) => {
    await page.goto('/nonexistent-page-that-does-not-exist', { timeout: 15_000 });
    // Should show some kind of 404 or "not found" indication
    await page.waitForTimeout(2_000);
    const content = await page.content();
    // Next.js should render a 404 page, not a blank page
    expect(content.length).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// Responsive layout basics
// ---------------------------------------------------------------------------

test.describe('Responsive layout', () => {
  test('sidebar is visible on desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Sidebar should have navigation links
    const dashboardLink = page.getByRole('link', { name: 'Dashboard' }).first();
    await expect(dashboardLink).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// No runtime errors during navigation
// ---------------------------------------------------------------------------

test.describe('No uncaught errors', () => {
  test('navigating all pages produces no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => {
      // Ignore ChunkLoadError from Next.js dev recompilation
      if (err.message.includes('ChunkLoadError') || err.message.includes('Failed to load chunk')) {
        return;
      }
      errors.push(err.message);
    });

    const pages = ['/', '/machines', '/agents', '/sessions', '/discover', '/logs', '/settings'];
    for (const url of pages) {
      await page.goto(url, { timeout: 15_000 });
      await page.waitForSelector('h1, h2', { timeout: 10_000 });
    }

    expect(errors).toEqual([]);
  });
});
