import { expect, type Page, test } from '@playwright/test';
import type { MemoryEdge, MemoryFact } from '@agentctl/shared';

const NOW = '2026-04-14T08:00:00.000Z';

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  const source = {
    session_id: 'session-graph-1',
    agent_id: 'agent-graph-1',
    machine_id: 'machine-graph-1',
    turn_index: 7,
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

const GRAPH_FACTS: readonly MemoryFact[] = [
  makeFact(),
  makeFact({
    id: 'fact-pattern',
    scope: 'global',
    content: 'Vector search policy prefers BM25 fallback for sparse queries',
    entity_type: 'pattern',
    confidence: 0.88,
    strength: 0.71,
    source: {
      session_id: 'session-graph-2',
      agent_id: 'agent-graph-2',
      machine_id: 'machine-graph-1',
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

const GRAPH_EDGES: readonly MemoryEdge[] = [
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
    relation: 'related_to',
    weight: 0.64,
    created_at: NOW,
  },
];

type GraphRequest = {
  readonly scope: string | null;
  readonly entityType: string | null;
  readonly limit: string | null;
};

async function mockKnowledgeGraphApis(page: Page): Promise<{
  readonly graphRequests: GraphRequest[];
}> {
  const factsById = new Map(GRAPH_FACTS.map((fact) => [fact.id, fact]));
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
      const scope = searchParams.get('scope');
      const entityType = searchParams.get('entityType');
      const limit = searchParams.get('limit');
      graphRequests.push({ scope, entityType, limit });

      let nodes = Array.from(factsById.values());
      if (scope) {
        nodes = nodes.filter((fact) => fact.scope === scope);
      }
      if (entityType) {
        nodes = nodes.filter((fact) => fact.entity_type === entityType);
      }
      if (limit) {
        nodes = nodes.slice(0, Number(limit));
      }

      const nodeIds = new Set(nodes.map((fact) => fact.id));
      const edges = GRAPH_EDGES.filter(
        (edge) => nodeIds.has(edge.source_fact_id) && nodeIds.has(edge.target_fact_id),
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
      const fact = factsById.get(id);
      const edges = GRAPH_EDGES.filter(
        (edge) => edge.source_fact_id === id || edge.target_fact_id === id,
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

async function openKnowledgeGraph(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/memory/graph');
  await expect(page.getByRole('button', { name: 'Graph' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Dismiss' }).click({ timeout: 2_000 }).catch(() => {});
}

test.describe('Memory knowledge graph', () => {
  test('renders graph edges and applies table and global filters', async ({ page }) => {
    const state = await mockKnowledgeGraphApis(page);

    await openKnowledgeGraph(page);

    await expect(page.getByText('3 nodes, 2 edges')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Knowledge graph edges' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select source node fact-dec' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select target node fact-pat' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select source node fact-err' })).toBeVisible();
    const edgeTable = page.getByRole('table', { name: 'Knowledge graph edges' });
    await expect(edgeTable.getByText('depends on')).toBeVisible();
    await expect(edgeTable.getByText('related to')).toBeVisible();

    await page.getByLabel('Filter graph nodes').fill('vector search');

    await expect(page.getByText('1 edge')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select target node fact-pat' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select source node fact-err' })).toBeHidden();

    await page.getByLabel('Relation type filter').selectOption('related_to');
    await expect(page.getByText('No edges match the current filters.')).toBeVisible();

    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await page.getByLabel('Entity type filter').first().selectOption('decision');

    await expect
      .poll(() => state.graphRequests.at(-1), {
        message: 'latest graph request includes the selected entity type',
      })
      .toMatchObject({
        entityType: 'decision',
        limit: '200',
      });
    await expect(page.getByText('1 node, 0 edges')).toBeVisible();
  });

  test('opens the SVG graph and node detail panel without a live backend', async ({ page }) => {
    await mockKnowledgeGraphApis(page);

    await openKnowledgeGraph(page);

    await page.getByRole('button', { name: 'Graph' }).click();

    await expect(page.getByLabel('Knowledge graph visualization')).toBeVisible();
    await page.getByRole('button', { name: /Node: Project deploy check/i }).click();

    const detailPanel = page.getByRole('complementary').filter({ hasText: 'Node Detail' });
    await expect(detailPanel.getByRole('heading', { name: 'Node Detail' })).toBeVisible();
    await expect(
      detailPanel.getByText('Project deploy checklist must include beta gate review'),
    ).toBeVisible();
    await expect(detailPanel.getByText('Outgoing (1)')).toBeVisible();
    await expect(detailPanel.getByText('Incoming (1)')).toBeVisible();
    await expect(detailPanel.getByText('session-graph-1')).toBeVisible();

    await detailPanel.getByRole('button', { name: 'Close node detail' }).click();
    await expect(detailPanel.getByRole('heading', { name: 'Node Detail' })).toBeHidden();
  });
});
