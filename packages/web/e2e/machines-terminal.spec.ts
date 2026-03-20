import { expect, type Page, test } from '@playwright/test';

const MACHINE_ID = 'machine-1';
const TERMINAL_ID = 'term-123';
const INITIAL_COMMAND = 'claude login';

function machineTerminalPath(command = INITIAL_COMMAND): string {
  return `/machines/${MACHINE_ID}/terminal?command=${encodeURIComponent(command)}`;
}

async function mockMachineTerminalSpawn(
  page: Page,
  options?: {
    status?: number;
    body?: Record<string, unknown>;
  },
): Promise<void> {
  await page.route(`**/api/machines/${MACHINE_ID}/terminal`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    const status = options?.status ?? 200;
    const body =
      options?.body ??
      ({
        id: TERMINAL_ID,
        pid: 4242,
        command: '/bin/zsh',
        cols: 120,
        rows: 36,
        createdAt: '2026-03-21T00:00:00.000Z',
      } satisfies Record<string, unknown>);

    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.route(`**/api/machines/${MACHINE_ID}/terminal/${TERMINAL_ID}`, async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: 'null',
    });
  });
}

async function mockMachineTerminalWebSocket(page: Page): Promise<void> {
  await page.routeWebSocket(
    `ws://localhost:8080/api/machines/${MACHINE_ID}/terminal/${TERMINAL_ID}/ws`,
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
          return;
        }
      });
    },
  );
}

test.describe('machine terminal page', () => {
  test('renders the queued command and connects to the mocked terminal', async ({ page }) => {
    await mockMachineTerminalSpawn(page);
    await mockMachineTerminalWebSocket(page);

    await page.goto(machineTerminalPath());

    await expect(page.getByText('Queued command')).toBeVisible();
    await expect(page.getByText(INITIAL_COMMAND)).toBeVisible();
    await expect(page.getByText('Connected')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy terminal output' })).toBeVisible();
  });

  test('shows the existing terminal error state when spawn fails', async ({ page }) => {
    await mockMachineTerminalSpawn(page, {
      status: 500,
      body: {
        error: 'TERMINAL_SPAWN_FAILED',
        message: 'Failed to spawn machine terminal',
      },
    });

    await page.goto(machineTerminalPath());

    await expect(page.getByText('Failed to spawn machine terminal')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Go Back' })).toBeVisible();
  });
});
