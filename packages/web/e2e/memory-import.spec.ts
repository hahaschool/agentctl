import { expect, type Page, type Route, test } from '@playwright/test';

type ImportJobSource = 'claude-mem' | 'jsonl-history';
type ImportJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

type ImportJob = {
  id: string;
  source: ImportJobSource;
  status: ImportJobStatus;
  progress: {
    current: number;
    total: number;
  };
  imported: number;
  skipped: number;
  errors: number;
  startedAt: string;
  completedAt: string | null;
};

type StartImportBody = {
  source: ImportJobSource;
  dbPath: string;
};

type ImportMockState = {
  job: ImportJob;
  startCalls: StartImportBody[];
  cancelCalls: string[];
  completeImmediately: boolean;
};

function makeJob(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'import-job-1',
    source: 'claude-mem',
    status: 'running',
    progress: { current: 25, total: 100 },
    imported: 12,
    skipped: 1,
    errors: 0,
    startedAt: '2026-04-14T05:00:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockMemoryImportApis(page: Page, state: ImportMockState): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();

    if (method === 'POST' && pathname === '/api/memory/import/preview') {
      await fulfillJson(route, {
        ok: true,
        preview: {
          totalObservations: 4,
          newToImport: 4,
          alreadyImported: 0,
          byType: { decision: 2, bugfix: 1, discovery: 1 },
          sampleTitles: ['Stabilize memory import', 'Preserve rollback posture'],
        },
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/memory/import') {
      const body = (request.postDataJSON() ?? {}) as StartImportBody;
      state.startCalls.push(body);
      state.job = makeJob({
        id: 'import-job-1',
        source: body.source,
        status: state.completeImmediately ? 'completed' : 'running',
        progress: state.completeImmediately ? { current: 100, total: 100 } : { current: 25, total: 100 },
        imported: state.completeImmediately ? 42 : 12,
        skipped: state.completeImmediately ? 3 : 1,
        errors: state.completeImmediately ? 0 : 0,
        completedAt: state.completeImmediately ? '2026-04-14T05:01:00.000Z' : null,
      });
      await fulfillJson(route, { ok: true, job: state.job }, 201);
      return;
    }

    if (method === 'GET' && pathname === '/api/memory/import/status') {
      await fulfillJson(route, { ok: true, job: state.job });
      return;
    }

    const cancelMatch = pathname.match(/^\/api\/memory\/import\/([^/]+)$/);
    if (method === 'DELETE' && cancelMatch) {
      const id = decodeURIComponent(cancelMatch[1] ?? '');
      state.cancelCalls.push(id);
      state.job = makeJob({
        ...state.job,
        status: 'cancelled',
        progress: { current: state.job.progress.current, total: state.job.progress.total },
        completedAt: '2026-04-14T05:02:00.000Z',
      });
      await fulfillJson(route, { ok: true, job: state.job });
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
    if (method === 'GET' && pathname === '/api/memory/stats') {
      await fulfillJson(route, {
        ok: true,
        stats: {
          totalFacts: 0,
          newThisWeek: 0,
          avgConfidence: 0,
          pendingConsolidation: 0,
          byScope: {},
          byEntityType: {},
          strengthDistribution: { active: 0, decaying: 0, archived: 0 },
          growthTrend: [],
        },
      });
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

    throw new Error(`Unhandled API request in memory import e2e mock: ${method} ${pathname}`);
  });
}

test.describe('Memory import page', () => {
  test('keeps JSONL history import disabled until it is wired', async ({ page }) => {
    const state: ImportMockState = {
      job: makeJob(),
      startCalls: [],
      cancelCalls: [],
      completeImmediately: true,
    };
    await mockMemoryImportApis(page, state);

    await page.goto('/memory/import');

    await expect(page.getByRole('heading', { name: 'Memory Import' })).toBeVisible();
    await page.getByTestId('source-jsonl-history').click();
    await page.getByTestId('db-path-input').fill('~/.claude/projects/agentctl');

    await expect(page.getByText(/JSONL history import is not wired yet/i)).toBeVisible();
    await expect(page.getByTestId('step1-next')).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'Preview field mapping' })).toHaveCount(0);
    expect(state.startCalls).toEqual([]);
  });

  test('cancels a running import job from the progress step', async ({ page }) => {
    const state: ImportMockState = {
      job: makeJob(),
      startCalls: [],
      cancelCalls: [],
      completeImmediately: false,
    };
    await mockMemoryImportApis(page, state);

    await page.goto('/memory/import');
    await page.getByTestId('db-path-input').fill('~/.claude-mem/claude-mem.db');
    await page.getByTestId('step1-next').click();

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/memory/import') &&
          response.request().method() === 'POST',
      ),
      page.getByTestId('step2-start').click(),
    ]);

    await expect(page.getByRole('heading', { name: 'Importing' })).toBeVisible();
    await expect(page.getByTestId('progress-bar')).toHaveAttribute('aria-valuenow', '25');

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/memory/import/import-job-1') &&
          response.request().method() === 'DELETE',
      ),
      page.getByTestId('cancel-import').click(),
    ]);

    await expect(page.getByRole('heading', { name: 'Import cancelled' })).toBeVisible();
    expect(state.cancelCalls).toEqual(['import-job-1']);
  });
});
