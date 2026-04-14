import { expect, type Page, type Route, test } from '@playwright/test';

type MemoryScopeType = 'global' | 'project' | 'agent' | 'session';

type MemoryScopeRecord = {
  id: string;
  name: string;
  type: MemoryScopeType;
  parentId: string | null;
  factCount: number;
  createdAt: string;
};

type CreateScopeBody = {
  name: string;
  type: MemoryScopeType;
};

type DeleteScopeCall = {
  id: string;
  cascade: boolean;
};

type MemoryScopesMockState = {
  scopes: MemoryScopeRecord[];
  createCalls: CreateScopeBody[];
  deleteCalls: DeleteScopeCall[];
};

function makeScope(overrides: Partial<MemoryScopeRecord>): MemoryScopeRecord {
  return {
    id: 'global',
    name: 'global',
    type: 'global',
    parentId: null,
    factCount: 0,
    createdAt: '2026-04-14T06:00:00.000Z',
    ...overrides,
  };
}

function makeState(): MemoryScopesMockState {
  return {
    scopes: [
      makeScope({ id: 'global', name: 'global', type: 'global', factCount: 24 }),
      makeScope({
        id: 'project:agentctl',
        name: 'agentctl',
        type: 'project',
        parentId: 'global',
        factCount: 12,
      }),
      makeScope({
        id: 'project:mobile-app',
        name: 'mobile-app',
        type: 'project',
        parentId: 'global',
        factCount: 4,
      }),
      makeScope({
        id: 'agent:memory-worker',
        name: 'memory-worker',
        type: 'agent',
        parentId: 'project:agentctl',
        factCount: 3,
      }),
      makeScope({
        id: 'session:scope-review',
        name: 'scope-review',
        type: 'session',
        parentId: 'project:agentctl',
        factCount: 1,
      }),
    ],
    createCalls: [],
    deleteCalls: [],
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockMemoryScopesApis(page: Page, state: MemoryScopesMockState): Promise<void> {
  await page.route('**/health?**', async (route) => {
    await fulfillJson(route, {
      ok: true,
      status: 'healthy',
      services: { litellm: { ok: true, message: 'mocked' } },
    });
  });

  await page.route('**/metrics', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();

    if (method === 'GET' && pathname === '/api/memory/scopes') {
      await fulfillJson(route, { ok: true, scopes: state.scopes });
      return;
    }

    if (method === 'POST' && pathname === '/api/memory/scopes') {
      const body = (request.postDataJSON() ?? {}) as CreateScopeBody;
      state.createCalls.push(body);

      const scope = makeScope({
        id: `${body.type}:${body.name}`,
        name: body.name,
        type: body.type,
        parentId: 'global',
        factCount: 0,
      });
      state.scopes = [...state.scopes, scope];

      await fulfillJson(route, { ok: true, scope }, 201);
      return;
    }

    const scopeMatch = pathname.match(/^\/api\/memory\/scopes\/([^/]+)$/);
    if (method === 'DELETE' && scopeMatch) {
      const id = decodeURIComponent(scopeMatch[1] ?? '');
      const cascade = url.searchParams.get('cascade') === 'true';
      state.deleteCalls.push({ id, cascade });
      state.scopes = state.scopes.filter((scope) => scope.id !== id);

      await fulfillJson(route, { ok: true, id, deleted: 1 });
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

    throw new Error(`Unhandled API request in memory scopes e2e mock: ${method} ${pathname}`);
  });
}

test.describe('Memory scopes page', () => {
  test('renders the scope tree and creates a project scope without a backend', async ({
    page,
  }) => {
    const state = makeState();
    await mockMemoryScopesApis(page, state);

    await page.goto('/memory/scopes');

    await expect(page.getByRole('heading', { name: 'Memory Scopes' })).toBeVisible();
    const tree = page.getByTestId('scope-tree');
    await expect(tree).toBeVisible();
    await expect(tree.getByText('agentctl', { exact: true })).toBeVisible();
    await expect(tree.getByText('memory-worker')).toBeVisible();
    await expect(tree.getByText('24 facts')).toBeVisible();
    await expect(tree.getByText('1 fact')).toBeVisible();

    await page.getByRole('button', { name: 'New Scope' }).click();
    await expect(page.getByRole('dialog').getByText('Create Memory Scope')).toBeVisible();
    await page.getByLabel('Name').fill('cli-tools');
    await expect(page.getByText('project:cli-tools')).toBeVisible();

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/memory/scopes',
      ),
      page.getByRole('button', { name: 'Create' }).click(),
    ]);

    await expect(tree.getByText('cli-tools')).toBeVisible();
    expect(state.createCalls).toEqual([{ name: 'cli-tools', type: 'project' }]);
  });

  test('requires confirmation before deleting a populated scope with cascade', async ({ page }) => {
    const state = makeState();
    await mockMemoryScopesApis(page, state);

    await page.goto('/memory/scopes');
    const tree = page.getByTestId('scope-tree');
    await expect(tree.getByText('memory-worker')).toBeVisible();

    await tree.getByText('memory-worker').hover();
    await page.getByLabel('Actions for memory-worker').click();
    await page.getByRole('menuitem', { name: 'Delete scope' }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('heading', { name: 'Delete Scope' })).toBeVisible();
    await expect(dialog.getByText('agent:memory-worker', { exact: true })).toBeVisible();
    await expect(dialog.getByText('3 facts')).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(state.deleteCalls).toEqual([]);
    await expect(tree.getByText('memory-worker')).toBeVisible();

    await tree.getByText('memory-worker').hover();
    await page.getByLabel('Actions for memory-worker').click();
    await page.getByRole('menuitem', { name: 'Delete scope' }).click();

    await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === 'DELETE' &&
          url.pathname === '/api/memory/scopes/agent%3Amemory-worker' &&
          url.searchParams.get('cascade') === 'true'
        );
      }),
      page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click(),
    ]);

    await expect(tree.getByText('memory-worker')).toHaveCount(0);
    expect(state.deleteCalls).toEqual([{ id: 'agent:memory-worker', cascade: true }]);
  });
});
