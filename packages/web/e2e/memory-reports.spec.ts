import { expect, type Page, test } from '@playwright/test';

type MemoryReportType = 'project-progress' | 'knowledge-health' | 'activity-digest';
type MemoryReportTimeRange = 'last-7d' | 'last-30d' | 'last-90d' | 'all-time';

type GeneratedMemoryReport = {
  id: string;
  reportType: MemoryReportType;
  scope: string | null;
  timeRange: MemoryReportTimeRange;
  markdown: string;
  generatedAt: string;
};

type GenerateRequest = {
  reportType?: MemoryReportType;
  scope?: string;
  timeRange?: MemoryReportTimeRange;
};

const EXISTING_PROJECT_REPORT: GeneratedMemoryReport = {
  id: 'report-existing-project-progress',
  reportType: 'project-progress',
  scope: null,
  timeRange: 'last-30d',
  markdown: '# Stored Project Progress\n\nThe current roadmap has stable memory coverage.',
  generatedAt: '2026-04-01T08:00:00.000Z',
};

const GENERATED_ACTIVITY_REPORT: GeneratedMemoryReport = {
  id: 'report-generated-activity-digest',
  reportType: 'activity-digest',
  scope: 'project:agentctl',
  timeRange: 'all-time',
  markdown:
    '# Activity Digest\n\n- Reviewed deployment telemetry.\n- Captured agent handoff patterns.',
  generatedAt: '2026-04-01T09:00:00.000Z',
};

async function mockMemoryReportApis(
  page: Page,
  options: { failGenerate?: boolean } = {},
): Promise<{ generateRequests: GenerateRequest[] }> {
  const generateRequests: GenerateRequest[] = [];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/sync/conflicts/count') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 0 }),
      });
      return;
    }

    if (request.method() === 'GET' && url.pathname === '/api/memory/reports') {
      const reportType = url.searchParams.get('reportType');
      const scope = url.searchParams.get('scope');
      const reports =
        reportType === EXISTING_PROJECT_REPORT.reportType && !scope
          ? [EXISTING_PROJECT_REPORT]
          : [];

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, reports, total: reports.length }),
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === '/api/memory/reports/generate') {
      generateRequests.push(request.postDataJSON() as GenerateRequest);

      if (options.failGenerate) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            error: 'REPORT_GENERATION_FAILED',
            message: 'The report worker could not summarize memory facts.',
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, report: GENERATED_ACTIVITY_REPORT }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'NOT_FOUND',
        message: 'Unexpected e2e request',
      }),
    });
  });

  return { generateRequests };
}

async function openMemoryReports(page: Page): Promise<void> {
  await page.goto('/memory/reports');
  await expect(page.getByRole('heading', { name: 'Memory Reports' })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('Memory reports page', () => {
  test('generates a report using selected type, scope, and time range', async ({ page }) => {
    const state = await mockMemoryReportApis(page);

    await openMemoryReports(page);
    await expect(page.getByRole('heading', { name: 'Stored Project Progress' })).toBeVisible();

    const activityDigest = page.getByRole('button', {
      name: /Activity Digest/i,
    });
    await activityDigest.click();
    await expect(activityDigest).toHaveAttribute('aria-pressed', 'true');

    await page.getByLabel('Scope').selectOption('project:agentctl');
    await page.getByLabel('Time range').selectOption('all-time');

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/memory/reports/generate') &&
          response.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Generate report' }).click(),
    ]);

    expect(state.generateRequests).toEqual([
      {
        reportType: 'activity-digest',
        scope: 'project:agentctl',
        timeRange: 'all-time',
      },
    ]);
    await expect(page.getByRole('heading', { name: 'Activity Digest' })).toBeVisible();
    await expect(page.getByText('Reviewed deployment telemetry.')).toBeVisible();
    await expect(page.getByText('Captured agent handoff patterns.')).toBeVisible();
  });

  test('surfaces report generation failures', async ({ page }) => {
    const state = await mockMemoryReportApis(page, { failGenerate: true });

    await openMemoryReports(page);
    await page.getByRole('button', { name: /Knowledge Health/i }).click();

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/memory/reports/generate') &&
          response.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Generate report' }).click(),
    ]);

    expect(state.generateRequests).toEqual([
      {
        reportType: 'knowledge-health',
        timeRange: 'last-30d',
      },
    ]);
    await expect(
      page.getByRole('alert').filter({ hasText: 'Failed to generate report.' }),
    ).toHaveText('Failed to generate report. Please try again.');
  });
});
