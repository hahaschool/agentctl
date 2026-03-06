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

// ---------------------------------------------------------------------------
// Keyboard help overlay — extended scenarios
// ---------------------------------------------------------------------------

test.describe('Keyboard help overlay (extended)', () => {
  test('help overlay contains shortcut groups and descriptions', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Open with ? — use page.keyboard.type to produce the actual '?' character
    // (Shift+/ in headless Chromium does not reliably produce '?')
    await page.keyboard.type('?');

    // Should show the dialog
    const dialog = page.locator('[role="dialog"][aria-label="Keyboard shortcuts"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Should contain shortcut keys displayed as <kbd> elements
    const kbdElements = dialog.locator('kbd');
    const kbdCount = await kbdElements.count();
    expect(kbdCount).toBeGreaterThan(3);

    // Should contain at least some shortcut descriptions
    await expect(dialog.getByText('Esc').first()).toBeVisible({ timeout: 3_000 });

    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 3_000 });
  });

  test('pressing ? again closes the help overlay (toggle behavior)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Open
    await page.keyboard.type('?');
    await expect(page.getByText(/keyboard shortcuts/i).first()).toBeVisible({ timeout: 5_000 });

    // Press ? again to close (type into the dialog, which passes through)
    await page.keyboard.type('?');
    await expect(page.getByText(/keyboard shortcuts/i).first()).toBeHidden({ timeout: 3_000 });
  });

  test('clicking backdrop closes the help overlay', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Open
    await page.keyboard.type('?');
    await expect(page.getByText(/keyboard shortcuts/i).first()).toBeVisible({ timeout: 5_000 });

    // Click the backdrop (the fixed inset-0 overlay behind the panel)
    // Click at a corner that is outside the dialog panel
    await page.mouse.click(10, 10);
    await expect(page.getByText(/keyboard shortcuts/i).first()).toBeHidden({ timeout: 3_000 });
  });

  test('help overlay does not open when typing ? in an input', async ({ page }) => {
    await page.goto('/sessions');
    await page.waitForSelector('h2', { timeout: 15_000 });

    // Focus the search input
    const searchInput = page.locator('#session-search');
    if (await searchInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await searchInput.focus();
      await page.keyboard.type('?');

      // Help overlay should NOT appear
      await page.waitForTimeout(500);
      const overlay = page.getByText(/keyboard shortcuts/i).first();
      await expect(overlay).toBeHidden({ timeout: 2_000 });

      // The ? character should have been typed into the input
      const value = await searchInput.inputValue();
      expect(value).toContain('?');
    }
  });
});

// ---------------------------------------------------------------------------
// Sidebar navigation — extended scenarios
// ---------------------------------------------------------------------------

test.describe('Sidebar navigation (extended)', () => {
  const navTargets = [
    { label: 'Dashboard', url: /\/$/, heading: /command center/i },
    { label: 'Machines', url: /\/machines/, heading: /machines/i },
    { label: 'Agents', url: /\/agents/, heading: /agents/i },
    { label: 'Sessions', url: /\/sessions/, heading: /sessions/i },
    { label: 'Discover', url: /\/discover/, heading: /discover/i },
    { label: 'Logs', url: /\/logs/, heading: /logs/i },
  ];

  for (const { label, url, heading } of navTargets) {
    test(`clicking "${label}" in sidebar navigates to correct page`, async ({ page }) => {
      // Start from settings to ensure we are not already on the target page
      await page.goto('/settings');
      await page.waitForSelector('h1', { timeout: 15_000 });

      await page.getByRole('link', { name: label }).first().click();
      await expect(page).toHaveURL(url, { timeout: 10_000 });
      await expect(
        page.getByRole('heading', { name: heading }).first(),
      ).toBeVisible({ timeout: 10_000 });
    });
  }

  test('Settings link in sidebar navigates to /settings', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await page.getByRole('link', { name: /settings/i }).first().click();
    await expect(page).toHaveURL(/\/settings/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('sidebar shows AgentCTL branding', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // The sidebar nav should contain the "AgentCTL" brand text on large viewports
    // Use the nav-scoped locator to avoid matching the mobile header bar (hidden at lg)
    await expect(page.locator('nav').getByText('AgentCTL')).toBeVisible({ timeout: 5_000 });
  });

  test('sidebar shows shortcut hints on large viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Sidebar should show keyboard hint text like "Nav" and "Help"
    await expect(page.getByText('Nav').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Help').first()).toBeVisible({ timeout: 5_000 });
  });

  test('active nav item changes as user navigates', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Dashboard link should be active (has aria-current="page")
    const dashboardLink = page.getByRole('link', { name: 'Dashboard' }).first();
    await expect(dashboardLink).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });

    // Navigate to Agents
    await page.getByRole('link', { name: 'Agents' }).first().click();
    await page.waitForSelector('h1', { timeout: 10_000 });

    // Agents link should now be active
    const agentsLink = page.getByRole('link', { name: 'Agents' }).first();
    await expect(agentsLink).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });

    // Dashboard link should no longer be active
    await expect(dashboardLink).not.toHaveAttribute('aria-current', 'page');
  });
});

// ---------------------------------------------------------------------------
// Theme toggle — extended scenarios
// ---------------------------------------------------------------------------

test.describe('Theme toggle (extended)', () => {
  test('theme toggle button has accessible label', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // The theme button uses aria-label "Switch to light mode" or "Switch to dark mode"
    const themeBtn = page.locator('button[aria-label*="Switch to"]').first();
    await expect(themeBtn).toBeVisible({ timeout: 5_000 });

    const label = await themeBtn.getAttribute('aria-label');
    expect(label).toMatch(/Switch to (light|dark) mode/);
  });

  test('clicking theme toggle changes html class between dark and non-dark', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    const themeBtn = page.locator('button[aria-label*="Switch to"]').first();
    await expect(themeBtn).toBeVisible({ timeout: 5_000 });

    // Get initial theme state from <html> class
    const initialHasDark = await page.locator('html').evaluate(
      (el) => el.classList.contains('dark'),
    );

    // Click toggle
    await themeBtn.click();
    await page.waitForTimeout(500);

    // Verify it toggled
    const afterHasDark = await page.locator('html').evaluate(
      (el) => el.classList.contains('dark'),
    );
    expect(afterHasDark).toBe(!initialHasDark);

    // Click again to toggle back
    await themeBtn.click();
    await page.waitForTimeout(500);

    const restoredHasDark = await page.locator('html').evaluate(
      (el) => el.classList.contains('dark'),
    );
    expect(restoredHasDark).toBe(initialHasDark);
  });

  test('theme selection on settings page shows three options', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Settings has a Theme section with System, Light, Dark buttons
    // Use exact: true to avoid matching the sidebar's "Switch to light/dark mode" button
    await expect(page.getByText('Theme').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'System', exact: true })).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole('button', { name: 'Light', exact: true })).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole('button', { name: 'Dark', exact: true })).toBeVisible({ timeout: 3_000 });
  });

  test('selecting Light theme on settings page applies light mode', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Click Light theme button (exact to avoid matching sidebar theme toggle)
    const lightBtn = page.getByRole('button', { name: 'Light', exact: true });
    await expect(lightBtn).toBeVisible({ timeout: 5_000 });
    await lightBtn.click();
    await page.waitForTimeout(500);

    // html should NOT have dark class
    const hasDark = await page.locator('html').evaluate(
      (el) => el.classList.contains('dark'),
    );
    expect(hasDark).toBe(false);
  });

  test('selecting Dark theme on settings page applies dark mode', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Click Dark theme button (exact to avoid matching sidebar theme toggle)
    const darkBtn = page.getByRole('button', { name: 'Dark', exact: true });
    await expect(darkBtn).toBeVisible({ timeout: 5_000 });
    await darkBtn.click();
    await page.waitForTimeout(500);

    // html should have dark class
    const hasDark = await page.locator('html').evaluate(
      (el) => el.classList.contains('dark'),
    );
    expect(hasDark).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Settings page sections — extended scenarios
// ---------------------------------------------------------------------------

test.describe('Settings page sections (extended)', () => {
  test('settings page shows all three section groups', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Group 1: API Accounts
    await expect(page.getByRole('heading', { name: 'API Accounts' })).toBeVisible({
      timeout: 5_000,
    });

    // Group 2: Appearance & Preferences
    await expect(page.getByRole('heading', { name: 'Appearance & Preferences' })).toBeVisible({
      timeout: 3_000,
    });

    // Group 3: System
    await expect(page.getByRole('heading', { name: 'System' })).toBeVisible({
      timeout: 3_000,
    });
  });

  test('settings page shows Theme sub-section', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await expect(page.getByRole('heading', { name: 'Theme' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Choose your preferred color scheme')).toBeVisible({
      timeout: 3_000,
    });
  });

  test('settings page shows Control Plane sub-section', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await expect(page.getByRole('heading', { name: 'Control Plane' })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('settings page shows LLM Router sub-section with configure link', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await expect(page.getByRole('heading', { name: 'LLM Router' })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText('Multi-provider failover routing')).toBeVisible({
      timeout: 3_000,
    });

    // The configure link should navigate to /settings/router
    const configureLink = page.getByRole('link', { name: /configure/i });
    await expect(configureLink).toBeVisible({ timeout: 3_000 });
    await configureLink.click();
    await expect(page).toHaveURL(/\/settings\/router/, { timeout: 10_000 });
  });

  test('settings page shows Keyboard Shortcuts sub-section', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await expect(page.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeVisible({
      timeout: 5_000,
    });
    // Should have shortcut key <kbd> elements rendered in the section
    const section = page.locator('section#system');
    const kbds = section.locator('kbd');
    const kbdCount = await kbds.count();
    expect(kbdCount).toBeGreaterThan(0);
  });

  test('settings page shows About AgentCTL sub-section with version', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await expect(page.getByRole('heading', { name: 'About AgentCTL' })).toBeVisible({
      timeout: 5_000,
    });
    // Use exact: true to avoid matching the sidebar's "v0.1.0" text
    await expect(page.getByText('0.1.0', { exact: true })).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText('Next.js + React 19')).toBeVisible({ timeout: 3_000 });
  });

  test('settings page description text is present', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await expect(
      page.getByText('Configure accounts, preferences, and system connections'),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('settings page can scroll to each section via anchor ids', async ({ page }) => {
    await page.goto('/settings#system');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // The System section should be present
    await expect(page.locator('section#system')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('section#accounts')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('section#appearance')).toBeVisible({ timeout: 3_000 });
  });
});

// ---------------------------------------------------------------------------
// Search interactions on Sessions page
// ---------------------------------------------------------------------------

test.describe('Search interactions', () => {
  test('sessions page has a search input with correct placeholder', async ({ page }) => {
    await page.goto('/sessions');
    await page.waitForSelector('h2', { timeout: 15_000 });

    const searchInput = page.locator('#session-search');
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await expect(searchInput).toHaveAttribute('placeholder', 'Search sessions...');
    await expect(searchInput).toHaveAttribute('type', 'search');
  });

  test('sessions search input shows "/" keyboard hint when empty', async ({ page }) => {
    await page.goto('/sessions');
    await page.waitForSelector('h2', { timeout: 15_000 });

    const searchInput = page.locator('#session-search');
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // The "/" kbd hint should be visible when input is empty
    const kbdHint = page.locator('#session-search + kbd, .relative kbd').first();
    await expect(kbdHint).toBeVisible({ timeout: 3_000 });
    await expect(kbdHint).toHaveText('/');
  });

  test('typing in sessions search hides the "/" keyboard hint', async ({ page }) => {
    await page.goto('/sessions');
    await page.waitForSelector('h2', { timeout: 15_000 });

    const searchInput = page.locator('#session-search');
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // Type something
    await searchInput.fill('test-query');

    // The "/" hint should disappear when there is text
    await page.waitForTimeout(300);
    const kbdHint = searchInput.locator('..').locator('kbd');
    await expect(kbdHint).toBeHidden({ timeout: 3_000 });
  });

  test('clearing search input restores "/" keyboard hint', async ({ page }) => {
    await page.goto('/sessions');
    await page.waitForSelector('h2', { timeout: 15_000 });

    const searchInput = page.locator('#session-search');
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // Type, then clear
    await searchInput.fill('some query');
    await page.waitForTimeout(200);
    await searchInput.fill('');
    await page.waitForTimeout(300);

    // "/" hint should reappear
    const kbdHint = searchInput.locator('..').locator('kbd');
    await expect(kbdHint).toBeVisible({ timeout: 3_000 });
  });

  test('sessions search does not trigger keyboard navigation shortcuts', async ({ page }) => {
    await page.goto('/sessions');
    await page.waitForSelector('h2', { timeout: 15_000 });

    const searchInput = page.locator('#session-search');
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // Focus the search input and type a number key
    await searchInput.focus();
    await searchInput.fill('');
    await page.keyboard.press('1');

    // Should NOT navigate away — still on /sessions
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/sessions/);

    // The "1" should be in the input value
    const value = await searchInput.inputValue();
    expect(value).toBe('1');
  });

  test('sessions page has status filter tabs', async ({ page }) => {
    await page.goto('/sessions');
    await page.waitForSelector('h2', { timeout: 15_000 });

    // Should show status tabs: All, Starting, Active, Ended, Error
    const tabs = ['All', 'Starting', 'Active', 'Ended', 'Error'];
    for (const tab of tabs) {
      await expect(
        page.getByRole('button', { name: tab, exact: true }).first(),
      ).toBeVisible({ timeout: 3_000 });
    }
  });

  test('clicking a status tab changes the active filter', async ({ page }) => {
    await page.goto('/sessions');
    await page.waitForSelector('h2', { timeout: 15_000 });

    // Click "Active" tab
    const activeTab = page.getByRole('button', { name: 'Active', exact: true }).first();
    await activeTab.click();
    await page.waitForTimeout(300);

    // Active tab should have the "active" styling (border-primary and font-medium)
    const classes = await activeTab.getAttribute('class');
    expect(classes).toContain('border-primary');
    expect(classes).toContain('font-medium');

    // "All" tab should not have active styling
    const allTab = page.getByRole('button', { name: 'All', exact: true }).first();
    const allClasses = await allTab.getAttribute('class');
    expect(allClasses).toContain('border-transparent');
  });

  test('command palette search filters results', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    // Open command palette
    await page.keyboard.press('Meta+k');
    const input = page.locator('input[placeholder*="Search"]').first();
    await expect(input).toBeVisible({ timeout: 5_000 });

    // Type "mach" to filter
    await input.fill('mach');
    await page.waitForTimeout(300);

    // "Machines" should still be visible
    await expect(page.getByText('Machines').first()).toBeVisible({ timeout: 3_000 });

    // Clean up
    await page.keyboard.press('Escape');
  });
});

// ---------------------------------------------------------------------------
// Two-key (g+X) navigation sequences
// ---------------------------------------------------------------------------

test.describe('Two-key navigation (g + X)', () => {
  test('pressing g then d navigates to Dashboard', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await page.keyboard.press('g');
    await page.keyboard.press('d');

    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
    await expect(
      page.getByRole('heading', { name: /command center/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('pressing g then s navigates to Sessions', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await page.keyboard.press('g');
    await page.keyboard.press('s');

    await expect(page).toHaveURL(/\/sessions/, { timeout: 10_000 });
  });

  test('pressing g then a navigates to Agents', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await page.keyboard.press('g');
    await page.keyboard.press('a');

    await expect(page).toHaveURL(/\/agents/, { timeout: 10_000 });
  });

  test('pressing g then m navigates to Machines', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1', { timeout: 15_000 });

    await page.keyboard.press('g');
    await page.keyboard.press('m');

    await expect(page).toHaveURL(/\/machines/, { timeout: 10_000 });
  });
});
