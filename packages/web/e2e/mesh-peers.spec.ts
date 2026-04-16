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
  // 33.9 Mesh Version Observability — optional fields from PR #555.
  peerVersion?: string | null;
  peerGitSha?: string | null;
  peerSchemaVersion?: number | null;
  // 33.7 Ping diagnostics — failure category + HTTP status.
  lastPingError?: string | null;
  lastPingStatusCode?: number | null;
  // 33.8 Reverse registration + health panel fields.
  reverseRegistrationStatus?: 'pending' | 'ok' | 'failed' | null;
  reverseRegistrationError?: string | null;
  reverseRegistrationAt?: string | null;
  lastPullAt?: string | null;
  lastAckAt?: string | null;
};

type PingResult = { ok: boolean; status: 'reachable' | 'unreachable'; peer: SyncPeer | null };

type UpsertSyncPeerBody = {
  machineId: string;
  hostname: string;
  tailscaleIp?: string | null;
  syncUrl: string;
  role?: string;
  syncStatus?: string;
  syncIntervalMs?: number;
  isSelf?: boolean;
  publicKey?: string | null;
};

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
  upsertRequests?: UpsertSyncPeerBody[];
  upsertStatus?: number;
  upsertError?: { error: string; message: string };
  deleteCalls?: string[];
  deleteStatus?: number;
  deleteError?: { error: string; message: string };
  /** §33.8: reverse registration retry responses keyed by machineId. */
  reverseResponses?: Map<string, { ok: boolean; message?: string; peer: SyncPeer | null }>;
  reverseRetryCalls?: string[];
  /** Version-compat response for the MeshVersionBanner. */
  versionCompat?: {
    appVersion: string;
    gitSha: string;
    schemaVersion: number;
    minSupportedMobileBuild: number;
  } | null;
  /** §33.7: probe response for the add-peer dialog. */
  probeResponses?: Map<string, { reachable: boolean; statusCode?: number; appVersion?: string; error?: string }>;
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

    if (method === 'POST' && pathname === '/api/sync/peers') {
      const body = JSON.parse(req.postData() ?? '{}') as UpsertSyncPeerBody;
      state.upsertRequests ??= [];
      state.upsertRequests.push(body);

      if (state.upsertStatus && state.upsertStatus >= 400) {
        await fulfillJson(
          route,
          state.upsertError ?? {
            error: 'INVALID_SYNC_URL',
            message: '"syncUrl" points to a blocked local or metadata address',
          },
          state.upsertStatus,
        );
        return;
      }

      const peer = makePeer({
        machineId: body.machineId,
        hostname: body.hostname,
        tailscaleIp: body.tailscaleIp ?? null,
        syncUrl: body.syncUrl,
        role: body.role ?? 'full',
        syncStatus: body.syncStatus ?? 'unknown',
        syncIntervalMs: body.syncIntervalMs ?? 30_000,
        isSelf: body.isSelf ?? false,
        publicKey: body.publicKey ?? null,
        lastSeen: null,
      });
      state.peers = [peer, ...state.peers.filter((p) => p.machineId !== peer.machineId)];
      await fulfillJson(route, { ok: true, peer }, 201);
      return;
    }

    const deleteMatch = pathname.match(/^\/api\/sync\/peers\/([^/]+)$/);
    if (method === 'DELETE' && deleteMatch) {
      const machineId = decodeURIComponent(deleteMatch[1] ?? '');
      state.deleteCalls ??= [];
      state.deleteCalls.push(machineId);

      if (state.deleteStatus && state.deleteStatus >= 400) {
        await fulfillJson(
          route,
          state.deleteError ?? {
            error: 'SYNC_PEER_NOT_FOUND',
            message: `Sync peer '${machineId}' not found`,
          },
          state.deleteStatus,
        );
        return;
      }

      const peer = state.peers.find((p) => p.machineId === machineId) ?? null;
      state.peers = state.peers.filter((p) => p.machineId !== machineId);
      await fulfillJson(route, { ok: true, peer });
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
      // Reflect the new syncStatus (and ping diagnostics when present) in
      // the peers list for the next poll.
      state.peers = state.peers.map((p) => {
        if (p.machineId !== machineId) return p;
        const updatedPeer = response.peer;
        return {
          ...p,
          syncStatus: response.status,
          lastPingError: updatedPeer?.lastPingError ?? p.lastPingError,
          lastPingStatusCode: updatedPeer?.lastPingStatusCode ?? p.lastPingStatusCode,
        };
      });
      await fulfillJson(route, response);
      return;
    }

    // §33.8 — Reverse registration retry
    const reverseMatch = pathname.match(/^\/api\/sync\/peers\/([^/]+)\/register-reverse$/);
    if (method === 'POST' && reverseMatch) {
      const machineId = decodeURIComponent(reverseMatch[1] ?? '');
      state.reverseRetryCalls ??= [];
      state.reverseRetryCalls.push(machineId);
      const response = state.reverseResponses?.get(machineId) ?? {
        ok: false,
        message: 'Reverse registration failed',
        peer: null,
      };
      // Apply updated reverse status to the peers list when the response
      // carries an updated peer object.
      if (response.peer) {
        state.peers = state.peers.map((p) =>
          p.machineId === machineId
            ? {
                ...p,
                reverseRegistrationStatus: response.peer?.reverseRegistrationStatus ?? p.reverseRegistrationStatus,
                reverseRegistrationError: response.peer?.reverseRegistrationError ?? p.reverseRegistrationError,
              }
            : p,
        );
      }
      await fulfillJson(route, response);
      return;
    }

    // §33.8 — Peer cursors (row drill-down)
    const cursorsMatch = pathname.match(/^\/api\/sync\/peers\/([^/]+)\/cursors$/);
    if (method === 'GET' && cursorsMatch) {
      const machineId = decodeURIComponent(cursorsMatch[1] ?? '');
      await fulfillJson(route, {
        machineId,
        localNodeId: 'local-node',
        remoteNodeId: machineId,
        pulledCursor: 42,
        ackedCursor: 41,
        lastPullAt: new Date(Date.now() - 30_000).toISOString(),
        lastAckAt: new Date(Date.now() - 60_000).toISOString(),
        updatedAt: new Date(Date.now() - 30_000).toISOString(),
      });
      return;
    }

    // §33.11 — Version compat (drives the MeshVersionBanner)
    if (method === 'GET' && pathname === '/api/version-compat') {
      const compat = state.versionCompat ?? {
        appVersion: '0.5.1',
        gitSha: 'test',
        schemaVersion: 26,
        minSupportedMobileBuild: 0,
      };
      await fulfillJson(route, compat);
      return;
    }

    // §33.7 — Probe sync URL (pre-flight check in add-peer dialog)
    if (method === 'POST' && pathname === '/api/sync/probe') {
      const body = JSON.parse(req.postData() ?? '{}') as { syncUrl?: string };
      const syncUrl = body.syncUrl ?? '';
      const probeResult = state.probeResponses?.get(syncUrl) ?? {
        reachable: true,
        statusCode: 200,
        appVersion: '0.5.1',
      };
      await fulfillJson(route, probeResult);
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
    await expect(selfRow.getByTestId('delete-machine-self')).toBeDisabled();

    // Peer row shows IP, syncUrl, role, interval (1m), and an enabled Ping button.
    const betaRow = table.getByRole('row').filter({ hasText: 'beta.tail.ts.net' });
    await expect(betaRow.getByText('100.64.0.11', { exact: true })).toBeVisible();
    await expect(betaRow.getByText('http://100.64.0.11:8080', { exact: true })).toBeVisible();
    await expect(betaRow.getByText('replica', { exact: true })).toBeVisible();
    await expect(betaRow.getByText('1m', { exact: true })).toBeVisible();
    await expect(betaRow.getByTestId('ping-machine-beta')).toBeEnabled();
  });

  test('renders the version column and mesh drift banner when peers span versions', async ({
    page,
  }) => {
    const peers: SyncPeer[] = [
      makePeer({
        machineId: 'machine-self',
        hostname: 'self.tail.ts.net',
        role: 'self',
        isSelf: true,
        syncStatus: 'reachable',
        peerVersion: 'v0.4.0',
      }),
      makePeer({
        machineId: 'machine-old',
        hostname: 'old.tail.ts.net',
        tailscaleIp: '100.64.0.11',
        syncUrl: 'http://100.64.0.11:8080',
        role: 'replica',
        syncStatus: 'reachable',
        peerVersion: 'v0.3.1',
      }),
    ];
    await mountApiMocks(page, {
      peers,
      pingResponses: new Map(),
      pingCalls: [],
    });

    await page.goto('/mesh-peers');

    const table = page.getByRole('table', { name: 'Mesh sync peers' });
    await expect(table.getByRole('columnheader', { name: 'Version' })).toBeVisible();

    // Self row renders its own version with a match dot.
    const selfRow = table.getByRole('row').filter({ hasText: 'self.tail.ts.net' });
    await expect(selfRow.getByTestId('peer-version-match')).toBeVisible();
    await expect(selfRow.getByTestId('peer-version-match')).toContainText('v0.4.0');

    // Older peer renders the behind (yellow) drift indicator.
    const oldRow = table.getByRole('row').filter({ hasText: 'old.tail.ts.net' });
    await expect(oldRow.getByTestId('peer-version-behind')).toBeVisible();
    await expect(oldRow.getByTestId('peer-version-behind')).toContainText('v0.3.1');

    // Mesh-wide drift banner surfaces the version breakdown.
    const banner = page.getByTestId('mesh-drift-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Mesh on mixed versions');
    await expect(banner).toContainText('v0.4.0');
    await expect(banner).toContainText('v0.3.1');
  });

  test('renders the per-row peer-ahead badge when peer schema is ahead of local', async ({
    page,
  }) => {
    // Local schema is 26 (see packages/web/src/lib/mesh-version.ts). A peer
    // reporting 99 is unambiguously ahead and should surface the 33.10 badge.
    const peers: SyncPeer[] = [
      makePeer({
        machineId: 'machine-ahead',
        hostname: 'ahead.tail.ts.net',
        tailscaleIp: '100.64.0.12',
        syncUrl: 'http://100.64.0.12:8080',
        role: 'replica',
        syncStatus: 'reachable',
        peerVersion: 'v0.5.0',
        peerSchemaVersion: 99,
      }),
    ];
    await mountApiMocks(page, {
      peers,
      pingResponses: new Map(),
      pingCalls: [],
    });

    await page.goto('/mesh-peers');

    const table = page.getByRole('table', { name: 'Mesh sync peers' });
    const aheadRow = table.getByRole('row').filter({ hasText: 'ahead.tail.ts.net' });
    const badge = aheadRow.getByTestId('peer-ahead-badge-machine-ahead');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('update this node');
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
    await expect(page.getByTestId('empty-add-mesh-peer')).toBeVisible();
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

  test('adds a mesh peer and refreshes the table', async ({ page }) => {
    const state: MockState = {
      peers: [],
      pingResponses: new Map(),
      pingCalls: [],
      upsertRequests: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/mesh-peers');
    await page.getByTestId('add-mesh-peer').click();

    const dialog = page.getByTestId('mesh-peer-form-dialog');
    await expect(dialog.getByRole('heading', { name: 'Add mesh peer' })).toBeVisible();
    await dialog.getByLabel('Machine ID').fill('machine-delta');
    await dialog.getByLabel('Hostname').fill('delta.tail.ts.net');
    await dialog.getByLabel('Sync URL').fill('http://100.64.0.12:8080');
    await dialog.getByLabel('Tailscale IP').fill('100.64.0.12');
    await dialog.getByLabel('Sync interval seconds').fill('45');
    await dialog.getByLabel('Public key').fill('mesh-public-key');

    // §33.7: Probe the URL before Save becomes enabled.
    const probeRequest = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/sync/probe',
    );
    await dialog.getByTestId('mesh-peer-probe').click();
    await probeRequest;
    await expect(dialog.getByTestId('mesh-peer-probe-success')).toBeVisible();

    const upsertRequest = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/sync/peers',
    );
    await dialog.getByTestId('mesh-peer-submit').click();
    await upsertRequest;

    expect(state.upsertRequests).toEqual([
      {
        machineId: 'machine-delta',
        hostname: 'delta.tail.ts.net',
        syncUrl: 'http://100.64.0.12:8080',
        tailscaleIp: '100.64.0.12',
        role: 'full',
        syncStatus: 'unknown',
        syncIntervalMs: 45_000,
        isSelf: false,
        publicKey: 'mesh-public-key',
      },
    ]);

    await expect(page.getByTestId('mesh-peer-form-dialog')).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: /saved/i })).toBeVisible();

    const table = page.getByRole('table', { name: 'Mesh sync peers' });
    const deltaRow = table.getByRole('row').filter({ hasText: 'delta.tail.ts.net' });
    await expect(deltaRow.getByText('machine-delta', { exact: true })).toBeVisible();
    await expect(deltaRow.getByText('http://100.64.0.12:8080', { exact: true })).toBeVisible();
    await expect(deltaRow.getByText('45s', { exact: true })).toBeVisible();
  });

  test('updates an existing mesh peer without deleting it', async ({ page }) => {
    const state: MockState = {
      peers: [
        makePeer({
          machineId: 'machine-edit',
          hostname: 'old.tail.ts.net',
          tailscaleIp: '100.64.0.30',
          syncUrl: 'http://100.64.0.30:8080',
          syncStatus: 'unreachable',
          syncIntervalMs: 60_000,
          publicKey: 'old-public-key',
        }),
      ],
      pingResponses: new Map(),
      pingCalls: [],
      upsertRequests: [],
      deleteCalls: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/mesh-peers');
    const table = page.getByRole('table', { name: 'Mesh sync peers' });
    const editRow = table.getByRole('row').filter({ hasText: 'old.tail.ts.net' });
    await editRow.getByTestId('edit-machine-edit').click();

    const dialog = page.getByTestId('mesh-peer-form-dialog');
    await expect(dialog.getByRole('heading', { name: 'Update mesh peer' })).toBeVisible();
    await expect(dialog.getByLabel('Machine ID')).toHaveValue('machine-edit');
    await expect(dialog.getByLabel('Machine ID')).toBeDisabled();
    await expect(dialog.getByLabel('Hostname')).toHaveValue('old.tail.ts.net');
    await expect(dialog.getByLabel('Sync URL')).toHaveValue('http://100.64.0.30:8080');
    await expect(dialog.getByLabel('Tailscale IP')).toHaveValue('100.64.0.30');
    await expect(dialog.getByLabel('Sync interval seconds')).toHaveValue('60');
    await expect(dialog.getByLabel('Public key')).toHaveValue('old-public-key');

    await dialog.getByLabel('Hostname').fill('new.tail.ts.net');
    await dialog.getByLabel('Sync URL').fill('https://new.tail.ts.net:9090');
    await dialog.getByLabel('Tailscale IP').fill('100.64.0.31');
    await dialog.getByLabel('Sync interval seconds').fill('45');
    await dialog.getByLabel('Public key').fill('new-public-key');

    const upsertRequest = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/sync/peers',
    );
    await dialog.getByTestId('mesh-peer-submit').click();
    await upsertRequest;

    expect(state.upsertRequests).toEqual([
      {
        machineId: 'machine-edit',
        hostname: 'new.tail.ts.net',
        syncUrl: 'https://new.tail.ts.net:9090',
        tailscaleIp: '100.64.0.31',
        role: 'full',
        syncStatus: 'unreachable',
        syncIntervalMs: 45_000,
        isSelf: false,
        publicKey: 'new-public-key',
      },
    ]);
    expect(state.deleteCalls).toEqual([]);

    await expect(page.getByTestId('mesh-peer-form-dialog')).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: /updated/i })).toBeVisible();

    const updatedRow = table.getByRole('row').filter({ hasText: 'new.tail.ts.net' });
    await expect(updatedRow.getByText('machine-edit', { exact: true })).toBeVisible();
    await expect(updatedRow.getByText('https://new.tail.ts.net:9090', { exact: true })).toBeVisible();
    await expect(updatedRow.getByText('45s', { exact: true })).toBeVisible();
  });

  test('shows add-peer validation and backend errors without closing the dialog', async ({
    page,
  }) => {
    const state: MockState = {
      peers: [],
      pingResponses: new Map(),
      pingCalls: [],
      upsertRequests: [],
      upsertStatus: 400,
      upsertError: {
        error: 'INVALID_SYNC_URL',
        message: '"syncUrl" points to a blocked local or metadata address',
      },
    };
    await mountApiMocks(page, state);

    await page.goto('/mesh-peers');
    await page.getByTestId('add-mesh-peer').click();

    const dialog = page.getByTestId('mesh-peer-form-dialog');
    await dialog.getByLabel('Machine ID').fill('machine-local');
    await dialog.getByLabel('Hostname').fill('local.tail.ts.net');
    await dialog.getByLabel('Sync URL').fill('ftp://100.64.0.12:8080');
    await dialog.getByTestId('mesh-peer-submit').click();

    await expect(page.getByTestId('mesh-peer-form-error')).toContainText(
      'Sync URL must be a valid http(s) URL without credentials',
    );
    expect(state.upsertRequests).toEqual([]);

    await dialog.getByLabel('Sync URL').fill('http://localhost:8080');

    // §33.7: Probe the URL first — mock returns reachable but the backend
    // will reject the SSRF-blocked address on save. The probe unblocks Submit.
    const probeRequest = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/sync/probe',
    );
    await dialog.getByTestId('mesh-peer-probe').click();
    await probeRequest;
    await expect(dialog.getByTestId('mesh-peer-probe-success')).toBeVisible();

    const upsertRequest = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/sync/peers',
    );
    await dialog.getByTestId('mesh-peer-submit').click();
    await upsertRequest;

    await expect(page.getByTestId('mesh-peer-form-error')).toContainText(
      '"syncUrl" points to a blocked local or metadata address',
    );
    await expect(page.getByTestId('mesh-peer-form-dialog')).toBeVisible();
    expect(state.upsertRequests).toHaveLength(1);
  });

  test('deletes a non-self mesh peer after confirmation', async ({ page }) => {
    const state: MockState = {
      peers: [
        makePeer({
          machineId: 'machine-beta',
          hostname: 'beta.tail.ts.net',
          role: 'full',
        }),
      ],
      pingResponses: new Map(),
      pingCalls: [],
      deleteCalls: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/mesh-peers');

    const table = page.getByRole('table', { name: 'Mesh sync peers' });
    await expect(table.getByRole('row').filter({ hasText: 'beta.tail.ts.net' })).toBeVisible();
    await page.getByTestId('delete-machine-beta').click();

    const confirm = page.getByTestId('mesh-peer-delete-confirm');
    await expect(confirm.getByRole('heading', { name: 'Delete mesh peer?' })).toBeVisible();
    await expect(confirm.getByText('machine-beta', { exact: true })).toBeVisible();

    const deleteRequest = page.waitForRequest(
      (r) =>
        r.method() === 'DELETE' &&
        new URL(r.url()).pathname === '/api/sync/peers/machine-beta',
    );
    await confirm.getByTestId('confirm-delete-mesh-peer').click();
    await deleteRequest;

    expect(state.deleteCalls).toEqual(['machine-beta']);
    await expect(page.getByRole('alert').filter({ hasText: /deleted/i })).toBeVisible();
    await expect(table.getByRole('row').filter({ hasText: 'beta.tail.ts.net' })).toHaveCount(0);
    await expect(page.getByText('No mesh peers registered.')).toBeVisible();
  });

  test('surfaces delete failures and keeps the peer row', async ({ page }) => {
    const state: MockState = {
      peers: [
        makePeer({
          machineId: 'machine-beta',
          hostname: 'beta.tail.ts.net',
          role: 'full',
        }),
      ],
      pingResponses: new Map(),
      pingCalls: [],
      deleteCalls: [],
      deleteStatus: 404,
      deleteError: {
        error: 'SYNC_PEER_NOT_FOUND',
        message: "Sync peer 'machine-beta' not found",
      },
    };
    await mountApiMocks(page, state);

    await page.goto('/mesh-peers');

    const table = page.getByRole('table', { name: 'Mesh sync peers' });
    await page.getByTestId('delete-machine-beta').click();

    const confirm = page.getByTestId('mesh-peer-delete-confirm');
    const deleteRequest = page.waitForRequest(
      (r) =>
        r.method() === 'DELETE' &&
        new URL(r.url()).pathname === '/api/sync/peers/machine-beta',
    );
    await confirm.getByTestId('confirm-delete-mesh-peer').click();
    await deleteRequest;

    expect(state.deleteCalls).toEqual(['machine-beta']);
    await expect(page.getByRole('alert').filter({ hasText: /not found/i })).toBeVisible();
    await expect(page.getByTestId('mesh-peer-delete-confirm')).toHaveCount(0);
    await expect(table.getByRole('row').filter({ hasText: 'beta.tail.ts.net' })).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // §33.7 — Ping failure details (category badge + diagnostic line)
  // ---------------------------------------------------------------------------

  test('shows ping failure category badge and diagnostic line on unreachable peer', async ({
    page,
  }) => {
    const peer = makePeer({
      machineId: 'machine-fail',
      hostname: 'fail.tail.ts.net',
      syncStatus: 'unreachable',
      lastPingError: 'connect_refused',
      lastPingStatusCode: null,
    });
    const state: MockState = {
      peers: [peer],
      pingResponses: new Map(),
      pingCalls: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/mesh-peers');

    const row = page
      .getByRole('table', { name: 'Mesh sync peers' })
      .getByRole('row')
      .filter({ hasText: 'fail.tail.ts.net' });

    // The status pill shows "unreachable".
    await expect(row.getByText('unreachable', { exact: true })).toBeVisible();

    // The category badge renders inline next to the status pill.
    const badge = page.getByTestId('peer-ping-category-machine-fail');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('connect_refused');

    // The diagnostic line renders below the status row with the full reason.
    const diagnostic = page.getByTestId('peer-ping-diagnostic-machine-fail');
    await expect(diagnostic).toBeVisible();
    await expect(diagnostic).toContainText('connect_refused');
  });

  test('shows HTTP status code prefix in ping diagnostic when present', async ({ page }) => {
    const peer = makePeer({
      machineId: 'machine-http-fail',
      hostname: 'httpfail.tail.ts.net',
      syncStatus: 'unreachable',
      lastPingError: 'Service Unavailable',
      lastPingStatusCode: 503,
    });
    const state: MockState = {
      peers: [peer],
      pingResponses: new Map(),
      pingCalls: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/mesh-peers');

    // The diagnostic line should include the HTTP prefix.
    const diagnostic = page.getByTestId('peer-ping-diagnostic-machine-http-fail');
    await expect(diagnostic).toBeVisible();
    await expect(diagnostic).toContainText('HTTP 503');
    await expect(diagnostic).toContainText('Service Unavailable');
  });

  test('ping failure updates the row with failure category from response', async ({ page }) => {
    const peer = makePeer({
      machineId: 'machine-timeout',
      hostname: 'timeout.tail.ts.net',
      syncStatus: 'reachable',
    });
    const failedPeer: SyncPeer = {
      ...peer,
      syncStatus: 'unreachable',
      lastPingError: 'timeout',
      lastPingStatusCode: null,
    };
    const state: MockState = {
      peers: [peer],
      pingResponses: new Map([
        [
          'machine-timeout',
          { ok: false, status: 'unreachable' as const, peer: failedPeer },
        ],
      ]),
      pingCalls: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/mesh-peers');

    // Initially reachable — no category badge.
    await expect(page.getByTestId('peer-ping-category-machine-timeout')).toHaveCount(0);

    // Click Ping — the response carries failure details.
    const pingRequest = page.waitForRequest(
      (r) =>
        r.method() === 'POST' &&
        new URL(r.url()).pathname === '/api/sync/peers/machine-timeout/ping',
    );
    await page.getByTestId('ping-machine-timeout').click();
    await pingRequest;

    // After refetch, the row should show the failure category badge.
    const badge = page.getByTestId('peer-ping-category-machine-timeout');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('timeout');
  });

  test('hides ping diagnostic for reachable peers', async ({ page }) => {
    const peer = makePeer({
      machineId: 'machine-ok',
      hostname: 'ok.tail.ts.net',
      syncStatus: 'reachable',
      lastPingError: null,
      lastPingStatusCode: null,
    });
    const state: MockState = {
      peers: [peer],
      pingResponses: new Map(),
      pingCalls: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/mesh-peers');

    // Neither the category badge nor the diagnostic line should be present.
    await expect(page.getByTestId('peer-ping-category-machine-ok')).toHaveCount(0);
    await expect(page.getByTestId('peer-ping-diagnostic-machine-ok')).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------
  // §33.8 — MeshHealthSummary panel
  // ---------------------------------------------------------------------------

  test('renders MeshHealthSummary with correct counts', async ({ page }) => {
    const now = Date.now();
    const recentPull = new Date(now - 2 * 60 * 1000).toISOString(); // 2 min ago
    const stalePull = new Date(now - 15 * 60 * 1000).toISOString(); // 15 min ago

    const peers: SyncPeer[] = [
      makePeer({
        machineId: 'machine-self',
        hostname: 'self.tail.ts.net',
        isSelf: true,
        syncStatus: 'reachable',
      }),
      makePeer({
        machineId: 'machine-bi-1',
        hostname: 'bi1.tail.ts.net',
        syncStatus: 'reachable',
        reverseRegistrationStatus: 'ok',
        lastPullAt: recentPull,
      }),
      makePeer({
        machineId: 'machine-bi-2',
        hostname: 'bi2.tail.ts.net',
        syncStatus: 'reachable',
        reverseRegistrationStatus: 'ok',
        lastPullAt: recentPull,
      }),
      makePeer({
        machineId: 'machine-oneway',
        hostname: 'oneway.tail.ts.net',
        syncStatus: 'unreachable',
        reverseRegistrationStatus: 'failed',
        lastPullAt: stalePull,
      }),
      makePeer({
        machineId: 'machine-stale',
        hostname: 'stale.tail.ts.net',
        syncStatus: 'reachable',
        reverseRegistrationStatus: 'ok',
        lastPullAt: stalePull,
      }),
    ];

    const state: MockState = {
      peers,
      pingResponses: new Map(),
      pingCalls: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/mesh-peers');

    // The health summary panel should be visible.
    const summary = page.getByTestId('mesh-health-summary');
    await expect(summary).toBeVisible();

    // Total: 4 non-self peers.
    const totalMetric = page.getByTestId('mesh-health-total');
    await expect(totalMetric).toContainText('4');
    await expect(totalMetric).toContainText('peers');

    // Bidirectional: 3 peers with reverseRegistrationStatus === 'ok'.
    const biMetric = page.getByTestId('mesh-health-bidirectional');
    await expect(biMetric).toContainText('3');
    await expect(biMetric).toContainText('bidirectional');

    // One-way: 1 peer with failed reverse registration.
    const oneWayMetric = page.getByTestId('mesh-health-one-way');
    await expect(oneWayMetric).toContainText('1');
    await expect(oneWayMetric).toContainText('one-way');

    // Stale: 2 peers with lastPullAt older than 10 min.
    const staleMetric = page.getByTestId('mesh-health-stale');
    await expect(staleMetric).toContainText('2');
    await expect(staleMetric).toContainText('stale');
  });

  test('MeshHealthSummary is hidden when no peers are registered', async ({ page }) => {
    const state: MockState = {
      peers: [],
      pingResponses: new Map(),
      pingCalls: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/mesh-peers');

    await expect(page.getByTestId('mesh-health-summary')).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------
  // §33.8 — One-way badge + reverse registration retry
  // ---------------------------------------------------------------------------

  test('shows One-way badge and Retry button for failed reverse registration', async ({
    page,
  }) => {
    const peer = makePeer({
      machineId: 'machine-oneway',
      hostname: 'oneway.tail.ts.net',
      syncStatus: 'reachable',
      reverseRegistrationStatus: 'failed',
      reverseRegistrationError: 'Connection refused',
    });
    const updatedPeer: SyncPeer = {
      ...peer,
      reverseRegistrationStatus: 'ok',
      reverseRegistrationError: null,
    };
    const state: MockState = {
      peers: [peer],
      pingResponses: new Map(),
      pingCalls: [],
      reverseRetryCalls: [],
      reverseResponses: new Map([
        ['machine-oneway', { ok: true, peer: updatedPeer }],
      ]),
    };
    await mountApiMocks(page, state);

    await page.goto('/mesh-peers');

    // One-way badge should be visible.
    const badge = page.getByTestId('reverse-badge-machine-oneway');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('One-way');

    // Retry button should be present.
    const retryBtn = page.getByTestId('reverse-retry-machine-oneway');
    await expect(retryBtn).toBeVisible();
    await expect(retryBtn).toContainText('Retry');

    // Click retry — after success, the refetch should clear the badge.
    const reverseRequest = page.waitForRequest(
      (r) =>
        r.method() === 'POST' &&
        new URL(r.url()).pathname === '/api/sync/peers/machine-oneway/register-reverse',
    );
    await retryBtn.click();
    await reverseRequest;

    expect(state.reverseRetryCalls).toEqual(['machine-oneway']);

    // After a successful retry the toast should appear.
    await expect(page.getByRole('alert').filter({ hasText: /succeeded/i })).toBeVisible();
  });

  test('hides One-way badge when reverse registration is ok', async ({ page }) => {
    const peer = makePeer({
      machineId: 'machine-good',
      hostname: 'good.tail.ts.net',
      syncStatus: 'reachable',
      reverseRegistrationStatus: 'ok',
    });
    const state: MockState = {
      peers: [peer],
      pingResponses: new Map(),
      pingCalls: [],
    };
    await mountApiMocks(page, state);

    await page.goto('/mesh-peers');

    await expect(page.getByTestId('reverse-badge-machine-good')).toHaveCount(0);
    await expect(page.getByTestId('reverse-retry-machine-good')).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------
  // §33.11 — MeshVersionBanner (update-available banner)
  // ---------------------------------------------------------------------------

  test('renders update-available banner when a peer is ahead of local version', async ({
    page,
  }) => {
    const peers: SyncPeer[] = [
      makePeer({
        machineId: 'machine-self',
        hostname: 'self.tail.ts.net',
        isSelf: true,
        syncStatus: 'reachable',
        peerVersion: 'v0.5.1',
      }),
      makePeer({
        machineId: 'machine-ahead',
        hostname: 'ahead.tail.ts.net',
        syncStatus: 'reachable',
        peerVersion: 'v0.6.0',
      }),
    ];
    const state: MockState = {
      peers,
      pingResponses: new Map(),
      pingCalls: [],
      versionCompat: {
        appVersion: '0.5.1',
        gitSha: 'abc123',
        schemaVersion: 26,
        minSupportedMobileBuild: 0,
      },
    };
    await mountApiMocks(page, state);

    await page.goto('/mesh-peers');

    const banner = page.getByTestId('mesh-version-update-banner');
    await expect(banner).toBeVisible();

    const headline = page.getByTestId('mesh-version-update-headline');
    await expect(headline).toContainText('Update available');
    await expect(headline).toContainText('0.5.1');
    await expect(headline).toContainText('0.6.0');

    // The command hint should be present.
    const command = page.getByTestId('mesh-version-update-command');
    await expect(command).toContainText('peer-update.sh --dry-run');

    // Settings link should be present.
    const settingsLink = page.getByTestId('mesh-version-update-settings-link');
    await expect(settingsLink).toBeVisible();
    await expect(settingsLink).toHaveAttribute('href', '/settings');
  });

  test('hides update-available banner when all peers match local version', async ({ page }) => {
    const peers: SyncPeer[] = [
      makePeer({
        machineId: 'machine-self',
        hostname: 'self.tail.ts.net',
        isSelf: true,
        syncStatus: 'reachable',
        peerVersion: 'v0.5.1',
      }),
      makePeer({
        machineId: 'machine-same',
        hostname: 'same.tail.ts.net',
        syncStatus: 'reachable',
        peerVersion: 'v0.5.1',
      }),
    ];
    const state: MockState = {
      peers,
      pingResponses: new Map(),
      pingCalls: [],
      versionCompat: {
        appVersion: '0.5.1',
        gitSha: 'abc123',
        schemaVersion: 26,
        minSupportedMobileBuild: 0,
      },
    };
    await mountApiMocks(page, state);

    await page.goto('/mesh-peers');

    await expect(page.getByTestId('mesh-version-update-banner')).toHaveCount(0);
  });
});
