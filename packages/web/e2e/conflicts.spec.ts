import { expect, type Page, test } from '@playwright/test';

type ConflictResponse = {
  id: string;
  tableName: string;
  rowId: string;
  localVclock: Record<string, number>;
  localPayload: Record<string, unknown> | null;
  remoteVclock: Record<string, number>;
  remotePayload: Record<string, unknown> | null;
  remoteNodeId: string;
  status: 'pending' | 'resolved';
  resolution: 'local' | 'remote' | 'merged' | null;
  resolvedAt: string | null;
  createdAt: string;
};

type ResolveRequest = {
  id: string;
  resolution: 'local' | 'remote' | 'merged';
  payload?: Record<string, unknown> | null;
};

function createConflict(overrides: Partial<ConflictResponse> = {}): ConflictResponse {
  return {
    id: 'conflict-1',
    tableName: 'agent_runs',
    rowId: 'row-1234567890abcdef',
    localVclock: { local: 2 },
    localPayload: { status: 'running', machineId: 'machine-local' },
    remoteVclock: { remote: 3 },
    remotePayload: { status: 'ended', machineId: 'machine-remote' },
    remoteNodeId: 'mesh-node-remote-1',
    status: 'pending',
    resolution: null,
    resolvedAt: null,
    createdAt: '2026-04-01T10:00:00.000Z',
    ...overrides,
  };
}

const NORMAL_CONFLICT: ConflictResponse = {
  id: 'conflict-normal-1',
  tableName: 'agents',
  rowId: 'agent-row-1234567890',
  localVclock: { local: 2, 'remote-node-primary-1234567890': 1 },
  localPayload: { name: 'Local Agent', status: 'paused', retries: 1 },
  remoteVclock: { local: 2, 'remote-node-primary-1234567890': 2 },
  remotePayload: { name: 'Remote Agent', status: 'running', retries: 1, owner: 'ops' },
  remoteNodeId: 'remote-node-primary-1234567890',
  status: 'pending',
  resolution: null,
  resolvedAt: null,
  createdAt: '2026-04-01T08:00:00.000Z',
};

const DELETE_CONFLICT: ConflictResponse = {
  id: 'conflict-delete-1',
  tableName: 'api_accounts',
  rowId: 'account-row-0987654321',
  localVclock: { local: 3, 'remote-node-delete-1234567890': 1 },
  localPayload: null,
  remoteVclock: { local: 3, 'remote-node-delete-1234567890': 2 },
  remotePayload: { provider: 'claude_team', label: 'Shared Account' },
  remoteNodeId: 'remote-node-delete-1234567890',
  status: 'pending',
  resolution: null,
  resolvedAt: null,
  createdAt: '2026-04-01T08:05:00.000Z',
};

function cloneConflict(conflict: ConflictResponse): ConflictResponse {
  return JSON.parse(JSON.stringify(conflict)) as ConflictResponse;
}

async function interceptConflictsApi(
  page: Page,
  options: {
    conflicts?: ConflictResponse[];
    onResolve?: (request: ResolveRequest) => void;
  } = {},
): Promise<{ resolutionRequests: ResolveRequest[] }> {
  let conflicts = (options.conflicts ?? []).map(cloneConflict);
  const resolutionRequests: ResolveRequest[] = [];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/sync/conflicts') {
      const status = url.searchParams.get('status');
      const table = url.searchParams.get('table');
      const remoteNodeId = url.searchParams.get('remoteNodeId');

      const filtered = conflicts.filter((conflict) => {
        if (status && conflict.status !== status) return false;
        if (table && conflict.tableName !== table) return false;
        if (remoteNodeId && conflict.remoteNodeId !== remoteNodeId) return false;
        return true;
      });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          conflicts: filtered,
          total: filtered.length,
        }),
      });
      return;
    }

    if (request.method() === 'GET' && url.pathname === '/api/sync/conflicts/count') {
      const count = conflicts.filter((conflict) => conflict.status === 'pending').length;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count }),
      });
      return;
    }

    if (
      request.method() === 'PUT' &&
      /^\/api\/sync\/conflicts\/[^/]+\/resolve$/.test(url.pathname)
    ) {
      const id = url.pathname.split('/')[4] ?? '';
      const body = request.postDataJSON() as {
        resolution: 'local' | 'remote' | 'merged';
        payload?: Record<string, unknown> | null;
      };

      const resolveRequest: ResolveRequest = {
        id,
        resolution: body.resolution,
        payload: body.payload,
      };
      resolutionRequests.push(resolveRequest);
      options.onResolve?.(resolveRequest);

      conflicts = conflicts.map((conflict) =>
        conflict.id === id
          ? {
              ...conflict,
              status: 'resolved',
              resolution: body.resolution,
              resolvedAt: '2026-04-01T10:05:00.000Z',
            }
          : conflict,
      );

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          resolution: body.resolution,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'NOT_FOUND', message: 'Not found' }),
    });
  });

  return { resolutionRequests };
}

async function openConflictsPage(
  page: Page,
  conflicts: ConflictResponse[],
): Promise<{ resolutionRequests: ResolveRequest[] }> {
  const state = await interceptConflictsApi(page, { conflicts });
  await page.goto('/conflicts');
  await expect(page.getByRole('heading', { name: /sync conflicts/i })).toBeVisible({
    timeout: 15_000,
  });
  return state;
}

test.describe('Conflicts page', () => {
  test.beforeEach(async ({ page }) => {
    await interceptConflictsApi(page);
    await page.goto('/conflicts');
  });

  test('page loads with Sync Conflicts heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /sync conflicts/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('shows empty state when no conflicts exist', async ({ page }) => {
    await expect(page.getByText('No sync conflicts found')).toBeVisible({ timeout: 15_000 });
  });

  test('filter dropdowns render', async ({ page }) => {
    await expect(page.getByLabel('Filter by status')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Filter by table')).toBeVisible();
    await expect(page.getByLabel('Filter by peer')).toBeVisible();
  });

  test('selecting and resolving a conflict updates the list and sidebar badge', async ({
    page,
  }) => {
    let resolveRequest: ResolveRequest | null = null;
    await interceptConflictsApi(page, {
      conflicts: [createConflict()],
      onResolve: (request) => {
        resolveRequest = request;
      },
    });

    await page.goto('/conflicts');

    const conflictsNav = page.locator('a[href="/conflicts"]');
    await expect(conflictsNav.getByText('1', { exact: true })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /agent_runs/i }).click();
    await expect(page.getByRole('button', { name: 'Keep Remote' })).toBeVisible();

    await page.getByRole('button', { name: 'Keep Remote' }).click();

    await expect
      .poll(() => resolveRequest)
      .toEqual({
        id: 'conflict-1',
        resolution: 'remote',
        payload: undefined,
      });

    await expect(page.getByText('Conflict resolved: remote')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('No sync conflicts found')).toBeVisible({ timeout: 15_000 });
    await expect(conflictsNav.getByText('1', { exact: true })).toHaveCount(0);
  });

  test('manual merge sends the edited payload to the resolve endpoint', async ({ page }) => {
    let resolveRequest: ResolveRequest | null = null;
    await interceptConflictsApi(page, {
      conflicts: [createConflict()],
      onResolve: (request) => {
        resolveRequest = request;
      },
    });

    await page.goto('/conflicts');

    await page.getByRole('button', { name: /agent_runs/i }).click();
    await page.getByRole('button', { name: 'Edit & Merge' }).click();

    const editor = page.getByLabel('Merged payload (edit JSON)');
    await editor.fill(
      JSON.stringify(
        {
          status: 'synced',
          machineId: 'machine-merged',
        },
        null,
        2,
      ),
    );

    await page.getByRole('button', { name: 'Apply Merge' }).click();

    await expect
      .poll(() => resolveRequest)
      .toEqual({
        id: 'conflict-1',
        resolution: 'merged',
        payload: {
          status: 'synced',
          machineId: 'machine-merged',
        },
      });

    await expect(page.getByText('Conflict resolved: merged')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('No sync conflicts found')).toBeVisible({ timeout: 15_000 });
  });

  test('shows populated conflicts, supports filters, and opens selected details', async ({
    page,
  }) => {
    await openConflictsPage(page, [NORMAL_CONFLICT, DELETE_CONFLICT]);

    await expect(page.getByText('2 pending')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Select a conflict to view details')).toBeVisible();

    await page.getByLabel('Filter by table').selectOption('agents');
    await expect(page.getByRole('button', { name: /agents/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /api_accounts/i })).toHaveCount(0);

    await page.getByLabel('Filter by peer').selectOption(NORMAL_CONFLICT.remoteNodeId);

    await page.getByRole('button', { name: /agents/i }).click();

    await expect(page.getByText(/Table:\s*agents/)).toBeVisible();
    await expect(page.getByText('Local (this node)')).toBeVisible();
    await expect(page.getByText(/Remote \(/)).toBeVisible();
    await expect(page.getByText('Keep Local')).toBeVisible();
    await expect(page.getByText('Keep Remote')).toBeVisible();
    await expect(page.getByText('Edit & Merge')).toBeVisible();
    await expect(page.getByText('Local vclock:')).toBeVisible();
    await expect(page.getByText('Remote vclock:')).toBeVisible();
  });

  test('restores delete conflicts and refreshes the pending state', async ({ page }) => {
    const { resolutionRequests } = await openConflictsPage(page, [DELETE_CONFLICT]);

    await expect(page.getByText('1 pending')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /api_accounts/i }).click();

    await expect(page.getByText('DELETED', { exact: true })).toBeVisible();
    await expect(page.getByText('Restore')).toBeVisible();
    await expect(page.getByText('Edit & Merge')).toHaveCount(0);

    await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === 'PUT' && url.pathname.endsWith('/resolve');
      }),
      page.getByRole('button', { name: 'Restore', exact: true }).click(),
    ]);

    await expect(page.getByText('No sync conflicts found')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('All conflicts have been resolved.')).toBeVisible();
    await expect(page.getByText('1 pending')).toHaveCount(0);
    expect(resolutionRequests).toEqual([
      {
        id: DELETE_CONFLICT.id,
        resolution: 'remote',
        payload: undefined,
      },
    ]);
  });

  test('validates merge JSON and submits a merged resolution', async ({ page }) => {
    const { resolutionRequests } = await openConflictsPage(page, [NORMAL_CONFLICT]);

    await page.getByRole('button', { name: /agents/i }).click();
    await page.getByRole('button', { name: 'Edit & Merge', exact: true }).click();

    const mergeEditor = page.getByLabel('Merged payload (edit JSON)');
    await expect(mergeEditor).toBeVisible();
    await expect(mergeEditor).toHaveValue(/"owner": "ops"/);

    await mergeEditor.fill('{invalid json');
    await page.getByRole('button', { name: 'Apply Merge', exact: true }).click();
    await expect(page.getByText('Invalid JSON', { exact: true })).toBeVisible();

    const mergedPayload = {
      name: 'Merged Agent',
      status: 'running',
      retries: 2,
      owner: 'ops',
    };

    await mergeEditor.fill(JSON.stringify(mergedPayload, null, 2));

    await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === 'PUT' && url.pathname.endsWith('/resolve');
      }),
      page.getByRole('button', { name: 'Apply Merge', exact: true }).click(),
    ]);

    await expect(page.getByText('No sync conflicts found')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('All conflicts have been resolved.')).toBeVisible();
    expect(resolutionRequests).toEqual([
      {
        id: NORMAL_CONFLICT.id,
        resolution: 'merged',
        payload: mergedPayload,
      },
    ]);
  });
});
