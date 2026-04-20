import { expect, test } from '@playwright/test';

import {
  getTwoNodeMeshFixtureConfig,
  pingPeerAndWaitForVersion,
  skipReasonForTwoNodeMeshFixture,
} from './fixtures/two-node-mesh';

const fixture = getTwoNodeMeshFixtureConfig();

test.describe('two-node mesh fixture (live, opt-in)', () => {
  test.skip(!fixture.enabled, skipReasonForTwoNodeMeshFixture(fixture));

  test('surfaces peer version drift after one live peer ping', async ({ page, request }) => {
    if (!fixture.enabled) {
      throw new Error(skipReasonForTwoNodeMeshFixture(fixture));
    }

    await page.goto(fixture.primaryWebUrl('/mesh-peers'));

    const beforeRow = page.getByRole('row').filter({ hasText: fixture.peerMachineId });
    await expect(beforeRow).toBeVisible();

    const peer = await pingPeerAndWaitForVersion(request, fixture);
    expect(peer.peerVersion).toBe(fixture.expectedPeerVersion);

    await page.reload();

    const afterRow = page.getByRole('row').filter({ hasText: fixture.peerMachineId });
    await expect(afterRow).toContainText(fixture.expectedPeerVersion);

    const banner = page.getByTestId('mesh-version-update-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(fixture.expectedPeerVersion);
  });
});
