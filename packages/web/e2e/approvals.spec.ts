import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * E2E coverage for the `/approvals` page (the dedicated Permission Approvals surface).
 *
 * This is the full-page view that complements the sidebar notification bell: it lists
 * every pending permission request across all agents, plus a session-grouped history of
 * resolved ones. The page polls `/api/permission-requests` every 5s and resolves via
 * `PATCH /api/permission-requests/:id`.
 *
 * The older version of this spec targeted a thread-ID lookup UI that was replaced
 * when the approvals page was rewritten around the permission-request model. This spec
 * matches the current implementation.
 */

type PermissionRequestStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';

type PermissionRequest = {
  id: string;
  agentId: string;
  agentName?: string;
  sessionId: string;
  machineId: string;
  requestId: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  description?: string;
  status: PermissionRequestStatus;
  requestedAt: string;
  timeoutAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  decision?: 'approved' | 'denied';
};

type ResolvedRecord = {
  id: string;
  decision: 'approved' | 'denied';
  allowForSession: boolean | undefined;
};

function isoMinutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: 'pr-default',
    agentId: 'agent-build',
    agentName: 'Build Agent',
    sessionId: 'session-aaaaaaaa-1111',
    machineId: 'machine-1',
    requestId: 'req-default',
    toolName: 'Bash',
    toolInput: { command: 'pnpm install' },
    description: 'Install dependencies',
    status: 'pending',
    requestedAt: new Date().toISOString(),
    timeoutAt: isoMinutesFromNow(5),
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

type MockState = {
  requests: PermissionRequest[];
  resolved: ResolvedRecord[];
};

async function mountApiMocks(page: Page, state: MockState): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const { pathname } = url;

    if (method === 'GET' && pathname === '/api/permission-requests') {
      const requestedStatus = url.searchParams.get('status');
      const filtered =
        requestedStatus === null
          ? state.requests
          : state.requests.filter((r) => r.status === requestedStatus);
      await fulfillJson(route, filtered);
      return;
    }

    const resolveMatch = pathname.match(/^\/api\/permission-requests\/([^/]+)$/);
    if (method === 'PATCH' && resolveMatch) {
      const id = decodeURIComponent(resolveMatch[1] ?? '');
      const body = request.postData()
        ? (JSON.parse(request.postData() ?? '{}') as Record<string, unknown>)
        : {};
      const decision = body.decision === 'denied' ? 'denied' : 'approved';
      const allowForSession =
        typeof body.allowForSession === 'boolean' ? body.allowForSession : undefined;

      state.resolved.push({ id, decision, allowForSession });
      const idx = state.requests.findIndex((r) => r.id === id);
      const target = state.requests[idx];
      if (idx >= 0 && target) {
        const updated: PermissionRequest = {
          ...target,
          status: decision,
          decision,
          resolvedAt: new Date().toISOString(),
          resolvedBy: 'playwright',
        };
        state.requests = state.requests.map((r, i) => (i === idx ? updated : r));
        await fulfillJson(route, updated);
        return;
      }
      await fulfillJson(route, { error: 'NOT_FOUND', message: id }, 404);
      return;
    }

    // Safe defaults for anything the shell/page may call on boot.
    if (method === 'GET' && pathname === '/api/sync/conflicts/count') {
      await fulfillJson(route, { count: 0 });
      return;
    }
    if (method === 'GET' && pathname === '/api/agents') {
      await fulfillJson(route, []);
      return;
    }
    if (method === 'GET' && pathname === '/api/sessions') {
      await fulfillJson(route, { sessions: [], total: 0, limit: 50, offset: 0, hasMore: false });
      return;
    }
    if (method === 'GET' && pathname === '/api/runtime-sessions') {
      await fulfillJson(route, { sessions: [], count: 0 });
      return;
    }
    if (method === 'GET' && pathname === '/api/settings/accounts') {
      await fulfillJson(route, []);
      return;
    }
    if (method === 'GET' && pathname === '/api/health') {
      await fulfillJson(route, { ok: true, status: 'healthy' });
      return;
    }

    await fulfillJson(route, {});
  });
}

test.describe('Approvals page', () => {
  test('renders the empty state when no permission requests exist', async ({ page }) => {
    const state: MockState = { requests: [], resolved: [] };
    await mountApiMocks(page, state);

    await page.goto('/approvals');

    await expect(page.getByRole('heading', { name: 'Permission Approvals' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('0 total, all resolved')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^History \(/ })).toBeVisible();
    await expect(page.getByText('No resolved permission requests.')).toBeVisible();
    // No pending section rendered when there are no pending requests.
    await expect(page.getByRole('heading', { name: 'Pending' })).toHaveCount(0);
  });

  test('lists pending requests and resolves one via Allow once', async ({ page }) => {
    const state: MockState = {
      requests: [
        makeRequest({
          id: 'pr-pending-1',
          toolName: 'Bash',
          toolInput: { command: 'pnpm install' },
        }),
        makeRequest({
          id: 'pr-pending-2',
          agentId: 'agent-deploy',
          agentName: 'Deploy Agent',
          sessionId: 'session-bbbbbbbb-2222',
          toolName: 'Read',
          toolInput: { file_path: '/etc/hosts' },
        }),
      ],
      resolved: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/approvals');

    await expect(page.getByRole('heading', { name: 'Permission Approvals' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('2 pending · 0 resolved')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pending' })).toBeVisible();

    // Both pending cards render their Bash command / file path.
    await expect(page.getByText('pnpm install').first()).toBeVisible();
    await expect(page.getByText('/etc/hosts').first()).toBeVisible();

    // Resolve the first pending request with Allow once.
    const patchRequest = page.waitForRequest(
      (req) =>
        req.method() === 'PATCH' &&
        new URL(req.url()).pathname === '/api/permission-requests/pr-pending-1',
    );
    await page.getByRole('button', { name: 'Allow once' }).first().click();

    const sent = await patchRequest;
    expect(sent.postDataJSON()).toMatchObject({ decision: 'approved' });
    expect(sent.postDataJSON().allowForSession).not.toBe(true);

    // After the next poll the counts update.
    await expect(page.getByText('1 pending · 1 resolved')).toBeVisible({ timeout: 10_000 });
    expect(state.resolved).toEqual([
      { id: 'pr-pending-1', decision: 'approved', allowForSession: undefined },
    ]);
  });

  test('Allow for session and Deny send the correct decision payloads', async ({ page }) => {
    const state: MockState = {
      requests: [
        makeRequest({
          id: 'pr-session',
          toolName: 'Read',
          toolInput: { file_path: '/var/log/app.log' },
        }),
        makeRequest({
          id: 'pr-deny',
          toolName: 'Bash',
          toolInput: { command: 'rm -rf node_modules' },
        }),
      ],
      resolved: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/approvals');

    await expect(page.getByText('2 pending · 0 resolved')).toBeVisible({ timeout: 15_000 });

    // Allow for session on the first card.
    const sessionPatch = page.waitForRequest(
      (req) =>
        req.method() === 'PATCH' &&
        new URL(req.url()).pathname === '/api/permission-requests/pr-session',
    );
    await page.getByRole('button', { name: 'Allow for session' }).first().click();
    const sessionSent = await sessionPatch;
    expect(sessionSent.postDataJSON()).toMatchObject({
      decision: 'approved',
      allowForSession: true,
    });

    // Deny the second card.
    const denyPatch = page.waitForRequest(
      (req) =>
        req.method() === 'PATCH' &&
        new URL(req.url()).pathname === '/api/permission-requests/pr-deny',
    );
    await page.getByRole('button', { name: 'Deny' }).first().click();
    const denySent = await denyPatch;
    expect(denySent.postDataJSON()).toMatchObject({ decision: 'denied' });

    expect(state.resolved).toEqual([
      { id: 'pr-session', decision: 'approved', allowForSession: true },
      { id: 'pr-deny', decision: 'denied', allowForSession: undefined },
    ]);

    // After both resolutions the header reflects "0 total, all resolved" on the next poll.
    await expect(page.getByText('0 total, all resolved').or(page.getByText('2 total, all resolved'))).toBeVisible({
      timeout: 10_000,
    });
  });

  test('groups resolved requests by session and expands them on click', async ({ page }) => {
    const state: MockState = {
      requests: [
        makeRequest({
          id: 'pr-resolved-1',
          sessionId: 'session-aaaaaaaa-1111',
          status: 'approved',
          decision: 'approved',
          resolvedAt: new Date(Date.now() - 60_000).toISOString(),
          resolvedBy: 'ops',
          toolName: 'Bash',
          toolInput: { command: 'git status' },
        }),
        makeRequest({
          id: 'pr-resolved-2',
          sessionId: 'session-aaaaaaaa-1111',
          status: 'denied',
          decision: 'denied',
          resolvedAt: new Date(Date.now() - 30_000).toISOString(),
          resolvedBy: 'ops',
          toolName: 'Bash',
          toolInput: { command: 'rm -rf .git' },
        }),
        makeRequest({
          id: 'pr-resolved-3',
          sessionId: 'session-bbbbbbbb-2222',
          agentId: 'agent-deploy',
          status: 'approved',
          decision: 'approved',
          resolvedAt: new Date(Date.now() - 15_000).toISOString(),
          resolvedBy: 'auto:rule-ci',
          toolName: 'Read',
          toolInput: { file_path: '/etc/hostname' },
        }),
      ],
      resolved: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/approvals');

    await expect(page.getByRole('heading', { name: 'Permission Approvals' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('3 total, all resolved')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^History \(3\)/ })).toBeVisible();

    const sessionAExpander = page.getByRole('button', {
      name: /Expand resolved requests for session session-aaaa/,
    });
    const sessionBExpander = page.getByRole('button', {
      name: /Expand resolved requests for session session-bbbb/,
    });
    await expect(sessionAExpander).toBeVisible();
    await expect(sessionBExpander).toBeVisible();

    // Expand session A and verify both contained requests appear.
    await sessionAExpander.click();
    await expect(
      page.getByRole('button', {
        name: /Collapse resolved requests for session session-aaaa/,
      }),
    ).toBeVisible();
    await expect(page.getByText('git status')).toBeVisible();
    await expect(page.getByText('rm -rf .git')).toBeVisible();
  });
});
