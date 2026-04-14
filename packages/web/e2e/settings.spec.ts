import { expect, type Page, type Route, test } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

const SETTINGS_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'runtime-profiles', label: 'Runtime Profiles' },
  { id: 'credentials-access', label: 'Credentials & Access' },
  { id: 'workers-sync', label: 'Workers & Sync' },
  { id: 'routing-autonomy', label: 'Routing & Autonomy' },
  { id: 'appearance-preferences', label: 'Appearance & Preferences' },
  { id: 'notifications', label: 'Notifications' },
] as const;

type NotificationChannel =
  | 'push'
  | 'webhook-slack'
  | 'webhook-discord'
  | 'webhook-generic'
  | 'in-app';

type NotificationPriority = 'critical' | 'high' | 'normal' | 'low';

type NotificationPreference = {
  id: string;
  userId: string;
  priority: NotificationPriority;
  channels: NotificationChannel[];
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone?: string;
  createdAt: string;
  updatedAt: string;
};

type PreferenceBody = {
  userId: string;
  priority: NotificationPriority;
  channels: NotificationChannel[];
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone?: string;
};

type NotificationPreferenceMockState = {
  preferences: NotificationPreference[];
  setCalls: PreferenceBody[];
  deleteCalls: string[];
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function openSettings(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Runtime Control Center' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
}

async function expectSectionInMainViewport(page: Page, sectionId: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((id) => {
          const section = document.getElementById(id);
          const main = document.getElementById('main-content');
          if (!section || !main) return false;

          const sectionRect = section.getBoundingClientRect();
          const mainRect = main.getBoundingClientRect();

          return sectionRect.top >= mainRect.top && sectionRect.top < mainRect.bottom;
        }, sectionId),
      { message: `Expected #${sectionId} to be visible inside the main scroll container` },
    )
    .toBe(true);
}

function getSectionNavLink(page: Page, sectionId: string) {
  return page
    .getByRole('navigation', { name: 'Settings sections' })
    .locator(`a[href="#${sectionId}"]`);
}

function makePreferenceState(
  preferences: NotificationPreference[] = [],
): NotificationPreferenceMockState {
  return {
    preferences,
    setCalls: [],
    deleteCalls: [],
  };
}

async function mockSettingsApis(
  page: Page,
  state: NotificationPreferenceMockState,
): Promise<void> {
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

    if (method === 'GET' && pathname === '/api/notifications/preferences/local') {
      await fulfillJson(route, { preferences: state.preferences });
      return;
    }

    if (method === 'POST' && pathname === '/api/notifications/preferences') {
      const body = (request.postDataJSON() ?? {}) as PreferenceBody;
      state.setCalls.push(body);
      const preference: NotificationPreference = {
        id: 'pref-new',
        userId: body.userId,
        priority: body.priority,
        channels: body.channels,
        quietHoursStart: body.quietHoursStart,
        quietHoursEnd: body.quietHoursEnd,
        timezone: body.timezone,
        createdAt: '2026-04-14T06:00:00.000Z',
        updatedAt: '2026-04-14T06:00:00.000Z',
      };
      state.preferences = [preference];
      await fulfillJson(route, { ok: true, preference });
      return;
    }

    const deleteMatch = pathname.match(/^\/api\/notifications\/preferences\/([^/]+)$/);
    if (method === 'DELETE' && deleteMatch) {
      const id = decodeURIComponent(deleteMatch[1] ?? '');
      state.deleteCalls.push(id);
      state.preferences = state.preferences.filter((preference) => preference.id !== id);
      await fulfillJson(route, { ok: true, deletedId: id });
      return;
    }

    if (method === 'GET' && pathname === '/api/permission-requests') {
      await fulfillJson(route, []);
      return;
    }
    if (method === 'GET' && pathname === '/api/sync/conflicts/count') {
      await fulfillJson(route, { count: 0 });
      return;
    }
    if (method === 'GET' && pathname === '/api/runtime-config/defaults') {
      await fulfillJson(route, { profiles: [] });
      return;
    }
    if (method === 'GET' && pathname === '/api/runtime-config/drift') {
      await fulfillJson(route, { items: [] });
      return;
    }
    if (method === 'GET' && pathname === '/api/settings/accounts') {
      await fulfillJson(route, []);
      return;
    }
    if (method === 'GET' && pathname === '/api/settings/project-accounts') {
      await fulfillJson(route, []);
      return;
    }
    if (method === 'GET' && pathname === '/api/settings/defaults') {
      await fulfillJson(route, {});
      return;
    }
    if (method === 'GET' && pathname === '/api/agents') {
      await fulfillJson(route, []);
      return;
    }

    await fulfillJson(route, method === 'GET' ? [] : {});
  });
}

test.describe('Settings control center', () => {
  test('renders the runtime settings shell and all top-level sections', async ({ page }) => {
    await mockSettingsApis(page, makePreferenceState());

    await openSettings(page);

    for (const section of SETTINGS_SECTIONS) {
      const navLink = getSectionNavLink(page, section.id);
      await expect(navLink).toHaveAttribute('href', `#${section.id}`);
      await expect(navLink).toContainText(section.label);
      await expect(
        page.locator(`section#${section.id}`).getByRole('heading', {
          name: section.label,
          exact: true,
        }),
      ).toBeVisible();
    }
  });

  test('side navigation links update the hash and jump to the requested section', async ({
    page,
  }) => {
    await mockSettingsApis(page, makePreferenceState());

    await openSettings(page);

    for (const section of ['workers-sync', 'notifications'] as const) {
      await getSectionNavLink(page, section).click();
      await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#${section}`);
      await expectSectionInMainViewport(page, section);
    }
  });

  test('theme buttons update the app theme without backend mutations', async ({ page }) => {
    await mockSettingsApis(page, makePreferenceState());

    await openSettings(page);

    await getSectionNavLink(page, 'appearance-preferences').click();
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toBe('#appearance-preferences');

    const appearanceSection = page.locator('section#appearance-preferences');
    const lightButton = appearanceSection.getByRole('button', { name: 'Light', exact: true });
    const darkButton = appearanceSection.getByRole('button', { name: 'Dark', exact: true });

    await expect(lightButton).toBeVisible();
    await expect(darkButton).toBeVisible();

    await lightButton.click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem('theme')))
      .toBe('light');

    await darkButton.click();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('theme'))).toBe('dark');
  });

  test('adds and removes notification preferences without a backend', async ({ page }) => {
    const state = makePreferenceState();
    await mockSettingsApis(page, state);

    await openSettings(page);
    await getSectionNavLink(page, 'notifications').click();

    const notificationsSection = page.locator('section#notifications');
    await expect(
      notificationsSection.getByText('No preferences configured. Add one to start receiving notifications.'),
    ).toBeVisible();

    await notificationsSection.getByRole('button', { name: '+ Add' }).click();
    await notificationsSection.getByRole('button', { name: 'In-app' }).click();
    await notificationsSection.getByRole('button', { name: 'Add preference' }).click();
    await expect(
      notificationsSection.getByText('Select at least one notification channel.'),
    ).toBeVisible();

    await notificationsSection.getByRole('button', { name: 'Push notifications' }).click();
    await notificationsSection.getByRole('button', { name: 'Slack webhook' }).click();
    await notificationsSection.getByLabel('Quiet hours start').fill('22:00');
    await notificationsSection.getByLabel('Quiet hours end').fill('08:00');
    await notificationsSection.getByLabel('Timezone').fill('America/New_York');

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/notifications/preferences') &&
          response.request().method() === 'POST',
      ),
      notificationsSection.getByRole('button', { name: 'Add preference' }).click(),
    ]);

    await expect(notificationsSection.getByText('Normal', { exact: true })).toBeVisible();
    await expect(notificationsSection.getByText('Push notifications', { exact: true })).toBeVisible();
    await expect(notificationsSection.getByText('Slack webhook', { exact: true })).toBeVisible();
    await expect(notificationsSection.getByText('22:00')).toBeVisible();
    await expect(notificationsSection.getByText('08:00')).toBeVisible();
    await expect(notificationsSection.getByText('(America/New_York)')).toBeVisible();
    expect(state.setCalls).toEqual([
      {
        userId: 'local',
        priority: 'normal',
        channels: ['push', 'webhook-slack'],
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
        timezone: 'America/New_York',
      },
    ]);

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/notifications/preferences/pref-new') &&
          response.request().method() === 'DELETE',
      ),
      notificationsSection.getByRole('button', { name: 'Remove preference' }).click(),
    ]);

    expect(state.deleteCalls).toEqual(['pref-new']);
    await expect(
      notificationsSection.getByText('No preferences configured. Add one to start receiving notifications.'),
    ).toBeVisible();
  });
});
