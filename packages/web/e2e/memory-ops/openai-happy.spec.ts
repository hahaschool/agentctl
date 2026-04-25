import type { EmbeddingProvider, MemoryOpsJob } from '@agentctl/shared';
import { expect, type Page, type Route, test } from '@playwright/test';

const NOW = '2026-04-25T00:00:00.000Z';

type MockState = {
  providers: EmbeddingProvider[];
  jobs: MemoryOpsJob[];
  providerCreateBodies: unknown[];
  jobCreateBodies: unknown[];
};

function makeProvider(overrides: Partial<EmbeddingProvider> = {}): EmbeddingProvider {
  return {
    id: 'provider-openai',
    name: 'OpenAI memory',
    provider: 'openai',
    model: 'text-embedding-3-small',
    apiKeyLast4: 'mock',
    isActive: true,
    metadata: {
      lastTestOk: true,
      lastTestError: null,
      lastTestedAt: NOW,
      dim: 1536,
      latencyMs: 42,
      costUsd: 0.0001,
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeJob(overrides: Partial<MemoryOpsJob> = {}): MemoryOpsJob {
  return {
    id: 'job-openai-1',
    kind: 'embedding-backfill',
    status: 'completed',
    params: {},
    progress: {
      processed: 12,
      embedded: 12,
      failed: 0,
      total: 12,
      costUsd: 0.0002,
      usageEstimated: false,
    },
    result: { processed: 12, embedded: 12, failed: 0 },
    error: null,
    errorCode: null,
    credentialId: 'provider-openai',
    providerKind: 'openai',
    providerModel: 'text-embedding-3-small',
    providerHost: 'https://api.openai.com',
    priceUsdPerMtoken: '0.02',
    originMachineId: 'dev-1',
    executorMachineId: 'dev-1',
    cancelRequestedAt: null,
    startedAt: NOW,
    finishedAt: NOW,
    createdAt: NOW,
    egressConfirmedAt: NOW,
    egressConfirmedBy: 'web',
    egressSnapshot: null,
    ...overrides,
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockApis(page: Page, state: MockState): Promise<void> {
  await page.route('**/health?**', (route) =>
    fulfillJson(route, { ok: true, status: 'healthy', dependencies: {} }),
  );

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const { pathname } = url;

    if (method === 'GET' && pathname === '/api/memory/providers') {
      await fulfillJson(route, { providers: state.providers });
      return;
    }
    if (method === 'POST' && pathname === '/api/memory/providers/test-ephemeral') {
      await fulfillJson(route, {
        ok: true,
        dim: 1536,
        model: 'text-embedding-3-small',
        costUsd: 0.0001,
        latencyMs: 42,
        signedToken: 'signed-test-token',
      });
      return;
    }
    if (method === 'POST' && pathname === '/api/memory/providers') {
      state.providerCreateBodies.push(request.postDataJSON());
      const provider = makeProvider({ name: 'E2E OpenAI memory' });
      state.providers = [provider];
      await fulfillJson(route, { ok: true, provider });
      return;
    }
    if (method === 'GET' && pathname === '/api/memory/ops/capabilities') {
      await fulfillJson(route, {
        enabled: true,
        enabledKinds: ['embedding-backfill', 'drawer-backfill', 'consolidation', 'synthesis'],
        machineId: 'dev-1',
        queueAvailable: true,
        activeProvider: state.providers[0]
          ? {
              id: state.providers[0].id,
              provider: state.providers[0].provider,
              model: state.providers[0].model,
              credentialLast4: state.providers[0].apiKeyLast4,
              lastTestOk: state.providers[0].metadata.lastTestOk,
            }
          : null,
        activeProviderLastTestOk: state.providers[0]?.metadata.lastTestOk ?? null,
        activeJobs: [],
      });
      return;
    }
    if (method === 'GET' && pathname === '/api/memory/ops/jobs') {
      await fulfillJson(route, { jobs: state.jobs, limit: 50, offset: 0 });
      return;
    }
    if (method === 'GET' && pathname.startsWith('/api/memory/ops/jobs/')) {
      const jobId = pathname.split('/').at(-1);
      const job = state.jobs.find((entry) => entry.id === jobId);
      await fulfillJson(route, job ? { job } : { error: 'not found' }, job ? 200 : 404);
      return;
    }
    if (method === 'POST' && pathname === '/api/memory/ops/jobs/preview') {
      await fulfillJson(route, {
        ok: true,
        egressToken: 'egress-token-openai',
        snapshot: {
          kind: 'embedding-backfill',
          providerKind: 'openai',
          providerModel: 'text-embedding-3-small',
          providerHost: 'https://api.openai.com',
          priceUsdPerMtoken: 0.02,
          rowCount: 12,
          tokenEstimate: 240,
          costEstimate: 0.0002,
          contentClass: 'memory-facts',
          computedAt: NOW,
        },
      });
      return;
    }
    if (method === 'POST' && pathname === '/api/memory/ops/jobs') {
      state.jobCreateBodies.push(request.postDataJSON());
      const job = makeJob();
      state.jobs = [job];
      await fulfillJson(route, { ok: true, job });
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
      await fulfillJson(route, {});
      return;
    }
    if (method === 'GET' && pathname === '/api/runtime-config/drift') {
      await fulfillJson(route, { activeVersion: 1, activeHash: 'sha256:mock', items: [] });
      return;
    }
    if (method === 'GET' && pathname === '/api/notifications/preferences/local') {
      await fulfillJson(route, { preferences: [] });
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

test.describe('Memory operations OpenAI mocked journey', () => {
  test('adds a tested provider, previews egress, confirms, and sees a completed job', async ({
    page,
  }) => {
    const state: MockState = { providers: [], jobs: [], providerCreateBodies: [], jobCreateBodies: [] };
    await mockApis(page, state);

    await page.goto('/settings#memory-embeddings');
    await expect(page.getByRole('heading', { name: 'Runtime Control Center' })).toBeVisible({
      timeout: 20_000,
    });
    const embeddingsSection = page.locator('section#memory-embeddings');
    await expect(embeddingsSection.getByText('Embedding Providers')).toBeVisible();

    await embeddingsSection.getByRole('button', { name: 'Add provider' }).click();
    await page.getByLabel('Name').fill('E2E OpenAI memory');
    await page.getByLabel('API key').fill('sk-test-openai');
    await page.getByRole('button', { name: 'Test credential' }).click();
    await expect(page.getByText(/Test passed: dim 1536/)).toBeVisible();
    await page.getByRole('button', { name: 'Save provider' }).click();
    await expect(embeddingsSection.getByText('E2E OpenAI memory')).toBeVisible();
    expect(state.providerCreateBodies).toHaveLength(1);

    await page.goto('/memory/operations');
    await expect(page.getByRole('heading', { name: 'Memory Operations' })).toBeVisible({
      timeout: 20_000,
    });
    const embeddingRunButton = page.getByRole('button', { name: 'Run now' }).first();
    await expect(embeddingRunButton).toBeEnabled();
    await embeddingRunButton.click();
    await expect(page.getByRole('alertdialog', { name: 'Confirm data egress' })).toBeVisible();
    await expect(page.getByText('https://api.openai.com')).toBeVisible();
    await page.getByLabel('I confirm this outbound request is expected for this job.').check();
    await page.getByRole('button', { name: 'Confirm and run' }).click();

    const jobDialog = page.getByRole('dialog', { name: 'Memory Job job-openai-1' });
    await expect(jobDialog).toBeVisible();
    await expect(jobDialog.getByText('Completed · embedding-backfill')).toBeVisible();
    await jobDialog.getByRole('button', { name: 'Close' }).click();

    await expect(page.getByRole('heading', { name: 'Recent Jobs' })).toBeVisible();
    await expect(page.getByText('Embedding Backfill').last()).toBeVisible();
    await expect(page.getByText('completed').first()).toBeVisible();
    expect(state.jobCreateBodies).toEqual([
      {
        kind: 'embedding-backfill',
        params: {},
        egressToken: 'egress-token-openai',
        egressConfirmedBy: 'web',
      },
    ]);
  });
});
