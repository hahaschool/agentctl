import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * Backend-independent coverage for /machines/[id]/terminal.
 *
 * The terminal page owns the spawn/delete API calls and opens a terminal
 * WebSocket. The app shell also opens its global WebSocket and shell queries,
 * so this spec mocks every `/api/**` request instead of reaching a live
 * control-plane or worker.
 */

const MACHINE_ID = 'machine-1';
const TERMINAL_ID = 'term-123';
const INITIAL_COMMAND = 'claude login';
const TERMINAL_SPAWN_COLS = 120;
const TERMINAL_SPAWN_ROWS = 30;
const NOW = '2026-04-24T10:15:00.000Z';

function machineTerminalPath(command = INITIAL_COMMAND): string {
  return `/machines/${MACHINE_ID}/terminal?command=${encodeURIComponent(command)}`;
}

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

async function mockMachineTerminalApis(
  page: Page,
  options?: {
    spawnRequests?: unknown[];
    spawnStatus?: number;
    spawnBody?: Record<string, unknown>;
  },
): Promise<void> {
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

    if (method === 'POST' && pathname === `/api/machines/${MACHINE_ID}/terminal`) {
      options?.spawnRequests?.push(request.postDataJSON());
      const status = options?.spawnStatus ?? 200;
      const body =
        options?.spawnBody ??
        ({
          id: TERMINAL_ID,
          pid: 4242,
          command: '/bin/zsh',
          cols: TERMINAL_SPAWN_COLS,
          rows: TERMINAL_SPAWN_ROWS,
          createdAt: NOW,
        } satisfies Record<string, unknown>);

      await fulfillJson(route, body, status);
      return;
    }

    if (method === 'DELETE' && pathname === `/api/machines/${MACHINE_ID}/terminal/${TERMINAL_ID}`) {
      await fulfillJson(route, null);
      return;
    }

    throw new Error(`Unhandled API request in machines-terminal e2e mock: ${method} ${pathname}`);
  });
}

async function mockMachineTerminalWebSocket(
  page: Page,
  terminalMessages: Record<string, unknown>[] = [],
): Promise<void> {
  await page.routeWebSocket(
    `ws://localhost:8080/api/machines/${MACHINE_ID}/terminal/${TERMINAL_ID}/ws`,
    (ws) => {
      ws.onMessage((message) => {
        const payload =
          typeof message === 'string'
            ? (JSON.parse(message) as Record<string, unknown>)
            : (JSON.parse(message.toString('utf8')) as Record<string, unknown>);
        terminalMessages.push(payload);

        if (payload.type === 'resize') {
          ws.send(JSON.stringify({ type: 'output', data: '$ ready\r\n' }));
          return;
        }

        if (payload.type === 'input') {
          ws.send(JSON.stringify({ type: 'output', data: `> ${String(payload.data ?? '')}` }));
          return;
        }
      });
    },
  );
}

test.describe('machine terminal page', () => {
  test('renders the queued command and connects to the mocked terminal', async ({ page }) => {
    const spawnRequests: unknown[] = [];
    const terminalMessages: Record<string, unknown>[] = [];
    await mockMachineTerminalApis(page, { spawnRequests });
    await mockMachineTerminalWebSocket(page, terminalMessages);

    await page.goto(machineTerminalPath());

    await expect(page.getByText('Queued command')).toBeVisible();
    await expect(page.getByText(INITIAL_COMMAND)).toBeVisible();
    await expect(page.getByText('Connected')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy terminal output' })).toBeVisible();

    expect(spawnRequests).toHaveLength(1);
    expect(spawnRequests[0]).toMatchObject({
      cols: TERMINAL_SPAWN_COLS,
      rows: TERMINAL_SPAWN_ROWS,
    });
    await expect
      .poll(() =>
        terminalMessages.some(
          (message) => message.type === 'input' && message.data === `${INITIAL_COMMAND}\r`,
        ),
      )
      .toBe(true);
  });

  test('shows the existing terminal error state when spawn fails', async ({ page }) => {
    await mockMachineTerminalApis(page, {
      spawnStatus: 500,
      spawnBody:
        ({
          error: 'TERMINAL_SPAWN_FAILED',
          message: 'Failed to spawn machine terminal',
        } satisfies Record<string, unknown>),
    });

    await page.goto(machineTerminalPath());

    await expect(page.getByText('Failed to spawn machine terminal')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Go Back' })).toBeVisible();
  });
});
