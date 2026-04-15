import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * Backend-independent coverage for the Scheduler page (`/scheduler`).
 *
 * The spec mocks every `/api/**` request, so it only needs the Next.js dev
 * server on $WEB_PORT and never depends on live beta/dev control-plane services.
 */

type RepeatableJobInfo = {
  key: string;
  name: string;
  pattern: string | null;
  every: string | null;
  next: number | null;
};

type CreateHeartbeatJobBody = {
  agentId: string;
  machineId: string;
  intervalMs: number;
};

type MockState = {
  jobs: RepeatableJobInfo[];
  createHeartbeatBodies: CreateHeartbeatJobBody[];
  deleteAgentIds: string[];
  schedulerConfigured: boolean;
};

const NEXT_RUN = Date.parse('2026-04-15T10:00:00.000Z');

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    jobs: [
      {
        key: 'heartbeat:agent-heartbeat',
        name: 'agentctl-heartbeat',
        pattern: null,
        every: '60000',
        next: NEXT_RUN,
      },
      {
        key: 'cron:agent-nightly',
        name: 'agentctl-cron',
        pattern: '*/15 * * * *',
        every: null,
        next: NEXT_RUN + 60_000,
      },
    ],
    createHeartbeatBodies: [],
    deleteAgentIds: [],
    schedulerConfigured: true,
    ...overrides,
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
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

    if (method === 'GET' && pathname === '/api/scheduler/jobs') {
      if (!state.schedulerConfigured) {
        await fulfillJson(
          route,
          {
            error: 'SCHEDULER_NOT_CONFIGURED',
            message: 'Repeatable job scheduler is not configured',
          },
          501,
        );
        return;
      }

      await fulfillJson(route, { jobs: state.jobs });
      return;
    }

    if (method === 'POST' && pathname === '/api/scheduler/jobs/heartbeat') {
      const body = JSON.parse(request.postData() ?? '{}') as CreateHeartbeatJobBody;
      state.createHeartbeatBodies.push(body);
      state.jobs = [
        ...state.jobs,
        {
          key: `heartbeat:${body.agentId}`,
          name: 'agentctl-heartbeat',
          pattern: null,
          every: String(body.intervalMs),
          next: NEXT_RUN + body.intervalMs,
        },
      ];

      await fulfillJson(route, { ok: true });
      return;
    }

    if (method === 'DELETE' && pathname.startsWith('/api/scheduler/jobs/')) {
      const agentId = decodeURIComponent(pathname.replace('/api/scheduler/jobs/', ''));
      state.deleteAgentIds.push(agentId);
      state.jobs = state.jobs.filter((job) => !job.key.endsWith(`:${agentId}`));
      await fulfillJson(route, { ok: true, key: agentId, removedCount: 1 });
      return;
    }

    throw new Error(`Unhandled API request in scheduler e2e mock: ${method} ${pathname}`);
  });
}

test.describe('Scheduler route', () => {
  test('renders jobs, creates heartbeat jobs, and removes jobs by derived agent id', async ({
    page,
  }) => {
    const state = makeState();
    await mountApiMocks(page, state);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/scheduler');

    await expect(page.getByRole('heading', { name: 'Scheduler' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: 'Scheduler' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('table', { name: 'Scheduled jobs' })).toBeVisible();
    await expect(page.getByText('heartbeat:agent-heartbeat')).toBeVisible();
    await expect(page.getByText('cron:agent-nightly')).toBeVisible();
    await expect(page.getByText('every 60s')).toBeVisible();
    await expect(page.getByText('*/15 * * * *')).toBeVisible();

    await page.getByTestId('new-scheduler-job').click();
    await page.getByLabel('Agent ID').fill(' agent-created ');
    await page.getByLabel('Machine ID').fill(' machine-dev-1 ');
    await page.getByLabel('Interval (seconds)').fill('45');
    await page.getByTestId('scheduler-submit').click();

    await expect
      .poll(() => state.createHeartbeatBodies.at(-1), {
        message: 'heartbeat create request should trim ids and convert seconds to ms',
      })
      .toEqual({
        agentId: 'agent-created',
        machineId: 'machine-dev-1',
        intervalMs: 45_000,
      });
    await expect(page.getByText('heartbeat:agent-created')).toBeVisible();
    await expect(page.getByText('every 45s')).toBeVisible();

    await page.getByTestId('delete-heartbeat:agent-created').click();
    await expect(page.getByTestId('scheduler-delete-confirm')).toBeVisible();
    await page.getByTestId('confirm-delete-scheduler-job').click();

    await expect
      .poll(() => state.deleteAgentIds.at(-1), {
        message: 'delete request should use agent id derived from the repeatable key',
      })
      .toBe('agent-created');
    await expect(page.getByTestId('scheduler-delete-confirm')).toBeHidden();
    await expect(page.getByRole('cell', { name: 'heartbeat:agent-created' })).toBeHidden();
  });

  test('renders scheduler-not-configured as informational state without hard error', async ({
    page,
  }) => {
    await mountApiMocks(page, makeState({ jobs: [], schedulerConfigured: false }));

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/scheduler');

    await expect(page.getByRole('heading', { name: 'Scheduler' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('scheduler-not-configured')).toContainText(
      'Scheduler not configured.',
    );
    await expect(page.getByTestId('new-scheduler-job')).toBeDisabled();
    await expect(page.getByTestId('scheduler-jobs-empty')).toBeHidden();
    await expect(page.getByText('Failed to load scheduled jobs')).toBeHidden();
  });
});
