import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * E2E coverage for the Webhooks page (`/webhooks`).
 * Mocks all `/api/**` traffic — only needs the Next.js dev server on $WEB_PORT.
 * Endpoints: GET/POST /api/webhooks, PATCH/DELETE /api/webhooks/:id, POST /api/webhooks/:id/test.
 */

type WebhookProvider = 'slack' | 'discord' | 'generic';

type WebhookEventType =
  | 'agent.started' | 'agent.stopped' | 'agent.error' | 'agent.cost_alert'
  | 'approval.pending' | 'deploy.success' | 'deploy.failure' | 'audit.high_severity';

type Webhook = {
  id: string; url: string; provider: WebhookProvider; secret: string | null;
  eventTypes: WebhookEventType[]; agentFilter: string[] | null; active: boolean;
  createdAt: string; updatedAt: string;
};

type CreateBody = { url: string; provider?: WebhookProvider; eventTypes: WebhookEventType[]; secret?: string };

type UpdateBody = {
  url?: string;
  provider?: WebhookProvider;
  eventTypes?: WebhookEventType[];
  secret?: string | null;
  active?: boolean;
};

type Delivery = {
  id: string; subscriptionId: string; eventType: string; status: string;
  statusCode: number | null; responseBody: string | null;
  createdAt: string; deliveredAt: string | null;
};

type TestResponse = { ok: boolean; delivery: Delivery };

type MockState = {
  webhooks: Webhook[];
  createCalls: CreateBody[];
  updateCalls: Array<{ id: string; body: UpdateBody }>;
  deleteCalls: string[];
  testCalls: string[];
  testResponses: Map<string, TestResponse>;
};

function emptyState(webhooks: Webhook[] = []): MockState {
  return {
    webhooks,
    createCalls: [],
    updateCalls: [],
    deleteCalls: [],
    testCalls: [],
    testResponses: new Map(),
  };
}

function makeWebhook(overrides: Partial<Webhook> = {}): Webhook {
  const now = new Date(Date.now() - 5 * 60_000).toISOString();
  return {
    id: 'wh-1',
    url: 'https://example.com/hook',
    provider: 'generic',
    secret: null,
    eventTypes: ['agent.started', 'agent.stopped'],
    agentFilter: null,
    active: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mountApiMocks(page: Page, state: MockState): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const { pathname } = url;

    if (method === 'GET' && pathname === '/api/webhooks') {
      await fulfillJson(route, { subscriptions: state.webhooks, limit: 50, offset: 0 });
      return;
    }

    if (method === 'POST' && pathname === '/api/webhooks') {
      const body = (req.postDataJSON() ?? {}) as CreateBody;
      state.createCalls.push(body);
      const created: Webhook = makeWebhook({
        id: `wh-${state.webhooks.length + 1}`,
        url: body.url,
        provider: body.provider ?? 'generic',
        eventTypes: body.eventTypes,
      });
      state.webhooks = [...state.webhooks, created];
      await fulfillJson(route, { ok: true, subscription: created }, 201);
      return;
    }

    const idMatch = pathname.match(/^\/api\/webhooks\/([^/]+)$/);
    if (method === 'PATCH' && idMatch) {
      const id = decodeURIComponent(idMatch[1] ?? '');
      const body = (req.postDataJSON() ?? {}) as UpdateBody;
      state.updateCalls.push({ id, body });

      const existing = state.webhooks.find((w) => w.id === id);
      if (!existing) {
        await fulfillJson(route, { error: 'Webhook not found' }, 404);
        return;
      }

      const updated: Webhook = {
        ...existing,
        url: body.url ?? existing.url,
        provider: body.provider ?? existing.provider,
        secret: body.secret ?? existing.secret,
        eventTypes: body.eventTypes ?? existing.eventTypes,
        active: body.active ?? existing.active,
        updatedAt: new Date().toISOString(),
      };
      state.webhooks = state.webhooks.map((w) => (w.id === id ? updated : w));
      await fulfillJson(route, { ok: true, subscription: updated });
      return;
    }

    if (method === 'DELETE' && idMatch) {
      const id = decodeURIComponent(idMatch[1] ?? '');
      state.deleteCalls.push(id);
      state.webhooks = state.webhooks.filter((w) => w.id !== id);
      await fulfillJson(route, { ok: true, deletedId: id });
      return;
    }

    const testMatch = pathname.match(/^\/api\/webhooks\/([^/]+)\/test$/);
    if (method === 'POST' && testMatch) {
      const id = decodeURIComponent(testMatch[1] ?? '');
      state.testCalls.push(id);
      const now = new Date().toISOString();
      const response = state.testResponses.get(id) ?? {
        ok: true,
        delivery: {
          id: 'd-1',
          subscriptionId: id,
          eventType: 'test',
          status: 'delivered',
          statusCode: 200,
          responseBody: null,
          createdAt: now,
          deliveredAt: now,
        },
      };
      await fulfillJson(route, response);
      return;
    }

    // Safe empty payloads for explicit shell/sidebar/bell boot requests.
    if (method === 'GET' && pathname === '/api/permission-requests') {
      await fulfillJson(route, []);
      return;
    }
    if (method === 'GET' && pathname === '/api/sync/conflicts/count') {
      await fulfillJson(route, { count: 0 });
      return;
    }
    if (method === 'GET' && pathname === '/api/agents') {
      await fulfillJson(route, []);
      return;
    }
    if (method === 'GET' && pathname === '/api/sessions') {
      await fulfillJson(route, { sessions: [], total: 0, limit: 50, offset: 0, hasMore: false });
      return;
    }
    if (method === 'GET' && pathname === '/api/runtime-sessions') {
      await fulfillJson(route, { sessions: [], count: 0 });
      return;
    }
    if (method === 'GET' && pathname === '/api/settings/accounts') {
      await fulfillJson(route, []);
      return;
    }
    if (method === 'GET' && pathname === '/api/health') {
      await fulfillJson(route, { ok: true, status: 'healthy' });
      return;
    }
    if (method === 'GET' && pathname === '/api/version-compat') {
      await fulfillJson(route, {
        appVersion: '0.4.0',
        gitSha: 'test',
        schemaVersion: 26,
        minSupportedMobileBuild: 0,
        minSupportedWebBuild: 0,
      });
      return;
    }

    throw new Error(`Unhandled API request in webhooks e2e mock: ${method} ${pathname}`);
  });
}

test.describe('Webhooks page', () => {
  test('renders webhook rows with provider, URL, events, and state columns', async ({ page }) => {
    const webhooks: Webhook[] = [
      makeWebhook({
        id: 'wh-slack',
        url: 'https://hooks.slack.com/services/T/B/XYZ',
        provider: 'slack',
        eventTypes: ['agent.started', 'deploy.success'],
        active: true,
      }),
      makeWebhook({
        id: 'wh-paused',
        url: 'https://example.com/paused',
        provider: 'generic',
        eventTypes: ['agent.error'],
        active: false,
      }),
    ];
    await mountApiMocks(page, emptyState(webhooks));

    await page.goto('/webhooks');

    await expect(page.getByRole('heading', { name: 'Webhooks' })).toBeVisible();
    await expect(page.getByText('1 / 2 active', { exact: true })).toBeVisible();

    const table = page.getByRole('table', { name: 'Webhook subscriptions' });
    await expect(table).toBeVisible();

    for (const header of ['Provider / ID', 'URL', 'Events', 'State', 'Created', 'Updated', 'Actions']) {
      await expect(table.getByRole('columnheader', { name: header })).toBeVisible();
    }

    const slackRow = table.getByRole('row').filter({ hasText: 'wh-slack' });
    await expect(slackRow.getByText('slack', { exact: true })).toBeVisible();
    await expect(slackRow.getByText('https://hooks.slack.com/services/T/B/XYZ')).toBeVisible();
    await expect(slackRow.getByText('agent.started', { exact: true })).toBeVisible();
    await expect(slackRow.getByText('deploy.success', { exact: true })).toBeVisible();
    await expect(slackRow.getByText('Active', { exact: true })).toBeVisible();

    const pausedRow = table.getByRole('row').filter({ hasText: 'wh-paused' });
    await expect(pausedRow.getByText('Paused', { exact: true })).toBeVisible();
  });

  test('Add Webhook dialog submits a POST with the filled payload and refreshes the list', async ({
    page,
  }) => {
    const state = emptyState();
    await mountApiMocks(page, state);

    await page.goto('/webhooks');

    await expect(page.getByText('No webhook subscriptions yet')).toBeVisible();
    await page.getByTestId('add-webhook').click();

    const dialog = page.getByTestId('webhook-form-dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('#webhook-url').fill('https://example.com/new-hook');
    await dialog.locator('#webhook-provider').selectOption('discord');
    await dialog.getByTestId('event-agent.started').check();
    await dialog.getByTestId('event-deploy.failure').check();

    const createRequest = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/webhooks',
    );
    await dialog.getByTestId('webhook-submit').click();
    await createRequest;

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('alert').filter({ hasText: /created/i })).toBeVisible();

    expect(state.createCalls).toHaveLength(1);
    const sent = state.createCalls[0];
    expect(sent?.url).toBe('https://example.com/new-hook');
    expect(sent?.provider).toBe('discord');
    expect(sent?.eventTypes).toEqual(
      expect.arrayContaining(['agent.started', 'deploy.failure'] satisfies WebhookEventType[]),
    );
    expect(sent?.eventTypes).toHaveLength(2);

    // The list reflects the new row after refetch.
    const table = page.getByRole('table', { name: 'Webhook subscriptions' });
    await expect(table.getByRole('row').filter({ hasText: 'https://example.com/new-hook' })).toBeVisible();
  });

  test('Form validation blocks submit when URL is empty', async ({ page }) => {
    const state = emptyState();
    await mountApiMocks(page, state);

    await page.goto('/webhooks');
    await page.getByTestId('add-webhook').click();

    const dialog = page.getByTestId('webhook-form-dialog');
    await expect(dialog).toBeVisible();

    // Submit with empty URL + no events selected → validation error shown, no POST fired.
    await dialog.getByTestId('webhook-submit').click();

    await expect(dialog.getByTestId('form-error')).toHaveText(/URL is required/i);
    expect(state.createCalls).toHaveLength(0);
    await expect(dialog).toBeVisible();
  });

  test('Edit Webhook dialog submits a PATCH and refreshes the row', async ({ page }) => {
    const state = emptyState([
      makeWebhook({
        id: 'wh-edit-me',
        url: 'https://example.com/old',
        provider: 'slack',
        eventTypes: ['agent.started'],
        active: true,
      }),
    ]);
    await mountApiMocks(page, state);

    await page.goto('/webhooks');
    await page.getByTestId('edit-wh-edit-me').click();

    const dialog = page.getByTestId('webhook-form-dialog');
    await expect(dialog.getByRole('heading', { name: 'Edit webhook' })).toBeVisible();

    await dialog.locator('#webhook-url').fill('https://example.com/updated');
    await dialog.locator('#webhook-provider').selectOption('discord');
    await dialog.getByTestId('event-agent.started').uncheck();
    await dialog.getByTestId('event-deploy.failure').check();
    await dialog.getByTestId('webhook-active').uncheck();

    const patchRequest = page.waitForRequest(
      (r) => r.method() === 'PATCH' && new URL(r.url()).pathname === '/api/webhooks/wh-edit-me',
    );
    await dialog.getByTestId('webhook-submit').click();
    await patchRequest;

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('alert').filter({ hasText: /updated/i })).toBeVisible();

    expect(state.updateCalls).toHaveLength(1);
    expect(state.updateCalls[0]).toEqual({
      id: 'wh-edit-me',
      body: {
        url: 'https://example.com/updated',
        provider: 'discord',
        eventTypes: ['deploy.failure'],
        active: false,
      },
    });

    const updatedRow = page.getByRole('table', { name: 'Webhook subscriptions' }).getByRole('row').filter({
      hasText: 'wh-edit-me',
    });
    await expect(updatedRow.getByText('discord', { exact: true })).toBeVisible();
    await expect(updatedRow.getByText('https://example.com/updated')).toBeVisible();
    await expect(updatedRow.getByText('deploy.failure', { exact: true })).toBeVisible();
    await expect(updatedRow.getByText('Paused', { exact: true })).toBeVisible();
  });

  test('Delete requires confirmation and issues a DELETE request', async ({ page }) => {
    const hook = makeWebhook({ id: 'wh-delete-me', url: 'https://example.com/gone' });
    const state = emptyState([hook]);
    await mountApiMocks(page, state);

    await page.goto('/webhooks');
    await expect(page.getByRole('row').filter({ hasText: 'wh-delete-me' })).toBeVisible();

    await page.getByTestId('delete-wh-delete-me').click();

    const confirm = page.getByTestId('webhook-delete-confirm');
    await expect(confirm).toBeVisible();

    const deleteRequest = page.waitForRequest(
      (r) =>
        r.method() === 'DELETE' &&
        new URL(r.url()).pathname === '/api/webhooks/wh-delete-me',
    );
    await confirm.getByTestId('confirm-delete').click();
    await deleteRequest;

    expect(state.deleteCalls).toEqual(['wh-delete-me']);
    await expect(page.getByRole('alert').filter({ hasText: /deleted/i })).toBeVisible();
    await expect(page.getByText('No webhook subscriptions yet')).toBeVisible();
  });

  test('Test button calls /test and toasts success vs. failure appropriately', async ({ page }) => {
    const now = new Date().toISOString();
    const failResponse: TestResponse = {
      ok: false,
      delivery: {
        id: 'd-fail',
        subscriptionId: 'wh-fail',
        eventType: 'test',
        status: 'failed',
        statusCode: 502,
        responseBody: 'bad gateway',
        createdAt: now,
        deliveredAt: null,
      },
    };
    const state = emptyState([
      makeWebhook({ id: 'wh-ok', url: 'https://example.com/ok' }),
      makeWebhook({ id: 'wh-fail', url: 'https://example.com/fail' }),
    ]);
    state.testResponses.set('wh-fail', failResponse);
    await mountApiMocks(page, state);

    await page.goto('/webhooks');

    const okRequest = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/webhooks/wh-ok/test',
    );
    await page.getByTestId('test-wh-ok').click();
    await okRequest;
    await expect(page.getByRole('alert').filter({ hasText: /delivered/i })).toBeVisible();

    const failRequest = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/webhooks/wh-fail/test',
    );
    await page.getByTestId('test-wh-fail').click();
    await failRequest;
    await expect(page.getByRole('alert').filter({ hasText: /failed \(502\)/i })).toBeVisible();

    expect(state.testCalls).toEqual(['wh-ok', 'wh-fail']);
  });
});
