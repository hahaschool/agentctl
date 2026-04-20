import { expect, test, type Page } from '@playwright/test';

import {
  forceSchemaAheadEnvelopeRejectionAndReadPeer,
  getTwoNodeMeshFixtureConfig,
  pingPeerAndWaitForVersion,
  readConfiguredPeer,
  readMeshConfig,
  runPeerUpdateDryRunAndReadPlan,
  skipReasonForTwoNodeMeshAddPeerReverse,
  skipReasonForTwoNodeMeshMachineVisibility,
  skipReasonForTwoNodeMeshOneWayRetry,
  skipReasonForTwoNodeMeshSchemaAhead,
  skipReasonForTwoNodeMeshDryRun,
  skipReasonForTwoNodeMeshFixture,
  waitForAddPeerReverseOnSecondaryNode,
  waitForPrimaryPeerReverseStatus,
  type TwoNodeMeshFixtureConfig,
} from './fixtures/two-node-mesh';

type EnabledTwoNodeMeshFixtureConfig = Extract<TwoNodeMeshFixtureConfig, { enabled: true }>;

const fixture = getTwoNodeMeshFixtureConfig();
const ONE_WAY_RETRY_FIXTURE_ERROR = 'fixture reverse registration retry failed';

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

async function fillIfPresent(page: Page, label: string, value: string | null): Promise<void> {
  if (!value) return;
  await page.getByLabel(label).fill(value);
}

function failedReversePeer<T extends { machineId: string }>(
  peer: T,
): T & {
  reverseRegistrationStatus: 'failed';
  reverseRegistrationError: string;
  reverseRegistrationErrorCode: null;
  reverseRegistrationHttpStatus: 502;
} {
  return {
    ...peer,
    reverseRegistrationStatus: 'failed',
    reverseRegistrationError: ONE_WAY_RETRY_FIXTURE_ERROR,
    reverseRegistrationErrorCode: null,
    reverseRegistrationHttpStatus: 502,
  };
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

  test('adds a peer through the UI and confirms reverse registration on the secondary node', async ({
    page,
    request,
  }) => {
    test.skip(
      !fixture.enabled ||
        !fixture.addPeerReverseEnabled ||
        !fixture.addPeerReverseSecondaryWebUrl ||
        !fixture.addPeerReverseSecondaryApiUrl ||
        fixture.addPeerReverseMissingEnv.length > 0 ||
        fixture.addPeerReverseInvalidEnv.length > 0,
      skipReasonForTwoNodeMeshAddPeerReverse(fixture),
    );
    if (
      !fixture.enabled ||
      !fixture.addPeerReverseEnabled ||
      !fixture.addPeerReverseSecondaryWebUrl ||
      !fixture.addPeerReverseSecondaryApiUrl ||
      fixture.addPeerReverseMissingEnv.length > 0 ||
      fixture.addPeerReverseInvalidEnv.length > 0
    ) {
      throw new Error(skipReasonForTwoNodeMeshAddPeerReverse(fixture));
    }

    const [primaryConfig, secondaryConfig] = await Promise.all([
      readMeshConfig(request, fixture.primaryApiUrl),
      readMeshConfig(request, fixture.addPeerReverseSecondaryApiUrl),
    ]);
    expect(secondaryConfig.machineId).toBe(fixture.peerMachineId);

    await page.goto(fixture.primaryWebUrl('/mesh-peers'));
    await expect(page.getByRole('heading', { name: 'Mesh Peers' })).toBeVisible();
    await page.getByTestId('add-mesh-peer').click();
    await expect(page.getByTestId('mesh-peer-form-dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add mesh peer' })).toBeVisible();

    await page.getByLabel('Machine ID').fill(secondaryConfig.machineId);
    await page.getByLabel('Hostname').fill(secondaryConfig.hostname);
    await page.getByLabel('Sync URL').fill(secondaryConfig.syncUrl);
    await fillIfPresent(page, 'Tailscale IP', secondaryConfig.tailscaleIp);
    await fillIfPresent(page, 'Public key', secondaryConfig.publicKey);

    await page.getByTestId('mesh-peer-probe').click();
    await expect(page.getByTestId('mesh-peer-probe-success')).toContainText('Reachable');
    await expect(page.getByTestId('preflight-status-compatible')).toContainText(
      'Token compatible',
    );

    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/sync/peers'),
    );
    await page.getByTestId('mesh-peer-submit').click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.status()).toBe(201);
    const saveBody = (await saveResponse.json()) as {
      peer?: { reverseRegistrationStatus?: string | null };
    };
    expect(saveBody.peer?.reverseRegistrationStatus).toBe('ok');

    await expect(
      page.getByText(`Peer ${secondaryConfig.machineId} also registered this node in reverse`),
    ).toBeVisible();
    const primaryPeer = await waitForPrimaryPeerReverseStatus(
      request,
      fixture,
      secondaryConfig.machineId,
      'ok',
      fixture.addPeerReverseTimeoutMs,
    );
    expect(primaryPeer.syncUrl).toBe(secondaryConfig.syncUrl);

    const secondaryPeer = await waitForAddPeerReverseOnSecondaryNode(
      request,
      fixture,
      primaryConfig.machineId,
    );
    expect(secondaryPeer.syncUrl).toBe(primaryConfig.syncUrl);

    await page.goto(fixture.addPeerReverseSecondaryWebUrl('/mesh-peers'));
    await expect(page.getByRole('table', { name: 'Mesh sync peers' })).toBeVisible();
    const reverseRow = page.getByTestId(`peer-row-${primaryConfig.machineId}`);
    await expect(reverseRow).toBeVisible();
    await expect(reverseRow).toContainText(primaryConfig.syncUrl);
  });

  test('surfaces one-way reverse-registration warning and retry failure', async ({
    page,
    request,
  }) => {
    test.skip(
      !fixture.enabled ||
        !fixture.oneWayRetryEnabled ||
        fixture.oneWayRetryInvalidEnv.length > 0,
      skipReasonForTwoNodeMeshOneWayRetry(fixture),
    );
    if (
      !fixture.enabled ||
      !fixture.oneWayRetryEnabled ||
      fixture.oneWayRetryInvalidEnv.length > 0
    ) {
      throw new Error(skipReasonForTwoNodeMeshOneWayRetry(fixture));
    }

    const configuredPeer = await readConfiguredPeer(request, fixture);
    if (!configuredPeer) {
      throw new Error(`Peer ${fixture.peerMachineId} is not registered on the primary node`);
    }

    await page.route('**/api/sync/peers', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }

      const response = await route.fetch();
      const body = (await response.json()) as { peers?: Array<typeof configuredPeer> };
      const peers = Array.isArray(body.peers) ? body.peers : [];
      await route.fulfill({
        status: response.status(),
        contentType: 'application/json',
        body: JSON.stringify({
          ...body,
          peers: peers.map((peer) =>
            peer.machineId === fixture.peerMachineId ? failedReversePeer(peer) : peer,
          ),
        }),
      });
    });

    await page.route(
      `**/api/sync/peers/${encodeURIComponent(fixture.peerMachineId)}/register-reverse`,
      async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }

        await route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            error: 'REVERSE_REGISTRATION_FAILED',
            message: ONE_WAY_RETRY_FIXTURE_ERROR,
            peer: failedReversePeer(configuredPeer),
          }),
        });
      },
    );

    await page.goto(fixture.primaryWebUrl('/mesh-peers'));
    const row = page.getByTestId(`peer-row-${fixture.peerMachineId}`);
    await expect(row).toBeVisible();
    const badge = row.getByTestId(`reverse-badge-${fixture.peerMachineId}`);
    const retry = row.getByTestId(`reverse-retry-${fixture.peerMachineId}`);
    await expect(badge).toHaveText('One-way');
    await expect(retry).toHaveText('Retry');

    const retryResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes(
          `/api/sync/peers/${encodeURIComponent(fixture.peerMachineId)}/register-reverse`,
        ),
    );
    await retry.click();
    const retryResponse = await retryResponsePromise;
    expect(retryResponse.status()).toBe(502);
    await expect(
      page.getByText(`Reverse registration failed: ${ONE_WAY_RETRY_FIXTURE_ERROR}`),
    ).toBeVisible();
    await expect(badge).toBeVisible();
    await expect(retry).toHaveText('Retry');
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
