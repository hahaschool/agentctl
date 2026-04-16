import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * E2E coverage for the Security Findings page (`/security-findings`).
 *
 * The page is driven by:
 *   - GET /api/security/findings?severity=&limit=  — paginated findings list
 *   - GET /api/security/findings/summary           — severity + category totals
 *
 * These specs mock all `/api/**` traffic via `page.route` so no control plane
 * or worker is required — only the Next.js dev server on $WEB_PORT.
 */

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
  listCalls: Array<{ severity: string | null; limit: string | null }>;
  listStatus: number;
};

function makeFinding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    id: 'f-1',
    agentId: 'agent-1',
    runId: 'run-1',
    severity: 'high',
    category: 'injection',
    title: 'Potential SQL injection',
    description: 'Unsanitized input in query builder',
    file: 'src/db.ts',
    line: 42,
    recommendation: 'Use parameterized queries',
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

async function mountApiMocks(page: Page, state: MockState): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const { pathname } = url;

    if (method === 'GET' && pathname === '/api/security/findings') {
      state.listCalls.push({
        severity: url.searchParams.get('severity'),
        limit: url.searchParams.get('limit'),
      });
      if (state.listStatus >= 400) {
        await fulfillJson(route, { error: 'internal error' }, state.listStatus);
        return;
      }
      const severity = url.searchParams.get('severity') as SecurityFindingSeverity | null;
      const filtered = severity
        ? state.findings.filter((f) => f.severity === severity)
        : state.findings;
      await fulfillJson(route, { findings: filtered, total: filtered.length });
      return;
    }

    if (method === 'GET' && pathname === '/api/security/findings/summary') {
      await fulfillJson(route, state.summary);
      return;
    }

    // Safe empty payloads for anything the shell (sidebar, bell) polls on boot.
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

test.describe('Security Findings page', () => {
  test('renders rows with all columns and summary badges', async ({ page }) => {
    const findings: SecurityFinding[] = [
      makeFinding({
        id: 'f-crit',
        severity: 'critical',
        category: 'secrets',
        title: 'Hardcoded API token',
        file: 'src/auth.ts',
        line: 99,
      }),
      makeFinding({
        id: 'f-high',
        severity: 'high',
        category: 'injection',
        title: 'Potential SQL injection',
        file: 'src/db.ts',
        line: 42,
      }),
    ];
    const summary = makeSummary({ total: 4, critical: 1, high: 2, medium: 1 });
    await mountApiMocks(page, { findings, summary, listCalls: [], listStatus: 200 });

    await page.goto('/security-findings');

    await expect(page.getByRole('heading', { name: 'Security Findings' })).toBeVisible();
    await expect(page.getByTestId('total-badge')).toHaveText(/4 total/i);

    // Summary badges render counts per severity and hide zero-count buckets.
    await expect(page.getByTestId('summary-critical')).toHaveText(/1 critical/i);
    await expect(page.getByTestId('summary-high')).toHaveText(/2 high/i);
    await expect(page.getByTestId('summary-medium')).toHaveText(/1 medium/i);
    await expect(page.getByTestId('summary-low')).toHaveCount(0);
    await expect(page.getByTestId('summary-info')).toHaveCount(0);

    const table = page.getByRole('table', { name: 'Security findings' });
    await expect(table).toBeVisible();

    for (const header of ['Severity', 'Category', 'Title / Description', 'File:Line', 'State', 'Created']) {
      await expect(table.getByRole('columnheader', { name: header })).toBeVisible();
    }

    const critRow = table.getByRole('row').filter({ hasText: 'Hardcoded API token' });
    await expect(critRow.getByText('critical', { exact: true })).toBeVisible();
    await expect(critRow.getByText('secrets', { exact: true })).toBeVisible();
    await expect(critRow.getByText('src/auth.ts:99', { exact: true })).toBeVisible();
    await expect(critRow.getByText('Open', { exact: true })).toBeVisible();

    await expect(page.getByText('Showing 2 of 2')).toBeVisible();
  });

  test('shows the empty state when no findings are returned', async ({ page }) => {
    await mountApiMocks(page, { findings: [], summary: makeSummary(), listCalls: [], listStatus: 200 });
    await page.goto('/security-findings');

    await expect(page.getByRole('heading', { name: 'Security Findings' })).toBeVisible();
    await expect(page.getByText('No security findings')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Security findings' })).toHaveCount(0);
  });

  test('severity filter scopes the API call and visible rows', async ({ page }) => {
    const findings: SecurityFinding[] = [
      makeFinding({ id: 'f-crit', severity: 'critical', title: 'Critical only row' }),
      makeFinding({ id: 'f-high', severity: 'high', title: 'High only row' }),
    ];
    const state: MockState = {
      findings,
      summary: makeSummary({ total: 2, critical: 1, high: 1 }),
      listCalls: [],
      listStatus: 200,
    };
    await mountApiMocks(page, state);

    await page.goto('/security-findings');

    // Initial load is severity-unscoped ("all").
    await expect(page.getByText('Critical only row')).toBeVisible();
    await expect(page.getByText('High only row')).toBeVisible();

    const filteredRequest = page.waitForRequest(
      (r) =>
        r.method() === 'GET' &&
        new URL(r.url()).pathname === '/api/security/findings' &&
        new URL(r.url()).searchParams.get('severity') === 'critical',
    );

    await page.getByTestId('severity-filter').selectOption('critical');
    await filteredRequest;

    await expect(page.getByText('Critical only row')).toBeVisible();
    await expect(page.getByText('High only row')).toHaveCount(0);
    await expect(page.getByText('Showing 1 of 1')).toBeVisible();

    // At least one list request carried severity=critical.
    expect(state.listCalls.some((c) => c.severity === 'critical')).toBe(true);
  });

  test('renders an error banner when the findings API returns 500', async ({ page }) => {
    await mountApiMocks(page, { findings: [], summary: makeSummary(), listCalls: [], listStatus: 500 });
    await page.goto('/security-findings');

    await expect(page.getByRole('heading', { name: 'Security Findings' })).toBeVisible();
    await expect(page.getByText(/Failed to load findings/i)).toBeVisible();
    await expect(page.getByRole('table', { name: 'Security findings' })).toHaveCount(0);
  });
});
