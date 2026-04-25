import { expect, type Page, test } from '@playwright/test';

// Inline types so e2e spec has no local src imports
type FactTimelineEvent = {
  edge_id: string;
  relation: string;
  direction: 'incoming' | 'outgoing';
  other_fact_id: string;
  other_fact_preview: string;
  effective_from: string;
  effective_until: string | null;
  edge_created_at: string;
  source_fact_id: string;
  target_fact_id: string;
};

type FactTimelineResponse = {
  ok: true;
  entity: {
    requested_id: string;
    resolved_fact_id: string;
    content_preview: string;
    valid_from: string;
    valid_until: string | null;
    confidence: number | null;
    active_at_as_of: boolean | null;
    canonicalization_mode: 'fact-id-fallback';
  };
  as_of: string | null;
  limit: number;
  next_cursor: string | null;
  events: FactTimelineEvent[];
  limitations: string[];
};

const NOW = '2026-04-14T08:00:00.000Z';
const OLDER = '2026-03-01T12:00:00.000Z';

const ENTITY_ID = 'fact-abc123';

function makeEvent(overrides: Partial<FactTimelineEvent> = {}): FactTimelineEvent {
  return {
    edge_id: 'edge-001',
    relation: 'related_to',
    direction: 'outgoing',
    other_fact_id: 'fact-xyz789',
    other_fact_preview: 'Vector search policy prefers BM25 fallback for sparse queries',
    effective_from: OLDER,
    effective_until: null,
    edge_created_at: OLDER,
    source_fact_id: ENTITY_ID,
    target_fact_id: 'fact-xyz789',
    ...overrides,
  };
}

function makeTimeline(overrides: Partial<FactTimelineResponse> = {}): FactTimelineResponse {
  return {
    ok: true,
    entity: {
      requested_id: ENTITY_ID,
      resolved_fact_id: ENTITY_ID,
      content_preview: 'Project deploy checklist must include beta gate review',
      valid_from: OLDER,
      valid_until: null,
      confidence: 0.92,
      active_at_as_of: null,
      canonicalization_mode: 'fact-id-fallback',
    },
    as_of: null,
    limit: 20,
    next_cursor: null,
    events: [
      makeEvent(),
      makeEvent({
        edge_id: 'edge-002',
        relation: 'derived_from',
        direction: 'incoming',
        other_fact_id: 'fact-pqr456',
        other_fact_preview: 'Rollback procedure requires approval from two engineers',
        effective_from: NOW,
        source_fact_id: 'fact-pqr456',
        target_fact_id: ENTITY_ID,
      }),
    ],
    limitations: [],
    ...overrides,
  };
}

async function mockTimelineApis(
  page: Page,
  timeline: FactTimelineResponse | null = makeTimeline(),
): Promise<{ timelineRequests: { entity: string; as_of: string | null }[] }> {
  const timelineRequests: { entity: string; as_of: string | null }[] = [];

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
            totalFacts: 42,
            newThisWeek: 3,
            avgConfidence: 0.88,
            pendingConsolidation: 0,
            byScope: { global: 42 },
            byEntityType: { decision: 42 },
            strengthDistribution: { active: 40, decaying: 2, archived: 0 },
            growthTrend: [{ date: '2026-04-14', count: 42 }],
          },
        }),
      });
      return;
    }

    if (request.method() === 'GET' && pathname === '/api/memory/timeline') {
      const entity = searchParams.get('entity');
      const as_of = searchParams.get('as_of');
      timelineRequests.push({ entity: entity ?? '', as_of });

      if (!timeline || entity !== ENTITY_ID) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'NOT_FOUND', message: 'Fact not found' }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(timeline),
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

  return { timelineRequests };
}

async function openMemoryTimeline(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/memory/timeline');
  await expect(page.getByLabel('Fact ID')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Dismiss' }).click({ timeout: 2_000 }).catch(() => {});
}

test.describe('Memory Timeline page', () => {
  test('shows empty state before any fact ID is entered', async ({ page }) => {
    await mockTimelineApis(page);
    await openMemoryTimeline(page);

    await expect(page.getByTestId('timeline-empty')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load' })).toBeDisabled();
  });

  test('loads and renders entity card and edge events after entering a fact ID', async ({
    page,
  }) => {
    const { timelineRequests } = await mockTimelineApis(page);

    await openMemoryTimeline(page);

    await page.getByLabel('Fact ID').fill(ENTITY_ID);
    await page.getByRole('button', { name: 'Load' }).click();

    await expect(page.getByTestId('timeline-entity-card')).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText('Project deploy checklist must include beta gate review'),
    ).toBeVisible();
    await expect(page.getByText('Edge events (2)')).toBeVisible();
    await expect(page.getByText('related_to')).toBeVisible();
    await expect(page.getByText('derived_from')).toBeVisible();
    await expect(page.getByText('outgoing').first()).toBeVisible();
    await expect(page.getByText('incoming').first()).toBeVisible();
    await expect(
      page.getByText('Vector search policy prefers BM25 fallback for sparse queries'),
    ).toBeVisible();

    await expect
      .poll(() => timelineRequests.at(-1), { message: 'API called with entity ID' })
      .toMatchObject({ entity: ENTITY_ID, as_of: null });
  });

  test('submits the as_of parameter when provided', async ({ page }) => {
    const { timelineRequests } = await mockTimelineApis(page);

    await openMemoryTimeline(page);

    await page.getByLabel('Fact ID').fill(ENTITY_ID);
    await page.getByLabel('As of datetime').fill('2026-04-01T00:00:00Z');
    await page.getByRole('button', { name: 'Load' }).click();

    await expect(page.getByTestId('timeline-entity-card')).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(() => timelineRequests.at(-1))
      .toMatchObject({ entity: ENTITY_ID, as_of: '2026-04-01T00:00:00Z' });
  });

  test('shows error state when fact is not found', async ({ page }) => {
    await mockTimelineApis(page, null);

    await openMemoryTimeline(page);

    await page.getByLabel('Fact ID').fill('nonexistent-fact');
    await page.getByRole('button', { name: 'Load' }).click();

    await expect(page.getByTestId('timeline-error')).toBeVisible({ timeout: 10_000 });
  });

  test('shows empty events message when timeline has no edges', async ({ page }) => {
    const emptyTimeline = makeTimeline({ events: [] });
    await mockTimelineApis(page, emptyTimeline);

    await openMemoryTimeline(page);

    await page.getByLabel('Fact ID').fill(ENTITY_ID);
    await page.getByRole('button', { name: 'Load' }).click();

    await expect(page.getByTestId('timeline-no-events')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Edge events (0)')).toBeVisible();
  });

  test('displays limitations warning when the API returns them', async ({ page }) => {
    const timelineWithLimitations = makeTimeline({
      limitations: [
        'Edge temporal resolution is not yet available.',
        'Canonicalization is limited to fact ID lookups.',
      ],
    });
    await mockTimelineApis(page, timelineWithLimitations);

    await openMemoryTimeline(page);

    await page.getByLabel('Fact ID').fill(ENTITY_ID);
    await page.getByRole('button', { name: 'Load' }).click();

    await expect(page.getByTestId('timeline-limitations')).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText('Edge temporal resolution is not yet available.'),
    ).toBeVisible();
  });

  test('shows load more button when next_cursor is present and hides it when absent', async ({
    page,
  }) => {
    const paginatedTimeline = makeTimeline({ next_cursor: 'cursor-abc' });
    await mockTimelineApis(page, paginatedTimeline);

    await openMemoryTimeline(page);

    await page.getByLabel('Fact ID').fill(ENTITY_ID);
    await page.getByRole('button', { name: 'Load' }).click();

    await expect(page.getByTestId('timeline-load-more')).toBeVisible({ timeout: 10_000 });

    const noCursorTimeline = makeTimeline({ next_cursor: null });
    await mockTimelineApis(page, noCursorTimeline);

    // New search clears cursor
    await page.getByLabel('As of datetime').fill('2026-04-15T00:00:00Z');
    await page.getByRole('button', { name: 'Load' }).click();
    await expect(page.getByTestId('timeline-load-more')).toBeHidden({ timeout: 10_000 });
  });

  test('Timeline link is present in the memory sidebar nav', async ({ page }) => {
    await mockTimelineApis(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/memory/timeline');
    await expect(
      page.getByRole('navigation', { name: 'Memory navigation' }).getByRole('link', {
        name: 'Timeline',
      }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
