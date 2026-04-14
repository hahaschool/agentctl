import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * Backend-independent coverage for the agent settings route.
 *
 * The page coordinates agent metadata, model/prompt fields, runtime config
 * overrides, and the config preview sidebar. These specs mock every `/api/**`
 * request so they only need the Next.js dev server on $WEB_PORT.
 */

type Agent = {
  id: string;
  machineId: string;
  name: string;
  type: 'manual' | 'cron' | 'heartbeat' | 'loop';
  runtime: 'claude-code' | 'codex';
  status: 'idle' | 'running' | 'error' | 'timeout';
  schedule: string | null;
  projectPath: string | null;
  worktreeBranch: string | null;
  currentSessionId: string | null;
  config: {
    model?: string;
    initialPrompt?: string;
    defaultPrompt?: string;
    systemPrompt?: string;
    maxTurns?: number;
    permissionMode?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
    runtimeConfigOverrides?: {
      sandbox?: string;
      approvalPolicy?: string;
      codexReasoningEffort?: string;
      codexModelProvider?: string;
    };
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

type UpdateAgentBody = {
  name?: string;
  machineId?: string;
  type?: string;
  runtime?: string;
  schedule?: string | null;
  config?: Agent['config'];
};

type MockState = {
  agent: Agent;
  machines: Machine[];
  updateBodies: UpdateAgentBody[];
};

const AGENT_ID = 'agent-settings-e2e';
const NOW = '2026-04-14T13:00:00.000Z';

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
    status: 'online',
    lastHeartbeat: NOW,
    createdAt: '2026-04-01T00:00:00.000Z',
  },
];

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: AGENT_ID,
    machineId: 'machine-dev-1',
    name: 'Settings Auditor',
    type: 'manual',
    runtime: 'codex',
    status: 'idle',
    schedule: null,
    projectPath: '/Users/hahaschool/agentctl',
    worktreeBranch: 'agent/codex-495-agent-settings-e2e',
    currentSessionId: null,
    config: {
      model: 'gpt-5.4',
      initialPrompt: 'Inspect the agent settings route.',
      defaultPrompt: 'Keep agent settings stable.',
      systemPrompt: 'You are focused on settings regressions.',
      maxTurns: 6,
      permissionMode: 'on-request',
      allowedTools: ['Read', 'Grep'],
      disallowedTools: ['Write'],
      runtimeConfigOverrides: {
        sandbox: 'read-only',
        approvalPolicy: 'on-request',
        codexReasoningEffort: 'medium',
        codexModelProvider: 'openai',
      },
    },
    lastRunAt: NOW,
    lastCostUsd: 0.19,
    totalCostUsd: 0.81,
    accountId: null,
    createdAt: '2026-04-13T08:00:00.000Z',
    ...overrides,
  };
}

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
    if (method === 'GET' && pathname === `/api/agents/${AGENT_ID}`) {
      await fulfillJson(route, state.agent);
      return;
    }
    if (method === 'PATCH' && pathname === `/api/agents/${AGENT_ID}`) {
      const body = request.postDataJSON() as UpdateAgentBody;
      state.updateBodies.push(body);
      state.agent = {
        ...state.agent,
        ...body,
        config: body.config ?? state.agent.config,
      };
      await fulfillJson(route, state.agent);
      return;
    }
    if (method === 'GET' && pathname === `/api/agents/${AGENT_ID}/config-preview`) {
      await fulfillJson(route, {
        files: [
          {
            path: '.codex/config.toml',
            scope: 'workspace',
            content: `model = "${state.agent.config.model ?? 'gpt-5.4'}"\n`,
            status: 'managed',
            overriddenFields: ['model'],
          },
          {
            path: '.claude/settings.json',
            scope: 'workspace',
            content: JSON.stringify({ name: state.agent.name }, null, 2),
            status: 'merged',
            overriddenFields: ['name'],
          },
        ],
      });
      return;
    }

    throw new Error(`Unhandled API request in agent-settings e2e mock: ${method} ${pathname}`);
  });
}

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    agent: makeAgent(),
    machines,
    updateBodies: [],
    ...overrides,
  };
}

async function chooseSelectOption(page: Page, triggerId: string, optionName: string): Promise<void> {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole('option', { name: optionName }).click();
}

test.describe('Agent settings page', () => {
  test('renders the settings shell and saves general metadata', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const state = makeState();
    await mountApiMocks(page, state);

    await page.goto(`/agents/${AGENT_ID}/settings`);

    await expect(page.getByRole('heading', { name: /Settings Auditor.*Settings/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings Auditor' })).toHaveAttribute(
      'href',
      `/agents/${AGENT_ID}`,
    );
    await expect(page.getByLabel('Back to agent')).toHaveAttribute('href', `/agents/${AGENT_ID}`);
    await expect(page.getByText('Config Preview (2 files)')).toBeVisible();

    await page.getByLabel('Name *').fill('Settings Auditor Renamed');
    await expect(page.getByText('You have unsaved changes')).toBeVisible();
    await page.getByRole('tabpanel').getByRole('button', { name: 'Save' }).click();

    await expect
      .poll(() => state.updateBodies, { message: 'PATCH /api/agents/:id captured' })
      .toEqual([
        expect.objectContaining({
          name: 'Settings Auditor Renamed',
          machineId: 'machine-dev-1',
          type: 'manual',
          runtime: 'codex',
          schedule: null,
        }),
      ]);
    await expect(page.getByRole('alert').filter({ hasText: 'General settings saved' })).toBeVisible();
  });

  test('saves model and prompt configuration without a live control plane', async ({ page }) => {
    const state = makeState();
    await mountApiMocks(page, state);

    await page.goto(`/agents/${AGENT_ID}/settings`);
    await page.getByRole('tab', { name: 'Model & Prompts' }).click();

    await page.getByLabel('Max Turns').fill('12');
    await page.getByLabel('Initial Prompt').fill('Run the backend-independent settings audit.');
    await page.getByLabel('Default Prompt').fill('Use the settings audit baseline.');
    await page.getByLabel('System Prompt').fill('Prefer focused regression evidence.');
    await expect(page.getByText('You have unsaved changes')).toBeVisible();

    await page.getByRole('tabpanel').getByRole('button', { name: 'Save' }).click();

    await expect
      .poll(() => state.updateBodies, { message: 'model prompt PATCH captured' })
      .toEqual([
        expect.objectContaining({
          config: expect.objectContaining({
            model: 'gpt-5.4',
            maxTurns: 12,
            initialPrompt: 'Run the backend-independent settings audit.',
            defaultPrompt: 'Use the settings audit baseline.',
            systemPrompt: 'Prefer focused regression evidence.',
          }),
        }),
      ]);
    await expect(page.getByRole('alert').filter({ hasText: 'Model & prompts saved' })).toBeVisible();
  });

  test('saves Codex runtime configuration overrides', async ({ page }) => {
    const state = makeState();
    await mountApiMocks(page, state);

    await page.goto(`/agents/${AGENT_ID}/settings`);
    await page.getByRole('tab', { name: 'Runtime Config' }).click();

    await chooseSelectOption(page, 'sandbox-select', 'Workspace Write');
    await chooseSelectOption(page, 'approval-select', 'Never');
    await chooseSelectOption(page, 'reasoning-select', 'High');
    await chooseSelectOption(page, 'provider-select', 'Azure OpenAI');
    await expect(page.getByText('You have unsaved changes')).toBeVisible();

    await page.getByRole('tabpanel').getByRole('button', { name: 'Save' }).click();

    await expect
      .poll(() => state.updateBodies, { message: 'runtime config PATCH captured' })
      .toEqual([
        expect.objectContaining({
          config: expect.objectContaining({
            runtimeConfigOverrides: {
              sandbox: 'workspace-write',
              approvalPolicy: 'never',
              codexReasoningEffort: 'high',
              codexModelProvider: 'azure',
            },
          }),
        }),
      ]);
    await expect(page.getByRole('alert').filter({ hasText: 'Runtime config saved' })).toBeVisible();
  });
});
