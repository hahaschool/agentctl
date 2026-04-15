import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * Backend-independent coverage for the fleet machine list and detail routes.
 *
 * The spec mocks every `/api/**` request so it only needs the Next.js dev
 * server on $WEB_PORT and never depends on beta/dev control-plane services.
 */

type MachineStatus = 'online' | 'offline' | 'degraded';

type Machine = {
  id: string;
  hostname: string;
  tailscaleIp: string;
  os: 'linux' | 'darwin';
  arch: 'x64' | 'arm64';
  status: MachineStatus;
  lastHeartbeat: string | null;
  capabilities?: {
    gpu: boolean;
    docker: boolean;
    maxConcurrentAgents: number;
  };
  createdAt: string;
};

type Agent = {
  id: string;
  machineId: string;
  name: string;
  type: 'manual' | 'adhoc' | 'cron' | 'heartbeat' | 'loop';
  status: string;
  schedule: string | null;
  projectPath: string | null;
  worktreeBranch: string | null;
  currentSessionId: string | null;
  config: Record<string, unknown>;
  lastRunAt: string | null;
  lastCostUsd: number | null;
  totalCostUsd: number;
  accountId: string | null;
  createdAt: string;
};

type Session = {
  id: string;
  agentId: string;
  agentName: string | null;
  machineId: string;
  sessionUrl: string | null;
  claudeSessionId: string | null;
  status: string;
  projectPath: string;
  pid: number | null;
  startedAt: string;
  lastHeartbeat: string | null;
  endedAt: string | null;
  metadata: Record<string, unknown>;
  accountId: string | null;
  model: string;
};

type WorkerNode = {
  id: string;
  hostname: string;
  tailscaleIp: string | null;
  maxConcurrentAgents: number;
  currentLoad: number;
  capabilities: string[];
  status: MachineStatus;
  lastHeartbeatAt: string;
  createdAt: string;
};

type RuntimeDriftItem = {
  id: string;
  machineId: string;
  runtime: 'claude-code' | 'codex';
  isInstalled: boolean;
  isAuthenticated: boolean;
  syncStatus: string;
  configVersion: number | null;
  configHash: string | null;
  metadata: Record<string, unknown>;
  lastConfigAppliedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  drifted: boolean;
};

type SyncPeerFixture = {
  machineId: string;
  hostname: string;
  tailscaleIp: string | null;
  syncUrl: string | null;
  role: string;
  syncStatus: string;
  syncIntervalMs: number;
  isSelf: boolean;
  publicKey: string | null;
  lastSeen: string | null;
  createdAt: string | null;
  reverseRegistrationStatus?: 'pending' | 'ok' | 'failed' | null;
  reverseRegistrationError?: string | null;
  reverseRegistrationAt?: string | null;
};

type MockState = {
  machines: Machine[];
  agents: Agent[];
  sessions: Session[];
  workerNodes: WorkerNode[];
  runtimeDrift: RuntimeDriftItem[];
  memoryFacts: Array<Record<string, unknown>>;
  syncPeers: SyncPeerFixture[];
};

const NOW = new Date().toISOString();
const STALE_HEARTBEAT = new Date(Date.now() - 120_000).toISOString();
const REGISTERED_AT = '2026-04-01T00:00:00.000Z';

const machines: Machine[] = [
  {
    id: 'machine-dev-1',
    hostname: 'dev-1',
    tailscaleIp: '100.64.0.10',
    os: 'darwin',
    arch: 'arm64',
    status: 'online',
    lastHeartbeat: NOW,
    capabilities: {
      gpu: true,
      docker: false,
      maxConcurrentAgents: 4,
    },
    createdAt: REGISTERED_AT,
  },
  {
    id: 'machine-stale-mac',
    hostname: 'stale-mac',
    tailscaleIp: '100.64.0.20',
    os: 'darwin',
    arch: 'arm64',
    status: 'online',
    lastHeartbeat: STALE_HEARTBEAT,
    capabilities: {
      gpu: false,
      docker: true,
      maxConcurrentAgents: 2,
    },
    createdAt: REGISTERED_AT,
  },
  {
    id: 'machine-linux-offline',
    hostname: 'linux-offline',
    tailscaleIp: '100.64.0.30',
    os: 'linux',
    arch: 'x64',
    status: 'offline',
    lastHeartbeat: NOW,
    capabilities: {
      gpu: false,
      docker: true,
      maxConcurrentAgents: 1,
    },
    createdAt: REGISTERED_AT,
  },
  {
    id: 'machine-gpu-degraded',
    hostname: 'gpu-degraded',
    tailscaleIp: '100.64.0.40',
    os: 'linux',
    arch: 'x64',
    status: 'degraded',
    lastHeartbeat: NOW,
    capabilities: {
      gpu: true,
      docker: true,
      maxConcurrentAgents: 8,
    },
    createdAt: REGISTERED_AT,
  },
];

const agents: Agent[] = [
  {
    id: 'agent-build-sentinel',
    machineId: 'machine-dev-1',
    name: 'Build Sentinel',
    type: 'manual',
    status: 'running',
    schedule: null,
    projectPath: '/srv/agentctl',
    worktreeBranch: 'codex/497-machines-e2e',
    currentSessionId: 'sess-machine-dev-1',
    config: {},
    lastRunAt: NOW,
    lastCostUsd: 0.15,
    totalCostUsd: 1.2,
    accountId: 'acct-codex',
    createdAt: REGISTERED_AT,
  },
  {
    id: 'agent-offline-helper',
    machineId: 'machine-linux-offline',
    name: 'Offline Helper',
    type: 'manual',
    status: 'stopped',
    schedule: null,
    projectPath: '/srv/other',
    worktreeBranch: null,
    currentSessionId: null,
    config: {},
    lastRunAt: null,
    lastCostUsd: null,
    totalCostUsd: 0,
    accountId: null,
    createdAt: REGISTERED_AT,
  },
];

const sessions: Session[] = [
  {
    id: 'sess-machine-dev-1',
    agentId: 'agent-build-sentinel',
    agentName: 'Build Sentinel',
    machineId: 'machine-dev-1',
    sessionUrl: null,
    claudeSessionId: null,
    status: 'running',
    projectPath: '/srv/agentctl',
    pid: 4747,
    startedAt: NOW,
    lastHeartbeat: NOW,
    endedAt: null,
    metadata: {},
    accountId: 'acct-codex',
    model: 'gpt-5.4',
  },
  {
    id: 'sess-linux-offline',
    agentId: 'agent-offline-helper',
    agentName: 'Offline Helper',
    machineId: 'machine-linux-offline',
    sessionUrl: null,
    claudeSessionId: null,
    status: 'completed',
    projectPath: '/srv/other',
    pid: null,
    startedAt: '2026-04-14T08:00:00.000Z',
    lastHeartbeat: '2026-04-14T08:10:00.000Z',
    endedAt: '2026-04-14T08:12:00.000Z',
    metadata: {},
    accountId: null,
    model: 'claude-sonnet-4-5',
  },
];

const workerNodes: WorkerNode[] = [
  {
    id: 'worker-hostname-match',
    hostname: 'dev-1',
    tailscaleIp: '100.64.9.2',
    maxConcurrentAgents: 4,
    currentLoad: 1,
    capabilities: ['docker'],
    status: 'online',
    lastHeartbeatAt: NOW,
    createdAt: REGISTERED_AT,
  },
  {
    id: 'worker-ip-match',
    hostname: 'renamed-worker',
    tailscaleIp: '100.64.0.10',
    maxConcurrentAgents: 8,
    currentLoad: 2,
    capabilities: ['gpu'],
    status: 'online',
    lastHeartbeatAt: NOW,
    createdAt: REGISTERED_AT,
  },
  {
    id: 'worker-other-machine',
    hostname: 'linux-offline',
    tailscaleIp: '100.64.0.30',
    maxConcurrentAgents: 1,
    currentLoad: 0,
    capabilities: [],
    status: 'offline',
    lastHeartbeatAt: NOW,
    createdAt: REGISTERED_AT,
  },
];

const runtimeDrift: RuntimeDriftItem[] = [
  {
    id: 'runtime-dev-1-claude',
    machineId: 'machine-dev-1',
    runtime: 'claude-code',
    isInstalled: true,
    isAuthenticated: true,
    syncStatus: 'in-sync',
    configVersion: 12,
    configHash: 'hash-claude',
    metadata: {},
    lastConfigAppliedAt: NOW,
    createdAt: REGISTERED_AT,
    updatedAt: NOW,
    drifted: false,
  },
  {
    id: 'runtime-dev-1-codex',
    machineId: 'machine-dev-1',
    runtime: 'codex',
    isInstalled: true,
    isAuthenticated: false,
    syncStatus: 'in-sync',
    configVersion: 12,
    configHash: 'hash-codex',
    metadata: {},
    lastConfigAppliedAt: NOW,
    createdAt: REGISTERED_AT,
    updatedAt: NOW,
    drifted: false,
  },
];

const memoryFacts = [
  {
    id: 'fact-project',
    scope: 'project',
    content: 'Machines coverage should remain backend-independent.',
    confidence: 0.91,
    strength: 0.88,
    entity_type: 'pattern',
    source: { type: 'agent', agentId: 'agent-build-sentinel', sessionId: 'sess-machine-dev-1' },
    valid_from: NOW,
    valid_until: null,
    created_at: NOW,
    accessed_at: NOW,
    tags: ['machines', 'e2e'],
  },
  {
    id: 'fact-agent',
    scope: 'agent',
    content: 'Worker-node matching uses hostname or Tailscale IP.',
    confidence: 0.86,
    strength: 0.74,
    entity_type: 'constraint',
    source: { type: 'agent', agentId: 'agent-build-sentinel', sessionId: 'sess-machine-dev-1' },
    valid_from: NOW,
    valid_until: null,
    created_at: NOW,
    accessed_at: NOW,
    tags: ['worker-nodes'],
  },
];

const syncPeers: SyncPeerFixture[] = [];

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
    if (method === 'GET' && pathname === '/api/sessions') {
      const machineId = url.searchParams.get('machineId');
      const filtered = machineId
        ? state.sessions.filter((session) => session.machineId === machineId)
        : state.sessions;
      await fulfillJson(route, {
        sessions: filtered,
        total: filtered.length,
        limit: Number(url.searchParams.get('limit') ?? 50),
        offset: Number(url.searchParams.get('offset') ?? 0),
        hasMore: false,
      });
      return;
    }
    if (method === 'GET' && pathname === '/api/memory/facts') {
      expect(url.searchParams.get('machineId')).toBeTruthy();
      expect(url.searchParams.get('limit')).toBe('200');
      await fulfillJson(route, {
        ok: true,
        facts: state.memoryFacts,
        total: state.memoryFacts.length,
      });
      return;
    }
    if (method === 'GET' && pathname === '/api/fleet/nodes') {
      await fulfillJson(route, state.workerNodes);
      return;
    }
    if (method === 'GET' && pathname === '/api/sync/peers') {
      await fulfillJson(route, { peers: state.syncPeers });
      return;
    }
    if (method === 'POST' && /^\/api\/sync\/peers\/[^/]+\/register-reverse$/.test(pathname)) {
      await fulfillJson(route, { ok: true, status: 'ok', peer: null });
      return;
    }
    if (method === 'GET' && pathname === '/api/runtime-config/drift') {
      const machineId = url.searchParams.get('machineId');
      const items = machineId
        ? state.runtimeDrift.filter((entry) => entry.machineId === machineId)
        : state.runtimeDrift;
      await fulfillJson(route, {
        activeVersion: 12,
        activeHash: 'hash-active',
        items,
      });
      return;
    }

    throw new Error(`Unhandled API request in machines e2e mock: ${method} ${pathname}`);
  });
}

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    machines,
    agents,
    sessions,
    workerNodes,
    runtimeDrift,
    memoryFacts,
    syncPeers,
    ...overrides,
  };
}

test.describe('Machines operator surfaces', () => {
  test('renders the fleet list, stale badge, compact mode, search, and status filtering', async ({
    page,
  }) => {
    await mountApiMocks(page, makeState());

    await page.goto('/machines');

    await expect(page.getByRole('heading', { name: 'Fleet Machines' })).toBeVisible();
    await expect(page.getByText('4/4 machines')).toBeVisible();
    await expect(page.getByTestId('machines-inline-stat-total')).toContainText('4');
    await expect(page.getByTestId('machines-inline-stat-offline')).toContainText(
      'Needs attention',
    );
    await expect(page.getByTestId('machines-inline-stat-degraded')).toContainText(
      'Partial issues',
    );

    await expect(page.getByRole('link', { name: 'dev-1', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'stale-mac', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'linux-offline', exact: true })).toBeVisible();
    await expect(page.locator('[title="Last heartbeat was more than 60 seconds ago"]')).toHaveCount(
      1,
    );

    await page.getByRole('button', { name: 'Switch to compact view' }).click();
    await expect(page.getByRole('button', { name: 'Switch to detailed view' })).toBeVisible();

    await page.getByLabel('Search machines (press / to focus)').fill('stale');
    await expect(page.getByRole('link', { name: 'stale-mac', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'dev-1', exact: true })).toHaveCount(0);
    await expect(page.getByText('1/4 machines')).toBeVisible();

    await page.getByLabel('Search machines (press / to focus)').fill('');
    await page.getByLabel('Filter by status').selectOption('offline');
    await expect(page.getByRole('link', { name: 'linux-offline', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'dev-1', exact: true })).toHaveCount(0);
    await expect(page.getByText('1/4 machines')).toBeVisible();

    await page.getByLabel('Filter by status').selectOption('degraded');
    await expect(page.getByRole('link', { name: 'gpu-degraded', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'linux-offline', exact: true })).toHaveCount(0);
  });

  test('shows the §33.8 One-way warning badge for peers with failed reverse registration', async ({
    page,
  }) => {
    await mountApiMocks(
      page,
      makeState({
        syncPeers: [
          {
            machineId: 'machine-dev-1',
            hostname: 'dev-1',
            tailscaleIp: '100.64.0.10',
            syncUrl: 'http://dev-1:8080',
            role: 'full',
            syncStatus: 'reachable',
            syncIntervalMs: 30_000,
            isSelf: false,
            publicKey: null,
            lastSeen: NOW,
            createdAt: REGISTERED_AT,
            reverseRegistrationStatus: 'failed',
            reverseRegistrationError: 'handshake timeout',
            reverseRegistrationAt: NOW,
          },
        ],
      }),
    );

    await page.goto('/machines');

    await expect(page.getByTestId('machine-reverse-badge-machine-dev-1')).toBeVisible();
    await expect(page.getByTestId('machine-reverse-retry-machine-dev-1')).toBeVisible();
  });

  test('renders machine detail cards, runtimes, worker-node matching, agents, and sessions', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mountApiMocks(page, makeState());

    await page.goto('/machines/machine-dev-1');

    await expect(page.getByRole('heading', { name: 'dev-1' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Terminal' })).toHaveAttribute(
      'href',
      '/machines/machine-dev-1/terminal',
    );
    await expect(page.getByText('Machine Details')).toBeVisible();
    await expect(page.getByText('100.64.0.10')).toBeVisible();
    await expect(page.getByText('darwin / arm64')).toBeVisible();

    await expect(page.getByText('Capabilities')).toBeVisible();
    await expect(page.getByText('Max Concurrent Agents')).toBeVisible();
    await expect(page.getByText('GPU', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Docker', { exact: true }).first()).toBeVisible();

    await expect(page.getByText('Available Runtimes')).toBeVisible();
    await expect(page.getByText('Claude Code')).toBeVisible();
    await expect(page.getByText('Codex')).toBeVisible();
    await expect(page.getByText('Authenticated', { exact: true })).toBeVisible();
    await expect(page.getByText('Not authenticated', { exact: true })).toBeVisible();

    const workerTable = page.getByRole('table', { name: 'Worker nodes for this machine' });
    await expect(workerTable).toContainText('dev-1');
    await expect(workerTable).toContainText('renamed-worker');
    await expect(workerTable).not.toContainText('linux-offline');
    await expect(workerTable).toContainText('1 / 4');
    await expect(workerTable).toContainText('2 / 8');

    const agentsTable = page.getByRole('table', { name: 'Agents on this machine' });
    await expect(agentsTable.getByRole('link', { name: 'Build Sentinel' })).toHaveAttribute(
      'href',
      '/agents/agent-build-sentinel',
    );
    const sessionsTable = page.getByRole('table', { name: 'Recent sessions on this machine' });
    await expect(sessionsTable).toContainText('sess-machine');
    await expect(sessionsTable).toContainText('/srv/agentctl');
    await expect(sessionsTable).not.toContainText('sess-linux-offline');

    await expect(page.getByText('Memory Stats')).toBeVisible();
    await expect(page.getByText('Total Facts')).toBeVisible();
    await expect(page.getByText('Project Scope')).toBeVisible();
    await expect(page.getByText('Agent Scope')).toBeVisible();
  });

  test('shows stale heartbeat detail warning without opening terminal flows', async ({ page }) => {
    await mountApiMocks(page, makeState());

    await page.goto('/machines/machine-stale-mac');

    await expect(page.getByRole('heading', { name: 'stale-mac' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Machine appears offline' })).toBeVisible();
    await expect(page.getByText('Unresponsive')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Terminal' })).toHaveAttribute(
      'href',
      '/machines/machine-stale-mac/terminal',
    );
  });
});
