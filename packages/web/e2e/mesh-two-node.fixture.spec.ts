import { expect, test, type Page } from '@playwright/test';

import {
  forceSchemaAheadEnvelopeRejectionAndReadPeer,
  getTwoNodeMeshFixtureConfig,
  pingPeerAndWaitForVersion,
  runPeerUpdateDryRunAndReadPlan,
  skipReasonForTwoNodeMeshMachineVisibility,
  skipReasonForTwoNodeMeshSchemaAhead,
  skipReasonForTwoNodeMeshDryRun,
  skipReasonForTwoNodeMeshFixture,
  type TwoNodeMeshFixtureConfig,
} from './fixtures/two-node-mesh';

type EnabledTwoNodeMeshFixtureConfig = Extract<TwoNodeMeshFixtureConfig, { enabled: true }>;

const fixture = getTwoNodeMeshFixtureConfig();

async function expectSyncedMachineOnSecondaryNode(
  page: Page,
  config: EnabledTwoNodeMeshFixtureConfig,
): Promise<void> {
  if (!config.machineVisibilitySecondaryWebUrl) {
    throw new Error(skipReasonForTwoNodeMeshMachineVisibility(config));
  }

  const deadline = Date.now() + config.machineVisibilityTimeoutMs;
  const provenanceLabel = `Synced from ${config.machineVisibilityOriginLabel}`;

  while (Date.now() <= deadline) {
    await page.goto(config.machineVisibilitySecondaryWebUrl('/machines'));
    await expect(page.getByRole('heading', { name: 'Fleet Machines' })).toBeVisible({
      timeout: 5_000,
    });
    await page
      .getByLabel('Search machines (press / to focus)')
      .fill(config.machineVisibilityMachineHostname);

    const row = page
      .locator('div')
      .filter({
        has: page.getByRole('link', {
          name: config.machineVisibilityMachineHostname,
          exact: true,
        }),
        hasText: provenanceLabel,
      })
      .first();
    const remainingMs = Math.max(1, deadline - Date.now());
    const waitMs = Math.min(config.pollIntervalMs, remainingMs);

    try {
      await row.waitFor({ state: 'visible', timeout: waitMs });
      return;
    } catch {
      await page.waitForTimeout(waitMs);
    }
  }

  throw new Error(
    `Timed out waiting for ${config.machineVisibilityMachineHostname} on secondary ` +
      `node with provenance label "${provenanceLabel}"`,
  );
}

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

  test('surfaces an A-to-B synced machine row on the secondary node', async ({ page }) => {
    test.skip(
      !fixture.enabled ||
        !fixture.machineVisibilityEnabled ||
        !fixture.machineVisibilitySecondaryWebUrl ||
        fixture.machineVisibilityMissingEnv.length > 0 ||
        fixture.machineVisibilityInvalidEnv.length > 0,
      skipReasonForTwoNodeMeshMachineVisibility(fixture),
    );
    if (
      !fixture.enabled ||
      !fixture.machineVisibilityEnabled ||
      !fixture.machineVisibilitySecondaryWebUrl ||
      fixture.machineVisibilityMissingEnv.length > 0 ||
      fixture.machineVisibilityInvalidEnv.length > 0
    ) {
      throw new Error(skipReasonForTwoNodeMeshMachineVisibility(fixture));
    }

    await expectSyncedMachineOnSecondaryNode(page, fixture);
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

  test('forces a schema-ahead envelope rejection and surfaces the 33.10 badge', async ({
    page,
    request,
  }) => {
    test.skip(
      !fixture.enabled || !fixture.schemaAheadEnabled || !fixture.schemaAheadDatabaseUrl,
      skipReasonForTwoNodeMeshSchemaAhead(fixture),
    );
    if (!fixture.enabled || !fixture.schemaAheadEnabled || !fixture.schemaAheadDatabaseUrl) {
      throw new Error(skipReasonForTwoNodeMeshSchemaAhead(fixture));
    }

    const { after, envelopeSchemaVersion } =
      await forceSchemaAheadEnvelopeRejectionAndReadPeer(request, fixture);

    expect(after.lastSchemaAheadVersion).toBe(envelopeSchemaVersion);
    expect(after.schemaAheadCount ?? 0).toBeGreaterThan(0);

    await page.goto(fixture.primaryWebUrl('/mesh-peers'));

    const row = page.getByRole('row').filter({ hasText: fixture.peerMachineId });
    const badge = row.getByTestId(`peer-schema-ahead-badge-${fixture.peerMachineId}`);
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(`schema v${envelopeSchemaVersion}`);
  });
});
