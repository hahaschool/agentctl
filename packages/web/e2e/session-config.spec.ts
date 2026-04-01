import { expect, type Page, test } from '@playwright/test';

const SESSION_ID = 'session-config-test';
const CLAUDE_SESSION_ID = 'claude-session-config-test';
const SESSION_MESSAGE = 'Session tab content for the config test.';

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

const POPULATED_DISPATCH_CONFIG: DispatchConfigResponse = {
  runId: 'run-1',
  runCount: 1,
  config: {
    model: 'claude-sonnet-4',
    permissionMode: 'bypassPermissions',
    allowedTools: null,
    mcpServers: null,
    systemPrompt: null,
    defaultPrompt: 'start processing',
    instructionsStrategy: null,
    mcpServerCount: 0,
    accountProvider: 'claude_team',
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
  dispatchConfig: DispatchConfigResponse | undefined,
): Promise<void> {
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
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          dispatchConfig ?? {
            runId: null,
            runCount: 0,
            config: null,
          },
        ),
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
}

test.describe('Session detail config tab', () => {
  test('Config tab is visible on session detail page', async ({ page }) => {
    await interceptSessionDetailApi(page, undefined);
    await page.goto(`/sessions/${SESSION_ID}`);

    await expect(page.getByRole('button', { name: 'Config' })).toBeVisible({ timeout: 15_000 });
  });

  test('Config tab shows "No dispatch record" or config sections', async ({ page }) => {
    await interceptSessionDetailApi(page, POPULATED_DISPATCH_CONFIG);
    await page.goto(`/sessions/${SESSION_ID}`);

    await page.getByRole('button', { name: 'Config' }).click();

    const noDispatchRecord = page.getByText(/no dispatch record/i);
    const configSections = page.getByText('MCP Servers (0)');
    await expect(noDispatchRecord.or(configSections)).toBeVisible({ timeout: 15_000 });
  });

  test('clicking Config tab switches content', async ({ page }) => {
    await interceptSessionDetailApi(page, POPULATED_DISPATCH_CONFIG);
    await page.goto(`/sessions/${SESSION_ID}`);

    await expect(page.getByText(SESSION_MESSAGE)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Config' }).click();

    await expect(page.getByText('General')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(SESSION_MESSAGE)).toHaveCount(0);
  });
});
