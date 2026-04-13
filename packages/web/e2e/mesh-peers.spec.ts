import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * E2E coverage for the Mesh Peers page (`/mesh-peers`).
 *
 * The page is driven by:
 *   - GET  /api/sync/peers                       — list of Tailscale mesh sync peers
 *   - POST /api/sync/peers/:machineId/ping       — probe a peer's /health endpoint
 *
 * These specs mock all `/api/**` traffic via `page.route` so no control plane
 * or worker is required — only the Next.js dev server on $WEB_PORT.
 */

type SyncPeer = {
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
};

type PingResult = { ok: boolean; status: 'reachable' | 'unreachable'; peer: SyncPeer | null };

function makePeer(overrides: Partial<SyncPeer> = {}): SyncPeer {
  return {
    machineId: 'machine-alpha',
    hostname: 'alpha.tail.ts.net',
    tailscaleIp: '100.64.0.10',
    syncUrl: 'http://100.64.0.10:8080',
    role: 'primary',
    syncStatus: 'reachable',
    syncIntervalMs: 30_000,
    isSelf: false,
    publicKey: null,
    lastSeen: new Date(Date.now() - 60_000).toISOString(),
    createdAt: '2026-04-01T00:00:00.000Z',
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
  peers: SyncPeer[];
  pingResponses: Map<string, PingResult>;
  pingCalls: string[];
};

async function mountApiMocks(page: Page, state: MockState): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const { pathname } = url;

    if (method === 'GET' && pathname === '/api/sync/peers') {
      await fulfillJson(route, { peers: state.peers });
      return;
    }

    const pingMatch = pathname.match(/^\/api\/sync\/peers\/([^/]+)\/ping$/);
    if (method === 'POST' && pingMatch) {
      const machineId = decodeURIComponent(pingMatch[1] ?? '');
      state.pingCalls.push(machineId);
      const response = state.pingResponses.get(machineId) ?? {
        ok: false,
        status: 'unreachable' as const,
        peer: null,
      };
      // Reflect the new syncStatus in the peers list for the next poll.
      state.peers = state.peers.map((p) =>
        p.machineId === machineId ? { ...p, syncStatus: response.status } : p,
      );
      await fulfillJson(route, response);
      return;
    }

    // Safe empty payloads for anything the shell (sidebar, bell) polls on boot.
    if (method === 'GET' && pathname === '/api/sessions') {
      await fulfillJson(route, { sessions: [], total: 0, limit: 50, offset: 0, hasMore: false });
      return;
    }
    if (method === 'GET' && pathname === '/api/runtime-sessions') {
      await fulfillJson(route, { sessions: [], count: 0 });
      return;
    }
    await fulfillJson(route, method === 'GET' ? [] : {});
  });
}

test.describe('Mesh Peers page', () => {
  test('renders peer rows with the expected columns', async ({ page }) => {
    const peers: SyncPeer[] = [
      makePeer({
        machineId: 'machine-self',
        hostname: 'self.tail.ts.net',
        role: 'self',
        isSelf: true,
        syncStatus: 'reachable',
      }),
      makePeer({
        machineId: 'machine-beta',
        hostname: 'beta.tail.ts.net',
        tailscaleIp: '100.64.0.11',
        syncUrl: 'http://100.64.0.11:8080',
        role: 'replica',
        syncStatus: 'unreachable',
        syncIntervalMs: 60_000,
      }),
    ];
    await mountApiMocks(page, {
      peers,
      pingResponses: new Map(),
      pingCalls: [],
    });

    await page.goto('/mesh-peers');

    await expect(page.getByRole('heading', { name: 'Mesh Peers' })).toBeVisible();
    await expect(page.getByText('1 reachable', { exact: true })).toBeVisible();
    await expect(page.getByText('1 unreachable', { exact: true })).toBeVisible();

    const table = page.getByRole('table', { name: 'Mesh sync peers' });
    await expect(table).toBeVisible();

    for (const header of [
      'Peer',
      'Status',
      'Tailscale IP',
      'Sync URL',
      'Role',
      'Interval',
      'Last Seen',
      'Action',
    ]) {
      await expect(table.getByRole('columnheader', { name: header })).toBeVisible();
    }

    // Self row renders the SELF badge and a disabled Ping button.
    const selfRow = table.getByRole('row').filter({ hasText: 'self.tail.ts.net' });
    await expect(selfRow.getByText('SELF', { exact: true })).toBeVisible();
    await expect(selfRow.getByTestId('ping-machine-self')).toBeDisabled();

    // Peer row shows IP, syncUrl, role, interval (1m), and an enabled Ping button.
    const betaRow = table.getByRole('row').filter({ hasText: 'beta.tail.ts.net' });
    await expect(betaRow.getByText('100.64.0.11', { exact: true })).toBeVisible();
    await expect(betaRow.getByText('http://100.64.0.11:8080', { exact: true })).toBeVisible();
    await expect(betaRow.getByText('replica', { exact: true })).toBeVisible();
    await expect(betaRow.getByText('1m', { exact: true })).toBeVisible();
    await expect(betaRow.getByTestId('ping-machine-beta')).toBeEnabled();
  });

  test('shows the empty state when no peers are registered', async ({ page }) => {
    await mountApiMocks(page, {
      peers: [],
      pingResponses: new Map(),
      pingCalls: [],
    });

    await page.goto('/mesh-peers');

    await expect(page.getByRole('heading', { name: 'Mesh Peers' })).toBeVisible();
    await expect(page.getByText('No mesh peers registered.')).toBeVisible();
    // Table should not render.
    await expect(page.getByRole('table', { name: 'Mesh sync peers' })).toHaveCount(0);
  });

  test('Ping success surfaces a reachable toast and updates status', async ({ page }) => {
    const peer = makePeer({
      machineId: 'machine-beta',
      hostname: 'beta.tail.ts.net',
      syncStatus: 'unknown',
    });
    const state: MockState = {
      peers: [peer],
      pingResponses: new Map([
        [
          'machine-beta',
          { ok: true, status: 'reachable' as const, peer: { ...peer, syncStatus: 'reachable' } },
        ],
      ]),
      pingCalls: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/mesh-peers');

    const pingRequest = page.waitForRequest(
      (r) =>
        r.method() === 'POST' &&
        new URL(r.url()).pathname === '/api/sync/peers/machine-beta/ping',
    );

    await page.getByTestId('ping-machine-beta').click();
    await pingRequest;

    await expect(page.getByRole('alert').filter({ hasText: /reachable/i })).toBeVisible();
    expect(state.pingCalls).toEqual(['machine-beta']);

    // After the refetch the row's status pill flips to reachable.
    const betaRow = page
      .getByRole('table', { name: 'Mesh sync peers' })
      .getByRole('row')
      .filter({ hasText: 'beta.tail.ts.net' });
    await expect(betaRow.getByText('reachable', { exact: true })).toBeVisible();
  });

  test('Ping failure surfaces an unreachable error toast', async ({ page }) => {
    const peer = makePeer({
      machineId: 'machine-gamma',
      hostname: 'gamma.tail.ts.net',
      syncStatus: 'reachable',
    });
    const state: MockState = {
      peers: [peer],
      pingResponses: new Map([
        [
          'machine-gamma',
          { ok: false, status: 'unreachable' as const, peer: { ...peer, syncStatus: 'unreachable' } },
        ],
      ]),
      pingCalls: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/mesh-peers');

    await page.getByTestId('ping-machine-gamma').click();

    await expect(page.getByRole('alert').filter({ hasText: /unreachable/i })).toBeVisible();
    expect(state.pingCalls).toEqual(['machine-gamma']);
  });
});
