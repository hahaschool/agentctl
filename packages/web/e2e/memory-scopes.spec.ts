import type { MemoryScopeRecord, MemoryScopeType } from '@agentctl/shared';
import { type Page, type Route, expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = '2026-04-14T08:00:00.000Z';

function makeScope(overrides: Partial<MemoryScopeRecord> = {}): MemoryScopeRecord {
  return {
    id: 'project:agentctl',
    name: 'agentctl',
    type: 'project',
    parentId: 'global',
    factCount: 5,
    createdAt: NOW,
    ...overrides,
  };
}

const INITIAL_SCOPES: readonly MemoryScopeRecord[] = [
  makeScope({
    id: 'global',
    name: 'global',
    type: 'global',
    parentId: null,
    factCount: 42,
  }),
  makeScope({
    id: 'project:agentctl',
    name: 'agentctl',
    type: 'project',
    factCount: 7,
  }),
  makeScope({
    id: 'project:sidecar',
    name: 'sidecar',
    type: 'project',
    factCount: 3,
  }),
  makeScope({
    id: 'agent:worker-1',
    name: 'worker-1',
    type: 'agent',
    factCount: 1,
  }),
];

// ---------------------------------------------------------------------------
// Mock state + setup
// ---------------------------------------------------------------------------

type CreateCall = { readonly name: string; readonly type: MemoryScopeType };
type RenameCall = { readonly id: string; readonly name: string };
type DeleteCall = { readonly id: string; readonly cascade: boolean };
type MergeCall = { readonly sourceId: string; readonly targetId: string };

type ScopesMockState = {
  scopes: MemoryScopeRecord[];
  readonly createCalls: CreateCall[];
  readonly renameCalls: RenameCall[];
  readonly deleteCalls: DeleteCall[];
  readonly promoteCalls: string[];
  readonly mergeCalls: MergeCall[];
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockScopesApis(
  page: Page,
  initial: readonly MemoryScopeRecord[] = INITIAL_SCOPES,
): Promise<ScopesMockState> {
  const state: ScopesMockState = {
    scopes: initial.map((s) => ({ ...s })),
    createCalls: [],
    renameCalls: [],
    deleteCalls: [],
    promoteCalls: [],
    mergeCalls: [],
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname, searchParams } = url;
    const method = request.method();

    // Keep the notification bell quiet.
    if (method === 'GET' && pathname === '/api/sync/conflicts/count') {
      await fulfillJson(route, { count: 0 });
      return;
    }

    if (method === 'GET' && pathname === '/api/memory/scopes') {
      await fulfillJson(route, { ok: true, scopes: state.scopes });
      return;
    }

    if (method === 'POST' && pathname === '/api/memory/scopes') {
      const body = (request.postDataJSON() ?? {}) as CreateCall;
      state.createCalls.push(body);
      const created: MemoryScopeRecord = {
        id: `${body.type}:${body.name}`,
        name: body.name,
        type: body.type,
        parentId: 'global',
        factCount: 0,
        createdAt: NOW,
      };
      state.scopes = [...state.scopes, created];
      await fulfillJson(route, { ok: true, scope: created }, 201);
      return;
    }

    const scopeMatch = pathname.match(/^\/api\/memory\/scopes\/([^/]+)(?:\/(promote|merge))?$/);
    if (scopeMatch) {
      const id = decodeURIComponent(scopeMatch[1] ?? '');
      const action = scopeMatch[2];
      const target = state.scopes.find((s) => s.id === id);

      if (!action && method === 'PATCH') {
        const body = (request.postDataJSON() ?? {}) as { name: string };
        state.renameCalls.push({ id, name: body.name });
        if (!target) {
          await fulfillJson(route, { ok: false, error: 'NOT_FOUND' }, 404);
          return;
        }
        const renamed: MemoryScopeRecord = { ...target, name: body.name };
        state.scopes = state.scopes.map((s) => (s.id === id ? renamed : s));
        await fulfillJson(route, { ok: true, scope: renamed });
        return;
      }

      if (!action && method === 'DELETE') {
        const cascade = searchParams.get('cascade') === 'true';
        state.deleteCalls.push({ id, cascade });
        const prior = state.scopes.length;
        state.scopes = state.scopes.filter((s) => s.id !== id);
        await fulfillJson(route, { ok: true, id, deleted: prior - state.scopes.length });
        return;
      }

      if (action === 'promote' && method === 'POST') {
        state.promoteCalls.push(id);
        if (!target || !target.parentId) {
          await fulfillJson(route, { ok: false, error: 'NO_PARENT' }, 400);
          return;
        }
        const promoted = target.factCount;
        state.scopes = state.scopes.map((s) => {
          if (s.id === id) return { ...s, factCount: 0 };
          if (s.id === target.parentId) return { ...s, factCount: s.factCount + promoted };
          return s;
        });
        await fulfillJson(route, {
          ok: true,
          promoted,
          fromScope: id,
          toScope: target.parentId,
        });
        return;
      }

      if (action === 'merge' && method === 'POST') {
        const body = (request.postDataJSON() ?? {}) as { targetId: string };
        state.mergeCalls.push({ sourceId: id, targetId: body.targetId });
        if (!target) {
          await fulfillJson(route, { ok: false, error: 'NOT_FOUND' }, 404);
          return;
        }
        const merged = target.factCount;
        state.scopes = state.scopes
          .filter((s) => s.id !== id)
          .map((s) =>
            s.id === body.targetId ? { ...s, factCount: s.factCount + merged } : s,
          );
        await fulfillJson(route, {
          ok: true,
          merged,
          fromScope: id,
          toScope: body.targetId,
        });
        return;
      }
    }

    await fulfillJson(
      route,
      {
        ok: false,
        error: 'UNEXPECTED_E2E_REQUEST',
        message: `${method} ${pathname}`,
      },
      404,
    );
  });

  return state;
}

async function openScopesPage(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/memory/scopes');
  await expect(page.getByRole('heading', { name: 'Memory Scopes' })).toBeVisible({
    timeout: 15_000,
  });
}

async function openActionsMenu(page: Page, scopeName: string): Promise<void> {
  await page.getByRole('button', { name: `Actions for ${scopeName}` }).click({ force: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Memory scopes manager', () => {
  test('renders the scope tree with names, types, and fact counts', async ({ page }) => {
    await mockScopesApis(page);

    await openScopesPage(page);

    const tree = page.getByTestId('scope-tree');
    await expect(tree).toBeVisible();

    // Global root appears once with its fact count.
    await expect(tree.getByText('global', { exact: true }).first()).toBeVisible();
    await expect(tree.getByText('42 facts')).toBeVisible();

    // Children sorted alphabetically: agentctl, sidecar, worker-1.
    await expect(tree.getByText('agentctl')).toBeVisible();
    await expect(tree.getByText('sidecar')).toBeVisible();
    await expect(tree.getByText('worker-1')).toBeVisible();
    await expect(tree.getByText('7 facts')).toBeVisible();
    await expect(tree.getByText('3 facts')).toBeVisible();
    await expect(tree.getByText('1 fact')).toBeVisible();

    // Loading skeleton should be gone once data resolves.
    await expect(page.getByTestId('scopes-loading')).toBeHidden();
    await expect(page.getByTestId('scopes-empty')).toBeHidden();
  });

  test('shows an empty state with a create shortcut when no scopes exist', async ({ page }) => {
    await mockScopesApis(page, []);

    await openScopesPage(page);

    await expect(page.getByTestId('scopes-empty')).toBeVisible();
    await expect(page.getByTestId('scope-tree')).toBeHidden();

    // CTA inside the empty state opens the create dialog.
    await page.getByRole('button', { name: /Create your first scope/i }).click();
    await expect(page.getByRole('dialog', { name: 'Create Memory Scope' })).toBeVisible();
  });

  test('creates a new scope through the dialog and it appears in the tree', async ({ page }) => {
    const state = await mockScopesApis(page);

    await openScopesPage(page);

    await page.getByRole('button', { name: /New Scope/ }).click();

    const dialog = page.getByRole('dialog', { name: 'Create Memory Scope' });
    await expect(dialog).toBeVisible();

    // Default type is "project"; just set a name and submit.
    await dialog.getByLabel('Name').fill('billing');
    // Live preview updates with the typed name.
    await expect(dialog.getByText('project:billing')).toBeVisible();

    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect
      .poll(() => state.createCalls, { message: 'POST /api/memory/scopes captured' })
      .toEqual([{ name: 'billing', type: 'project' }]);

    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('scope-tree').getByText('billing')).toBeVisible();
  });

  test('renames an existing scope via the actions menu', async ({ page }) => {
    const state = await mockScopesApis(page);

    await openScopesPage(page);

    await openActionsMenu(page, 'sidecar');
    await page.getByRole('menuitem', { name: 'Rename' }).click();

    const dialog = page.getByRole('dialog', { name: 'Rename Scope' });
    await expect(dialog).toBeVisible();

    const nameField = dialog.getByLabel('New Name');
    await expect(nameField).toHaveValue('sidecar');
    await nameField.fill('sidecar-prod');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect
      .poll(() => state.renameCalls, { message: 'PATCH /api/memory/scopes/:id captured' })
      .toEqual([{ id: 'project:sidecar', name: 'sidecar-prod' }]);

    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('scope-tree').getByText('sidecar-prod')).toBeVisible();
    await expect(page.getByTestId('scope-tree').getByText('sidecar', { exact: true })).toBeHidden();
  });

  test('deletes a scope with cascade when it still contains facts', async ({ page }) => {
    const state = await mockScopesApis(page);

    await openScopesPage(page);

    await openActionsMenu(page, 'agentctl');
    await page.getByRole('menuitem', { name: /Delete scope/i }).click();

    const confirm = page.getByRole('alertdialog', { name: 'Delete Scope' });
    await expect(confirm).toBeVisible();
    // 7 facts trigger the cascade warning copy.
    await expect(confirm.getByText(/and its 7 facts/i)).toBeVisible();

    await confirm.getByRole('button', { name: 'Delete' }).click();

    await expect
      .poll(() => state.deleteCalls, { message: 'DELETE /api/memory/scopes/:id captured' })
      .toEqual([{ id: 'project:agentctl', cascade: true }]);

    await expect(confirm).toBeHidden();
    await expect(page.getByTestId('scope-tree').getByText('agentctl')).toBeHidden();
    // Siblings remain.
    await expect(page.getByTestId('scope-tree').getByText('sidecar')).toBeVisible();
  });

  test('merges one scope into a sibling via the merge dialog', async ({ page }) => {
    const state = await mockScopesApis(page);

    await openScopesPage(page);

    await openActionsMenu(page, 'sidecar');
    await page.getByRole('menuitem', { name: /Merge into sibling/i }).click();

    const merge = page.getByRole('alertdialog', { name: 'Merge Scope' });
    await expect(merge).toBeVisible();
    // Description mentions the source scope id.
    await expect(merge.getByText(/project:sidecar/)).toBeVisible();

    await merge.getByRole('button', { name: 'Merge' }).click();

    await expect
      .poll(() => state.mergeCalls, { message: 'POST /api/memory/scopes/:id/merge captured' })
      .toHaveLength(1);
    expect(state.mergeCalls[0]).toMatchObject({ sourceId: 'project:sidecar' });
    expect(state.mergeCalls[0]?.targetId).not.toBe('project:sidecar');

    await expect(merge).toBeHidden();
    await expect(page.getByTestId('scope-tree').getByText('sidecar', { exact: true })).toBeHidden();
  });
});
