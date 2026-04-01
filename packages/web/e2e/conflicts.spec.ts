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

async function interceptConflictsApi(
  page: Page,
  options: {
    conflicts?: ConflictResponse[];
    onResolve?: (request: ResolveRequest) => void;
  } = {},
): Promise<void> {
  let conflicts = [...(options.conflicts ?? [])];

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

      options.onResolve?.({
        id,
        resolution: body.resolution,
        payload: body.payload,
      });

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
    await expect(page.getByText('No sync conflicts found.')).toBeVisible({ timeout: 15_000 });
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
    await expect(page.getByText('No sync conflicts found.')).toBeVisible({ timeout: 15_000 });
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
    await expect(page.getByText('No sync conflicts found.')).toBeVisible({ timeout: 15_000 });
  });
});
