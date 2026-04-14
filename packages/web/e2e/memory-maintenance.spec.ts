import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * E2E coverage for the Knowledge Maintenance page (`/memory/maintenance`).
 *
 * Mocks all `/api/**` traffic — only needs the Next.js dev server on $WEB_PORT.
 * Primary endpoint under test: POST /api/memory/maintenance.
 */

// ── Fixtures ────────────────────────────────────────────────────────────────

type MaintenanceResult = {
  staleEntries: Array<{
    factId: string;
    content: string;
    referencedPaths: string[];
    reason: string;
  }>;
  deletedFileEntries: Array<{
    factId: string;
    content: string;
    deletedFile: string;
  }>;
  synthesisClusters: Array<{
    seedFactId: string;
    factIds: string[];
    factContents: string[];
    proposedPrinciple: string;
  }>;
  coverageReport: {
    covered: Array<{ directory: string; factCount: number }>;
    gaps: Array<{ directory: string; factCount: number }>;
    totalDirectories: number;
    coveredCount: number;
    gapCount: number;
  };
  consolidationItems: unknown[];
  report: {
    id: string;
    type: string;
    scope: string;
    periodStart: string;
    periodEnd: string;
    content: string;
    metadata: { factCount: number; newFacts: number; topEntities: unknown[] };
    generatedAt: string;
  } | null;
};

const RICH_RESULT: MaintenanceResult = {
  staleEntries: [
    {
      factId: 'fact-stale01',
      content: 'Reference to packages/old/gone.ts for the legacy Foo pattern.',
      referencedPaths: ['packages/old/gone.ts'],
      reason: 'referenced path no longer exists',
    },
  ],
  deletedFileEntries: [
    {
      factId: 'fact-deleted1',
      content: 'Notes about deprecated legacy-worker.ts hook',
      deletedFile: 'packages/agent-worker/src/legacy-worker.ts',
    },
  ],
  synthesisClusters: [
    {
      seedFactId: 'fact-seedaa1',
      factIds: ['fact-seedaa1', 'fact-clust02', 'fact-clust03'],
      factContents: ['A', 'B', 'C'],
      proposedPrinciple: 'Consolidate caching strategy facts into one principle.',
    },
  ],
  coverageReport: {
    covered: [{ directory: 'packages/shared', factCount: 12 }],
    gaps: [
      { directory: 'packages/control-plane/src/scheduler', factCount: 0 },
      { directory: 'packages/agent-worker/src/hooks', factCount: 0 },
    ],
    totalDirectories: 3,
    coveredCount: 1,
    gapCount: 2,
  },
  consolidationItems: [],
  report: {
    id: 'report-aaaa',
    type: 'knowledge-health',
    scope: 'all',
    periodStart: '2026-04-01T00:00:00Z',
    periodEnd: '2026-04-14T00:00:00Z',
    content: '## summary',
    metadata: { factCount: 2, newFacts: 1, topEntities: [] },
    generatedAt: '2026-04-14T00:00:00Z',
  },
};

const CLEAN_RESULT: MaintenanceResult = {
  staleEntries: [],
  deletedFileEntries: [],
  synthesisClusters: [],
  coverageReport: {
    covered: [],
    gaps: [],
    totalDirectories: 5,
    coveredCount: 5,
    gapCount: 0,
  },
  consolidationItems: [],
  report: null,
};

type MaintenanceRequest = {
  body: { scope?: string } | null;
};

type MockMode = 'rich' | 'clean' | 'error';

type MockState = {
  mode: MockMode;
  requests: MaintenanceRequest[];
  result: MaintenanceResult;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mountMocks(page: Page, state: MockState): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();

    if (method === 'POST' && pathname === '/api/memory/maintenance') {
      const body = (request.postDataJSON() ?? null) as { scope?: string } | null;
      state.requests.push({ body });
      if (state.mode === 'error') {
        await fulfillJson(route, { ok: false, error: 'MAINTENANCE_FAILED' }, 500);
        return;
      }
      await fulfillJson(route, {
        ok: true,
        summary: {
          staleEntries: state.result.staleEntries.length,
          deletedFileEntries: state.result.deletedFileEntries.length,
          synthesisClusters: state.result.synthesisClusters.length,
          consolidationItems: state.result.consolidationItems.length,
          coverageReport: {
            totalDirectories: state.result.coverageReport.totalDirectories,
            covered: state.result.coverageReport.coveredCount,
            gaps: state.result.coverageReport.gapCount,
          },
          reportId: state.result.report?.id ?? null,
        },
        result: state.result,
      });
      return;
    }

    // Safe empty fallbacks for shell/sidebar boot requests.
    if (method === 'GET' && pathname === '/api/sync/conflicts/count') {
      await fulfillJson(route, { count: 0 });
      return;
    }
    if (method === 'GET' && pathname === '/api/permission-requests') {
      await fulfillJson(route, []);
      return;
    }

    await fulfillJson(route, method === 'GET' ? {} : {});
  });
}

async function openPage(page: Page): Promise<void> {
  await page.goto('/memory/maintenance');
  await expect(page.getByRole('heading', { name: 'Knowledge Maintenance' })).toBeVisible({
    timeout: 20_000,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Memory maintenance page', () => {
  test('shows the empty placeholder before any run and fires no request on load', async ({
    page,
  }) => {
    const state: MockState = { mode: 'rich', requests: [], result: RICH_RESULT };
    await mountMocks(page, state);

    await openPage(page);

    await expect(page.getByText(/No maintenance results yet/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run memory maintenance' })).toBeEnabled();
    expect(state.requests).toEqual([]);
  });

  test('runs maintenance with no body when scope is "all" and renders all result sections', async ({
    page,
  }) => {
    const state: MockState = { mode: 'rich', requests: [], result: RICH_RESULT };
    await mountMocks(page, state);

    await openPage(page);

    const postRequest = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/memory/maintenance',
    );
    await page.getByRole('button', { name: 'Run memory maintenance' }).click();
    await postRequest;

    // Scope "all" must NOT set a scope filter — omit it from the body.
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]?.body?.scope).toBeUndefined();

    // Summary strip shows each category count.
    const summary = page.locator('[aria-live="polite"]').first();
    await expect(summary).toContainText('stale');
    await expect(summary).toContainText('deleted-file refs');
    await expect(summary).toContainText('clusters');
    await expect(summary).toContainText('coverage gaps');

    // Four sections render with their titles and counts.
    const staleSection = page.locator('#maintenance-stale-entries');
    const deletedSection = page.locator('#maintenance-deleted-files');
    const clusterSection = page.locator('#maintenance-synthesis-clusters');
    const gapsSection = page.locator('#maintenance-coverage-gaps');

    await expect(staleSection).toBeVisible();
    await expect(deletedSection).toBeVisible();
    await expect(clusterSection).toBeVisible();
    await expect(gapsSection).toBeVisible();

    // Non-empty sections default to open.
    await expect(staleSection).toHaveAttribute('open', '');
    await expect(deletedSection).toHaveAttribute('open', '');
    await expect(clusterSection).toHaveAttribute('open', '');

    // Coverage section content reflects the mocked counts.
    await expect(gapsSection).toContainText('3');
    await expect(gapsSection).toContainText('directories scanned');

    // Saved-report link points at the report id (link label is slice(0, 8)).
    await expect(
      page.getByRole('link', { name: 'report-a' }),
    ).toHaveAttribute('href', '/memory/reports?reportId=report-aaaa');
  });

  test('passes the selected non-all scope through to the maintenance body', async ({ page }) => {
    const state: MockState = { mode: 'clean', requests: [], result: CLEAN_RESULT };
    await mountMocks(page, state);

    await openPage(page);

    await page.getByLabel('Scope').selectOption('global');
    await page.getByRole('button', { name: 'Run memory maintenance' }).click();

    await expect(page.getByText(/Memory is clean\./i)).toBeVisible({ timeout: 10_000 });
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]?.body).toEqual({ scope: 'global' });
  });

  test('renders the "memory is clean" message when all categories are empty', async ({ page }) => {
    const state: MockState = { mode: 'clean', requests: [], result: CLEAN_RESULT };
    await mountMocks(page, state);

    await openPage(page);
    await page.getByRole('button', { name: 'Run memory maintenance' }).click();

    await expect(page.getByText(/Memory is clean\./i)).toBeVisible({ timeout: 10_000 });

    // Sections still render, but are closed by default when count is 0.
    // Expand each and confirm the no-items inner copy is present.
    const staleSection = page.locator('#maintenance-stale-entries');
    const deletedSection = page.locator('#maintenance-deleted-files');
    const clusterSection = page.locator('#maintenance-synthesis-clusters');
    const gapsSection = page.locator('#maintenance-coverage-gaps');

    for (const section of [staleSection, deletedSection, clusterSection, gapsSection]) {
      await expect(section).toBeVisible();
      await expect(section).not.toHaveAttribute('open', '');
      await section.locator('summary').click();
      await expect(section).toHaveAttribute('open', '');
    }

    await expect(staleSection).toContainText('No stale path references.');
    await expect(deletedSection).toContainText('No facts reference deleted files.');
    await expect(clusterSection).toContainText(/No clusters of 3\+ related facts/i);
    await expect(gapsSection).toContainText('No coverage gaps detected.');

    // Empty-state placeholder should NOT still be visible after a run completed.
    await expect(page.getByText(/No maintenance results yet/i)).toHaveCount(0);
  });

  test('shows an error alert when the maintenance endpoint fails', async ({ page }) => {
    const state: MockState = { mode: 'error', requests: [], result: CLEAN_RESULT };
    await mountMocks(page, state);

    await openPage(page);
    await page.getByRole('button', { name: 'Run memory maintenance' }).click();

    await expect(
      page.getByRole('alert').filter({ hasText: /Failed to run maintenance/i }),
    ).toBeVisible();

    // No result arrived — the empty placeholder is still visible.
    await expect(page.getByText(/No maintenance results yet/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run memory maintenance' })).toBeEnabled();
  });
});
