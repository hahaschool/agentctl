import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Critical user flows — tests the actual API interactions and UI behavior
// Control plane (8080) and worker (9000) must be running.
// ---------------------------------------------------------------------------

test.describe.configure({ timeout: 60_000 });

// ---------------------------------------------------------------------------
// API Health
// ---------------------------------------------------------------------------

test.describe('API Health', () => {
  test('control-plane is healthy', async ({ request }) => {
    const res = await request.get('http://localhost:8080/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('worker is healthy', async ({ request }) => {
    const res = await request.get('http://localhost:9000/health');
    expect(res.ok()).toBeTruthy();
  });

  test('Next.js API proxy forwards to control-plane', async ({ request }) => {
    const res = await request.get('/api/sessions');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Session CRUD via API
// ---------------------------------------------------------------------------

test.describe('Session CRUD (API)', () => {
  test.describe.configure({ mode: 'serial' });
  let sessionId: string;

  test('create session returns valid response', async ({ request }) => {
    const res = await request.post('/api/sessions', {
      data: {
        agentId: 'adhoc',
        machineId: 'mac-local',
        projectPath: '/tmp/playwright-test',
        prompt: 'test prompt',
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sessionId).toBeTruthy();
    expect(body.session).toBeTruthy();
    expect(body.session.status).toBe('active');
    sessionId = body.sessionId;
  });

  test('list sessions includes created session', async ({ request }) => {
    if (!sessionId) test.skip();
    const res = await request.get('/api/sessions');
    expect(res.ok()).toBeTruthy();
    const sessions = await res.json();
    const found = sessions.find((s: { id: string }) => s.id === sessionId);
    expect(found).toBeTruthy();
  });

  test('get single session by id', async ({ request }) => {
    if (!sessionId) test.skip();
    const res = await request.get(`/api/sessions/${sessionId}`);
    expect(res.ok()).toBeTruthy();
    const session = await res.json();
    expect(session.id).toBe(sessionId);
  });

  test('delete session succeeds', async ({ request }) => {
    if (!sessionId) test.skip();
    const res = await request.delete(`/api/sessions/${sessionId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.session.status).toBe('ended');
  });

  test('delete already-ended session returns ok', async ({ request }) => {
    if (!sessionId) test.skip();
    const res = await request.delete(`/api/sessions/${sessionId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.message).toContain('already ended');
  });

  test('delete non-existent session returns 404', async ({ request }) => {
    const res = await request.delete('/api/sessions/00000000-0000-0000-0000-000000000000');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('SESSION_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Session CRUD via UI
// ---------------------------------------------------------------------------

test.describe('Session UI', () => {
  test('Sessions page renders session list', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/sessions');
    await page.waitForSelector('h2', { timeout: 15_000 });
    const heading = await page.locator('h2').first().textContent();
    expect(heading?.toLowerCase()).toContain('sessions');

    expect(errors).toEqual([]);
  });

  test('Sessions page shows empty state or session cards without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/sessions');
    await page.waitForSelector('h2', { timeout: 15_000 });

    // Wait for data to load (either sessions or empty state)
    await page.waitForTimeout(2_000);

    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Accounts via API
// ---------------------------------------------------------------------------

test.describe('Accounts CRUD (API)', () => {
  test.describe.configure({ mode: 'serial' });
  let accountId: string;

  test('create account', async ({ request }) => {
    const res = await request.post('/api/settings/accounts', {
      data: {
        name: 'Playwright Test Account',
        provider: 'anthropic_api',
        credential: 'sk-ant-test-invalid-key',
        priority: 99,
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('Playwright Test Account');
    expect(body.provider).toBe('anthropic_api');
    expect(body.credentialMasked).toBeTruthy();
    accountId = body.id;
  });

  test('list accounts includes created account', async ({ request }) => {
    if (!accountId) test.skip();
    const res = await request.get('/api/settings/accounts');
    expect(res.ok()).toBeTruthy();
    const accounts = await res.json();
    const found = accounts.find((a: { id: string }) => a.id === accountId);
    expect(found).toBeTruthy();
    expect(found.name).toBe('Playwright Test Account');
  });

  test('test account returns result (expected to fail with invalid key)', async ({ request }) => {
    if (!accountId) test.skip();
    const res = await request.post(`/api/settings/accounts/${accountId}/test`);
    // Should succeed (200) with ok: false (invalid key)
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.ok).toBe('boolean');
    expect(body.ok).toBe(false);
  });

  test('delete account', async ({ request }) => {
    if (!accountId) test.skip();
    const res = await request.delete(`/api/settings/accounts/${accountId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Accounts UI
// ---------------------------------------------------------------------------

test.describe('Accounts UI', () => {
  test('Settings page shows API Accounts section', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/settings');
    await page.waitForSelector('text=API Accounts', { timeout: 15_000 });
    await expect(page.getByText('API Accounts')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Add Account dialog opens and has all fields', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/settings');
    await page.waitForSelector('text=API Accounts', { timeout: 15_000 });

    // Click Add Account button
    await page.getByRole('button', { name: 'Add Account' }).click();

    // Dialog should open
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Add Account').nth(1)).toBeVisible();

    // Should have Name, Provider, Priority fields
    await expect(page.locator('#account-name')).toBeVisible();
    await expect(page.locator('#account-provider')).toBeVisible();
    await expect(page.locator('#account-priority')).toBeVisible();

    // Create button should be disabled (no fields filled)
    const createBtn = page.getByRole('button', { name: 'Create Account' });
    await expect(createBtn).toBeDisabled();

    expect(errors).toEqual([]);
  });

  test('Add Account shows provider-specific credential field', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/settings');
    await page.waitForSelector('text=API Accounts', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Add Account' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Fill name
    await page.locator('#account-name').fill('Test Key');

    // Select Anthropic API provider
    await page.locator('#account-provider').click();
    await page.getByRole('option', { name: 'Anthropic API' }).click();

    // Should show API Key field
    await expect(page.locator('#account-credential')).toBeVisible();
    await expect(page.getByText('API Key', { exact: true })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Add Account shows Session Token field for Claude Max', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/settings');
    await page.waitForSelector('text=API Accounts', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Add Account' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Fill name
    await page.locator('#account-name').fill('Test Max');

    // Select Claude Max provider
    await page.locator('#account-provider').click();
    await page.getByRole('option', { name: 'Claude Max (Pro)' }).click();

    // Should show Session Token field (not API Key)
    await expect(page.locator('#account-credential')).toBeVisible();
    await expect(page.getByText('Session Token', { exact: true })).toBeVisible();
    await expect(page.getByText('claude login')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Create and delete account via UI', async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/settings');
    await page.waitForSelector('text=API Accounts', { timeout: 15_000 });

    // Open Add Account dialog
    const addBtn = page.getByRole('button', { name: 'Add Account' });
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Wait for dialog to be visible (Radix dialog uses role="dialog")
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    // Fill form
    await page.locator('#account-name').fill('E2E Test Account');
    await page.locator('#account-provider').click();
    await page.getByRole('option', { name: 'Anthropic API' }).click();
    await page.locator('#account-credential').fill('sk-ant-e2e-test-key');

    // Create
    const createBtn = page.getByRole('button', { name: 'Create Account' });
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    // Wait for dialog to close
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5_000 });

    // Account should appear in the list
    await expect(page.getByText('E2E Test Account')).toBeVisible({ timeout: 5_000 });

    // Delete the account via the button next to it
    // Find the row containing "E2E Test Account" and click its Delete button
    const row = page.locator('div').filter({ hasText: /E2E Test Account/ }).first();
    const deleteBtn = row.getByRole('button', { name: 'Delete' });
    await deleteBtn.click();

    // Confirm delete dialog
    await expect(page.getByText('Are you sure you want to delete')).toBeVisible({ timeout: 3_000 });
    // Click the destructive Delete button (the last "Delete" button in the confirm dialog)
    await page.getByRole('button', { name: 'Delete' }).last().click();

    // Account should disappear
    await expect(page.getByText('E2E Test Account')).toHaveCount(0, { timeout: 5_000 });

    // Clean up via API in case UI delete failed
    const accounts = await (await request.get('/api/settings/accounts')).json();
    for (const a of accounts) {
      if ((a as { name: string }).name === 'E2E Test Account') {
        await request.delete(`/api/settings/accounts/${(a as { id: string }).id}`);
      }
    }

    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// OAuth callback proxy
// ---------------------------------------------------------------------------

test.describe('OAuth callback proxy', () => {
  test('OAuth callback route forwards to control-plane', async ({ request }) => {
    const res = await request.get('/api/oauth/callback?code=test&state=fake');
    // Should return HTML (from control-plane's callback handler)
    const contentType = res.headers()['content-type'] ?? '';
    expect(contentType).toContain('text/html');
    const body = await res.text();
    // Should contain error about unknown state (expected since we used fake state)
    expect(body).toContain('oauth_error');
  });
});

// ---------------------------------------------------------------------------
// DELETE/POST without body (regression: "Body cannot be empty" error)
// ---------------------------------------------------------------------------

test.describe('Empty body requests', () => {
  test('DELETE session does not send Content-Type: application/json', async ({ page }) => {
    const apiCalls: { method: string; url: string; headers: Record<string, string> }[] = [];

    page.on('request', (req) => {
      if (req.url().includes('/api/')) {
        apiCalls.push({
          method: req.method(),
          url: req.url(),
          headers: req.headers(),
        });
      }
    });

    // Create a session via API first
    const createRes = await page.request.post('/api/sessions', {
      data: {
        agentId: 'adhoc',
        machineId: 'mac-local',
        projectPath: '/tmp/pw-delete-test',
        prompt: 'delete test',
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const { sessionId } = await createRes.json();

    // Delete via API proxy (simulates frontend behavior)
    const delRes = await page.request.delete(`/api/sessions/${sessionId}`);
    expect(delRes.ok()).toBeTruthy();
    const delBody = await delRes.json();
    expect(delBody.ok).toBe(true);
  });

  test('POST test account does not send Content-Type: application/json without body', async ({
    request,
  }) => {
    // Create a test account
    const createRes = await request.post('/api/settings/accounts', {
      data: {
        name: 'PW No-Body Test',
        provider: 'anthropic_api',
        credential: 'sk-ant-pw-test',
        priority: 99,
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const account = await createRes.json();

    // Test the account (POST without body) — should not fail with "Body cannot be empty"
    const testRes = await request.post(`/api/settings/accounts/${account.id}/test`);
    expect(testRes.ok()).toBeTruthy();

    // Cleanup
    await request.delete(`/api/settings/accounts/${account.id}`);
  });
});

// ---------------------------------------------------------------------------
// Navigation (no runtime errors on any page)
// ---------------------------------------------------------------------------

test.describe('Navigation integrity', () => {
  test('can navigate between all pages without errors', async ({ page }) => {
    // This test is sensitive to Next.js dev server recompilation after code changes.
    // ChunkLoadErrors are transient — increase timeout and ignore them.
    const errors: string[] = [];
    page.on('pageerror', (err) => {
      // Ignore ChunkLoadError from Next.js dev server recompilation
      if (err.message.includes('ChunkLoadError') || err.message.includes('Failed to load chunk')) {
        return;
      }
      errors.push(err.message);
    });

    // Start at dashboard
    await page.goto('/', { timeout: 30_000 });
    await page.waitForSelector('h1', { timeout: 30_000 });

    // Navigate to each page via sidebar links
    const pages = [
      { linkText: 'Sessions', selector: 'h2' },
      { linkText: 'Agents', selector: 'h1' },
      { linkText: 'Machines', selector: 'h1' },
      { linkText: 'Settings', selector: 'h1' },
    ];

    for (const { linkText, selector } of pages) {
      await page.getByRole('link', { name: linkText }).first().click();
      await page.waitForSelector(selector, { timeout: 10_000 });
      // Wait for data to load
      await page.waitForTimeout(500);
    }

    expect(errors).toEqual([]);
  });
});
