import { expect, type Page, type Route, test } from '@playwright/test';
import type { TaskDefinition, TaskEdge, TaskGraph } from '@agentctl/shared';

/**
 * E2E coverage for the AutoDecomposeDialog reached from /tasks/[id].
 *
 * Endpoints under test:
 *   - POST /api/decompose/preview  (dry run — returns result + validationErrors)
 *   - POST /api/decompose          (apply — returns graphId + definitionIdMap)
 *
 * All API traffic is mocked with a wildcard route — only needs the Next.js dev
 * server on $WEB_PORT.
 */

// ── Fixtures ────────────────────────────────────────────────────────────────

const NOW = '2026-04-14T08:00:00.000Z';
const TASK_GRAPH_ID = 'graph-release-orchestration';
const NEW_GRAPH_ID = 'graph-newly-created';

const GRAPH: TaskGraph = {
  id: TASK_GRAPH_ID,
  name: 'Release Orchestration',
  createdAt: NOW,
};

const DEFINITIONS: readonly TaskDefinition[] = [
  {
    id: 'def-build',
    graphId: TASK_GRAPH_ID,
    type: 'task',
    name: 'Build artifacts',
    description: 'Compile web + control-plane bundles',
    requiredCapabilities: [],
    estimatedTokens: null,
    timeoutMs: 60_000,
    maxRetryAttempts: 1,
    retryBackoffMs: 5_000,
    createdAt: NOW,
  },
];

const EDGES: readonly TaskEdge[] = [];

const NEW_GRAPH: TaskGraph = {
  id: NEW_GRAPH_ID,
  name: 'Generated PKCE Plan',
  createdAt: NOW,
};

type DecomposedTaskDto = {
  tempId: string;
  type: 'task' | 'gate';
  name: string;
  description: string;
  requiredCapabilities: string[];
  estimatedTokens: number;
  timeoutMs: number;
};

type DecomposedEdgeDto = {
  from: string;
  to: string;
  type: 'blocks' | 'context';
};

type DecompositionResultDto = {
  tasks: DecomposedTaskDto[];
  edges: DecomposedEdgeDto[];
  suggestedApprovalGates: string[];
  reasoning: string;
  estimatedTotalTokens: number;
  estimatedTotalCostUsd: number | null;
};

const PREVIEW_TASKS: DecomposedTaskDto[] = [
  {
    tempId: 'temp-scaffold',
    type: 'task',
    name: 'Scaffold auth module',
    description: 'Stub out the OAuth PKCE entrypoints and module layout.',
    requiredCapabilities: ['typescript'],
    estimatedTokens: 2_400,
    timeoutMs: 60_000,
  },
  {
    tempId: 'temp-implement',
    type: 'task',
    name: 'Implement PKCE flow',
    description: 'Wire the provider-side PKCE challenge/verifier exchange.',
    requiredCapabilities: ['typescript', 'oauth'],
    estimatedTokens: 8_200,
    timeoutMs: 120_000,
  },
  {
    tempId: 'temp-review',
    type: 'gate',
    name: 'Security review gate',
    description: 'Human approval before merging auth changes.',
    requiredCapabilities: [],
    estimatedTokens: 0,
    timeoutMs: 30_000,
  },
];

const PREVIEW_EDGES: DecomposedEdgeDto[] = [
  { from: 'temp-scaffold', to: 'temp-implement', type: 'blocks' },
  { from: 'temp-implement', to: 'temp-review', type: 'blocks' },
];

const RICH_PREVIEW: DecompositionResultDto = {
  tasks: PREVIEW_TASKS,
  edges: PREVIEW_EDGES,
  suggestedApprovalGates: ['temp-review'],
  reasoning: 'Break work along scaffold → implement → review with a human gate.',
  estimatedTotalTokens: 10_600,
  estimatedTotalCostUsd: 0.047,
};

const NEW_DEFINITIONS: readonly TaskDefinition[] = PREVIEW_TASKS.map((task, index) => ({
  id: `def-new-${task.tempId.replace(/^temp-/, '')}`,
  graphId: NEW_GRAPH_ID,
  type: task.type,
  name: task.name,
  description: task.description,
  requiredCapabilities: task.requiredCapabilities,
  estimatedTokens: task.estimatedTokens,
  timeoutMs: task.timeoutMs,
  maxRetryAttempts: 1,
  retryBackoffMs: 5_000,
  createdAt: new Date(new Date(NOW).getTime() + index).toISOString(),
}));

const NEW_EDGES: readonly TaskEdge[] = [
  { fromDefinition: 'def-new-scaffold', toDefinition: 'def-new-implement', type: 'blocks' },
  { fromDefinition: 'def-new-implement', toDefinition: 'def-new-review', type: 'blocks' },
];

type DecomposeRequest = {
  body: { description?: string; spaceId?: string; constraints?: unknown } | null;
};

type MockState = {
  previewRequests: DecomposeRequest[];
  applyRequests: DecomposeRequest[];
  previewMode: 'ok' | 'error' | 'with-validation';
  applyMode: 'ok' | 'error';
};

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
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

async function mountMocks(page: Page, state: MockState): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('agentctl:autoRefreshInterval', '0');
  });
  await mockAppShellWebSocket(page);

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();

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

    if (method === 'GET' && pathname === `/api/task-graphs/${TASK_GRAPH_ID}`) {
      await fulfillJson(route, { ...GRAPH, definitions: DEFINITIONS, edges: EDGES });
      return;
    }
    if (method === 'GET' && pathname === `/api/task-graphs/${NEW_GRAPH_ID}`) {
      await fulfillJson(route, { ...NEW_GRAPH, definitions: NEW_DEFINITIONS, edges: NEW_EDGES });
      return;
    }
    if (method === 'GET' && pathname === '/api/task-runs') {
      await fulfillJson(route, []);
      return;
    }

    if (method === 'POST' && pathname === '/api/decompose/preview') {
      const body = request.postDataJSON() as DecomposeRequest['body'];
      state.previewRequests.push({ body });
      if (state.previewMode === 'error') {
        await fulfillJson(
          route,
          { ok: false, error: 'PREVIEW_FAILED', message: 'Upstream LLM timeout' },
          500,
        );
        return;
      }
      const validationErrors =
        state.previewMode === 'with-validation'
          ? ['Gate temp-review has no downstream tasks']
          : [];
      await fulfillJson(route, { result: RICH_PREVIEW, validationErrors });
      return;
    }

    if (method === 'POST' && pathname === '/api/decompose') {
      const body = request.postDataJSON() as DecomposeRequest['body'];
      state.applyRequests.push({ body });
      if (state.applyMode === 'error') {
        await fulfillJson(
          route,
          { ok: false, error: 'APPLY_FAILED', message: 'Could not persist graph' },
          500,
        );
        return;
      }
      await fulfillJson(route, {
        graphId: NEW_GRAPH_ID,
        definitionIdMap: {
          'temp-scaffold': 'def-new-scaffold',
          'temp-implement': 'def-new-implement',
          'temp-review': 'def-new-review',
        },
        result: RICH_PREVIEW,
        validationErrors: [],
      });
      return;
    }

    throw new Error(`Unhandled API request in task-auto-decompose e2e mock: ${method} ${pathname}`);
  });
}

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    previewRequests: [],
    applyRequests: [],
    previewMode: 'ok',
    applyMode: 'ok',
    ...overrides,
  };
}

async function openDialog(page: Page): Promise<void> {
  await page.goto(`/tasks/${TASK_GRAPH_ID}`);
  await expect(page.getByRole('heading', { name: 'Release Orchestration' })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId('auto-decompose-trigger').click();
  await expect(page.getByTestId('auto-decompose-dialog')).toBeVisible();
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Task auto-decompose dialog', () => {
  test('opens from the task detail page seeded with the graph name', async ({ page }) => {
    const state = makeState();
    await mountMocks(page, state);

    await openDialog(page);

    // Seeded textarea content (initialDescription = graph.name).
    const textarea = page.getByTestId('auto-decompose-description-input');
    await expect(textarea).toHaveValue('Release Orchestration');

    // Apply button is disabled until a preview with tasks exists.
    await expect(page.getByTestId('auto-decompose-apply-button')).toBeDisabled();

    // No requests fired on mere open.
    expect(state.previewRequests).toEqual([]);
    expect(state.applyRequests).toEqual([]);
  });

  test('preview fetches the dry-run endpoint and renders the proposed tree with dependencies', async ({
    page,
  }) => {
    const state = makeState();
    await mountMocks(page, state);

    await openDialog(page);

    const textarea = page.getByTestId('auto-decompose-description-input');
    await textarea.fill('Refactor the auth module to support OAuth PKCE and integration tests.');

    const previewPost = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/decompose/preview',
    );
    await page.getByTestId('auto-decompose-preview-button').click();
    await previewPost;

    // Preview body carries the trimmed description and did NOT hit the apply endpoint.
    expect(state.previewRequests).toHaveLength(1);
    expect(state.previewRequests[0]?.body?.description).toBe(
      'Refactor the auth module to support OAuth PKCE and integration tests.',
    );
    expect(state.applyRequests).toEqual([]);

    // All three proposed tasks render, with their gate/task badges.
    await expect(page.getByTestId('proposed-task-temp-scaffold')).toBeVisible();
    await expect(page.getByTestId('proposed-task-temp-implement')).toBeVisible();
    const reviewRow = page.getByTestId('proposed-task-temp-review');
    await expect(reviewRow).toBeVisible();
    await expect(reviewRow).toContainText('gate');

    // Dependency labels reflect the edge from temp-scaffold → temp-implement.
    await expect(page.getByTestId('proposed-task-temp-implement')).toContainText(
      'depends on: Scaffold auth module',
    );

    // Header shows totals derived from the mocked result.
    await expect(page.getByText('3 task(s)')).toBeVisible();
  });

  test('apply hits /api/decompose (not preview), then closes the dialog', async ({ page }) => {
    const state = makeState();
    await mountMocks(page, state);

    await openDialog(page);

    const textarea = page.getByTestId('auto-decompose-description-input');
    await textarea.fill('Break down release orchestration into phases.');

    await page.getByTestId('auto-decompose-preview-button').click();
    await expect(page.getByTestId('proposed-task-temp-scaffold')).toBeVisible();

    const applyPost = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/decompose',
    );
    await page.getByTestId('auto-decompose-apply-button').click();
    await applyPost;

    // Apply request was issued with the same description; preview endpoint was NOT
    // called a second time for apply.
    expect(state.applyRequests).toHaveLength(1);
    expect(state.applyRequests[0]?.body?.description).toBe(
      'Break down release orchestration into phases.',
    );
    expect(state.previewRequests).toHaveLength(1);

    // Dialog closes on successful apply.
    await expect(page.getByTestId('auto-decompose-dialog')).toBeHidden({ timeout: 10_000 });
  });

  test('shows an apply error and keeps the preview available when apply fails', async ({
    page,
  }) => {
    const state = makeState({ applyMode: 'error' });
    await mountMocks(page, state);

    await openDialog(page);

    const textarea = page.getByTestId('auto-decompose-description-input');
    await textarea.fill('Break down release orchestration into phases.');

    await page.getByTestId('auto-decompose-preview-button').click();
    await expect(page.getByTestId('proposed-task-temp-scaffold')).toBeVisible();

    const applyResponse = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/decompose',
    );
    await page.getByTestId('auto-decompose-apply-button').click();
    const response = await applyResponse;

    expect(response.status()).toBe(500);
    expect(state.applyRequests).toHaveLength(1);
    expect(state.applyRequests[0]?.body?.description).toBe(
      'Break down release orchestration into phases.',
    );
    expect(state.previewRequests).toHaveLength(1);

    await expect(page.getByTestId('auto-decompose-dialog')).toBeVisible();
    await expect(page.getByTestId('auto-decompose-apply-error')).toBeVisible();
    await expect(page.getByTestId('auto-decompose-apply-error')).toContainText(
      'Could not persist graph',
    );
    await expect(page.getByTestId('proposed-task-temp-scaffold')).toBeVisible();
    await expect(page.getByTestId('auto-decompose-apply-button')).toBeEnabled();
  });

  test('requires a fresh preview when the description changes after preview', async ({ page }) => {
    const state = makeState();
    await mountMocks(page, state);

    await openDialog(page);

    const textarea = page.getByTestId('auto-decompose-description-input');
    await textarea.fill('Break down release orchestration into phases.');

    await page.getByTestId('auto-decompose-preview-button').click();
    await expect(page.getByTestId('proposed-task-temp-scaffold')).toBeVisible();
    expect(state.previewRequests).toHaveLength(1);

    await textarea.fill('Break down release orchestration into launch, rollback, and cleanup.');

    await expect(page.getByTestId('auto-decompose-stale-preview')).toBeVisible();
    await expect(page.getByTestId('auto-decompose-apply-button')).toBeDisabled();
    await expect(page.getByTestId('proposed-task-temp-scaffold')).toBeHidden();
    expect(state.applyRequests).toEqual([]);

    await page.getByTestId('auto-decompose-preview-button').click();
    await expect(page.getByTestId('proposed-task-temp-scaffold')).toBeVisible();
    await expect(page.getByTestId('auto-decompose-stale-preview')).toBeHidden();
    await expect(page.getByTestId('auto-decompose-apply-button')).toBeEnabled();

    expect(state.previewRequests).toHaveLength(2);
    expect(state.previewRequests[1]?.body?.description).toBe(
      'Break down release orchestration into launch, rollback, and cleanup.',
    );
  });

  test('renders validation warnings returned from the preview endpoint', async ({ page }) => {
    const state = makeState({ previewMode: 'with-validation' });
    await mountMocks(page, state);

    await openDialog(page);

    const textarea = page.getByTestId('auto-decompose-description-input');
    await textarea.fill('Decompose the release workflow with explicit validation issues.');

    await page.getByTestId('auto-decompose-preview-button').click();

    const warnings = page.getByTestId('decompose-validation-errors');
    await expect(warnings).toBeVisible();
    await expect(warnings).toContainText('Gate temp-review has no downstream tasks');

    // Apply is still allowed when the preview has tasks — warnings are non-blocking.
    await expect(page.getByTestId('auto-decompose-apply-button')).toBeEnabled();
  });

  test('shows a preview error alert and keeps apply disabled when preview fails', async ({
    page,
  }) => {
    const state = makeState({ previewMode: 'error' });
    await mountMocks(page, state);

    await openDialog(page);

    const textarea = page.getByTestId('auto-decompose-description-input');
    await textarea.fill('Trigger a preview that the mock will reject with a 500.');

    await page.getByTestId('auto-decompose-preview-button').click();

    await expect(page.getByTestId('auto-decompose-preview-error')).toBeVisible();
    await expect(page.getByTestId('auto-decompose-apply-button')).toBeDisabled();

    // No apply call should have been issued.
    expect(state.applyRequests).toEqual([]);
  });
});
