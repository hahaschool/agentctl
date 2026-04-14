import { expect, type Page, test } from '@playwright/test';
import type { MemoryEdge, MemoryFact } from '@agentctl/shared';

const NOW = '2026-04-14T08:00:00.000Z';

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  const source = {
    session_id: 'session-1',
    agent_id: 'agent-1',
    machine_id: 'machine-1',
    turn_index: 3,
    extraction_method: 'manual' as const,
  };

  return {
    id: 'fact-decision',
    scope: 'project:agentctl',
    content: 'Project deploy checklist must include beta gate review',
    content_model: 'text-embedding-3-small',
    entity_type: 'decision',
    confidence: 0.92,
    strength: 0.83,
    source,
    valid_from: NOW,
    valid_until: null,
    created_at: NOW,
    accessed_at: NOW,
    ...overrides,
    source: overrides.source ?? source,
  };
}

const INITIAL_FACTS: readonly MemoryFact[] = [
  makeFact(),
  makeFact({
    id: 'fact-pattern',
    scope: 'global',
    content: 'Vector search policy prefers BM25 fallback for sparse queries',
    entity_type: 'pattern',
    confidence: 0.88,
    strength: 0.71,
    source: {
      session_id: 'session-2',
      agent_id: 'agent-2',
      machine_id: 'machine-1',
      turn_index: 4,
      extraction_method: 'llm',
    },
  }),
  makeFact({
    id: 'fact-error',
    scope: 'project:agentctl',
    content: 'Old worker crash reports usually point at a stale cache',
    entity_type: 'error',
    confidence: 0.42,
    strength: 0.35,
  }),
];

const RELATED_EDGE: MemoryEdge = {
  id: 'edge-1',
  source_fact_id: 'fact-decision',
  target_fact_id: 'fact-pattern',
  relation: 'related_to',
  weight: 0.82,
  created_at: NOW,
};

type ListRequest = {
  readonly q: string | null;
  readonly scope: string | null;
  readonly entityType: string | null;
  readonly sessionId: string | null;
  readonly agentId: string | null;
  readonly machineId: string | null;
  readonly minConfidence: string | null;
};

type UpdateRequest = {
  readonly id: string;
  readonly body: unknown;
};

type FeedbackRequest = {
  readonly id: string;
  readonly body: unknown;
};

async function mockMemoryBrowserApis(page: Page): Promise<{
  readonly listRequests: ListRequest[];
  readonly updateRequests: UpdateRequest[];
  readonly deleteRequests: string[];
  readonly feedbackRequests: FeedbackRequest[];
}> {
  const factsById = new Map(INITIAL_FACTS.map((fact) => [fact.id, fact]));
  const listRequests: ListRequest[] = [];
  const updateRequests: UpdateRequest[] = [];
  const deleteRequests: string[] = [];
  const feedbackRequests: FeedbackRequest[] = [];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname, searchParams } = url;

    if (request.method() === 'GET' && pathname === '/api/sync/conflicts/count') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 0 }),
      });
      return;
    }

    if (request.method() === 'GET' && pathname === '/api/memory/stats') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          stats: {
            totalFacts: factsById.size,
            newThisWeek: 1,
            avgConfidence: 0.74,
            pendingConsolidation: 0,
            byScope: { global: 1, 'project:agentctl': factsById.size - 1 },
            byEntityType: { decision: 1, pattern: 1, error: 1 },
            strengthDistribution: { active: 2, decaying: 1, archived: 0 },
            growthTrend: [{ date: '2026-04-14', count: 3 }],
          },
        }),
      });
      return;
    }

    const feedbackMatch = pathname.match(/^\/api\/memory\/facts\/([^/]+)\/feedback$/);
    if (feedbackMatch && request.method() === 'POST') {
      const id = decodeURIComponent(feedbackMatch[1]);
      const body = request.postDataJSON();
      feedbackRequests.push({ id, body });
      const current = factsById.get(id);
      await route.fulfill({
        status: current ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(
          current ? { ok: true, fact: current } : { ok: false, error: 'NOT_FOUND' },
        ),
      });
      return;
    }

    if (pathname.startsWith('/api/memory/facts/')) {
      const id = decodeURIComponent(pathname.slice('/api/memory/facts/'.length));

      if (request.method() === 'GET') {
        const fact = factsById.get(id);
        await route.fulfill({
          status: fact ? 200 : 404,
          contentType: 'application/json',
          body: JSON.stringify(
            fact
              ? { ok: true, fact, edges: id === 'fact-decision' ? [RELATED_EDGE] : [] }
              : { ok: false, error: 'NOT_FOUND', message: 'Fact not found' },
          ),
        });
        return;
      }

      if (request.method() === 'PATCH') {
        const body = request.postDataJSON();
        updateRequests.push({ id, body });
        const current = factsById.get(id);
        const next = current ? { ...current, ...(body as Partial<MemoryFact>) } : current;
        if (next) {
          factsById.set(id, next);
        }
        await route.fulfill({
          status: next ? 200 : 404,
          contentType: 'application/json',
          body: JSON.stringify(
            next ? { ok: true, fact: next } : { ok: false, error: 'NOT_FOUND' },
          ),
        });
        return;
      }

      if (request.method() === 'DELETE') {
        deleteRequests.push(id);
        factsById.delete(id);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, id }),
        });
        return;
      }
    }

    if (request.method() === 'GET' && pathname === '/api/memory/facts') {
      const q = searchParams.get('q');
      const scope = searchParams.get('scope');
      const entityType = searchParams.get('entityType');
      const sessionId = searchParams.get('sessionId');
      const agentId = searchParams.get('agentId');
      const machineId = searchParams.get('machineId');
      const minConfidence = searchParams.get('minConfidence');
      listRequests.push({ q, scope, entityType, sessionId, agentId, machineId, minConfidence });

      let facts = Array.from(factsById.values());
      if (q) {
        const normalizedQuery = q.toLowerCase();
        facts = facts.filter((fact) => fact.content.toLowerCase().includes(normalizedQuery));
      }
      if (scope) {
        facts = facts.filter((fact) => fact.scope === scope);
      }
      if (entityType) {
        facts = facts.filter((fact) => fact.entity_type === entityType);
      }
      if (sessionId) {
        facts = facts.filter((fact) => fact.source.session_id === sessionId);
      }
      if (agentId) {
        facts = facts.filter((fact) => fact.source.agent_id === agentId);
      }
      if (machineId) {
        facts = facts.filter((fact) => fact.source.machine_id === machineId);
      }
      if (minConfidence) {
        facts = facts.filter((fact) => fact.confidence >= Number(minConfidence));
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, facts, total: facts.length }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        error: 'UNEXPECTED_E2E_REQUEST',
        message: `${request.method()} ${pathname}`,
      }),
    });
  });

  return { listRequests, updateRequests, deleteRequests, feedbackRequests };
}

async function openMemoryBrowser(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/memory/browser');
  await expect(page.getByLabel('Search facts')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Dismiss' }).click({ timeout: 2_000 }).catch(() => {});
}

test.describe('Memory browser facts flow', () => {
  test('renders facts and applies search, scope, and entity filters', async ({ page }) => {
    const state = await mockMemoryBrowserApis(page);

    await openMemoryBrowser(page);

    await expect(page.getByText('3 facts')).toBeVisible();
    await expect(
      page.getByText('Project deploy checklist must include beta gate review'),
    ).toBeVisible();
    await expect(page.getByText('Vector search policy prefers BM25 fallback')).toBeVisible();

    await page.getByLabel('Search facts').fill('Vector search');

    await expect(page).toHaveURL(/q=Vector\+search/);
    await expect(page.getByText('1 fact matching "Vector search"')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('Vector search policy prefers BM25 fallback')).toBeVisible();
    await expect(
      page.getByText('Project deploy checklist must include beta gate review'),
    ).toBeHidden();

    await page.getByLabel('Scope filter').selectOption('global');
    await page.getByRole('button', { name: 'Toggle entity type: pattern' }).click();
    await page.getByLabel('Session ID filter').fill('session-2');
    await page.getByLabel('Agent ID filter').fill('agent-2');
    await page.getByLabel('Machine ID filter').fill('machine-1');

    await expect(page).toHaveURL(/sessionId=session-2/);
    await expect(page).toHaveURL(/agentId=agent-2/);
    await expect(page).toHaveURL(/machineId=machine-1/);

    await expect
      .poll(() => state.listRequests.at(-1), {
        message: 'latest facts request includes the selected filters and provenance',
      })
      .toMatchObject({
        q: 'Vector search',
        scope: 'global',
        entityType: 'pattern',
        sessionId: 'session-2',
        agentId: 'agent-2',
        machineId: 'machine-1',
      });
  });

  test('opens a fact detail panel, edits content, and deletes the fact', async ({ page }) => {
    const state = await mockMemoryBrowserApis(page);

    await openMemoryBrowser(page);

    await page
      .getByRole('button', { name: /View fact: Project deploy checklist must include beta gate/i })
      .click();

    const detailPanel = page.getByRole('complementary').filter({ hasText: 'Fact Detail' });
    await expect(detailPanel.getByRole('heading', { name: 'Fact Detail' })).toBeVisible();
    await expect(detailPanel.getByText('Relationships (1)')).toBeVisible();
    await expect(detailPanel.getByText('session-1')).toBeVisible();

    await page.getByRole('button', { name: 'Edit fact' }).click();
    await page
      .getByLabel('Edit fact content')
      .fill('Project deploy checklist must include beta gate and rollback review');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect
      .poll(() => state.updateRequests, { message: 'PATCH request captured' })
      .toEqual([
        {
          id: 'fact-decision',
          body: { content: 'Project deploy checklist must include beta gate and rollback review' },
        },
      ]);
    await expect(
      detailPanel.getByText('Project deploy checklist must include beta gate and rollback review'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Delete fact' }).click();

    await expect
      .poll(() => state.deleteRequests, { message: 'detail DELETE request captured' })
      .toEqual(['fact-decision']);
    await expect(detailPanel.getByRole('heading', { name: 'Fact Detail' })).toBeHidden();
    await expect(
      page.getByRole('button', { name: /View fact: Project deploy checklist/i }),
    ).toBeHidden();
  });

  test('bulk deletes selected facts from the list', async ({ page }) => {
    const state = await mockMemoryBrowserApis(page);

    await openMemoryBrowser(page);

    await page.getByLabel('Select fact: Project deploy checklist must include').check();
    await page.getByLabel('Select fact: Vector search policy prefers BM25').check();

    await expect(page.getByText('2 selected')).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).click();

    await expect
      .poll(() => state.deleteRequests, { message: 'bulk DELETE requests captured' })
      .toEqual(['fact-decision', 'fact-pattern']);
    await expect(page.getByText('1 fact')).toBeVisible();
    await expect(
      page.getByText('Old worker crash reports usually point at a stale cache'),
    ).toBeVisible();
    await expect(page.getByText('Vector search policy prefers BM25 fallback')).toBeHidden();
  });

  test('submits a "used" feedback signal when the thumbs-up button is clicked', async ({
    page,
  }) => {
    const state = await mockMemoryBrowserApis(page);

    await openMemoryBrowser(page);

    await expect(page.getByText('3 facts')).toBeVisible();

    const usefulButtons = page.getByRole('button', { name: 'Useful: used' });
    await expect(usefulButtons.first()).toBeVisible();
    await usefulButtons.first().click();

    await expect
      .poll(() => state.feedbackRequests, { message: 'feedback POST captured' })
      .toEqual([
        {
          id: 'fact-decision',
          body: { signal: 'used' },
        },
      ]);
  });
});
