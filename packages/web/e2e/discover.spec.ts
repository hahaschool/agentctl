import { expect, type Page, type Route, test } from '@playwright/test';

type DiscoveredSession = {
  sessionId: string;
  projectPath: string;
  summary: string;
  messageCount: number;
  lastActivity: string;
  branch: string | null;
  runtime?: 'claude-code' | 'codex';
  machineId: string;
  hostname: string;
};

type CreateSessionBody = {
  agentId: string;
  machineId: string;
  projectPath: string;
  prompt?: string;
  resumeSessionId?: string;
  runtime?: string;
};

type DiscoverMockState = {
  sessions: DiscoveredSession[];
  existingClaudeSessionIds: string[];
  createCalls: CreateSessionBody[];
};

const DISCOVERED_SESSIONS: DiscoveredSession[] = [
  {
    sessionId: 'session-agents-refactor',
    projectPath: '/Users/hahaschool/agentctl',
    summary: '<b>Refactor dashboard agent queue</b>',
    messageCount: 18,
    lastActivity: '2026-04-14T06:30:00.000Z',
    branch: 'agent/refactor-dashboard',
    runtime: 'codex',
    machineId: 'machine-beta',
    hostname: 'beta-host',
  },
  {
    sessionId: 'session-imported-docs',
    projectPath: '/Users/hahaschool/agentctl',
    summary: 'Document deployment handoff',
    messageCount: 4,
    lastActivity: '2026-04-14T05:10:00.000Z',
    branch: null,
    runtime: 'claude-code',
    machineId: 'machine-alpha',
    hostname: 'alpha-host',
  },
  {
    sessionId: 'session-mobile-ui',
    projectPath: '/Users/hahaschool/mobile-app',
    summary: 'Polish mobile notifications',
    messageCount: 8,
    lastActivity: '2026-04-13T21:15:00.000Z',
    branch: 'feature/notifications',
    machineId: 'machine-alpha',
    hostname: 'alpha-host',
  },
];

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockDiscoverApis(page: Page, state: DiscoverMockState): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();

    if (method === 'GET' && pathname === '/api/sessions/discover') {
      await fulfillJson(route, {
        sessions: state.sessions,
        count: state.sessions.length,
        machinesQueried: 2,
        machinesFailed: 0,
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/sessions') {
      await fulfillJson(route, {
        sessions: state.existingClaudeSessionIds.map((claudeSessionId) => ({
          id: `imported-${claudeSessionId}`,
          claudeSessionId,
        })),
        total: state.existingClaudeSessionIds.length,
        limit: 1000,
        offset: 0,
        hasMore: false,
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/sessions') {
      const body = (request.postDataJSON() ?? {}) as CreateSessionBody;
      state.createCalls.push(body);
      const sessionId = `created-${state.createCalls.length}`;
      await fulfillJson(route, {
        ok: true,
        sessionId,
        session: {
          id: sessionId,
          claudeSessionId: body.resumeSessionId ?? null,
          machineId: body.machineId,
          projectPath: body.projectPath,
          status: 'starting',
        },
      });
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

    if (method === 'GET' && pathname === '/api/version-compat') {
      await fulfillJson(route, {
        appVersion: '0.4.0',
        gitSha: 'test',
        schemaVersion: 26,
        minSupportedMobileBuild: 0,
        minSupportedWebBuild: 0,
      });
      return;
    }

    throw new Error(`Unhandled API request in discover e2e mock: ${method} ${pathname}`);
  });
}

function makeState(): DiscoverMockState {
  return {
    sessions: [...DISCOVERED_SESSIONS],
    existingClaudeSessionIds: ['session-imported-docs'],
    createCalls: [],
  };
}

test.describe('Discover sessions page', () => {
  test('renders grouped discovered sessions and filters the list without a backend', async ({
    page,
  }) => {
    await mockDiscoverApis(page, makeState());

    await page.goto('/discover');

    await expect(page.getByRole('heading', { name: 'Discover Sessions' })).toBeVisible();
    await expect(page.getByText('Queried 2 machine(s)')).toBeVisible();
    await expect(
      page.getByText('Showing 3 of 3 sessions across 2 projects on 2 machines'),
    ).toBeVisible();
    await expect(page.getByText('(1 already imported)')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Toggle group: agentctl' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Toggle group: mobile-app' })).toBeVisible();
    await expect(page.getByText('Refactor dashboard agent queue')).toBeVisible();
    await expect(page.getByText('Document deployment handoff')).toBeVisible();
    await expect(page.getByText('Polish mobile notifications')).toBeVisible();
    await expect(page.locator('span').filter({ hasText: /^Codex$/ }).first()).toBeVisible();
    await expect(page.locator('span').filter({ hasText: /^Claude$/ }).first()).toBeVisible();
    await expect(page.locator('span').filter({ hasText: /^Unknown$/ }).first()).toBeVisible();
    await expect(page.getByText('Imported', { exact: true })).toBeVisible();

    await page.getByLabel('Search sessions').fill('mobile');
    await expect(page.getByText('Polish mobile notifications')).toBeVisible();
    await expect(page.getByText('Refactor dashboard agent queue')).toHaveCount(0);
    await expect(
      page.getByText('Showing 1 of 3 sessions across 1 project on 1 machine'),
    ).toBeVisible();

    await page.getByLabel('Search sessions').fill('');
    const runtimeFilter = page
      .locator('select')
      .filter({ has: page.locator('option[value="codex"]') })
      .first();
    await runtimeFilter.selectOption('codex');
    await expect(page.getByText('Refactor dashboard agent queue')).toBeVisible();
    await expect(page.getByText('Document deployment handoff')).toHaveCount(0);
    await expect(page.getByText('Polish mobile notifications')).toHaveCount(0);

    await runtimeFilter.selectOption('all');
    await page.locator('#discover-machine').selectOption('alpha-host');
    await expect(page.getByText('Document deployment handoff')).toBeVisible();
    await expect(page.getByText('Polish mobile notifications')).toBeVisible();
    await expect(page.getByText('Refactor dashboard agent queue')).toHaveCount(0);

    await page.locator('#discover-machine').selectOption('all');
    await page.getByLabel('Group by').selectOption('machine');
    await expect(page.getByRole('button', { name: 'Toggle group: alpha-host' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Toggle group: beta-host' })).toBeVisible();
  });

  test('imports a discovered session and creates a new session with deterministic requests', async ({
    page,
  }) => {
    const state = makeState();
    await mockDiscoverApis(page, state);

    await page.goto('/discover');
    await expect(page.getByRole('heading', { name: 'Discover Sessions' })).toBeVisible();

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/sessions',
      ),
      page.getByRole('button', { name: 'Import session session-agen' }).click(),
    ]);

    await expect(page.getByRole('alert').filter({ hasText: 'Imported session from beta-host' }))
      .toBeVisible();
    expect(state.createCalls[0]).toEqual({
      agentId: 'adhoc',
      machineId: 'machine-beta',
      projectPath: '/Users/hahaschool/agentctl',
      prompt: expect.stringContaining('Imported from discover'),
      resumeSessionId: 'session-agents-refactor',
    });

    await page.getByRole('button', { name: 'Show new session form' }).click();
    await page.locator('#new-session-machine').selectOption('machine-alpha');
    await page.getByLabel('Project Path').fill('/Users/hahaschool/new-agent');
    await page.getByLabel('Prompt').fill('Investigate flaky discovery imports');
    await page.getByRole('radio', { name: 'Codex' }).click();

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/sessions',
      ),
      page.getByRole('button', { name: 'Create' }).click(),
    ]);

    await expect(page.getByRole('alert').filter({ hasText: 'Session created successfully' }))
      .toBeVisible();
    expect(state.createCalls[1]).toEqual({
      agentId: 'adhoc',
      machineId: 'machine-alpha',
      projectPath: '/Users/hahaschool/new-agent',
      prompt: 'Investigate flaky discovery imports',
      runtime: 'codex',
    });
  });
});
