import { expect, type Page, test } from '@playwright/test';

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

test.describe('Settings control center', () => {
  test('renders the runtime settings shell and all top-level sections', async ({ page }) => {
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
    await openSettings(page);

    for (const section of ['workers-sync', 'notifications'] as const) {
      await getSectionNavLink(page, section).click();
      await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#${section}`);
      await expectSectionInMainViewport(page, section);
    }
  });

  test('theme buttons update the app theme without backend mutations', async ({ page }) => {
    await openSettings(page);

    await getSectionNavLink(page, 'appearance-preferences').click();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(
      '#appearance-preferences',
    );

    const appearanceSection = page.locator('section#appearance-preferences');
    const lightButton = appearanceSection.getByRole('button', { name: 'Light', exact: true });
    const darkButton = appearanceSection.getByRole('button', { name: 'Dark', exact: true });

    await expect(lightButton).toBeVisible();
    await expect(darkButton).toBeVisible();

    await lightButton.click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('theme'))).toBe(
      'light',
    );

    await darkButton.click();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('theme'))).toBe(
      'dark',
    );
  });
});
