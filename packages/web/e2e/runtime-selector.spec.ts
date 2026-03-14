import { test } from '@playwright/test';

test.describe('Runtime Selector', () => {
  test('create agent with codex runtime', async ({ page }) => {
    await page.goto('/agents');
    // Click create agent
    // Open Advanced section
    // Select Codex runtime
    // Verify model dropdown shows Codex models
    // Fill required fields
    // Save
    // Verify agent has runtime: 'codex'
    test.skip(true, 'E2E stub — requires running backend');
  });

  test('create session with codex runtime', async ({ page }) => {
    await page.goto('/sessions');
    // Select Codex runtime
    // Verify model list shows Codex models
    // Fill fields and submit
    test.skip(true, 'E2E stub — requires running backend');
  });

  test('discover page shows runtime badges', async ({ page }) => {
    await page.goto('/discover');
    // Verify runtime badges visible on session rows
    // Select runtime filter
    // Verify filtering works
    test.skip(true, 'E2E stub — requires running backend');
  });

  test('agent settings runtime change shows confirmation', async ({ page }) => {
    await page.goto('/agents');
    // Navigate to agent settings
    // Change runtime
    // Verify confirmation dialog / toast appears
    // Confirm
    // Verify MCP servers cleared
    test.skip(true, 'E2E stub — requires running backend');
  });

  test('machine detail shows available runtimes', async ({ page }) => {
    await page.goto('/machines');
    // Navigate to machine detail page
    // Verify "Available Runtimes" section exists
    // Verify installed/authenticated status shown
    test.skip(true, 'E2E stub — requires running backend');
  });
});
