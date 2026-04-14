import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * E2E coverage for the Knowledge Synthesis page (`/memory/synthesis`).
 * Mocks all `/api/**` traffic — only needs the Next.js dev server on $WEB_PORT.
 * Primary endpoint under test: POST /api/memory/synthesis.
 */

type NearDuplicate = {
  factIdA: string;
  factIdB: string;
  similarity: number;
  contentA: string;
  contentB: string;
};

type StaleFact = {
  factId: string;
  content: string;
  lastAccessedDaysAgo: number;
};

type OrphanFact = {
  factId: string;
  content: string;
  entityType: string;
  createdAt: string;
};

type SynthesisGroup = {
  entityType: string;
  factIds: string[];
  factContents: string[];
  proposalHint: string;
};

type SynthesisResult = {
  lint: {
    nearDuplicates: NearDuplicate[];
    staleFacts: StaleFact[];
    orphanFacts: OrphanFact[];
  };
  synthesisGroups: SynthesisGroup[];
};

type SynthesisRequest = {
  body: { scope?: string } | null;
};

type MockMode = 'rich' | 'clean' | 'error';

type MockState = {
  mode: MockMode;
  requests: SynthesisRequest[];
  result: SynthesisResult;
};

const RICH_RESULT: SynthesisResult = {
  lint: {
    nearDuplicates: [
      {
        factIdA: 'fact-aaaaaaaa',
        factIdB: 'fact-bbbbbbbb',
        similarity: 0.871,
        contentA: 'Project deploy checklist must include beta gate review',
        contentB: 'Deploy checklist must include beta gate review step',
      },
    ],
    staleFacts: [
      {
        factId: 'fact-stale01',
        content: 'Old runbook referenced deprecated claude-mem sqlite path',
        lastAccessedDaysAgo: 42,
      },
    ],
    orphanFacts: [
      {
        factId: 'fact-orphan1',
        content: 'Vector search policy prefers BM25 fallback for sparse queries',
        entityType: 'pattern',
        createdAt: '2026-04-01T00:00:00.000Z',
      },
    ],
  },
  synthesisGroups: [
    {
      entityType: 'decision',
      factIds: ['fact-dec00001', 'fact-dec00002', 'fact-dec00003'],
      factContents: ['decision A', 'decision B', 'decision C'],
      proposalHint: 'Consider consolidating these 3 decisions into a higher-level principle.',
    },
  ],
};

const CLEAN_RESULT: SynthesisResult = {
  lint: { nearDuplicates: [], staleFacts: [], orphanFacts: [] },
  synthesisGroups: [],
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mountApiMocks(page: Page, state: MockState): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const { pathname } = url;

    if (method === 'POST' && pathname === '/api/memory/synthesis') {
      state.requests.push({ body: (request.postDataJSON() ?? null) as { scope?: string } | null });
      if (state.mode === 'error') {
        await fulfillJson(route, { ok: false, error: 'SYNTHESIS_FAILED' }, 500);
        return;
      }
      await fulfillJson(route, { ok: true, result: state.result });
      return;
    }

    // Safe empty payloads for shell/sidebar/bell boot requests.
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

    // Generic empty fallback — never throw, synthesis page has tight scope.
    await fulfillJson(route, method === 'GET' ? {} : {});
  });
}

async function openPage(page: Page): Promise<void> {
  await page.goto('/memory/synthesis');
  await expect(page.getByRole('heading', { name: 'Knowledge Synthesis' })).toBeVisible({
    timeout: 20_000,
  });
}

test.describe('Memory synthesis page', () => {
  test('shows empty/preview state before any run and no synthesis request fires', async ({
    page,
  }) => {
    const state: MockState = { mode: 'rich', requests: [], result: RICH_RESULT };
    await mountApiMocks(page, state);

    await openPage(page);

    await expect(page.getByText('No synthesis results yet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run knowledge synthesis' })).toBeEnabled();
    expect(state.requests).toEqual([]);
  });

  test('runs synthesis and renders all four result sections with counts', async ({ page }) => {
    const state: MockState = { mode: 'rich', requests: [], result: RICH_RESULT };
    await mountApiMocks(page, state);

    await openPage(page);

    const postRequest = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/memory/synthesis',
    );
    await page.getByRole('button', { name: 'Run knowledge synthesis' }).click();
    await postRequest;

    // Summary strip should reflect each category count.
    await expect(page.getByText('near-duplicates', { exact: true })).toBeVisible();
    await expect(page.getByText('principle candidates', { exact: true })).toBeVisible();

    // Near-duplicates section — open by default.
    const duplicatesSection = page.locator('#synthesis-near-duplicates');
    await expect(duplicatesSection).toHaveAttribute('open', '');
    await expect(duplicatesSection).toContainText('similarity 87.1%');
    await expect(duplicatesSection).toContainText(
      'A: Project deploy checklist must include beta gate review',
    );

    // Stale facts section — must show "days stale" suffix.
    const staleSection = page.locator('#synthesis-stale-facts');
    await expect(staleSection).toContainText('42d stale');

    // Orphan facts section — must show entity-type badge.
    const orphanSection = page.locator('#synthesis-orphan-facts');
    await expect(orphanSection).toContainText('pattern');

    // Principle candidates section — defaults open because synthesisGroups has entries.
    const groupsSection = page.locator('#synthesis-principle-candidates');
    await expect(groupsSection).toHaveAttribute('open', '');
    await expect(groupsSection).toContainText(
      'Consider consolidating these 3 decisions into a higher-level principle.',
    );
    await expect(groupsSection).toContainText('3 facts');
  });

  test('sends the selected non-"all" scope as the synthesis POST body', async ({ page }) => {
    const state: MockState = { mode: 'clean', requests: [], result: CLEAN_RESULT };
    await mountApiMocks(page, state);

    await openPage(page);

    await page.getByLabel('Scope').selectOption('global');
    await page.getByRole('button', { name: 'Run knowledge synthesis' }).click();

    await expect(page.getByText('Knowledge graph looks clean.')).toBeVisible();
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]?.body).toEqual({ scope: 'global' });
  });

  test('renders the clean-graph message when all sections are empty', async ({ page }) => {
    const state: MockState = { mode: 'clean', requests: [], result: CLEAN_RESULT };
    await mountApiMocks(page, state);

    await openPage(page);
    await page.getByRole('button', { name: 'Run knowledge synthesis' }).click();

    await expect(page.getByText('Knowledge graph looks clean.')).toBeVisible();
    await expect(
      page.getByText('No structural issues or synthesis opportunities detected in this scope.'),
    ).toBeVisible();

    // Each collapsible section should still render with its "no items" inner message.
    await expect(page.getByText('No near-duplicate pairs detected.')).toHaveCount(1);
    await expect(page.getByText('No stale facts.')).toHaveCount(1);
    await expect(page.getByText('No orphan facts.')).toHaveCount(1);
  });

  test('shows an error alert when the synthesis endpoint fails', async ({ page }) => {
    const state: MockState = { mode: 'error', requests: [], result: CLEAN_RESULT };
    await mountApiMocks(page, state);

    await openPage(page);
    await page.getByRole('button', { name: 'Run knowledge synthesis' }).click();

    await expect(
      page.getByRole('alert').filter({ hasText: /Failed to run synthesis/i }),
    ).toBeVisible();

    // Empty-state remains since no result arrived; button re-enabled to allow retry.
    await expect(page.getByText('No synthesis results yet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run knowledge synthesis' })).toBeEnabled();
  });
});
