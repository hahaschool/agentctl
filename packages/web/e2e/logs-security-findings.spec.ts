import { expect, type Page, type Route, test } from '@playwright/test';

type SecurityFindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

type SecurityFinding = {
  id: string;
  agentId: string;
  runId: string;
  severity: SecurityFindingSeverity;
  category: string;
  title: string;
  description: string;
  file: string | null;
  line: number | null;
  recommendation: string;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgeReason: string | null;
  issueCreated: boolean;
  createdAt: string;
};

type SecurityFindingsSummary = {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  byCategory: Record<string, number>;
};

type MockState = {
  findings: SecurityFinding[];
  summary: SecurityFindingsSummary;
  listCalls: Array<{ limit: string | null }>;
  listStatus: number;
};

function makeFinding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    id: 'finding-1',
    agentId: 'agent-security',
    runId: 'run-security',
    severity: 'high',
    category: 'injection',
    title: 'Unsafe shell interpolation',
    description: 'User-controlled command text reaches a shell invocation.',
    file: 'packages/agent-worker/src/shell.ts',
    line: 118,
    recommendation: 'Use structured process arguments instead of shell interpolation.',
    acknowledged: false,
    acknowledgedBy: null,
    acknowledgeReason: null,
    issueCreated: false,
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...overrides,
  };
}

function makeSummary(overrides: Partial<SecurityFindingsSummary> = {}): SecurityFindingsSummary {
  return {
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    byCategory: {},
    ...overrides,
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mountLogsMocks(page: Page, state: MockState): Promise<void> {
  await page.route('**/health?detail=true', async (route) => {
    await fulfillJson(route, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: 120,
      dependencies: {},
    });
  });

  await page.route('**/metrics', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: 'agentctl_sessions_total 0\nagentctl_agents_total 0\n',
    });
  });

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const { pathname } = url;

    if (method === 'GET' && pathname === '/api/security/findings') {
      state.listCalls.push({ limit: url.searchParams.get('limit') });
      if (state.listStatus >= 400) {
        await fulfillJson(route, { message: 'Failed to load security findings' }, state.listStatus);
        return;
      }
      await fulfillJson(route, { findings: state.findings, total: state.findings.length });
      return;
    }

    if (method === 'GET' && pathname === '/api/security/findings/summary') {
      await fulfillJson(route, state.summary);
      return;
    }

    if (method === 'GET' && pathname === '/api/agents/list') {
      await fulfillJson(route, { agents: [], total: 0, hasMore: false });
      return;
    }

    if (method === 'GET' && pathname === '/api/agents') {
      await fulfillJson(route, []);
      return;
    }

    if (method === 'GET' && pathname === '/api/audit') {
      await fulfillJson(route, { actions: [], total: 0, limit: 50, offset: 0, hasMore: false });
      return;
    }

    if (method === 'GET' && pathname === '/api/audit/summary') {
      await fulfillJson(route, { total: 0, byActionType: {}, byAgent: {}, toolBreakdown: {} });
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

    await fulfillJson(route, method === 'GET' ? [] : {});
  });
}

test.describe('Logs security findings tab', () => {
  test('renders summary cards and latest findings from the security findings APIs', async ({
    page,
  }) => {
    const state: MockState = {
      findings: [
        makeFinding({
          id: 'finding-critical',
          severity: 'critical',
          category: 'secrets',
          title: 'Hardcoded production token',
          file: 'packages/control-plane/src/auth.ts',
          line: 44,
          acknowledged: true,
          issueCreated: true,
        }),
        makeFinding({
          id: 'finding-high',
          severity: 'high',
          category: 'injection',
          title: 'Unsafe shell interpolation',
        }),
      ],
      summary: makeSummary({
        total: 4,
        critical: 1,
        high: 2,
        medium: 1,
        byCategory: { injection: 2, secrets: 2 },
      }),
      listCalls: [],
      listStatus: 200,
    };
    await mountLogsMocks(page, state);

    await page.goto('/logs');
    await expect(page.getByRole('heading', { name: 'Logs & Metrics' })).toBeVisible();

    await page.getByRole('button', { name: 'Security Findings' }).click();

    await expect(page.getByTestId('stat-card-Total Findings')).toContainText('4');
    await expect(page.getByTestId('stat-card-Critical')).toContainText('1');
    await expect(page.getByTestId('stat-card-High')).toContainText('2');
    await expect(page.getByTestId('stat-card-Categories')).toContainText('2');

    await expect(page.getByRole('heading', { name: 'Latest Findings' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Hardcoded production token' })).toBeVisible();
    await expect(page.getByText('critical', { exact: true })).toBeVisible();
    await expect(page.getByText('secrets', { exact: true })).toBeVisible();
    await expect(page.getByText('Acknowledged')).toBeVisible();
    await expect(page.getByText('GitHub issue created')).toBeVisible();
    await expect(page.getByText('packages/control-plane/src/auth.ts:44')).toBeVisible();
    const highFinding = page.locator('article').filter({ hasText: 'Unsafe shell interpolation' });
    await expect(
      highFinding.getByText('Use structured process arguments instead of shell interpolation.'),
    ).toBeVisible();

    expect(state.listCalls.some((call) => call.limit === '20')).toBe(true);
  });

  test('shows the embedded empty state when the APIs return no findings', async ({ page }) => {
    await mountLogsMocks(page, {
      findings: [],
      summary: makeSummary(),
      listCalls: [],
      listStatus: 200,
    });

    await page.goto('/logs');
    await page.getByRole('button', { name: 'Security Findings' }).click();

    await expect(page.getByText('No security findings')).toBeVisible();
    await expect(
      page.getByText('Security audit findings will appear here when agents report them.'),
    ).toBeVisible();
  });

  test('surfaces the findings API error in the Logs security tab', async ({ page }) => {
    await mountLogsMocks(page, {
      findings: [],
      summary: makeSummary({ total: 1, high: 1, byCategory: { injection: 1 } }),
      listCalls: [],
      listStatus: 500,
    });

    await page.goto('/logs');
    await page.getByRole('button', { name: 'Security Findings' }).click();

    await expect(page.getByText('Failed to load security findings')).toBeVisible();
  });
});
