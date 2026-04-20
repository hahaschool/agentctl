import { expect, test } from '@playwright/test';

import {
  getTwoNodeMeshFixtureConfig,
  pingPeerAndWaitForVersion,
  runPeerUpdateDryRunAndReadPlan,
  skipReasonForTwoNodeMeshDryRun,
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

  test('streams peer-update dry-run planned steps without applying an update', async ({
    request,
  }) => {
    test.skip(
      !fixture.enabled || !fixture.dryRunEnabled,
      skipReasonForTwoNodeMeshDryRun(fixture),
    );
    if (!fixture.enabled || !fixture.dryRunEnabled) {
      throw new Error(skipReasonForTwoNodeMeshDryRun(fixture));
    }

    const { events, result } = await runPeerUpdateDryRunAndReadPlan(request, fixture);

    const start = events.find((event) => event.type === 'start');
    expect(start).toMatchObject({
      type: 'start',
      command: 'pnpm agentctl peer update --dry-run',
    });

    const done = [...events].reverse().find((event) => event.type === 'done');
    expect(done).toMatchObject({ type: 'done', exitCode: 0 });
    expect(events.some((event) => event.type === 'stdout')).toBe(true);

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.steps?.length ?? 0).toBeGreaterThan(0);
    expect(result.steps?.every((step) => step.dryRun === true && step.ok === true)).toBe(
      true,
    );
    expect(result.steps?.map((step) => step.name)).toEqual(
      expect.arrayContaining([
        'Resolve target tag',
        'Verify attestation',
        'Checkout tag',
        'pm2 reload mesh ecosystem',
        'Poll /health appVersion',
      ]),
    );
  });
});
