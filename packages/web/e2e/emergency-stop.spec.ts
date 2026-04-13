import { expect, type Page, type Route, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Emergency stop UI — covers per-agent + fleet-wide kill buttons.
// Mocks /api/agents listing and the two emergency-stop endpoints.
// ---------------------------------------------------------------------------

type EmergencyStopAllResponse = {
  ok: boolean;
  results: { machineId: string; stoppedCount: number; error?: string }[];
};

const RUNNING_AGENT = {
  id: 'agent-running-1',
  machineId: 'machine-1',
  name: 'nightly-reviewer',
  type: 'manual' as const,
  runtime: 'claude-code' as const,
  status: 'running' as const,
  schedule: null,
  projectPath: '/tmp/proj',
  worktreeBranch: 'main',
  currentSessionId: 'sess-1',
  config: {},
  lastRunAt: '2026-04-12T10:00:00Z',
  lastCostUsd: 0.05,
  totalCostUsd: 1.25,
  accountId: null,
  createdAt: '2026-04-01T00:00:00Z',
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function interceptApi(
  page: Page,
  options: {
    onPerAgentStop?: (agentId: string) => void;
    onFleetStop?: () => EmergencyStopAllResponse;
    perAgentResponse?: { status?: number; body?: unknown };
  } = {},
): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/agents') {
      await fulfillJson(route, [RUNNING_AGENT]);
      return;
    }

    if (method === 'GET' && url.pathname === `/api/agents/${RUNNING_AGENT.id}`) {
      await fulfillJson(route, RUNNING_AGENT);
      return;
    }

    if (method === 'GET' && url.pathname === `/api/agents/${RUNNING_AGENT.id}/runs`) {
      await fulfillJson(route, []);
      return;
    }

    if (method === 'GET' && url.pathname === `/api/agents/${RUNNING_AGENT.id}/health`) {
      await fulfillJson(route, {
        consecutiveFailures: 0,
        failureRate24h: 0,
        lastSuccessAt: null,
        status: 'healthy',
      });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/machines') {
      await fulfillJson(route, []);
      return;
    }

    if (method === 'GET' && url.pathname === '/api/settings/accounts') {
      await fulfillJson(route, []);
      return;
    }

    if (method === 'GET' && url.pathname === '/api/sessions') {
      await fulfillJson(route, { sessions: [], total: 0, limit: 100, offset: 0, hasMore: false });
      return;
    }

    const perAgentMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/emergency-stop$/);
    if (method === 'POST' && perAgentMatch) {
      const agentId = decodeURIComponent(perAgentMatch[1] ?? '');
      options.onPerAgentStop?.(agentId);
      const status = options.perAgentResponse?.status ?? 200;
      const body = options.perAgentResponse?.body ?? { ok: true };
      await fulfillJson(route, body, status);
      return;
    }

    if (method === 'POST' && url.pathname === '/api/agents/emergency-stop-all') {
      const body = options.onFleetStop?.() ?? {
        ok: true,
        results: [{ machineId: 'm-1', stoppedCount: 3 }],
      };
      await fulfillJson(route, body);
      return;
    }

    // Allow other unrelated endpoints to pass through with empty defaults so
    // peripheral hooks (memory, mcp, etc.) on /agents don't blow up the page.
    await fulfillJson(route, []);
  });
}

test.describe('Emergency stop UI', () => {
  test('fleet button requires the typed phrase before posting', async ({ page }) => {
    let fleetCalled = 0;
    await interceptApi(page, {
      onFleetStop: () => {
        fleetCalled += 1;
        return { ok: true, results: [{ machineId: 'm-1', stoppedCount: 2 }] };
      },
    });

    await page.goto('/agents');
    await expect(page.getByRole('heading', { name: /agents/i })).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('emergency-stop-all-button').click();
    await expect(page.getByTestId('emergency-stop-all-dialog')).toBeVisible();

    // Confirm button is disabled until the operator types STOP ALL.
    const confirm = page.getByTestId('emergency-stop-all-confirm');
    await expect(confirm).toBeDisabled();

    await page.getByTestId('emergency-stop-all-phrase').fill('STOP ALL');
    await expect(confirm).toBeEnabled();

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/api/agents/emergency-stop-all') && r.request().method() === 'POST',
      ),
      confirm.click(),
    ]);

    expect(fleetCalled).toBe(1);
  });

  test('per-agent button posts to the emergency-stop endpoint after confirming', async ({
    page,
  }) => {
    const stoppedAgents: string[] = [];
    await interceptApi(page, {
      onPerAgentStop: (agentId) => {
        stoppedAgents.push(agentId);
      },
    });

    await page.goto(`/agents/${RUNNING_AGENT.id}`);
    await expect(
      page.getByRole('heading', { name: new RegExp(RUNNING_AGENT.name, 'i') }).first(),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('emergency-stop-button').click();
    await expect(page.getByTestId('emergency-stop-dialog')).toBeVisible();

    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/api/agents/${RUNNING_AGENT.id}/emergency-stop`) &&
          r.request().method() === 'POST',
      ),
      page.getByTestId('emergency-stop-confirm').click(),
    ]);

    expect(stoppedAgents).toEqual([RUNNING_AGENT.id]);
  });
});
