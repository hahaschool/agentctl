import { expect, type Page, type Route, test } from '@playwright/test';
import type { Space, TaskDefinition, TaskEdge, TaskGraph } from '@agentctl/shared';

/**
 * Backend-independent coverage for the /tasks and /spaces index routes.
 *
 * These pages render their shell before data loads, so this spec fails on
 * unhandled API traffic and asserts real backend contract data instead of only
 * headings/buttons.
 */

const NOW = '2026-04-14T08:00:00.000Z';
const TASK_GRAPH_ID = 'graph-release-orchestration';

const TASK_GRAPH: TaskGraph = {
  id: TASK_GRAPH_ID,
  name: 'Release Orchestration',
  createdAt: NOW,
};

const TASK_DEFINITIONS: readonly TaskDefinition[] = [
  {
    id: 'def-build',
    graphId: TASK_GRAPH_ID,
    type: 'task',
    name: 'Build artifacts',
    description: 'Compile web and control-plane bundles',
    requiredCapabilities: ['typescript'],
    estimatedTokens: 1200,
    timeoutMs: 60_000,
    maxRetryAttempts: 1,
    retryBackoffMs: 5_000,
    createdAt: NOW,
  },
  {
    id: 'def-deploy',
    graphId: TASK_GRAPH_ID,
    type: 'task',
    name: 'Deploy to beta',
    description: 'Promote the verified build to beta',
    requiredCapabilities: ['deployment'],
    estimatedTokens: 800,
    timeoutMs: 120_000,
    maxRetryAttempts: 1,
    retryBackoffMs: 5_000,
    createdAt: NOW,
  },
];

const TASK_EDGES: readonly TaskEdge[] = [
  { fromDefinition: 'def-build', toDefinition: 'def-deploy', type: 'blocks' },
];

const INITIAL_SPACE: Space = {
  id: 'space-fleet-command',
  name: 'Fleet Command',
  description: 'Coordinate release work across agents',
  type: 'collaboration',
  visibility: 'team',
  createdBy: 'alice',
  createdAt: NOW,
};

type CreateSpaceBody = {
  name: string;
  description?: string;
  type?: string;
  visibility?: string;
  createdBy?: string;
};

type MockState = {
  spaces: Space[];
  createSpaceBodies: CreateSpaceBody[];
  taskGraphDetailCalls: string[];
  taskGraphValidationCalls: string[];
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockAppShellWebSocket(page: Page): Promise<void> {
  await page.routeWebSocket('ws://localhost:8080/api/ws', (ws) => {
    ws.onMessage((message) => {
      const raw = typeof message === 'string' ? message : message.toString('utf8');
      const payload = JSON.parse(raw) as Record<string, unknown>;

      if (payload.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: NOW }));
      }
    });
  });
}

async function mountApiMocks(page: Page, options: { spaces?: Space[] } = {}): Promise<MockState> {
  await page.addInitScript(() => {
    window.localStorage.setItem('agentctl:autoRefreshInterval', '0');
  });
  await mockAppShellWebSocket(page);

  const state: MockState = {
    spaces: [...(options.spaces ?? [INITIAL_SPACE])],
    createSpaceBodies: [],
    taskGraphDetailCalls: [],
    taskGraphValidationCalls: [],
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const { pathname } = url;

    if (method === 'GET' && pathname === '/api/sync/conflicts/count') {
      await fulfillJson(route, { count: 0 });
      return;
    }

    if (method === 'GET' && pathname === '/api/permission-requests') {
      await fulfillJson(route, []);
      return;
    }

    if (method === 'GET' && pathname === '/api/version-compat') {
      await fulfillJson(route, {
        appVersion: '0.8.2',
        gitSha: 'e2e',
        schemaVersion: 35,
        minSupportedMobileBuild: 0,
        minSupportedWebBuild: 0,
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/task-graphs') {
      await fulfillJson(route, [TASK_GRAPH]);
      return;
    }

    if (method === 'GET' && pathname === `/api/task-graphs/${TASK_GRAPH_ID}`) {
      state.taskGraphDetailCalls.push(TASK_GRAPH_ID);
      await fulfillJson(route, {
        ...TASK_GRAPH,
        definitions: TASK_DEFINITIONS,
        edges: TASK_EDGES,
      });
      return;
    }

    if (method === 'POST' && pathname === `/api/task-graphs/${TASK_GRAPH_ID}/validate`) {
      state.taskGraphValidationCalls.push(TASK_GRAPH_ID);
      await fulfillJson(route, {
        valid: true,
        errors: [],
        topologicalOrder: ['def-build', 'def-deploy'],
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/spaces') {
      await fulfillJson(route, state.spaces);
      return;
    }

    if (method === 'POST' && pathname === '/api/spaces') {
      const body = request.postDataJSON() as CreateSpaceBody;
      state.createSpaceBodies.push(body);

      if (!body.createdBy) {
        await fulfillJson(
          route,
          { error: 'INVALID_CREATED_BY', message: 'A non-empty "createdBy" string is required' },
          400,
        );
        return;
      }

      const created: Space = {
        id: 'space-release-room',
        name: body.name,
        description: body.description ?? '',
        type: body.type === 'solo' || body.type === 'fleet-overview' ? body.type : 'collaboration',
        visibility:
          body.visibility === 'team' || body.visibility === 'public' ? body.visibility : 'private',
        createdBy: body.createdBy,
        createdAt: NOW,
      };
      state.spaces = [created, ...state.spaces];
      await fulfillJson(route, created, 201);
      return;
    }

    throw new Error(`Unhandled API request in tasks-spaces e2e mock: ${method} ${pathname}`);
  });

  return state;
}

test.describe('Tasks page', () => {
  test('renders task graph summaries from the task graph APIs', async ({ page }) => {
    const state = await mountApiMocks(page);

    await page.goto('/tasks');

    await expect(page.getByRole('heading', { name: /^tasks$/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: /^spaces$/i })).toBeVisible();
    await expect(page.getByRole('table', { name: /task graphs/i })).toBeVisible();
    await expect(page.getByRole('cell', { name: TASK_GRAPH.name })).toBeVisible();
    await expect(page.getByRole('cell', { name: /^ready$/i })).toBeVisible();
    await expect(page.getByRole('cell', { name: /^2$/ })).toBeVisible();

    expect(state.taskGraphDetailCalls).toEqual([TASK_GRAPH_ID]);
    expect(state.taskGraphValidationCalls).toEqual([TASK_GRAPH_ID]);
  });
});

test.describe('Spaces page', () => {
  test('renders spaces from the spaces API', async ({ page }) => {
    await mountApiMocks(page);

    await page.goto('/spaces');

    await expect(page.getByRole('heading', { name: /^spaces$/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: INITIAL_SPACE.name })).toBeVisible();
    await expect(page.getByText(INITIAL_SPACE.description)).toBeVisible();
    await expect(page.getByText(INITIAL_SPACE.type)).toBeVisible();
    await expect(page.locator('[aria-label="Team"]')).toBeVisible();
  });

  test('creates a space with the backend-required creator identity', async ({ page }) => {
    const state = await mountApiMocks(page, { spaces: [] });

    await page.goto('/spaces');

    await expect(page.getByText(/no collaboration spaces yet/i)).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: /^new space$/i }).click();
    await page.getByLabel(/^name$/i).fill('Release Room');
    await page.getByLabel(/description/i).fill('Coordinate release sign-off');

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/spaces') && response.request().method() === 'POST',
      ),
      page.getByRole('button', { name: /^create space$/i }).click(),
    ]);

    expect(state.createSpaceBodies).toEqual([
      {
        name: 'Release Room',
        description: 'Coordinate release sign-off',
        type: 'collaboration',
        visibility: 'private',
        createdBy: 'local',
      },
    ]);
    await expect(page.getByRole('link', { name: 'Release Room' })).toBeVisible();
    await expect(page.getByText('Coordinate release sign-off')).toBeVisible();
  });
});
