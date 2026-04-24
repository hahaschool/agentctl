import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * Backend-independent coverage for the dynamic agent detail route.
 *
 * The page coordinates agent details, run history, sessions, account/machine
 * lookup, memory facts, and the start-run mutation. These specs mock every
 * `/api/**` request so they only need the Next.js dev server on $WEB_PORT.
 */

type AgentStatus = 'idle' | 'running' | 'error' | 'timeout';

type Agent = {
  id: string;
  machineId: string;
  name: string;
  type: 'manual' | 'cron' | 'heartbeat' | 'loop';
  runtime: 'claude-code' | 'codex';
  status: AgentStatus;
  schedule: string | null;
  projectPath: string | null;
  worktreeBranch: string | null;
  currentSessionId: string | null;
  config: {
    model?: string;
    maxTurns?: number;
    permissionMode?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
    systemPrompt?: string;
    defaultPrompt?: string;
  };
  lastRunAt: string | null;
  lastCostUsd: number | null;
  totalCostUsd: number;
  accountId: string | null;
  createdAt: string;
};

type AgentRun = {
  id: string;
  agentId: string;
  trigger: 'manual' | 'schedule';
  status: 'success' | 'failure';
  phase: 'completed' | 'failed';
  prompt: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  resultSummary: {
    status: 'success' | 'failure';
    workCompleted: string;
    executiveSummary: string;
    keyFindings: string[];
    filesChanged: Array<{ path: string; action: 'created' | 'modified' | 'deleted' }>;
    followUps: string[];
    commandsRun: number;
    toolUsageBreakdown: Record<string, number>;
    branchName: string | null;
    prUrl: string | null;
    tokensUsed: { input: number; output: number };
    costUsd: number;
    durationMs: number;
  };
  sessionId: string | null;
};

type Session = {
  id: string;
  agentId: string;
  agentName: string;
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

type ApiAccount = {
  id: string;
  provider: string;
  name: string;
  isActive: boolean;
  priority: number;
  createdAt: string;
  lastUsedAt: string | null;
};

type MemoryFact = {
  id: string;
  scope: string;
  content: string;
  content_model: string;
  entity_type: string;
  confidence: number;
  strength: number;
  source: { type: string; sessionId?: string; agentId?: string };
  valid_from: string;
  valid_until: string | null;
  created_at: string;
  accessed_at: string;
  tags: string[];
};

type MockState = {
  agent: Agent;
  runs: AgentRun[];
  sessions: Session[];
  machines: Machine[];
  accounts: ApiAccount[];
  facts: MemoryFact[];
  startBodies: unknown[];
};

const AGENT_ID = 'agent-detail-e2e';
const SESSION_ID = 'sess-agent-detail-0001';
const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysAgo(
  daysAgo: number,
  hours: number,
  minutes: number,
  seconds = 0,
  milliseconds = 0,
): string {
  const date = new Date(Date.now() - daysAgo * DAY_MS);
  date.setHours(hours, minutes, seconds, milliseconds);
  return date.toISOString();
}

function addMilliseconds(value: string, milliseconds: number): string {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

const NOW = isoDaysAgo(0, 9, 30);
const LATEST_RUN_STARTED_AT = isoDaysAgo(0, 9, 0);
const LATEST_RUN_FINISHED_AT = addMilliseconds(LATEST_RUN_STARTED_AT, 92_000);
const PREVIOUS_RUN_STARTED_AT = isoDaysAgo(1, 11, 0);
const PREVIOUS_RUN_FINISHED_AT = addMilliseconds(PREVIOUS_RUN_STARTED_AT, 120_000);

const agent: Agent = {
  id: AGENT_ID,
  machineId: 'machine-dev-1',
  name: 'Roadmap Detail Auditor',
  type: 'manual',
  runtime: 'codex',
  status: 'idle',
  schedule: null,
  projectPath: '/Users/hahaschool/agentctl',
  worktreeBranch: 'agent/codex-492-agent-detail-e2e',
  currentSessionId: SESSION_ID,
  config: {
    model: 'gpt-5.4',
    maxTurns: 8,
    permissionMode: 'on-request',
    allowedTools: ['Read', 'Grep', 'Bash'],
    disallowedTools: ['Write'],
    systemPrompt: 'Audit the agent detail route and report actionable gaps.',
    defaultPrompt: 'Run the roadmap detail audit.',
  },
  lastRunAt: NOW,
  lastCostUsd: 0.42,
  totalCostUsd: 1.26,
  accountId: 'acct-codex',
  createdAt: '2026-04-13T08:00:00.000Z',
};

const runs: AgentRun[] = [
  {
    id: 'run-detail-latest',
    agentId: AGENT_ID,
    trigger: 'manual',
    status: 'success',
    phase: 'completed',
    prompt: 'Run the roadmap detail audit.',
    costUsd: 0.42,
    tokensIn: 1200,
    tokensOut: 340,
    durationMs: 92_000,
    startedAt: LATEST_RUN_STARTED_AT,
    finishedAt: LATEST_RUN_FINISHED_AT,
    resultSummary: {
      status: 'success',
      workCompleted: 'Agent detail route coverage rendered successfully.',
      executiveSummary: 'Agent detail coverage found no blocking roadmap drift.',
      keyFindings: ['Route-level state renders from mocked control-plane data.'],
      filesChanged: [{ path: 'packages/web/e2e/agent-detail.spec.ts', action: 'created' }],
      followUps: ['Keep route mocks strict when adding new shell queries.'],
      commandsRun: 5,
      toolUsageBreakdown: { Read: 2, Grep: 1, Bash: 2 },
      branchName: 'agent/codex-492-agent-detail-e2e',
      prUrl: null,
      tokensUsed: { input: 1200, output: 340 },
      costUsd: 0.42,
      durationMs: 92_000,
    },
    sessionId: SESSION_ID,
  },
  {
    id: 'run-detail-previous',
    agentId: AGENT_ID,
    trigger: 'schedule',
    status: 'failure',
    phase: 'failed',
    prompt: 'Check stale roadmap notes.',
    costUsd: 0.84,
    tokensIn: 2000,
    tokensOut: 620,
    durationMs: 120_000,
    startedAt: PREVIOUS_RUN_STARTED_AT,
    finishedAt: PREVIOUS_RUN_FINISHED_AT,
    resultSummary: {
      status: 'failure',
      workCompleted: 'Earlier audit stopped on a fixture mismatch.',
      executiveSummary: 'Earlier audit hit a transient fixture gap.',
      keyFindings: [],
      filesChanged: [],
      followUps: [],
      commandsRun: 2,
      toolUsageBreakdown: { Bash: 2 },
      branchName: null,
      prUrl: null,
      tokensUsed: { input: 2000, output: 620 },
      costUsd: 0.84,
      durationMs: 120_000,
    },
    sessionId: 'sess-agent-detail-0000',
  },
];

const sessions: Session[] = [
  {
    id: SESSION_ID,
    agentId: AGENT_ID,
    agentName: agent.name,
    machineId: agent.machineId,
    sessionUrl: null,
    claudeSessionId: null,
    status: 'completed',
    projectPath: agent.projectPath ?? '',
    pid: null,
    startedAt: LATEST_RUN_STARTED_AT,
    lastHeartbeat: addMilliseconds(LATEST_RUN_STARTED_AT, 90_000),
    endedAt: LATEST_RUN_FINISHED_AT,
    metadata: { costUsd: 0.42 },
    accountId: agent.accountId,
    model: 'gpt-5.4',
  },
];

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
];

const accounts: ApiAccount[] = [
  {
    id: 'acct-codex',
    provider: 'openai',
    name: 'Codex Primary',
    isActive: true,
    priority: 1,
    createdAt: '2026-04-01T00:00:00.000Z',
    lastUsedAt: NOW,
  },
];

const facts: MemoryFact[] = [
  {
    id: 'fact-agent-detail-1',
    scope: 'project:agentctl',
    content: 'Agent detail pages should keep backend-independent E2E route mocks strict.',
    content_model: 'text-embedding-3-small',
    entity_type: 'pattern',
    confidence: 0.91,
    strength: 0.88,
    source: { type: 'agent', agentId: AGENT_ID, sessionId: SESSION_ID },
    valid_from: NOW,
    valid_until: null,
    created_at: NOW,
    accessed_at: NOW,
    tags: ['e2e', 'agents'],
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
    if (method === 'GET' && pathname === '/api/agents') {
      await fulfillJson(route, state.machines);
      return;
    }
    if (method === 'GET' && pathname === '/api/agents/list') {
      await fulfillJson(route, { agents: [state.agent], total: 1, hasMore: false });
      return;
    }
    if (method === 'GET' && pathname === `/api/agents/${AGENT_ID}`) {
      await fulfillJson(route, state.agent);
      return;
    }
    if (method === 'GET' && pathname === `/api/agents/${AGENT_ID}/runs`) {
      await fulfillJson(route, state.runs);
      return;
    }
    if (method === 'GET' && pathname === `/api/agents/${AGENT_ID}/health`) {
      await fulfillJson(route, {
        consecutiveFailures: 0,
        failureRate24h: 0,
        lastSuccessAt: NOW,
        status: 'healthy',
      });
      return;
    }
    if (method === 'POST' && pathname === `/api/agents/${AGENT_ID}/start`) {
      const payload = request.postDataJSON();
      state.startBodies.push(payload);
      await fulfillJson(route, { ok: true });
      return;
    }
    if (method === 'GET' && pathname === '/api/sessions') {
      expect(url.searchParams.get('agentId')).toBe(AGENT_ID);
      await fulfillJson(route, {
        sessions: state.sessions,
        total: state.sessions.length,
        limit: Number(url.searchParams.get('limit') ?? 20),
        offset: Number(url.searchParams.get('offset') ?? 0),
        hasMore: false,
      });
      return;
    }
    if (method === 'GET' && pathname === '/api/runtime-sessions') {
      await fulfillJson(route, { sessions: [], count: 0 });
      return;
    }
    if (method === 'GET' && pathname === '/api/settings/accounts') {
      await fulfillJson(route, state.accounts);
      return;
    }
    if (method === 'GET' && pathname === '/api/memory/facts') {
      expect(url.searchParams.get('agentId')).toBe(AGENT_ID);
      await fulfillJson(route, { ok: true, facts: state.facts, total: state.facts.length });
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

    throw new Error(`Unhandled API request in agent-detail e2e mock: ${method} ${pathname}`);
  });
}

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    agent,
    runs,
    sessions,
    machines,
    accounts,
    facts,
    startBodies: [],
    ...overrides,
  };
}

test.describe('Agent detail page', () => {
  test('renders details, configuration, sessions, memory, and run history', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const state = makeState();
    await mountApiMocks(page, state);

    await page.goto(`/agents/${AGENT_ID}`);

    await expect(page.getByRole('heading', { name: agent.name })).toBeVisible();
    await expect(page.getByText('gpt-5.4').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'dev-1' })).toHaveAttribute(
      'href',
      `/machines/${agent.machineId}`,
    );
    await expect(page.getByText('/Users/hahaschool/agentctl')).toBeVisible();
    await expect(page.getByText('agent/codex-492-agent-detail-e2e')).toBeVisible();
    await expect(page.getByRole('link', { name: 'sess-agent-d...' })).toHaveAttribute(
      'href',
      `/sessions/${SESSION_ID}`,
    );

    await expect(page.getByText('Last Run Cost')).toBeVisible();
    await expect(page.getByText('$0.42').first()).toBeVisible();
    await expect(page.getByText('Total Cost')).toBeVisible();
    await expect(page.getByText('$1.26')).toBeVisible();
    await expect(page.getByText('Avg Cost / Run')).toBeVisible();
    await expect(page.getByText('$0.63')).toBeVisible();

    const configCard = page.getByTestId('agent-config-card');
    await expect(configCard).toContainText('Max Turns');
    await expect(configCard).toContainText('8');
    await expect(configCard).toContainText('on-request');
    await expect(configCard).toContainText('Read, Grep, Bash');
    await expect(configCard).toContainText('Write');
    await expect(configCard).toContainText('Audit the agent detail route');

    await expect(page.getByRole('link', { name: /sess-agent-d.*gpt-5\.4/ })).toHaveAttribute(
      'href',
      `/sessions/${SESSION_ID}`,
    );
    await expect(page.getByRole('button', { name: 'View Run' })).toBeVisible();

    await expect(page.getByTestId('agent-memory-section')).toBeVisible();
    await expect(page.getByTestId('agent-memory-card')).toContainText('1 fact');
    await expect(page.getByText('Agent detail pages should keep')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse all' })).toHaveAttribute(
      'href',
      `/memory/browser?agentId=${encodeURIComponent(AGENT_ID)}`,
    );

    await expect(page.getByTestId('run-history-timeline')).toContainText('50% success');
    await expect(page.getByText('Latest Run Summary')).toBeVisible();
    await expect(page.getByText('Agent detail coverage found no blocking roadmap drift.')).toBeVisible();
    await expect(page.getByText('Route-level state renders from mocked control-plane data.')).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'Runs from Today' }).getByText('Run the roadmap detail audit.'),
    ).toBeVisible();
    await expect(page.locator('table').getByText('Check stale roadmap notes.')).toBeVisible();
  });

  test('starts an agent with an override prompt', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const state = makeState();
    await mountApiMocks(page, state);

    await page.goto(`/agents/${AGENT_ID}`);
    await expect(page.getByRole('heading', { name: agent.name })).toBeVisible();

    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByRole('heading', { name: 'Start Agent' })).toBeVisible();

    await page.getByLabel('Prompt to start agent').fill('Re-run audit with screenshots');
    const startResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/agents/${AGENT_ID}/start`,
    );
    await page.getByRole('button', { name: 'Go' }).click();
    await startResponse;

    expect(state.startBodies).toEqual([{ prompt: 'Re-run audit with screenshots' }]);
    await expect(page.getByText('Agent started')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Start Agent' })).toHaveCount(0);
  });
});
