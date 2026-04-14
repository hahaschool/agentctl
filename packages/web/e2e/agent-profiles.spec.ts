import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * Backend-independent coverage for the Agent Profiles page.
 *
 * The spec mocks every `/api/**` request so it only needs the Next.js dev
 * server on $WEB_PORT and never depends on live beta/dev control-plane
 * services.
 */

type AgentRuntimeType = 'claude-code' | 'codex' | 'openclaw' | 'nanoclaw';

type AgentProfile = {
  id: string;
  name: string;
  runtimeType: AgentRuntimeType;
  modelId: string;
  providerId: string;
  capabilities: string[];
  toolScopes: string[];
  maxTokensPerTask: number | null;
  maxCostPerHour: number | null;
  createdAt: string;
};

type CreateAgentProfileBody = {
  name: string;
  runtimeType: AgentRuntimeType;
  modelId: string;
  providerId: string;
  capabilities?: string[];
  toolScopes?: string[];
  maxTokensPerTask?: number | null;
  maxCostPerHour?: number | null;
};

type MockState = {
  profiles: AgentProfile[];
  createCalls: CreateAgentProfileBody[];
  deleteCalls: string[];
  listError: { status: number; message: string } | null;
  deleteErrors: Map<string, { status: number; message: string }>;
};

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'profile-reviewer',
    name: 'code-reviewer',
    runtimeType: 'claude-code',
    modelId: 'claude-opus-4-5',
    providerId: 'anthropic',
    capabilities: ['code-review'],
    toolScopes: ['Read', 'Grep'],
    maxTokensPerTask: null,
    maxCostPerHour: null,
    createdAt: '2026-04-14T08:00:00.000Z',
    ...overrides,
  };
}

function makeState(profiles: AgentProfile[] = []): MockState {
  return {
    profiles,
    createCalls: [],
    deleteCalls: [],
    listError: null,
    deleteErrors: new Map(),
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mountApiMocks(page: Page, state: MockState): Promise<void> {
  await page.route('**/health?**', async (route) => {
    await fulfillJson(route, {
      ok: true,
      status: 'healthy',
      dependencies: { litellm: { status: 'ok' } },
    });
  });

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const { pathname } = url;

    if (method === 'GET' && pathname === '/api/agent-profiles') {
      if (state.listError) {
        await fulfillJson(
          route,
          { error: 'AGENT_PROFILES_UNAVAILABLE', message: state.listError.message },
          state.listError.status,
        );
        return;
      }
      await fulfillJson(route, state.profiles);
      return;
    }

    if (method === 'POST' && pathname === '/api/agent-profiles') {
      const body = (req.postDataJSON() ?? {}) as CreateAgentProfileBody;
      state.createCalls.push(body);
      const created = makeProfile({
        id: `profile-${state.profiles.length + 1}`,
        name: body.name,
        runtimeType: body.runtimeType,
        modelId: body.modelId,
        providerId: body.providerId,
        capabilities: body.capabilities ?? [],
        toolScopes: body.toolScopes ?? [],
        maxTokensPerTask: body.maxTokensPerTask ?? null,
        maxCostPerHour: body.maxCostPerHour ?? null,
        createdAt: new Date().toISOString(),
      });
      state.profiles = [...state.profiles, created];
      await fulfillJson(route, created, 201);
      return;
    }

    const profileMatch = pathname.match(/^\/api\/agent-profiles\/([^/]+)$/);
    if (method === 'DELETE' && profileMatch) {
      const id = decodeURIComponent(profileMatch[1] ?? '');
      state.deleteCalls.push(id);

      const deleteError = state.deleteErrors.get(id);
      if (deleteError) {
        await fulfillJson(
          route,
          { error: 'DELETE_AGENT_PROFILE_FAILED', message: deleteError.message },
          deleteError.status,
        );
        return;
      }

      state.profiles = state.profiles.filter((profile) => profile.id !== id);
      await fulfillJson(route, { ok: true });
      return;
    }

    // Safe payloads for explicit app-shell boot requests.
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

    throw new Error(`Unhandled API request in agent-profiles e2e mock: ${method} ${pathname}`);
  });
}

test.describe('Agent Profiles page', () => {
  test('renders profile rows with runtime, model, provider, and capabilities', async ({ page }) => {
    const state = makeState([
      makeProfile({
        id: 'profile-reviewer',
        name: 'code-reviewer',
        runtimeType: 'claude-code',
        modelId: 'claude-opus-4-5',
        providerId: 'anthropic',
        capabilities: ['code-review', 'planning'],
      }),
      makeProfile({
        id: 'profile-codex',
        name: 'codex-builder',
        runtimeType: 'codex',
        modelId: 'gpt-5.4',
        providerId: 'openai',
        capabilities: [],
      }),
    ]);
    await mountApiMocks(page, state);

    await page.goto('/agent-profiles');

    await expect(page.getByRole('heading', { name: 'Agent Profiles' })).toBeVisible();
    await expect(page.getByText('2 total', { exact: true })).toBeVisible();

    const table = page.getByRole('table', { name: 'Agent profiles' });
    await expect(table).toBeVisible();

    for (const header of ['Name', 'Runtime', 'Model', 'Provider', 'Capabilities', 'Action']) {
      await expect(table.getByRole('columnheader', { name: header })).toBeVisible();
    }

    const reviewerRow = table.getByRole('row').filter({ hasText: 'code-reviewer' });
    await expect(reviewerRow.getByText('profile-reviewer')).toBeVisible();
    await expect(reviewerRow.getByText('claude-code', { exact: true })).toBeVisible();
    await expect(reviewerRow.getByText('claude-opus-4-5')).toBeVisible();
    await expect(reviewerRow.getByText('anthropic')).toBeVisible();
    await expect(reviewerRow.getByText('code-review, planning')).toBeVisible();

    const codexRow = table.getByRole('row').filter({ hasText: 'codex-builder' });
    await expect(codexRow.getByText('codex', { exact: true })).toBeVisible();
    await expect(codexRow.getByText('gpt-5.4')).toBeVisible();
    await expect(codexRow.getByText('openai')).toBeVisible();
    await expect(codexRow.getByText('—')).toBeVisible();
  });

  test('shows the empty state and creates a profile with sanitized payload fields', async ({
    page,
  }) => {
    const state = makeState();
    await mountApiMocks(page, state);

    await page.goto('/agent-profiles');

    await expect(page.getByTestId('agent-profiles-empty')).toBeVisible();
    await expect(page.getByText('No agent profiles yet.')).toBeVisible();

    await page.getByTestId('empty-new-agent-profile').click();
    const dialog = page.getByTestId('agent-profile-form-dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByTestId('agent-profile-submit').click();
    await expect(dialog.getByTestId('agent-profile-form-error')).toHaveText('Name is required');
    expect(state.createCalls).toHaveLength(0);

    await dialog.locator('#agent-profile-name').fill('  codex-builder  ');
    await dialog.locator('#agent-profile-runtime').selectOption('codex');
    await dialog.locator('#agent-profile-model').fill('gpt-5.4');
    await dialog.locator('#agent-profile-provider').fill('openai');
    await dialog.locator('#agent-profile-capabilities').fill('code-review, planning, , shell');
    await dialog.locator('#agent-profile-tool-scopes').fill('Read, Grep, Bash');

    const createRequest = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/agent-profiles',
    );
    await dialog.getByTestId('agent-profile-submit').click();
    await createRequest;

    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('alert').filter({ hasText: /Profile codex-builder created/i }),
    ).toBeVisible();

    expect(state.createCalls).toEqual([
      {
        name: 'codex-builder',
        runtimeType: 'codex',
        modelId: 'gpt-5.4',
        providerId: 'openai',
        capabilities: ['code-review', 'planning', 'shell'],
        toolScopes: ['Read', 'Grep', 'Bash'],
      },
    ]);

    const table = page.getByRole('table', { name: 'Agent profiles' });
    const createdRow = table.getByRole('row').filter({ hasText: 'codex-builder' });
    await expect(createdRow.getByText('gpt-5.4')).toBeVisible();
    await expect(createdRow.getByText('code-review, planning, shell')).toBeVisible();
  });

  test('requires delete confirmation and removes the row on success', async ({ page }) => {
    const state = makeState([makeProfile({ id: 'profile-delete-me', name: 'delete-me' })]);
    await mountApiMocks(page, state);

    await page.goto('/agent-profiles');
    await expect(page.getByRole('row').filter({ hasText: 'delete-me' })).toBeVisible();

    await page.getByTestId('delete-profile-delete-me').click();
    const confirm = page.getByTestId('agent-profile-delete-confirm');
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText('delete-me')).toBeVisible();

    const deleteRequest = page.waitForRequest(
      (r) =>
        r.method() === 'DELETE' &&
        new URL(r.url()).pathname === '/api/agent-profiles/profile-delete-me',
    );
    await confirm.getByTestId('confirm-delete-agent-profile').click();
    await deleteRequest;

    expect(state.deleteCalls).toEqual(['profile-delete-me']);
    await expect(
      page.getByRole('alert').filter({ hasText: /Profile delete-me deleted/i }),
    ).toBeVisible();
    await expect(page.getByText('No agent profiles yet.')).toBeVisible();
  });

  test('closes delete confirmation and shows an error toast when delete fails', async ({
    page,
  }) => {
    const state = makeState([makeProfile({ id: 'profile-busy', name: 'busy-profile' })]);
    state.deleteErrors.set('profile-busy', {
      status: 409,
      message: 'Profile has active instances',
    });
    await mountApiMocks(page, state);

    await page.goto('/agent-profiles');

    await page.getByTestId('delete-profile-busy').click();
    const confirm = page.getByTestId('agent-profile-delete-confirm');
    await expect(confirm).toBeVisible();

    const deleteRequest = page.waitForRequest(
      (r) =>
        r.method() === 'DELETE' && new URL(r.url()).pathname === '/api/agent-profiles/profile-busy',
    );
    await confirm.getByTestId('confirm-delete-agent-profile').click();
    await deleteRequest;

    expect(state.deleteCalls).toEqual(['profile-busy']);
    await expect(confirm).toBeHidden();
    await expect(
      page.getByRole('alert').filter({ hasText: /Profile has active instances/i }),
    ).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'busy-profile' })).toBeVisible();
  });

  test('shows the API error banner and retries after the list endpoint recovers', async ({
    page,
  }) => {
    const state = makeState([
      makeProfile({
        id: 'profile-recovered',
        name: 'recovered-profile',
        modelId: 'claude-sonnet-4-6',
      }),
    ]);
    state.listError = { status: 503, message: 'Profile service unavailable' };
    await mountApiMocks(page, state);

    await page.goto('/agent-profiles');

    const banner = page.getByRole('alert').filter({
      hasText: /Failed to load agent profiles: Profile service unavailable/i,
    });
    await expect(banner).toBeVisible();
    await expect(page.getByTestId('agent-profiles-empty')).toBeHidden();

    state.listError = null;
    await banner.getByRole('button', { name: 'Retry' }).click();

    await expect(page.getByRole('row').filter({ hasText: 'recovered-profile' })).toBeVisible();
    await expect(page.getByText('claude-sonnet-4-6')).toBeVisible();
  });
});
