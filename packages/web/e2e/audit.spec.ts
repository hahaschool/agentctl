import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * Backend-independent coverage for the Audit page (`/audit`).
 *
 * The spec mocks every `/api/**` request, so it only needs the Next.js dev
 * server on $WEB_PORT and never depends on live beta/dev control-plane services.
 */

type AuditAction = {
  id: string;
  runId: string;
  timestamp: string;
  actionType: string;
  toolName: string | null;
  toolInput: Record<string, unknown> | null;
  toolOutputHash: string | null;
  durationMs: number | null;
  approvedBy: string | null;
  agentId: string | null;
};

type AuditSummary = {
  totalActions: number;
  toolBreakdown: Record<string, number>;
  actionTypeBreakdown: Record<string, number>;
  avgDurationMs: number | null;
};

type SuspiciousSession = {
  sessionId: string;
  agentId: string | null;
  actionCount: number;
  firstEventAt: string | null;
  lastEventAt: string | null;
  suspiciousReasons: string[];
};

type AuditListCall = {
  agentId: string | null;
  tool: string | null;
  limit: string | null;
  offset: string | null;
};

type AuditSummaryCall = {
  agentId: string | null;
};

type MockState = {
  actions: AuditAction[];
  summary: AuditSummary;
  suspiciousSessions: SuspiciousSession[];
  listCalls: AuditListCall[];
  summaryCalls: AuditSummaryCall[];
  listStatus: number;
};

function makeAction(overrides: Partial<AuditAction> = {}): AuditAction {
  return {
    id: 'audit-1',
    runId: 'run-1',
    timestamp: '2026-04-14T08:00:00.000Z',
    actionType: 'tool_use',
    toolName: 'Read',
    toolInput: { path: '/repo/README.md' },
    toolOutputHash: 'sha256:read',
    durationMs: 120,
    approvedBy: null,
    agentId: 'agent-alpha',
    ...overrides,
  };
}

function makeSummary(overrides: Partial<AuditSummary> = {}): AuditSummary {
  return {
    totalActions: 0,
    toolBreakdown: {},
    actionTypeBreakdown: {},
    avgDurationMs: null,
    ...overrides,
  };
}

function makeState(actions: AuditAction[], summary: AuditSummary): MockState {
  return {
    actions,
    summary,
    suspiciousSessions: [],
    listCalls: [],
    summaryCalls: [],
    listStatus: 200,
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function filterActions(state: MockState, searchParams: URLSearchParams): AuditAction[] {
  const agentId = searchParams.get('agentId');
  const tool = searchParams.get('tool');

  return state.actions.filter((action) => {
    if (agentId && action.agentId !== agentId) return false;
    if (tool && action.toolName !== tool) return false;
    return true;
  });
}

async function mountApiMocks(page: Page, state: MockState): Promise<void> {
  await page.route('**/health?**', async (route) => {
    await fulfillJson(route, {
      status: 'ok',
      timestamp: '2026-04-14T08:00:00.000Z',
      dependencies: {},
    });
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const { pathname, searchParams } = url;

    if (method === 'GET' && pathname === '/api/audit') {
      state.listCalls.push({
        agentId: searchParams.get('agentId'),
        tool: searchParams.get('tool'),
        limit: searchParams.get('limit'),
        offset: searchParams.get('offset'),
      });

      if (state.listStatus >= 400) {
        await fulfillJson(
          route,
          { error: 'QUERY_FAILED', message: 'Failed to query audit actions' },
          state.listStatus,
        );
        return;
      }

      const actions = filterActions(state, searchParams);
      await fulfillJson(route, {
        actions,
        total: actions.length,
        hasMore: false,
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/audit/summary') {
      state.summaryCalls.push({ agentId: searchParams.get('agentId') });
      await fulfillJson(route, state.summary);
      return;
    }

    if (method === 'GET' && pathname === '/api/audit/suspicious') {
      await fulfillJson(route, state.suspiciousSessions);
      return;
    }

    // Safe payloads for app-shell boot requests.
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

    throw new Error(`Unhandled API request in audit e2e mock: ${method} ${pathname}`);
  });
}

test.describe('Audit page', () => {
  test('renders summary cards, sorted breakdowns, rows, and expanded row details', async ({
    page,
  }) => {
    const state = makeState(
      [
        makeAction({
          id: 'audit-bash',
          runId: 'run-bash',
          timestamp: '2026-04-14T08:02:00.000Z',
          actionType: 'tool_use',
          toolName: 'Bash',
          toolInput: { command: 'pnpm test:e2e' },
          toolOutputHash: 'sha256:bash',
          durationMs: 6400,
          approvedBy: 'operator-1',
          agentId: 'agent-beta',
        }),
        makeAction({
          id: 'audit-read',
          runId: 'run-read',
          timestamp: '2026-04-14T08:00:00.000Z',
          actionType: 'tool_result',
          toolName: 'Read',
          durationMs: 80,
          agentId: 'agent-alpha',
        }),
      ],
      makeSummary({
        totalActions: 9,
        avgDurationMs: 321.8,
        actionTypeBreakdown: { tool_result: 2, tool_use: 7 },
        toolBreakdown: { Read: 3, Bash: 6 },
      }),
    );
    await mountApiMocks(page, state);

    await page.goto('/audit');

    await expect(page.getByRole('heading', { name: 'Audit Trail' })).toBeVisible();
    await expect(page.getByTestId('audit-total-badge')).toHaveText(/9 actions/i);
    await expect(page.getByTestId('audit-summary-card')).toContainText('Total actions');
    await expect(page.getByTestId('audit-summary-card')).toContainText('avg 322ms');

    const summaryCard = page.getByTestId('audit-summary-card');
    await expect(summaryCard.getByText('tool_use')).toBeVisible();
    await expect(summaryCard.getByText('Bash')).toBeVisible();

    const summaryText = await summaryCard.innerText();
    expect(summaryText.indexOf('tool_use')).toBeLessThan(summaryText.indexOf('tool_result'));
    expect(summaryText.indexOf('Bash')).toBeLessThan(summaryText.indexOf('Read'));

    await expect(page.getByText('Showing 2 of 2')).toBeVisible();
    await expect(page.getByRole('button').filter({ hasText: 'Bash' })).toBeVisible();
    await expect(page.getByRole('button').filter({ hasText: 'Read' })).toBeVisible();

    await page.getByRole('button').filter({ hasText: 'Bash' }).click();

    await expect(page.getByText('Run ID:')).toBeVisible();
    await expect(page.getByText('run-bash')).toBeVisible();
    await expect(page.getByText('Approved By:')).toBeVisible();
    await expect(page.getByText('operator-1')).toBeVisible();
    await expect(page.getByText('"command": "pnpm test:e2e"')).toBeVisible();
  });

  test('trims agent and tool filters before sending audit query parameters', async ({ page }) => {
    const state = makeState(
      [
        makeAction({
          id: 'audit-match',
          actionType: 'tool_use',
          toolName: 'Bash',
          agentId: 'agent-beta',
        }),
        makeAction({
          id: 'audit-filtered-out',
          actionType: 'tool_use',
          toolName: 'Read',
          agentId: 'agent-alpha',
        }),
      ],
      makeSummary({
        totalActions: 2,
        actionTypeBreakdown: { tool_use: 2 },
        toolBreakdown: { Bash: 1, Read: 1 },
      }),
    );
    await mountApiMocks(page, state);

    await page.goto('/audit');
    await expect(page.getByText('audit-filtered-out')).toHaveCount(0);
    await expect(page.getByRole('button').filter({ hasText: 'Read' })).toBeVisible();

    const filteredListRequest = page.waitForRequest(
      (request) =>
        request.method() === 'GET' &&
        new URL(request.url()).pathname === '/api/audit' &&
        new URL(request.url()).searchParams.get('agentId') === 'agent-beta' &&
        new URL(request.url()).searchParams.get('tool') === 'Bash',
    );
    const filteredSummaryRequest = page.waitForRequest(
      (request) =>
        request.method() === 'GET' &&
        new URL(request.url()).pathname === '/api/audit/summary' &&
        new URL(request.url()).searchParams.get('agentId') === 'agent-beta',
    );

    await page.getByTestId('audit-agent-filter').fill('  agent-beta  ');
    await page.getByTestId('audit-tool-filter').fill('  Bash  ');
    await filteredListRequest;
    await filteredSummaryRequest;

    await expect(page.getByRole('button').filter({ hasText: 'Bash' })).toBeVisible();
    await expect(page.getByRole('button').filter({ hasText: 'Read' })).toHaveCount(0);
    await expect(page.getByText('Showing 1 of 1')).toBeVisible();

    expect(
      state.listCalls.some(
        (call) =>
          call.agentId === 'agent-beta' &&
          call.tool === 'Bash' &&
          call.limit === '200' &&
          call.offset === null,
      ),
    ).toBe(true);
    expect(state.summaryCalls.some((call) => call.agentId === 'agent-beta')).toBe(true);
  });

  test('shows the embedded empty state when the audit API returns no rows', async ({ page }) => {
    await mountApiMocks(page, makeState([], makeSummary()));

    await page.goto('/audit');

    await expect(page.getByRole('heading', { name: 'Audit Trail' })).toBeVisible();
    await expect(page.getByText('No audit actions.')).toBeVisible();
    await expect(page.getByText(/POST \/api\/audit\/actions/)).toBeVisible();
    await expect(page.getByRole('button').filter({ hasText: 'tool_use' })).toHaveCount(0);
  });
});
