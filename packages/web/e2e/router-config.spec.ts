import { expect, type Page, type Route, test } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

type LitellmState = 'ok' | 'missing' | 'error';
type ModelInfoMode = 'success' | 'empty' | 'not-found';

type RouterMockState = {
  healthCalls: number;
  modelInfoCalls: number;
  litellm: LitellmState;
  modelInfoMode: ModelInfoMode;
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function makeRouterState(overrides: Partial<RouterMockState> = {}): RouterMockState {
  return {
    healthCalls: 0,
    modelInfoCalls: 0,
    litellm: 'ok',
    modelInfoMode: 'success',
    ...overrides,
  };
}

function makeHealthResponse(state: RouterMockState) {
  if (state.litellm === 'missing') {
    return {
      ok: true,
      status: 'ok',
      dependencies: {},
    };
  }

  return {
    ok: state.litellm === 'ok',
    status: state.litellm === 'ok' ? 'ok' : 'degraded',
    dependencies: {
      litellm:
        state.litellm === 'ok'
          ? { status: 'ok', latencyMs: 42 }
          : { status: 'error', error: 'Connection refused', latencyMs: 0 },
    },
  };
}

function makeModelsInfoResponse() {
  return {
    deployments: [
      {
        modelName: 'sonnet-fast',
        litellmParams: { model: 'bedrock/anthropic.claude-3-5-sonnet' },
        modelInfo: {
          input_cost_per_token: 0.000003,
          output_cost_per_token: 0.000015,
        },
      },
      {
        modelName: 'gpt-fallback',
        litellmParams: { model: 'openai/gpt-4.1' },
        modelInfo: {},
      },
    ],
  };
}

async function mockRouterConfigApis(page: Page, state: RouterMockState): Promise<void> {
  await page.route('**/health?**', async (route) => {
    state.healthCalls += 1;
    await fulfillJson(route, makeHealthResponse(state));
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const { pathname } = url;

    if (method === 'GET' && pathname === '/api/router/models/info') {
      state.modelInfoCalls += 1;
      if (state.modelInfoMode === 'not-found') {
        await fulfillJson(route, { error: 'LiteLLM model info unavailable' }, 404);
        return;
      }

      await fulfillJson(route, state.modelInfoMode === 'empty' ? { deployments: [] } : makeModelsInfoResponse());
      return;
    }

    if (method === 'GET' && pathname === '/api/permission-requests') {
      await fulfillJson(route, []);
      return;
    }

    if (method === 'GET' && pathname === '/api/sync/conflicts/count') {
      await fulfillJson(route, { count: 0 });
      return;
    }

    await fulfillJson(route, method === 'GET' ? [] : {});
  });
}

test.describe('Router config page', () => {
  test('renders connected LiteLLM status and configured model cards without a backend', async ({
    page,
  }) => {
    const state = makeRouterState();
    await mockRouterConfigApis(page, state);

    await page.goto('/settings/router');

    await expect(page.getByRole('heading', { name: 'LiteLLM Router' })).toBeVisible();
    await expect(page.getByText('Connected')).toBeVisible();
    await expect(page.getByText('42ms')).toBeVisible();
    const sonnetCard = page.locator('div.rounded-md').filter({ hasText: 'sonnet-fast' });
    await expect(sonnetCard.getByText('sonnet-fast')).toBeVisible();
    await expect(sonnetCard.getByText('bedrock/anthropic.claude-3-5-sonnet')).toBeVisible();
    await expect(sonnetCard.getByText('AWS Bedrock')).toBeVisible();

    const fallbackCard = page.locator('div.rounded-md').filter({ hasText: 'gpt-fallback' });
    await expect(fallbackCard.getByText('gpt-fallback')).toBeVisible();
    await expect(fallbackCard.getByText('OpenAI')).toBeVisible();
    await expect(page.getByText(/\$0\.000003\/tok in/)).toBeVisible();
    await expect(page.getByText(/\$0\.000015\/tok out/)).toBeVisible();
    await expect(page.getByText('Failover Strategy')).toBeVisible();
  });

  test('explains the not-configured state when LiteLLM health is absent', async ({ page }) => {
    const state = makeRouterState({ litellm: 'missing', modelInfoMode: 'not-found' });
    await mockRouterConfigApis(page, state);

    await page.goto('/settings/router');

    await expect(page.getByText('Not configured', { exact: true })).toBeVisible();
    await expect(page.getByText(/LiteLLM proxy is not configured/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  });

  test('recovers model info via inline retry and refreshes both router queries', async ({ page }) => {
    const state = makeRouterState({ modelInfoMode: 'not-found' });
    await mockRouterConfigApis(page, state);

    await page.goto('/settings/router');

    await expect(page.getByText('Failed to load model info from LiteLLM.')).toBeVisible();
    expect(state.modelInfoCalls).toBe(1);

    state.modelInfoMode = 'success';
    await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/router/models/info' &&
          response.request().method() === 'GET' &&
          response.status() === 200,
      ),
      page.getByRole('button', { name: 'Retry', exact: true }).click(),
    ]);

    await expect(page.getByText('sonnet-fast')).toBeVisible();

    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/health?detail=true')),
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/router/models/info' &&
          response.request().method() === 'GET',
      ),
      page.getByRole('button', { name: 'Refresh', exact: true }).click(),
    ]);

    await expect.poll(() => state.healthCalls).toBeGreaterThanOrEqual(2);
    await expect.poll(() => state.modelInfoCalls).toBeGreaterThanOrEqual(3);
  });
});
