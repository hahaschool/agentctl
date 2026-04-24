import { expect, type Page, type Route, test } from '@playwright/test';
import type {
  ContextRef,
  CrossSpaceSubscription,
  Space,
  SpaceEvent,
  SpaceMember,
  TaskDefinition,
  TaskEdge,
  TaskGraph,
  TaskRun,
  Thread,
} from '@agentctl/shared';

// ── Shared fixtures ─────────────────────────────────────────────────────────
const NOW = '2026-04-14T08:00:00.000Z';
const SPACE_ID = 'test-space-1';
const TASK_GRAPH_ID = 'test-task-1';

async function respond(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockAppShellWebSocket(page: Page): Promise<void> {
  await page.routeWebSocket('ws://localhost:8080/api/ws', (ws) => {
    ws.onMessage((message) => {
      const payload =
        typeof message === 'string'
          ? (JSON.parse(message) as Record<string, unknown>)
          : (JSON.parse(message.toString('utf8')) as Record<string, unknown>);

      if (payload.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: NOW }));
      }
    });
  });
}

async function maybeRespondToAppShellApi(
  route: Route,
  method: string,
  pathname: string,
): Promise<boolean> {
  if (method === 'GET' && pathname === '/api/sync/conflicts/count') {
    await respond(route, 200, { count: 0 });
    return true;
  }
  if (method === 'GET' && pathname === '/api/permission-requests') {
    await respond(route, 200, []);
    return true;
  }
  if (method === 'GET' && pathname === '/api/version-compat') {
    await respond(route, 200, {
      appVersion: '0.8.2',
      gitSha: 'e2e',
      schemaVersion: 35,
      minSupportedMobileBuild: 0,
      minSupportedWebBuild: 0,
    });
    return true;
  }

  return false;
}

function unexpectedApiRequest(method: string, pathname: string): never {
  throw new Error(`Unhandled API request in spaces/tasks detail e2e mock: ${method} ${pathname}`);
}

// ── /spaces/[id] fixtures and mock ──────────────────────────────────────────
const MEMBERS: readonly SpaceMember[] = [
  { spaceId: SPACE_ID, memberType: 'human', memberId: 'alice', role: 'owner' },
  { spaceId: SPACE_ID, memberType: 'agent', memberId: 'agent-planner', role: 'member' },
];

const SPACE: Space & { members: SpaceMember[] } = {
  id: SPACE_ID,
  name: 'Fleet Command',
  description: 'Primary operations coordination space for agent fleet',
  type: 'collaboration',
  visibility: 'team',
  createdBy: 'alice',
  createdAt: NOW,
  members: [...MEMBERS],
};

function makeThread(id: string, title: string, type: Thread['type']): Thread {
  return { id, spaceId: SPACE_ID, title, type, createdAt: NOW };
}
const THREAD_ALPHA = makeThread('thread-alpha', 'Deploy checklist', 'discussion');
const THREAD_BETA = makeThread('thread-beta', 'Incident retro', 'review');

const CONTEXT_REF: ContextRef = {
  id: 'ref-1',
  sourceSpaceId: 'aaaaaaaa-source-space-id',
  sourceThreadId: 'thread-99',
  sourceEventId: null,
  targetSpaceId: SPACE_ID,
  targetThreadId: 'bbbbbbbb-target-thread',
  mode: 'reference',
  snapshotPayload: null,
  metadata: {},
  createdBy: 'alice',
  createdAt: NOW,
};


function makeSub(id: string, active: boolean): CrossSpaceSubscription {
  return {
    id,
    sourceSpaceId: `${id}-upstream-space`,
    targetSpaceId: SPACE_ID,
    filterCriteria: {},
    active,
    createdBy: 'alice',
    createdAt: NOW,
  };
}
const SUBSCRIPTIONS = [makeSub('sub-1', true), makeSub('sub-2', false)];

function makeEvent(overrides: Partial<SpaceEvent>): SpaceEvent {
  return {
    id: 'event-1',
    spaceId: SPACE_ID,
    threadId: 'thread-alpha',
    sequenceNum: 1,
    type: 'message',
    senderType: 'human',
    senderId: 'alice',
    payload: { text: 'default' },
    visibility: 'public',
    createdAt: NOW,
    ...overrides,
  };
}

type SpaceMockState = {
  readonly createdThreads: Array<{ readonly body: unknown }>;
  readonly postedEvents: Array<{ readonly threadId: string; readonly body: unknown }>;
  readonly removeMemberCalls: string[];
};

async function mockSpaceApis(
  page: Page,
  opts: { readonly notFound?: boolean } = {},
): Promise<SpaceMockState> {
  await mockAppShellWebSocket(page);

  const state: SpaceMockState = {
    createdThreads: [],
    postedEvents: [],
    removeMemberCalls: [],
  };
  const threadsById = new Map<string, Thread>([
    [THREAD_ALPHA.id, THREAD_ALPHA],
    [THREAD_BETA.id, THREAD_BETA],
  ]);
  const eventsByThread = new Map<string, SpaceEvent[]>([
    [
      'thread-alpha',
      [
        makeEvent({
          id: 'event-1',
          sequenceNum: 1,
          payload: { text: 'Kickoff message on deploy checklist.' },
        }),
        makeEvent({
          id: 'event-2',
          sequenceNum: 2,
          senderType: 'agent',
          senderId: 'agent-planner',
          payload: { text: 'Acknowledged — plan ready for review.' },
        }),
      ],
    ],
    ['thread-beta', []],
  ]);
  const eventsMatcher = new RegExp(`^/api/spaces/${SPACE_ID}/threads/([^/]+)/events$`);

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    const method = req.method();

    if (await maybeRespondToAppShellApi(route, method, pathname)) {
      return;
    }
    if (method === 'GET' && pathname === `/api/spaces/${SPACE_ID}`) {
      return opts.notFound
        ? respond(route, 404, { error: 'NOT_FOUND', message: 'Space test-space-1 not found' })
        : respond(route, 200, SPACE);
    }
    if (method === 'DELETE' && pathname.startsWith(`/api/spaces/${SPACE_ID}/members/`)) {
      state.removeMemberCalls.push(decodeURIComponent(pathname.split('/members/')[1] ?? ''));
      return route.fulfill({ status: 204, body: '' });
    }
    if (method === 'GET' && pathname === `/api/spaces/${SPACE_ID}/threads`) {
      return respond(route, 200, Array.from(threadsById.values()));
    }
    if (method === 'POST' && pathname === `/api/spaces/${SPACE_ID}/threads`) {
      const body = req.postDataJSON() as { title?: string; type?: Thread['type'] };
      state.createdThreads.push({ body });
      const created: Thread = {
        id: `thread-new-${threadsById.size + 1}`,
        spaceId: SPACE_ID,
        title: body.title ?? null,
        type: body.type ?? 'discussion',
        createdAt: NOW,
      };
      threadsById.set(created.id, created);
      eventsByThread.set(created.id, []);
      return respond(route, 200, created);
    }
    if (method === 'GET' && pathname === `/api/spaces/${SPACE_ID}/context-refs`) {
      return respond(route, 200, [CONTEXT_REF]);
    }
    if (method === 'GET' && pathname === `/api/spaces/${SPACE_ID}/subscriptions`) {
      return respond(route, 200, SUBSCRIPTIONS);
    }
    const eventsMatch = pathname.match(eventsMatcher);
    if (method === 'GET' && eventsMatch) {
      const threadId = decodeURIComponent(eventsMatch[1] ?? '');
      return respond(route, 200, eventsByThread.get(threadId) ?? []);
    }
    if (method === 'POST' && eventsMatch) {
      const threadId = decodeURIComponent(eventsMatch[1] ?? '');
      const body = req.postDataJSON() as { payload?: { text?: string } };
      state.postedEvents.push({ threadId, body });
      const bucket = eventsByThread.get(threadId) ?? [];
      const next = makeEvent({
        id: `event-new-${bucket.length + 1}`,
        threadId,
        sequenceNum: bucket.length + 1,
        senderId: 'user',
        payload: body.payload ?? {},
      });
      eventsByThread.set(threadId, [...bucket, next]);
      return respond(route, 200, next);
    }

    unexpectedApiRequest(method, pathname);
  });

  return state;
}

// ── /tasks/[id] fixtures and mock ───────────────────────────────────────────
const TASK_GRAPH: TaskGraph = {
  id: TASK_GRAPH_ID,
  name: 'Release Orchestration',
  createdAt: NOW,
};

function makeDef(overrides: Partial<TaskDefinition>): TaskDefinition {
  return {
    id: 'def-1',
    graphId: TASK_GRAPH_ID,
    type: 'task',
    name: 'Task',
    description: '',
    requiredCapabilities: [],
    estimatedTokens: null,
    timeoutMs: 60_000,
    maxRetryAttempts: 1,
    retryBackoffMs: 5_000,
    createdAt: NOW,
    ...overrides,
  };
}

const TASK_DEFS: readonly TaskDefinition[] = [
  makeDef({
    id: 'def-build',
    name: 'Build artifacts',
    description: 'Compile web + control-plane bundles',
  }),
  makeDef({ id: 'def-deploy', name: 'Deploy to beta', description: 'Promote artifacts to beta' }),
];

const TASK_EDGES: readonly TaskEdge[] = [
  { fromDefinition: 'def-build', toDefinition: 'def-deploy', type: 'blocks' },
];

function makeRun(overrides: Partial<TaskRun>): TaskRun {
  return {
    id: 'run-1',
    definitionId: 'def-build',
    spaceId: null,
    threadId: null,
    status: 'completed',
    attempt: 1,
    assigneeInstanceId: null,
    machineId: null,
    claimedAt: null,
    startedAt: NOW,
    completedAt: NOW,
    lastHeartbeatAt: null,
    result: null,
    error: null,
    createdAt: NOW,
    ...overrides,
  };
}

const TASK_RUNS: readonly TaskRun[] = [
  makeRun({ id: 'run-aaaaaa01', definitionId: 'def-build' }),
  makeRun({
    id: 'run-bbbbbb02',
    definitionId: 'def-deploy',
    status: 'running',
    completedAt: null,
  }),
  // Belongs to a different graph — must be filtered out on the detail page.
  makeRun({ id: 'run-other-graph', definitionId: 'def-unrelated' }),
];

type TaskMockState = { readonly createdRuns: Array<{ readonly body: unknown }> };

async function mockTaskApis(
  page: Page,
  opts: { readonly notFound?: boolean; readonly emptyGraph?: boolean } = {},
): Promise<TaskMockState> {
  await mockAppShellWebSocket(page);

  const state: TaskMockState = { createdRuns: [] };

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    const method = req.method();

    if (await maybeRespondToAppShellApi(route, method, pathname)) {
      return;
    }
    if (method === 'GET' && pathname === `/api/task-graphs/${TASK_GRAPH_ID}`) {
      if (opts.notFound) {
        return respond(route, 404, {
          error: 'NOT_FOUND',
          message: `Task graph ${TASK_GRAPH_ID} not found`,
        });
      }
      return respond(route, 200, {
        ...TASK_GRAPH,
        definitions: opts.emptyGraph ? [] : TASK_DEFS,
        edges: opts.emptyGraph ? [] : TASK_EDGES,
      });
    }
    if (method === 'GET' && pathname === '/api/task-runs') {
      return respond(route, 200, opts.emptyGraph ? [] : TASK_RUNS);
    }
    if (method === 'POST' && pathname === '/api/task-runs') {
      const body = req.postDataJSON();
      state.createdRuns.push({ body });
      return respond(
        route,
        200,
        makeRun({
          id: `run-new-${state.createdRuns.length}`,
          definitionId: (body as { definitionId: string }).definitionId,
          status: 'pending',
          startedAt: null,
          completedAt: null,
        }),
      );
    }

    unexpectedApiRequest(method, pathname);
  });

  return state;
}

// ── Space detail tests — /spaces/[id] ───────────────────────────────────────
test.describe('Space detail page (/spaces/[id])', () => {
  test('renders space header, bridges, threads, and auto-selected event feed', async ({ page }) => {
    await mockSpaceApis(page);

    await page.goto(`/spaces/${SPACE_ID}`);

    await expect(page.getByRole('heading', { name: 'Fleet Command' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText('Primary operations coordination space for agent fleet'),
    ).toBeVisible();
    await expect(page.getByText('2 members')).toBeVisible();

    // Bridges section — 1 ref, 2 subscriptions, one active + one paused
    await expect(page.getByText('1 refs')).toBeVisible();
    await expect(page.getByText('2 subscriptions')).toBeVisible();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();

    // Thread sidebar + auto-selected thread-alpha event feed
    await expect(page.getByRole('button', { name: /Deploy checklist/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Incident retro/ })).toBeVisible();
    await expect(page.getByText('Kickoff message on deploy checklist.')).toBeVisible();
    await expect(page.getByText('Acknowledged — plan ready for review.')).toBeVisible();
  });

  test('shows not-found state when the space API returns 404', async ({ page }) => {
    await mockSpaceApis(page, { notFound: true });

    await page.goto(`/spaces/${SPACE_ID}`);

    // Either the "Space not found." message or an ErrorBanner is acceptable —
    // both prove the non-happy-path branch is exercised.
    const notFound = page.getByText('Space not found.');
    const errorBanner = page.getByText(/Failed to load space/);
    await expect(notFound.or(errorBanner)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Fleet Command' })).toHaveCount(0);
  });

  test('creates a new thread and auto-selects it in the sidebar', async ({ page }) => {
    const state = await mockSpaceApis(page);

    await page.goto(`/spaces/${SPACE_ID}`);
    await expect(page.getByRole('heading', { name: 'Fleet Command' })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: 'New thread' }).click();
    await page.getByPlaceholder('Thread title...').fill('Architecture review');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect
      .poll(() => state.createdThreads.at(-1), { message: 'POST /threads captured' })
      .toMatchObject({ body: { title: 'Architecture review', type: 'discussion' } });
    await expect(page.getByRole('button', { name: /Architecture review/ })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('posts a message event through the composer to the active thread', async ({ page }) => {
    const state = await mockSpaceApis(page);

    await page.goto(`/spaces/${SPACE_ID}`);
    await expect(page.getByText('Kickoff message on deploy checklist.')).toBeVisible({
      timeout: 15_000,
    });

    await page.getByPlaceholder('Type a message...').fill('Rollback plan looks good.');
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect
      .poll(() => state.postedEvents.at(-1), { message: 'POST event captured' })
      .toMatchObject({
        threadId: 'thread-alpha',
        body: {
          type: 'message',
          senderType: 'human',
          payload: { text: 'Rollback plan looks good.' },
        },
      });
  });

  test('toggles the members panel and removes a non-owner member', async ({ page }) => {
    const state = await mockSpaceApis(page);

    await page.goto(`/spaces/${SPACE_ID}`);
    await expect(page.getByRole('heading', { name: 'Fleet Command' })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: /^Members/ }).click();

    // Owner (alice) has no remove button; agent member (agent-planner) does.
    await expect(page.getByText('alice').first()).toBeVisible();
    await expect(page.getByText('agent-planner').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove alice' })).toHaveCount(0);

    const removeBtn = page.getByRole('button', { name: 'Remove agent-planner' });
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();

    await expect
      .poll(() => state.removeMemberCalls, { message: 'DELETE /members/:id captured' })
      .toEqual(['agent-planner']);
  });
});

// ── Task detail tests — /tasks/[id] ─────────────────────────────────────────
test.describe('Task graph detail page (/tasks/[id])', () => {
  test('renders graph header, nodes table with dependency, and filtered run history', async ({
    page,
  }) => {
    await mockTaskApis(page);

    await page.goto(`/tasks/${TASK_GRAPH_ID}`);

    await expect(page.getByRole('heading', { name: 'Release Orchestration' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(TASK_GRAPH_ID)).toBeVisible();
    await expect(page.getByText('ready', { exact: true })).toBeVisible();

    // Nodes table — "Build artifacts" appears as own row name AND as dependency
    // pill on the "Deploy to beta" row, so 2 occurrences are expected.
    const nodesTable = page.getByRole('table', { name: 'Task nodes' });
    await expect(nodesTable).toBeVisible();
    await expect(nodesTable.getByText('Build artifacts')).toHaveCount(2);
    await expect(nodesTable.getByText('Deploy to beta')).toBeVisible();
    await expect(nodesTable.getByText('Compile web + control-plane bundles')).toBeVisible();
    const deployRow = nodesTable.getByRole('row').filter({ hasText: 'Deploy to beta' });
    await expect(deployRow.getByText('Build artifacts')).toBeVisible();

    // Run history — only runs whose definitionId belongs to this graph.
    const runsTable = page.getByRole('table', { name: 'Task run history' });
    await expect(runsTable).toBeVisible();
    await expect(runsTable.getByText('run-aaa', { exact: false })).toBeVisible();
    await expect(runsTable.getByText('run-bbb', { exact: false })).toBeVisible();
    await expect(runsTable.getByText('run-other-graph')).toHaveCount(0);
    await expect(page.getByText('Run History').locator('..').getByText('(2)')).toBeVisible();
  });

  test('shows error banner with retry when the graph API returns 404', async ({ page }) => {
    await mockTaskApis(page, { notFound: true });

    await page.goto(`/tasks/${TASK_GRAPH_ID}`);

    await expect(page.getByText(/Failed to load task graph/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(new RegExp(`Task graph ${TASK_GRAPH_ID} not found`))).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Release Orchestration' })).toHaveCount(0);
  });

  test('renders empty state for a graph with no definitions and hides Start Run panel', async ({
    page,
  }) => {
    await mockTaskApis(page, { emptyGraph: true });

    await page.goto(`/tasks/${TASK_GRAPH_ID}`);

    await expect(page.getByRole('heading', { name: 'Release Orchestration' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('empty', { exact: true })).toBeVisible();
    await expect(page.getByText('No task nodes defined yet.')).toBeVisible();
    await expect(
      page.getByText('No runs yet. Click “Start Run” to execute a task.'),
    ).toBeVisible();
    // Start Run panel should not render when there are no definitions.
    await expect(page.getByRole('button', { name: /Start Run/ })).toHaveCount(0);
  });

  test('starts a task run with the selected definition via POST /api/task-runs', async ({
    page,
  }) => {
    const state = await mockTaskApis(page);

    await page.goto(`/tasks/${TASK_GRAPH_ID}`);
    await expect(page.getByRole('heading', { name: 'Release Orchestration' })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByLabel('Select task definition').selectOption('def-deploy');
    await page.getByRole('button', { name: /Start Run/ }).click();

    await expect
      .poll(() => state.createdRuns.at(-1), { message: 'POST /api/task-runs captured' })
      .toMatchObject({ body: { definitionId: 'def-deploy' } });
  });

  test('back link points at the tasks list', async ({ page }) => {
    await mockTaskApis(page);

    await page.goto(`/tasks/${TASK_GRAPH_ID}`);
    await expect(page.getByRole('heading', { name: 'Release Orchestration' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: /All Tasks/ })).toHaveAttribute('href', '/tasks');
  });
});
