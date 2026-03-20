import { expect, type Page, type Route, test } from '@playwright/test';

type ManagedRuntime = 'claude-code' | 'codex';
type ManagedSessionStatus = 'starting' | 'active' | 'paused' | 'handing_off' | 'ended' | 'error';

type AgentSession = {
  id: string;
  agentId: string;
  agentName: string | null;
  machineId: string;
  sessionUrl: string | null;
  claudeSessionId: string | null;
  status: string;
  projectPath: string | null;
  pid: number | null;
  startedAt: string;
  lastHeartbeat: string | null;
  endedAt: string | null;
  metadata: Record<string, unknown>;
  accountId: string | null;
  model: string | null;
};

type RuntimeSession = {
  id: string;
  runtime: ManagedRuntime;
  nativeSessionId: string | null;
  machineId: string;
  agentId: string | null;
  projectPath: string;
  worktreePath: string | null;
  status: ManagedSessionStatus;
  configRevision: number;
  handoffStrategy: string | null;
  handoffSourceSessionId: string | null;
  metadata: Record<string, unknown>;
  startedAt: string | null;
  lastHeartbeat: string | null;
  endedAt: string | null;
};

type MachineRecord = {
  id: string;
  hostname: string;
  tailscaleIp: string;
  os: string;
  arch: string;
  status: string;
  lastHeartbeat: string | null;
  capabilities: {
    gpu: boolean;
    docker: boolean;
    maxConcurrentAgents: number;
  };
  createdAt: string;
};

type RuntimeHandoff = {
  id: string;
  sourceSessionId: string;
  targetSessionId: string;
  sourceRuntime: ManagedRuntime;
  targetRuntime: ManagedRuntime;
  reason: string;
  strategy: string;
  status: string;
  snapshot: {
    diffSummary?: string;
    conversationSummary?: string;
    openTodos?: string[];
  };
  nativeImportAttempt?: {
    ok: boolean;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  };
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

type SessionTakeoverState = {
  active: boolean;
  sessionId: string;
  terminalId?: string;
  claudeSessionId?: string;
  machineId?: string;
  startedAt?: string;
  releasedAt?: string;
};

type MockState = {
  agentSessions: AgentSession[];
  runtimeSessions: RuntimeSession[];
  machines: MachineRecord[];
  handoffsBySessionId: Record<string, RuntimeHandoff[]>;
  terminalTakeoversBySessionId: Record<string, SessionTakeoverState>;
};

function createAgentSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'agent-session-1',
    agentId: 'build-agent',
    agentName: 'Build Agent',
    machineId: 'machine-1',
    sessionUrl: null,
    claudeSessionId: 'claude-agent-session-1',
    status: 'active',
    projectPath: '/tmp/agent-project',
    pid: 4242,
    startedAt: '2026-03-20T09:45:00.000Z',
    lastHeartbeat: '2026-03-20T10:03:00.000Z',
    endedAt: null,
    metadata: {
      messageCount: 14,
      costUsd: 2.5,
    },
    accountId: null,
    model: 'claude-sonnet-4',
    ...overrides,
  };
}

function createRuntimeSession(overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id: 'rt-codex-active',
    runtime: 'codex',
    nativeSessionId: 'codex-native-1',
    machineId: 'machine-1',
    agentId: 'agent-runtime-1',
    projectPath: '/tmp/runtime-alpha',
    worktreePath: '/tmp/runtime-alpha/.trees/runtime-alpha',
    status: 'active',
    configRevision: 3,
    handoffStrategy: 'snapshot-handoff',
    handoffSourceSessionId: null,
    metadata: {
      model: 'gpt-5-codex',
      environment: 'staging',
      activeMcpServers: ['github'],
    },
    startedAt: '2026-03-20T09:55:00.000Z',
    lastHeartbeat: '2026-03-20T10:06:00.000Z',
    endedAt: null,
    ...overrides,
  };
}

function createMachine(overrides: Partial<MachineRecord> = {}): MachineRecord {
  return {
    id: 'machine-1',
    hostname: 'mac-mini',
    tailscaleIp: '100.64.0.10',
    os: 'darwin',
    arch: 'arm64',
    status: 'online',
    lastHeartbeat: '2026-03-20T10:06:00.000Z',
    capabilities: {
      gpu: false,
      docker: true,
      maxConcurrentAgents: 4,
    },
    createdAt: '2026-03-20T08:00:00.000Z',
    ...overrides,
  };
}

function createHandoff(overrides: Partial<RuntimeHandoff> = {}): RuntimeHandoff {
  return {
    id: 'handoff-1',
    sourceSessionId: 'rt-codex-active',
    targetSessionId: 'rt-claude-paused',
    sourceRuntime: 'codex',
    targetRuntime: 'claude-code',
    reason: 'manual',
    strategy: 'snapshot-handoff',
    status: 'succeeded',
    snapshot: {
      diffSummary: 'Continue the release checklist.',
      conversationSummary: 'Resume the release validation work in the target runtime.',
      openTodos: ['Verify rollout status'],
    },
    nativeImportAttempt: {
      ok: false,
      reason: 'source_session_missing',
      metadata: {
        targetCli: { command: 'claude', version: '1.0.0' },
      },
    },
    errorMessage: null,
    createdAt: '2026-03-20T10:01:00.000Z',
    completedAt: '2026-03-20T10:01:20.000Z',
    ...overrides,
  };
}

function createRuntimeConfigDrift(machines: MachineRecord[]) {
  return {
    items: machines.flatMap((machine) =>
      (['claude-code', 'codex'] as const).map((runtime) => ({
        machineId: machine.id,
        runtime,
        isInstalled: true,
        isAuthenticated: true,
      })),
    ),
  };
}

function createTerminalTakeoverState(
  overrides: Partial<SessionTakeoverState> & Pick<SessionTakeoverState, 'sessionId'>,
): SessionTakeoverState {
  return {
    active: false,
    ...overrides,
  };
}

function createMockState(): MockState {
  const machines = [
    createMachine(),
    createMachine({
      id: 'machine-2',
      hostname: 'ec2-runner',
      tailscaleIp: '100.64.0.11',
      os: 'linux',
      arch: 'x64',
      createdAt: '2026-03-20T08:30:00.000Z',
    }),
  ];

  const runtimeSessions = [
    createRuntimeSession(),
    createRuntimeSession({
      id: 'rt-claude-paused',
      runtime: 'claude-code',
      nativeSessionId: 'claude-native-2',
      machineId: 'machine-2',
      agentId: null,
      projectPath: '/tmp/runtime-beta',
      worktreePath: '/tmp/runtime-beta/.trees/runtime-beta',
      status: 'paused',
      configRevision: 5,
      handoffSourceSessionId: 'rt-codex-active',
      metadata: {
        model: 'claude-sonnet-4',
        environment: 'prod',
        activeMcpServers: ['github', 'slack'],
      },
      startedAt: '2026-03-20T09:30:00.000Z',
      lastHeartbeat: '2026-03-20T10:00:00.000Z',
    }),
    createRuntimeSession({
      id: 'rt-codex-ended',
      runtime: 'codex',
      nativeSessionId: 'codex-native-ended',
      machineId: 'machine-2',
      agentId: null,
      projectPath: '/tmp/runtime-legacy',
      worktreePath: '/tmp/runtime-legacy/.trees/runtime-legacy',
      status: 'ended',
      configRevision: 1,
      handoffStrategy: null,
      metadata: {
        model: 'gpt-5-codex',
        environment: 'archive',
        activeMcpServers: [],
      },
      startedAt: '2026-03-19T20:00:00.000Z',
      lastHeartbeat: '2026-03-19T21:00:00.000Z',
      endedAt: '2026-03-19T21:05:00.000Z',
    }),
  ];

  return {
    agentSessions: [createAgentSession()],
    runtimeSessions,
    machines,
    handoffsBySessionId: {
      'rt-codex-active': [createHandoff()],
      'rt-claude-paused': [
        createHandoff({
          id: 'handoff-2',
          sourceSessionId: 'rt-codex-active',
          targetSessionId: 'rt-claude-paused',
          reason: 'resume investigation',
          snapshot: {
            diffSummary: 'Investigate the paused deployment from Codex.',
            conversationSummary: 'Resume the deployment analysis in Claude Code.',
            openTodos: ['Compare worker logs'],
          },
        }),
      ],
      'rt-codex-ended': [],
    },
    terminalTakeoversBySessionId: {
      'rt-claude-paused': createTerminalTakeoverState({ sessionId: 'rt-claude-paused' }),
    },
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function interceptRuntimeSessionsApi(page: Page, state: MockState): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const postData = request.postData();
    const body = postData ? (JSON.parse(postData) as Record<string, unknown>) : null;

    if (method === 'GET' && url.pathname === '/api/sessions') {
      const limit = Number(url.searchParams.get('limit') ?? state.agentSessions.length);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      await fulfillJson(route, {
        sessions: state.agentSessions,
        total: state.agentSessions.length,
        limit,
        offset,
        hasMore: false,
      });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/runtime-sessions') {
      await fulfillJson(route, {
        sessions: state.runtimeSessions,
        count: state.runtimeSessions.length,
      });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/settings/accounts') {
      await fulfillJson(route, []);
      return;
    }

    if (method === 'GET' && url.pathname === '/api/agents') {
      await fulfillJson(route, state.machines);
      return;
    }

    if (method === 'GET' && url.pathname === '/api/runtime-config/drift') {
      await fulfillJson(route, createRuntimeConfigDrift(state.machines));
      return;
    }

    const handoffsMatch = url.pathname.match(/^\/api\/runtime-sessions\/([^/]+)\/handoffs$/);
    if (method === 'GET' && handoffsMatch) {
      const sessionId = decodeURIComponent(handoffsMatch[1] ?? '');
      const handoffs = state.handoffsBySessionId[sessionId] ?? [];
      await fulfillJson(route, { handoffs, count: handoffs.length });
      return;
    }

    const preflightMatch = url.pathname.match(
      /^\/api\/runtime-sessions\/([^/]+)\/handoff\/preflight$/,
    );
    if (method === 'GET' && preflightMatch) {
      const targetRuntime = (url.searchParams.get('targetRuntime') ??
        'claude-code') as ManagedRuntime;
      await fulfillJson(route, {
        nativeImportCapable: true,
        attempt: {
          reason: null,
          metadata: {
            targetCli:
              targetRuntime === 'codex'
                ? { command: 'codex', version: '1.2.0' }
                : { command: 'claude', version: '1.0.0' },
            sourceStorage: {
              sessionPath: '/Users/example/.runtime/sessions',
            },
          },
        },
      });
      return;
    }

    const manualTakeoverMatch = url.pathname.match(
      /^\/api\/runtime-sessions\/([^/]+)\/manual-takeover$/,
    );
    if (method === 'GET' && manualTakeoverMatch) {
      await fulfillJson(route, { manualTakeover: null });
      return;
    }

    const terminalTakeoverMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/takeover$/);
    if (terminalTakeoverMatch) {
      const sessionId = decodeURIComponent(terminalTakeoverMatch[1] ?? '');
      const runtimeSession = state.runtimeSessions.find((session) => session.id === sessionId);

      if (method === 'GET') {
        await fulfillJson(
          route,
          state.terminalTakeoversBySessionId[sessionId] ??
            createTerminalTakeoverState({ sessionId }),
        );
        return;
      }

      if (method === 'POST') {
        const terminalTakeover = createTerminalTakeoverState({
          sessionId,
          active: true,
          terminalId: `term-${sessionId}`,
          claudeSessionId: runtimeSession?.nativeSessionId ?? undefined,
          machineId: runtimeSession?.machineId ?? 'machine-1',
          startedAt: '2026-03-21T00:05:00.000Z',
        });

        state.terminalTakeoversBySessionId[sessionId] = terminalTakeover;

        await fulfillJson(route, {
          ok: true,
          terminalId: terminalTakeover.terminalId,
          takeoverToken: `takeover-${sessionId}`,
          claudeSessionId: terminalTakeover.claudeSessionId,
          machineId: terminalTakeover.machineId,
        });
        return;
      }
    }

    const releaseMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/release$/);
    if (method === 'POST' && releaseMatch) {
      const sessionId = decodeURIComponent(releaseMatch[1] ?? '');
      const existingTakeover =
        state.terminalTakeoversBySessionId[sessionId] ?? createTerminalTakeoverState({ sessionId });

      state.terminalTakeoversBySessionId[sessionId] = {
        ...existingTakeover,
        active: false,
        releasedAt: '2026-03-21T00:06:00.000Z',
      };

      await fulfillJson(route, {
        ok: true,
        resumed: false,
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/sessions') {
      await fulfillJson(route, {
        ok: true,
        sessionId: 'session-created-1',
        session: createAgentSession({
          id: 'session-created-1',
          agentId: String(body?.agentId ?? 'adhoc'),
          machineId: String(body?.machineId ?? 'machine-1'),
          projectPath: String(body?.projectPath ?? '/tmp/runtime-created'),
          model: typeof body?.model === 'string' ? body.model : null,
          metadata: {
            createdBy: 'playwright',
          },
        }),
      });
      return;
    }

    await fulfillJson(
      route,
      {
        error: 'NOT_FOUND',
        message: `Unhandled API route: ${method} ${url.pathname}`,
      },
      404,
    );
  });
}

async function mockRuntimeSessionTerminalWebSocket(
  page: Page,
  machineId: string,
  terminalId: string,
): Promise<void> {
  await page.routeWebSocket(
    `ws://localhost:8080/api/machines/${machineId}/terminal/${terminalId}/ws`,
    (ws) => {
      ws.onMessage((message) => {
        const payload =
          typeof message === 'string'
            ? (JSON.parse(message) as Record<string, unknown>)
            : (JSON.parse(message.toString('utf8')) as Record<string, unknown>);

        if (payload.type === 'resize') {
          ws.send(JSON.stringify({ type: 'output', data: '$ ready\r\n' }));
          return;
        }

        if (payload.type === 'input') {
          ws.send(JSON.stringify({ type: 'output', data: `> ${String(payload.data ?? '')}` }));
        }
      });
    },
  );
}

function sessionRows(page: Page) {
  return page.locator('div[role="option"][id^="session-"]');
}

test.describe('Runtime sessions surface', () => {
  test('redirects into the runtime view and hides agent rows', async ({ page }) => {
    await interceptRuntimeSessionsApi(page, createMockState());

    await page.goto('/runtime-sessions');

    await expect(page).toHaveURL(/\/sessions\?type=runtime$/);
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByLabel('Type')).toHaveValue('runtime');
    await expect(page.locator('#session-rt-codex-active')).toBeVisible();
    await expect(page.locator('#session-rt-claude-paused')).toBeVisible();
    await expect(page.locator('#session-agent-session-1')).toHaveCount(0);
  });

  test('filters runtime rows by status and search, then shows runtime detail metadata and handoff history', async ({
    page,
  }) => {
    await interceptRuntimeSessionsApi(page, createMockState());

    await page.goto('/sessions?type=runtime');

    await expect(page.locator('#session-rt-codex-active')).toBeVisible({ timeout: 15_000 });

    await page.locator('button').filter({ hasText: 'Ended' }).first().click();
    await expect(sessionRows(page)).toHaveCount(2);
    await expect(page.locator('#session-rt-codex-ended')).toBeVisible();
    await expect(page.locator('#session-rt-claude-paused')).toBeVisible();
    await expect(page.locator('#session-rt-codex-active')).toHaveCount(0);

    await page.locator('button').filter({ hasText: 'All' }).first().click();
    await page.getByLabel('Search sessions').fill('rt-claude-paused');

    await expect(sessionRows(page)).toHaveCount(1);
    await expect(page.locator('#session-rt-claude-paused')).toBeVisible();
    await page.locator('#session-rt-claude-paused button').click();

    const detailPanel = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Session Detail' }) });

    await expect(detailPanel.getByText('claude-native-2')).toBeVisible();
    await expect(detailPanel.getByText('ec2-runner', { exact: true }).first()).toBeVisible();
    await expect(detailPanel.getByText('environment')).toBeVisible();
    await expect(detailPanel.getByText('prod')).toBeVisible();
    await expect(
      detailPanel.getByText('Investigate the paused deployment from Codex.'),
    ).toBeVisible();
    await expect(detailPanel.getByText('resume investigation')).toBeVisible();
  });

  test('submits the runtime-aware create session form with the selected runtime', async ({
    page,
  }) => {
    await interceptRuntimeSessionsApi(page, createMockState());

    await page.goto('/sessions?type=runtime');

    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: 'Create new session' }).click();
    await expect(page.getByText('Create New Session')).toBeVisible();

    await page.getByRole('radio', { name: 'Codex' }).click();
    await page.locator('#create-session-project').fill('/tmp/runtime-created');
    await page.locator('#create-session-prompt').fill('Validate the runtime session flow');

    const createRequestPromise = page.waitForRequest(
      (request) =>
        request.method() === 'POST' && new URL(request.url()).pathname === '/api/sessions',
    );
    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/sessions',
    );

    await expect(page.getByRole('button', { name: 'Create Session' })).toBeEnabled();
    await page.getByRole('button', { name: 'Create Session' }).click();

    const createRequest = await createRequestPromise;
    expect(createRequest.postDataJSON()).toMatchObject({
      agentId: 'adhoc',
      machineId: 'machine-1',
      projectPath: '/tmp/runtime-created',
      prompt: 'Validate the runtime session flow',
      runtime: 'codex',
    });

    const createResponse = await createResponsePromise;
    expect(createResponse.ok()).toBeTruthy();

    await expect(page.locator('#create-session-project')).toHaveCount(0);
  });

  test('attaches a live terminal for Claude runtime sessions and releases it', async ({ page }) => {
    const state = createMockState();
    await interceptRuntimeSessionsApi(page, state);
    await mockRuntimeSessionTerminalWebSocket(page, 'machine-2', 'term-rt-claude-paused');

    await page.goto('/sessions?type=runtime');

    await expect(page.locator('#session-rt-claude-paused')).toBeVisible({ timeout: 15_000 });
    await page.locator('#session-rt-claude-paused button').click();

    const detailPanel = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Session Detail' }) });

    await expect(detailPanel.getByRole('button', { name: 'Attach Terminal' })).toBeVisible();

    const attachResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/sessions/rt-claude-paused/takeover',
    );

    await detailPanel.getByRole('button', { name: 'Attach Terminal' }).click();

    const attachResponse = await attachResponsePromise;
    expect(attachResponse.ok()).toBeTruthy();

    await expect(page.getByText('Live terminal attach is ready')).toBeVisible();
    await expect(detailPanel.getByRole('button', { name: 'Release Terminal' })).toBeVisible();
    await expect(detailPanel.getByText('machine-2', { exact: true }).first()).toBeVisible();
    await expect(detailPanel.getByText('term-rt-claude-paused')).toBeVisible();
    await expect(detailPanel.getByText('Connected')).toBeVisible();
    await expect(detailPanel.getByRole('button', { name: 'Copy terminal output' })).toBeVisible();

    const releaseResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/sessions/rt-claude-paused/release',
    );

    await detailPanel.getByRole('button', { name: 'Release Terminal' }).click();

    const releaseResponse = await releaseResponsePromise;
    expect(releaseResponse.ok()).toBeTruthy();

    await expect(page.getByText('Live terminal attach released')).toBeVisible();
    await expect(detailPanel.getByRole('button', { name: 'Attach Terminal' })).toBeVisible();
    await expect(detailPanel.getByText('No active live terminal attach')).toBeVisible();
    await expect(detailPanel.getByRole('button', { name: 'Copy terminal output' })).toHaveCount(0);
  });
});
