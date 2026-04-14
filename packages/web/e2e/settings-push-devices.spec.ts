import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * E2E coverage for the Push Devices section inside Settings → Notifications.
 * Mocks all `/api/**` traffic — only needs the Next.js dev server on $WEB_PORT.
 * Endpoints under test:
 *   GET  /api/mobile-push-devices?userId=local
 *   POST /api/mobile-push-devices/:id/deactivate
 *
 * The component guards revoke behind window.confirm() — tests accept/dismiss the
 * native dialog via page.on('dialog', ...).
 */

type MobilePushDevice = {
  id: string;
  userId: string;
  platform: 'ios';
  provider: 'expo';
  pushToken: string;
  appId: string;
  lastSeenAt: string;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type DeactivateCall = { id: string };

type MockState = {
  devices: MobilePushDevice[];
  deactivateCalls: DeactivateCall[];
  listCalls: string[];
  deactivateStatus: number;
};

function makeDevice(overrides: Partial<MobilePushDevice> = {}): MobilePushDevice {
  const now = new Date(Date.now() - 3_600_000).toISOString();
  return {
    id: 'dev-1',
    userId: 'local',
    platform: 'ios',
    provider: 'expo',
    pushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxx]',
    appId: 'com.agentctl.ios',
    lastSeenAt: now,
    disabledAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mountApiMocks(page: Page, state: MockState): Promise<void> {
  await page.route('**/health?**', async (route) => {
    await fulfillJson(route, {
      ok: true,
      status: 'healthy',
      dependencies: { litellm: { status: 'ok' } },
    });
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const { pathname } = url;

    if (method === 'GET' && pathname === '/api/mobile-push-devices') {
      state.listCalls.push(url.search);
      await fulfillJson(route, {
        devices: state.devices.filter((d) => d.disabledAt === null),
      });
      return;
    }

    const deactivateMatch = pathname.match(
      /^\/api\/mobile-push-devices\/([^/]+)\/deactivate$/,
    );
    if (method === 'POST' && deactivateMatch) {
      const id = decodeURIComponent(deactivateMatch[1] ?? '');
      state.deactivateCalls.push({ id });

      if (state.deactivateStatus !== 200) {
        await fulfillJson(route, { ok: false, error: 'DEACTIVATE_FAILED' }, state.deactivateStatus);
        return;
      }

      const target = state.devices.find((d) => d.id === id);
      if (!target) {
        await fulfillJson(route, { ok: false, error: 'NOT_FOUND' }, 404);
        return;
      }
      const revokedAt = new Date().toISOString();
      const next: MobilePushDevice = { ...target, disabledAt: revokedAt };
      state.devices = state.devices.map((d) => (d.id === id ? next : d));
      await fulfillJson(route, { ok: true, device: next });
      return;
    }

    // Notification preferences endpoint used by the sibling panel.
    if (method === 'GET' && pathname === '/api/notifications/preferences/local') {
      await fulfillJson(route, { preferences: [] });
      return;
    }

    // Boot noise — stay silent, never throw from the Settings shell.
    await fulfillJson(route, method === 'GET' ? [] : {});
  });
}

async function openPushDevicesSection(page: Page): Promise<void> {
  await page.goto('/settings#notifications');
  await expect(page.getByRole('heading', { name: 'Runtime Control Center' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('push-devices-section')).toBeVisible();
}

test.describe('Settings — Push Devices section', () => {
  test('renders the list from the mocked GET and requests userId=local', async ({ page }) => {
    const state: MockState = {
      devices: [
        makeDevice({ id: 'dev-alpha', appId: 'com.agentctl.ios.alpha' }),
        makeDevice({ id: 'dev-beta', appId: 'com.agentctl.ios.beta' }),
      ],
      deactivateCalls: [],
      listCalls: [],
      deactivateStatus: 200,
    };
    await mountApiMocks(page, state);

    await openPushDevicesSection(page);

    const section = page.getByTestId('push-devices-section');
    await expect(section.getByTestId('push-device-row-dev-alpha')).toBeVisible();
    await expect(section.getByTestId('push-device-row-dev-beta')).toBeVisible();

    await expect(section.getByTestId('push-device-row-dev-alpha')).toContainText(
      'com.agentctl.ios.alpha',
    );
    await expect(section.getByTestId('push-device-row-dev-beta')).toContainText(
      'com.agentctl.ios.beta',
    );

    // GET must include userId=local (matches NotificationPreferencesPanel sentinel).
    expect(state.listCalls.length).toBeGreaterThan(0);
    expect(state.listCalls[0]).toContain('userId=local');
  });

  test('shows the empty state when no active devices are registered', async ({ page }) => {
    const state: MockState = {
      devices: [],
      deactivateCalls: [],
      listCalls: [],
      deactivateStatus: 200,
    };
    await mountApiMocks(page, state);

    await openPushDevicesSection(page);

    const empty = page.getByTestId('push-devices-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No devices registered.');

    // Should not render any device rows.
    await expect(page.locator('[data-testid^="push-device-row-"]')).toHaveCount(0);
  });

  test('revoking a device requires confirm() and POSTs the deactivate endpoint with the correct id', async ({
    page,
  }) => {
    const state: MockState = {
      devices: [makeDevice({ id: 'dev-revoke-me' })],
      deactivateCalls: [],
      listCalls: [],
      deactivateStatus: 200,
    };
    await mountApiMocks(page, state);

    // First, cancel the confirm dialog — no POST should fire.
    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toMatch(/Revoke this iOS device/i);
      await dialog.dismiss();
    });

    await openPushDevicesSection(page);
    await page.getByTestId('push-device-revoke-dev-revoke-me').click();

    // Brief wait — if a POST were fired it would appear here.
    await page.waitForTimeout(200);
    expect(state.deactivateCalls).toEqual([]);

    // Now accept the confirm — the POST must fire with the correct id.
    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });

    const deactivateRequest = page.waitForRequest(
      (r) =>
        r.method() === 'POST' &&
        new URL(r.url()).pathname === '/api/mobile-push-devices/dev-revoke-me/deactivate',
    );
    await page.getByTestId('push-device-revoke-dev-revoke-me').click();
    await deactivateRequest;

    expect(state.deactivateCalls).toEqual([{ id: 'dev-revoke-me' }]);

    // After refetch the row should disappear (server now reports disabledAt).
    await expect(page.getByTestId('push-device-row-dev-revoke-me')).toBeHidden();
    await expect(page.getByTestId('push-devices-empty')).toBeVisible();
  });

  test('surfaces a revoke failure via an inline error alert', async ({ page }) => {
    const state: MockState = {
      devices: [makeDevice({ id: 'dev-fail' })],
      deactivateCalls: [],
      listCalls: [],
      deactivateStatus: 500,
    };
    await mountApiMocks(page, state);

    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await openPushDevicesSection(page);

    const deactivateRequest = page.waitForRequest(
      (r) =>
        r.method() === 'POST' &&
        new URL(r.url()).pathname === '/api/mobile-push-devices/dev-fail/deactivate',
    );
    await page.getByTestId('push-device-revoke-dev-fail').click();
    await deactivateRequest;

    await expect(page.getByTestId('push-devices-revoke-error')).toBeVisible();
    expect(state.deactivateCalls).toEqual([{ id: 'dev-fail' }]);

    // The row remains because the server refused the revoke.
    await expect(page.getByTestId('push-device-row-dev-fail')).toBeVisible();
  });
});
