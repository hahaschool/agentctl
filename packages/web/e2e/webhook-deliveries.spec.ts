import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * E2E coverage for the Webhook delivery history drawer (`/webhooks`).
 * Mocks all `/api/**` traffic — only needs the Next.js dev server on $WEB_PORT.
 * Primary endpoint under test: GET /api/webhooks/:id/deliveries.
 */

type WebhookProvider = 'slack' | 'discord' | 'generic';

type WebhookEventType =
  | 'agent.started'
  | 'agent.stopped'
  | 'agent.error'
  | 'agent.cost_alert'
  | 'approval.pending'
  | 'deploy.success'
  | 'deploy.failure'
  | 'audit.high_severity';

type Webhook = {
  id: string;
  url: string;
  provider: WebhookProvider;
  secret: string | null;
  eventTypes: WebhookEventType[];
  agentFilter: string[] | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type Delivery = {
  id: string;
  subscriptionId: string;
  eventType: string;
  status: 'pending' | 'delivered' | 'failed';
  statusCode: number | null;
  responseBody: string | null;
  payload?: Record<string, unknown> | null;
  attempts?: number | null;
  nextRetryAt?: string | null;
  createdAt: string;
  deliveredAt: string | null;
};

type MockState = {
  webhooks: Webhook[];
  deliveriesById: Map<string, Delivery[]>;
  deliveriesCalls: string[];
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function makeWebhook(overrides: Partial<Webhook> = {}): Webhook {
  const now = new Date(Date.now() - 5 * 60_000).toISOString();
  return {
    id: 'wh-1',
    url: 'https://example.com/hook',
    provider: 'generic',
    secret: null,
    eventTypes: ['agent.started'],
    agentFilter: null,
    active: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  const now = new Date(Date.now() - 2 * 60_000).toISOString();
  return {
    id: 'd-1',
    subscriptionId: 'wh-1',
    eventType: 'agent.started',
    status: 'delivered',
    statusCode: 200,
    responseBody: '{"ok":true}',
    payload: { agentId: 'agent-1', action: 'started' },
    attempts: 1,
    nextRetryAt: null,
    createdAt: now,
    deliveredAt: now,
    ...overrides,
  };
}

async function mountApiMocks(page: Page, state: MockState): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const { pathname } = url;

    if (method === 'GET' && pathname === '/api/webhooks') {
      await fulfillJson(route, { subscriptions: state.webhooks, limit: 50, offset: 0 });
      return;
    }

    const deliveriesMatch = pathname.match(/^\/api\/webhooks\/([^/]+)\/deliveries$/);
    if (method === 'GET' && deliveriesMatch) {
      const id = decodeURIComponent(deliveriesMatch[1] ?? '');
      state.deliveriesCalls.push(id);
      const deliveries = state.deliveriesById.get(id) ?? [];
      await fulfillJson(route, { deliveries });
      return;
    }

    // Safe empty payloads for shell boot.
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

    throw new Error(`Unhandled API request in webhook-deliveries e2e mock: ${method} ${pathname}`);
  });
}

test.describe('Webhook deliveries drawer', () => {
  test('opens the deliveries dialog when the Deliveries button is clicked and triggers a GET', async ({
    page,
  }) => {
    const deliveries: Delivery[] = [makeDelivery({ id: 'd-open' })];
    const state: MockState = {
      webhooks: [makeWebhook({ id: 'wh-open', url: 'https://example.com/open' })],
      deliveriesById: new Map([['wh-open', deliveries]]),
      deliveriesCalls: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/webhooks');

    await expect(page.getByRole('row').filter({ hasText: 'wh-open' })).toBeVisible();

    const deliveriesRequest = page.waitForRequest(
      (r) =>
        r.method() === 'GET' && new URL(r.url()).pathname === '/api/webhooks/wh-open/deliveries',
    );
    await page.getByTestId('deliveries-wh-open').click();
    await deliveriesRequest;

    const dialog = page.getByTestId('webhook-deliveries-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Delivery history' })).toBeVisible();
    await expect(dialog).toContainText('https://example.com/open');
    expect(state.deliveriesCalls).toEqual(['wh-open']);
  });

  test('renders each delivery row with event type, status, status code, and attempts', async ({
    page,
  }) => {
    const deliveries: Delivery[] = [
      makeDelivery({
        id: 'd-ok',
        eventType: 'agent.started',
        status: 'delivered',
        statusCode: 200,
        attempts: 1,
      }),
      makeDelivery({
        id: 'd-fail',
        eventType: 'deploy.failure',
        status: 'failed',
        statusCode: 502,
        attempts: 4,
      }),
    ];
    const state: MockState = {
      webhooks: [makeWebhook({ id: 'wh-list' })],
      deliveriesById: new Map([['wh-list', deliveries]]),
      deliveriesCalls: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/webhooks');
    await page.getByTestId('deliveries-wh-list').click();

    const panel = page.getByTestId('webhook-deliveries-panel');
    await expect(panel).toBeVisible();

    // Row count reflects the delivery array length.
    await expect(panel).toContainText('Recent deliveries');

    const okRow = page.getByTestId('delivery-row-d-ok');
    await expect(okRow).toContainText('agent.started');
    await expect(okRow).toContainText('delivered');
    await expect(okRow).toContainText('200');
    await expect(okRow).toContainText('×1');

    const failRow = page.getByTestId('delivery-row-d-fail');
    await expect(failRow).toContainText('deploy.failure');
    await expect(failRow).toContainText('failed');
    await expect(failRow).toContainText('502');
    await expect(failRow).toContainText('×4');
  });

  test('expanding a delivery row reveals the payload and response JSON', async ({ page }) => {
    const deliveries: Delivery[] = [
      makeDelivery({
        id: 'd-expand',
        payload: { agentId: 'agent-42', eventKey: 'signal-roll' },
        responseBody: '{"accepted":true}',
      }),
    ];
    const state: MockState = {
      webhooks: [makeWebhook({ id: 'wh-expand' })],
      deliveriesById: new Map([['wh-expand', deliveries]]),
      deliveriesCalls: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/webhooks');
    await page.getByTestId('deliveries-wh-expand').click();

    const row = page.getByTestId('delivery-row-d-expand');
    const toggle = row.getByRole('button');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const payload = page.getByTestId('delivery-payload-d-expand');
    await expect(payload).toBeVisible();
    await expect(payload).toContainText('"agentId": "agent-42"');
    await expect(payload).toContainText('"eventKey": "signal-roll"');

    const response = page.getByTestId('delivery-response-d-expand');
    await expect(response).toContainText('"accepted": true');
  });

  test('shows the empty state when the subscription has no deliveries', async ({ page }) => {
    const state: MockState = {
      webhooks: [makeWebhook({ id: 'wh-empty' })],
      deliveriesById: new Map([['wh-empty', []]]),
      deliveriesCalls: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/webhooks');
    await page.getByTestId('deliveries-wh-empty').click();

    const empty = page.getByTestId('deliveries-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No deliveries yet.');

    // No row elements should exist when empty.
    await expect(page.locator('[data-testid^="delivery-row-"]')).toHaveCount(0);
  });
});
