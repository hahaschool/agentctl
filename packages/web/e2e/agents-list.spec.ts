import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * Backend-independent coverage for the agents index route.
 *
 * The page coordinates the agent list, machine/session lookups, create dialog,
 * and one-off start mutation. These specs mock every `/api/**` request so they
 * only need the Next.js dev server on $WEB_PORT.
 */

type AgentStatus = 'registered' | 'running' | 'stopped' | 'error' | 'starting' | 'stopping';

type Agent = {
  id: string;
  machineId: string;
  name: string;
  type: 'manual' | 'adhoc' | 'cron' | 'heartbeat' | 'loop';
  runtime: 'claude-code' | 'codex';
  status: AgentStatus;
  schedule: string | null;
  projectPath: string | null;
  worktreeBranch: string | null;
  currentSessionId: string | null;
  config: {
    model?: string;
    initialPrompt?: string;
    maxTurns?: number;
    permissionMode?: string;
    defaultPrompt?: string;
  };
  lastRunAt: string | null;
  lastCostUsd: number | null;
  totalCostUsd: number;
  accountId: string | null;
  createdAt: string;
};

type Machine = {
  id: string;
  hostname: string;
  tailscaleIp: string;
  os: string;
  arch: string;
  status: 'online' | 'offline';
  lastHeartbeat: string | null;
  createdAt: string;
};

type Session = {
  id: string;
  agentId: string | null;
  agentName: string | null;
  machineId: string;
  sessionUrl: string | null;
  claudeSessionId: string | null;
  status: 'completed' | 'running';
  projectPath: string;
  pid: number | null;
  startedAt: string;
  lastHeartbeat: string | null;
  endedAt: string | null;
  metadata: Record<string, unknown>;
  accountId: string | null;
  model: string;
};

type CreateAgentBody = {
  name: string;
  machineId: string;
  type: string;
  runtime?: string;
  projectPath?: string;
  config?: {
    model?: string;
    initialPrompt?: string;
    maxTurns?: number;
    permissionMode?: string;
  };
};

type StartCall = {
  id: string;
  body: unknown;
};

type MockState = {
  agents: Agent[];
  machines: Machine[];
  sessions: Session[];
  createBodies: CreateAgentBody[];
  startCalls: StartCall[];
};

const NOW = '2026-04-14T10:15:00.000Z';

const machines: Machine[] = [
  {
    id: 'machine-dev-1',
    hostname: 'dev-1',
    tailscaleIp: '100.64.0.10',
    os: 'darwin',
    arch: 'arm64',
    status: 'online',
    lastHeartbeat: NOW,
    createdAt: '2026-04-01T00:00:00.000Z',
  },
  {
    id: 'machine-dev-2',
    hostname: 'dev-2',
    tailscaleIp: '100.64.0.11',
    os: 'linux',
    arch: 'arm64',
    status: 'offline',
    lastHeartbeat: '2026-04-14T08:00:00.000Z',
    createdAt: '2026-04-01T00:00:00.000Z',
  },
];

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-roadmap-runner',
    machineId: 'machine-dev-1',
    name: 'Roadmap Runner',
    type: 'manual',
    runtime: 'codex',
    status: 'running',
    schedule: null,
    projectPath: '/Users/hahaschool/agentctl',
    worktreeBranch: 'agent/codex-494-agents-list-e2e',
    currentSessionId: 'sess-roadmap-runner',
    config: {
      model: 'gpt-5.4',
      defaultPrompt: 'Audit the current roadmap status.',
    },
    lastRunAt: '2026-04-14T10:00:00.000Z',
    lastCostUsd: 0.27,
    totalCostUsd: 1.09,
    accountId: 'acct-codex',
    createdAt: '2026-04-13T08:00:00.000Z',
    ...overrides,
  };
}

const agents: Agent[] = [
  makeAgent(),
  makeAgent({
    id: 'agent-idle-researcher',
    machineId: 'machine-dev-2',
    name: 'Idle Researcher',
    runtime: 'claude-code',
    status: 'stopped',
    currentSessionId: null,
    config: { model: 'claude-sonnet-4-5', defaultPrompt: 'Summarize roadmap drift.' },
    lastRunAt: null,
    lastCostUsd: null,
    totalCostUsd: 0,
    worktreeBranch: null,
  }),
];

const sessions: Session[] = [
  {
    id: 'sess-roadmap-runner',
    agentId: 'agent-roadmap-runner',
    agentName: 'Roadmap Runner',
    machineId: 'machine-dev-1',
    sessionUrl: null,
    claudeSessionId: null,
    status: 'running',
    projectPath: '/Users/hahaschool/agentctl',
    pid: 12345,
    startedAt: '2026-04-14T10:00:00.000Z',
    lastHeartbeat: NOW,
    endedAt: null,
    metadata: {},
    accountId: 'acct-codex',
    model: 'gpt-5.4',
  },
  {
    id: 'sess-recent-docs',
    agentId: null,
    agentName: null,
    machineId: 'machine-dev-1',
    sessionUrl: null,
    claudeSessionId: null,
    status: 'completed',
    projectPath: '/Users/hahaschool/agentctl/docs',
    pid: null,
    startedAt: '2026-04-14T09:00:00.000Z',
    lastHeartbeat: '2026-04-14T09:30:00.000Z',
    endedAt: '2026-04-14T09:35:00.000Z',
    metadata: {},
    accountId: null,
    model: 'gpt-5.4',
  },
];

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mountApiMocks(page: Page, state: MockState): Promise<void> {
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
    if (method === 'GET' && pathname === '/api/health') {
      await fulfillJson(route, { ok: true, status: 'healthy' });
      return;
    }
    if (method === 'GET' && pathname === '/api/agents') {
      await fulfillJson(route, state.machines);
      return;
    }
    if (method === 'GET' && pathname === '/api/agents/list') {
      await fulfillJson(route, {
        agents: state.agents,
        total: state.agents.length,
        hasMore: false,
      });
      return;
    }
    if (method === 'POST' && pathname === '/api/agents') {
      const body = request.postDataJSON() as CreateAgentBody;
      state.createBodies.push(body);
      state.agents = [
        makeAgent({
          id: 'agent-created-e2e',
          machineId: body.machineId,
          name: body.name,
          type: body.type as Agent['type'],
          runtime: (body.runtime ?? 'claude-code') as Agent['runtime'],
          status: 'registered',
          projectPath: body.projectPath ?? null,
          currentSessionId: null,
          config: body.config ?? {},
          lastRunAt: null,
          lastCostUsd: null,
          totalCostUsd: 0,
        }),
        ...state.agents,
      ];
      await fulfillJson(route, { ok: true, agentId: 'agent-created-e2e' });
      return;
    }

    const startMatch = pathname.match(/^\/api\/agents\/([^/]+)\/start$/);
    if (method === 'POST' && startMatch) {
      state.startCalls.push({
        id: decodeURIComponent(startMatch[1] ?? ''),
        body: request.postDataJSON(),
      });
      await fulfillJson(route, { ok: true });
      return;
    }

    if (method === 'GET' && pathname === '/api/sessions') {
      expect(url.searchParams.get('limit')).toBe('100');
      await fulfillJson(route, {
        sessions: state.sessions,
        total: state.sessions.length,
        limit: 100,
        offset: 0,
        hasMore: false,
      });
      return;
    }
    if (method === 'GET' && pathname === '/api/runtime-config/drift') {
      await fulfillJson(route, {
        ok: true,
        items: state.machines.flatMap((machine) => [
          {
            machineId: machine.id,
            runtime: 'claude-code',
            isInstalled: true,
            version: '1.0.0',
            issues: [],
          },
          {
            machineId: machine.id,
            runtime: 'codex',
            isInstalled: true,
            version: '1.0.0',
            issues: [],
          },
        ]),
      });
      return;
    }
    if (method === 'GET' && pathname === '/api/memory/scopes') {
      await fulfillJson(route, {
        ok: true,
        scopes: [
          {
            id: 'scope-agentctl',
            name: 'agentctl',
            type: 'project',
            created_at: NOW,
            updated_at: NOW,
          },
        ],
      });
      return;
    }

    throw new Error(`Unhandled API request in agents-list e2e mock: ${method} ${pathname}`);
  });
}

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    agents: [...agents],
    machines,
    sessions,
    createBodies: [],
    startCalls: [],
    ...overrides,
  };
}

test.describe('Agents page', () => {
  test('renders agents, filters the list, and starts a stopped agent', async ({ page }) => {
    const state = makeState();
    await mountApiMocks(page, state);

    await page.goto('/agents');

    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Roadmap Runner', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Idle Researcher', exact: true })).toBeVisible();
    await expect(page.getByText('2 agents registered')).toBeVisible();
    await expect(page.getByText('2/2 agents')).toBeVisible();
    await expect(page.getByText('dev-1')).toBeVisible();
    await expect(page.getByText('dev-2')).toBeVisible();

    await page.getByLabel('Search agents (press / to focus)').fill('roadmap');
    await expect(page.getByRole('link', { name: 'Roadmap Runner', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Idle Researcher', exact: true })).toBeHidden();
    await expect(page.getByText('1/2 agents')).toBeVisible();

    await page.getByLabel('Search agents (press / to focus)').fill('');
    await page.getByLabel('Filter by status').selectOption('stopped');
    await expect(page.getByRole('link', { name: 'Idle Researcher', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Roadmap Runner', exact: true })).toBeHidden();

    await page.getByRole('button', { name: 'Start' }).click();
    const startDialog = page.getByRole('dialog', { name: 'Start Agent' });
    await expect(startDialog).toBeVisible();
    await startDialog.getByLabel('Prompt').fill('Summarize pending roadmap drift');
    await startDialog.getByRole('button', { name: 'Start' }).click();

    await expect
      .poll(() => state.startCalls, { message: 'POST /api/agents/:id/start captured' })
      .toEqual([
        {
          id: 'agent-idle-researcher',
          body: { prompt: 'Summarize pending roadmap drift' },
        },
      ]);
    await expect(page.getByText('Agent started')).toBeVisible();
    await expect(startDialog).toBeHidden();
  });

  test('creates an agent from scratch with prompt, project, and name payload', async ({ page }) => {
    const state = makeState();
    await mountApiMocks(page, state);

    await page.goto('/agents');
    await page.getByRole('button', { name: 'New Agent' }).click();

    const dialog = page.getByRole('dialog', { name: 'New Agent' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Start from scratch' }).click();
    await dialog.getByLabel('Agent prompt').fill('Audit agent list browser flows');
    await dialog.getByLabel('Project').fill('/Users/hahaschool/agentctl');
    await dialog.getByRole('button', { name: /Advanced/ }).click();
    await dialog.getByLabel('Name').fill('Agent List Auditor');
    await dialog.getByLabel('Agent prompt').focus();
    await page.keyboard.press('Enter');

    await expect
      .poll(() => state.createBodies, { message: 'POST /api/agents captured' })
      .toEqual([
        expect.objectContaining({
          name: 'Agent List Auditor',
          machineId: 'machine-dev-1',
          type: 'adhoc',
          runtime: 'claude-code',
          projectPath: '/Users/hahaschool/agentctl',
          config: expect.objectContaining({
            initialPrompt: 'Audit agent list browser flows',
          }),
        }),
      ]);

    await expect(page.getByText('Agent "Agent List Auditor" created')).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('link', { name: 'Agent List Auditor', exact: true })).toBeVisible();
  });
});
