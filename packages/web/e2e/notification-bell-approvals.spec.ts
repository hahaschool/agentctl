import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * E2E coverage for the global NotificationBell + pending permission-request approvals popover.
 *
 * Why this flow matters:
 * - The bell lives on every page (sidebar) and is the developer's primary control surface
 *   for resolving in-flight permission gates that block running agents.
 * - It is driven by `/api/permission-requests?status=pending` (polled every 5s) and resolved
 *   via PATCH `/api/permission-requests/:id`. Neither path was previously covered by e2e specs.
 * - The existing approvals.spec.ts only covers the per-thread `/conflicts`-style approvals
 *   surface, NOT the global bell popover with the Allow once / Allow for session / Deny actions.
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

function makePending(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: 'pr-bash-1',
    agentId: 'agent-build',
    agentName: 'Build Agent',
    sessionId: 'session-1',
    machineId: 'machine-1',
    requestId: 'req-bash-1',
    toolName: 'Bash',
    toolInput: {
      command: 'pnpm install',
      description: 'install dependencies',
    },
    description: 'Install project dependencies',
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
  pending: PermissionRequest[];
  resolved: ResolvedRecord[];
};

async function mountApiMocks(page: Page, state: MockState): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const { pathname } = url;

    // Pending permission requests — the bell polls this every 5s.
    if (method === 'GET' && pathname === '/api/permission-requests') {
      const requestedStatus = url.searchParams.get('status');
      const filtered =
        requestedStatus === null ? state.pending : state.pending.filter((p) => p.status === requestedStatus);
      await fulfillJson(route, filtered);
      return;
    }

    // Resolve a request (Allow once, Allow for session, Deny).
    const resolveMatch = pathname.match(/^\/api\/permission-requests\/([^/]+)$/);
    if (method === 'PATCH' && resolveMatch) {
      const id = decodeURIComponent(resolveMatch[1] ?? '');
      const body = request.postData() ? (JSON.parse(request.postData() ?? '{}') as Record<string, unknown>) : {};
      const decision = body.decision === 'denied' ? 'denied' : 'approved';
      const allowForSession =
        typeof body.allowForSession === 'boolean' ? body.allowForSession : undefined;

      state.resolved.push({ id, decision, allowForSession });
      const idx = state.pending.findIndex((p) => p.id === id);
      const target = state.pending[idx];
      if (idx >= 0 && target) {
        // Remove from pending so the next poll reflects the resolution.
        state.pending = state.pending.filter((_, i) => i !== idx);
        await fulfillJson(route, {
          ...target,
          status: decision,
          decision,
          resolvedAt: new Date().toISOString(),
          resolvedBy: 'playwright',
        });
        return;
      }
      await fulfillJson(route, { error: 'NOT_FOUND', message: id }, 404);
      return;
    }

    // Anything else the sidebar / page boot may call — return safe empty payloads.
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

    // Default: empty 200 — keeps the spec resilient to small changes in initial fetches.
    await fulfillJson(route, {});
  });
}

function bellTrigger(page: Page) {
  return page.getByRole('button', { name: /^Notifications(\s|$|\()/ });
}

function popover(page: Page) {
  return page.getByRole('dialog', { name: 'Notifications' });
}

test.describe('Notification bell — pending approvals', () => {
  test('renders the unread badge and resolves an Allow-once request from the popover', async ({
    page,
  }) => {
    const state: MockState = {
      pending: [makePending()],
      resolved: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/');

    const trigger = bellTrigger(page);
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    // Badge reflects pending count (1).
    await expect(trigger).toHaveAttribute('aria-label', /Notifications \(1 pending approval\)/);

    await trigger.click();
    const dialog = popover(page);
    await expect(dialog).toBeVisible();

    // Pending card shows agent name, tool, and formatted Bash input.
    await expect(dialog.getByText('Build Agent')).toBeVisible();
    await expect(dialog.getByText('Bash', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/\$ pnpm install/)).toBeVisible();

    const patchRequest = page.waitForRequest(
      (req) =>
        req.method() === 'PATCH' && new URL(req.url()).pathname === '/api/permission-requests/pr-bash-1',
    );

    await dialog.getByRole('button', { name: 'Allow once' }).click();

    const sent = await patchRequest;
    expect(sent.postDataJSON()).toMatchObject({ decision: 'approved' });
    // Allow-once must NOT request session-wide allowance.
    expect(sent.postDataJSON().allowForSession).not.toBe(true);

    expect(state.resolved).toEqual([
      { id: 'pr-bash-1', decision: 'approved', allowForSession: undefined },
    ]);

    // After the next poll the badge clears and the empty state renders.
    await expect(trigger).toHaveAttribute('aria-label', 'Notifications', { timeout: 10_000 });
    await expect(dialog.getByText('No pending approvals')).toBeVisible();
  });

  test('Deny sends decision=denied and Allow-for-session sets allowForSession=true', async ({
    page,
  }) => {
    const state: MockState = {
      pending: [
        makePending({ id: 'pr-deny-1', toolInput: { command: 'rm -rf /' } }),
        makePending({
          id: 'pr-session-1',
          agentId: 'agent-deploy',
          agentName: 'Deploy Agent',
          toolName: 'Read',
          toolInput: { file_path: '/etc/passwd' },
          description: undefined,
        }),
      ],
      resolved: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/');

    const trigger = bellTrigger(page);
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await expect(trigger).toHaveAttribute('aria-label', /Notifications \(2 pending approvals\)/);

    await trigger.click();
    const dialog = popover(page);
    await expect(dialog).toBeVisible();

    // Deny the rm -rf request.
    const denyRequest = page.waitForRequest(
      (req) =>
        req.method() === 'PATCH' && new URL(req.url()).pathname === '/api/permission-requests/pr-deny-1',
    );
    // The first card is the rm -rf one — scope by its preformatted command.
    const denyCard = dialog
      .locator('div')
      .filter({ hasText: /\$ rm -rf \// })
      .last();
    await denyCard.getByRole('button', { name: 'Deny' }).click();
    const denySent = await denyRequest;
    expect(denySent.postDataJSON()).toMatchObject({ decision: 'denied' });

    // After resolution the second card remains.
    await expect(trigger).toHaveAttribute('aria-label', /Notifications \(1 pending approval\)/, {
      timeout: 10_000,
    });
    await expect(dialog.getByText('Deploy Agent')).toBeVisible();

    // Allow for session on the second card.
    const sessionRequest = page.waitForRequest(
      (req) =>
        req.method() === 'PATCH' &&
        new URL(req.url()).pathname === '/api/permission-requests/pr-session-1',
    );
    await dialog.getByRole('button', { name: 'Allow for session' }).click();
    const sessionSent = await sessionRequest;
    expect(sessionSent.postDataJSON()).toMatchObject({
      decision: 'approved',
      allowForSession: true,
    });

    expect(state.resolved).toEqual([
      { id: 'pr-deny-1', decision: 'denied', allowForSession: undefined },
      { id: 'pr-session-1', decision: 'approved', allowForSession: true },
    ]);

    await expect(trigger).toHaveAttribute('aria-label', 'Notifications', { timeout: 10_000 });
  });

  test('shows the empty pending-approvals state when the API returns no requests', async ({
    page,
  }) => {
    const state: MockState = { pending: [], resolved: [] };
    await mountApiMocks(page, state);

    await page.goto('/');

    const trigger = bellTrigger(page);
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    // No badge → aria-label is just "Notifications".
    await expect(trigger).toHaveAttribute('aria-label', 'Notifications');

    await trigger.click();
    const dialog = popover(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Pending Approvals', { exact: true })).toBeVisible();
    await expect(dialog.getByText('No pending approvals')).toBeVisible();
    await expect(dialog.getByText('No notifications')).toBeVisible();
  });
});
