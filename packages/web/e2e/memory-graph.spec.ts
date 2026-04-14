import type { MemoryEdge, MemoryFact } from '@agentctl/shared';
import { expect, type Page, test } from '@playwright/test';

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
    content: 'Adopt BM25 + vector hybrid search for graph queries',
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

// Content stays under 20 characters so the SVG label (slice 0,20) and the
// table truncation (slice 0,40) both surface the full string verbatim —
// keeping assertions simple and stable across both views.
const ALL_NODES: readonly MemoryFact[] = [
  makeFact({ content: 'Adopt hybrid search' }),
  makeFact({
    id: 'fact-pattern',
    scope: 'global',
    content: 'Repository pattern',
    entity_type: 'pattern',
    confidence: 0.88,
    strength: 0.71,
  }),
  makeFact({
    id: 'fact-error',
    scope: 'project:agentctl',
    content: 'Stale cache crash',
    entity_type: 'error',
    confidence: 0.42,
    strength: 0.35,
  }),
];

const ALL_EDGES: readonly MemoryEdge[] = [
  {
    id: 'edge-decision-pattern',
    source_fact_id: 'fact-decision',
    target_fact_id: 'fact-pattern',
    relation: 'depends_on',
    weight: 0.82,
    created_at: NOW,
  },
  {
    id: 'edge-error-decision',
    source_fact_id: 'fact-error',
    target_fact_id: 'fact-decision',
    relation: 'caused_by',
    weight: 0.55,
    created_at: NOW,
  },
];

type GraphRequest = {
  readonly scope: string | null;
  readonly entityType: string | null;
  readonly limit: string | null;
};

type GraphApiOptions = {
  readonly empty?: boolean;
};

async function mockGraphApis(
  page: Page,
  options: GraphApiOptions = {},
): Promise<{ readonly graphRequests: GraphRequest[] }> {
  const graphRequests: GraphRequest[] = [];

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

    if (request.method() === 'GET' && pathname === '/api/memory/graph') {
      graphRequests.push({
        scope: searchParams.get('scope'),
        entityType: searchParams.get('entityType'),
        limit: searchParams.get('limit'),
      });

      if (options.empty) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, nodes: [], edges: [] }),
        });
        return;
      }

      // Apply scope/entityType filters server-side to reflect real behavior.
      let nodes = ALL_NODES.slice();
      const scope = searchParams.get('scope');
      const entityType = searchParams.get('entityType');
      if (scope) {
        nodes = nodes.filter((n) => n.scope === scope);
      }
      if (entityType) {
        nodes = nodes.filter((n) => n.entity_type === entityType);
      }
      const nodeIds = new Set(nodes.map((n) => n.id));
      const edges = ALL_EDGES.filter(
        (e) => nodeIds.has(e.source_fact_id) && nodeIds.has(e.target_fact_id),
      );

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, nodes, edges }),
      });
      return;
    }

    if (request.method() === 'GET' && pathname.startsWith('/api/memory/facts/')) {
      const id = decodeURIComponent(pathname.slice('/api/memory/facts/'.length));
      const fact = ALL_NODES.find((n) => n.id === id);
      const edges = ALL_EDGES.filter(
        (e) => e.source_fact_id === id || e.target_fact_id === id,
      );
      await route.fulfill({
        status: fact ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(
          fact
            ? { ok: true, fact, edges }
            : { ok: false, error: 'NOT_FOUND', message: 'Fact not found' },
        ),
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

  return { graphRequests };
}

async function openGraphPage(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/memory/graph');
  // The scope filter in the toolbar is a stable anchor for the view being ready.
  await expect(page.getByLabel('Node limit')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Dismiss' }).click({ timeout: 2_000 }).catch(() => {});
}

test.describe('Memory graph page', () => {
  test('renders the toolbar and populates the edge table from the API', async ({ page }) => {
    const state = await mockGraphApis(page);

    await openGraphPage(page);

    // Toolbar controls from the view — presence guards a regression in the header.
    await expect(page.getByRole('button', { name: 'Table' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Graph' })).toBeVisible();
    await expect(page.getByLabel('Node limit')).toHaveValue('200');

    // Count pill reflects the mocked response.
    await expect(page.getByText('3 nodes, 2 edges')).toBeVisible();

    // Default table view renders rows keyed off node content.
    const table = page.getByRole('table', { name: 'Knowledge graph edges' });
    await expect(table).toBeVisible();
    // Decision appears as the source of edge-1 and the target of edge-2 → 2 cells.
    await expect(table.getByText('Adopt hybrid search')).toHaveCount(2);
    await expect(table.getByText('Repository pattern')).toHaveCount(1);
    await expect(table.getByText('Stale cache crash')).toHaveCount(1);
    await expect(table.getByText('depends on')).toBeVisible();
    await expect(table.getByText('caused by')).toBeVisible();

    // The default request uses the initial limit=200 and no filters.
    expect(state.graphRequests.length).toBeGreaterThan(0);
    expect(state.graphRequests[0]).toEqual({ scope: null, entityType: null, limit: '200' });
  });

  test('switches to graph view and renders one SVG node per fact', async ({ page }) => {
    await mockGraphApis(page);

    await openGraphPage(page);

    await page.getByRole('button', { name: 'Graph', exact: true }).click();

    const svg = page.getByRole('img', { name: 'Knowledge graph visualization' });
    await expect(svg).toBeVisible();

    // Each fact becomes a clickable node button in the SVG.
    await expect(page.getByRole('button', { name: /^Node: Adopt hybrid search/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Node: Repository pattern/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Node: Stale cache crash/ })).toBeVisible();

    // Legend should surface the entity type palette for selected-node colouring.
    await expect(page.getByText('Entity types', { exact: true })).toBeVisible();
  });

  test('sends filters to the API when the scope and entity type selects change', async ({
    page,
  }) => {
    const state = await mockGraphApis(page);

    await openGraphPage(page);

    // Narrow to global-scope pattern nodes via the toolbar filters (header controls).
    const headerScope = page.getByLabel('Scope filter').first();
    await headerScope.selectOption('global');

    const headerEntityType = page.getByLabel('Entity type filter').first();
    await headerEntityType.selectOption('pattern');

    await expect
      .poll(() => state.graphRequests.at(-1), {
        message: 'latest graph request reflects scope + entityType filters',
      })
      .toEqual({ scope: 'global', entityType: 'pattern', limit: '200' });

    // Result set shrinks to a single node with no surviving edges.
    await expect(page.getByText('1 node, 0 edges')).toBeVisible();
  });

  test('opens the node detail panel after selecting a table row', async ({ page }) => {
    await mockGraphApis(page);

    await openGraphPage(page);

    await page
      .getByRole('button', { name: /Select source node fact-dec/i })
      .first()
      .click();

    const detail = page.getByRole('complementary').filter({ hasText: 'Node Detail' });
    await expect(detail.getByRole('heading', { name: 'Node Detail' })).toBeVisible();
    await expect(detail.getByText('Adopt hybrid search')).toBeVisible();
    // Outgoing: decision -> pattern. Incoming: error -> decision.
    await expect(detail.getByText('Outgoing (1)')).toBeVisible();
    await expect(detail.getByText('Incoming (1)')).toBeVisible();

    // Close the detail panel and confirm it disappears.
    await detail.getByRole('button', { name: 'Close node detail' }).click();
    await expect(detail).toBeHidden();
  });

  test('shows the empty state when the API returns no nodes', async ({ page }) => {
    await mockGraphApis(page, { empty: true });

    await openGraphPage(page);

    // Default view is table — the empty-edges copy wins first.
    await expect(page.getByText('0 nodes, 0 edges')).toBeVisible();
    await expect(page.getByText('No edges match the current filters.')).toBeVisible();

    // Swap to the graph view to assert its dedicated empty-state copy too.
    await page.getByRole('button', { name: 'Graph', exact: true }).click();
    await expect(
      page.getByText('No entities to display. Adjust filters or add memory facts.'),
    ).toBeVisible();
    // SVG is not rendered when there are zero nodes.
    await expect(
      page.getByRole('img', { name: 'Knowledge graph visualization' }),
    ).toHaveCount(0);
  });
});
