import { expect, type Locator, type Page, test } from '@playwright/test';

const SESSION_ID = 'session-config-test';
const CLAUDE_SESSION_ID = 'claude-session-config-test';
const SESSION_MESSAGE = 'Session tab content for the config test.';
const NO_DISPATCH_RECORD_MESSAGE =
  'No dispatch record — this session has no associated agent run.';
const PRE_FEATURE_MESSAGE = 'Config not captured for this run (pre-feature data).';

type DispatchConfigResponse = {
  runId: string | null;
  runCount: number;
  config: {
    model: string | null;
    permissionMode: string | null;
    allowedTools: string[] | null;
    mcpServers: Record<
      string,
      { command: string; args?: string[]; envKeys?: string[] | null }
    > | null;
    systemPrompt: string | null;
    defaultPrompt: string | null;
    instructionsStrategy: string | null;
    mcpServerCount: number;
    accountProvider: string | null;
  } | null;
};

type SessionDetailMockState = {
  dispatchConfigRequests: number;
};

const NO_DISPATCH_CONFIG: DispatchConfigResponse = {
  runId: null,
  runCount: 0,
  config: null,
};

const PRE_FEATURE_DISPATCH_CONFIG: DispatchConfigResponse = {
  runId: 'run-pre-feature',
  runCount: 1,
  config: null,
};

const LATEST_DISPATCH_CONFIG: DispatchConfigResponse = {
  runId: 'run-3',
  runCount: 3,
  config: {
    model: 'claude-opus-4-20250514',
    permissionMode: 'acceptEdits',
    allowedTools: ['Read', 'Edit', 'Bash'],
    mcpServers: {
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        envKeys: ['GITHUB_TOKEN'],
      },
      slack: {
        command: 'uvx',
        args: ['slack-mcp-server'],
        envKeys: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
      },
    },
    systemPrompt: 'Operate strictly within the assigned worktree.',
    defaultPrompt: 'Investigate the latest dispatch snapshot.',
    instructionsStrategy: 'file',
    mcpServerCount: 2,
    accountProvider: 'claude_max',
  },
};

function createSession() {
  return {
    id: SESSION_ID,
    agentId: 'agent-1',
    agentName: 'Config Agent',
    machineId: 'machine-1',
    sessionUrl: null,
    claudeSessionId: CLAUDE_SESSION_ID,
    status: 'ended',
    projectPath: '/tmp/config-project',
    pid: null,
    startedAt: '2026-04-01T08:00:00.000Z',
    lastHeartbeat: '2026-04-01T08:05:00.000Z',
    endedAt: '2026-04-01T08:06:00.000Z',
    metadata: {},
    accountId: null,
    model: 'claude-sonnet-4',
  };
}

async function interceptSessionDetailApi(
  page: Page,
  dispatchConfig: DispatchConfigResponse,
): Promise<SessionDetailMockState> {
  const state: SessionDetailMockState = {
    dispatchConfigRequests: 0,
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === `/api/sessions/${SESSION_ID}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createSession()),
      });
      return;
    }

    if (
      request.method() === 'GET' &&
      url.pathname === `/api/sessions/${SESSION_ID}/dispatch-config`
    ) {
      state.dispatchConfigRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dispatchConfig),
      });
      return;
    }

    if (
      request.method() === 'GET' &&
      url.pathname === `/api/sessions/content/${encodeURIComponent(CLAUDE_SESSION_ID)}`
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: CLAUDE_SESSION_ID,
          totalMessages: 1,
          messages: [
            {
              type: 'assistant',
              content: SESSION_MESSAGE,
              timestamp: '2026-04-01T08:01:00.000Z',
            },
          ],
        }),
      });
      return;
    }

    if (request.method() === 'GET' && url.pathname === '/api/settings/accounts') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'NOT_FOUND', message: 'Not found' }),
    });
  });

  return state;
}

async function openConfigTab(page: Page, dispatchConfig: DispatchConfigResponse): Promise<void> {
  const state = await interceptSessionDetailApi(page, dispatchConfig);
  await page.goto(`/sessions/${SESSION_ID}`);

  await expect(page.getByText(SESSION_MESSAGE)).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => state.dispatchConfigRequests, {
      message: 'session detail requests the latest dispatch config',
    })
    .toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Config', exact: true }).click();
}

function configSection(page: Page, title: string): Locator {
  return page.getByText(title, { exact: true }).locator('xpath=../..');
}

async function expectConfigRow(
  section: Locator,
  label: string,
  value: string,
): Promise<void> {
  const row = section.getByText(label, { exact: true }).locator('xpath=..');
  await expect(row).toContainText(value);
}

test.describe('Session detail config tab', () => {
  test('shows the exact no-run empty state', async ({ page }) => {
    await openConfigTab(page, NO_DISPATCH_CONFIG);

    await expect(page.getByText(NO_DISPATCH_RECORD_MESSAGE)).toHaveText(NO_DISPATCH_RECORD_MESSAGE);
    await expect(page.getByText(SESSION_MESSAGE)).toHaveCount(0);
  });

  test('shows the exact pre-feature empty state when config was not captured', async ({ page }) => {
    await openConfigTab(page, PRE_FEATURE_DISPATCH_CONFIG);

    await expect(page.getByText(PRE_FEATURE_MESSAGE)).toHaveText(PRE_FEATURE_MESSAGE);
    await expect(page.getByText(SESSION_MESSAGE)).toHaveCount(0);
  });

  test('shows the latest dispatch snapshot details for multi-run sessions', async ({ page }) => {
    await openConfigTab(page, LATEST_DISPATCH_CONFIG);

    await expect(page.getByText('Showing config from latest dispatch (1 of 3 runs).')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(SESSION_MESSAGE)).toHaveCount(0);

    const generalSection = configSection(page, 'General');
    await expect(generalSection).toBeVisible();
    await expectConfigRow(generalSection, 'Model', 'claude-opus-4-20250514');
    await expectConfigRow(generalSection, 'Permission', 'acceptEdits');
    await expectConfigRow(generalSection, 'Provider', 'claude_max');
    await expectConfigRow(generalSection, 'Strategy', 'file');

    const toolRestrictionsSection = configSection(page, 'Tool Restrictions');
    await expect(toolRestrictionsSection).toBeVisible();
    await expectConfigRow(toolRestrictionsSection, 'Allowed', 'Read, Edit, Bash');

    const promptsSection = configSection(page, 'Prompts');
    await expect(promptsSection).toBeVisible();
    await expectConfigRow(
      promptsSection,
      'Default',
      'Investigate the latest dispatch snapshot.',
    );
    await expectConfigRow(
      promptsSection,
      'System',
      'Operate strictly within the assigned worktree.',
    );

    const mcpServersSection = configSection(page, 'MCP Servers (2)');
    await expect(mcpServersSection).toBeVisible();
    await expect(mcpServersSection).toContainText('github');
    await expect(mcpServersSection).toContainText('npx -y @modelcontextprotocol/server-github');
    await expect(mcpServersSection).toContainText('env: GITHUB_TOKEN');
    await expect(mcpServersSection).toContainText('slack');
    await expect(mcpServersSection).toContainText('uvx slack-mcp-server');
    await expect(mcpServersSection).toContainText('env: SLACK_BOT_TOKEN, SLACK_TEAM_ID');
  });
});
