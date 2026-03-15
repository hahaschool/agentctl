import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';

type ManagedRuntime = 'claude-code' | 'codex';

type MachineRecord = {
  id: string;
  hostname: string;
  status: string;
};

type RuntimeConfigDriftResponse = {
  items: Array<{
    machineId: string;
    runtime: ManagedRuntime;
    isInstalled: boolean;
    isAuthenticated: boolean;
  }>;
};

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function listMachines(request: APIRequestContext): Promise<MachineRecord[]> {
  const res = await request.get('/api/agents');
  expect(res.ok()).toBeTruthy();
  const machines = (await res.json()) as MachineRecord[];
  expect(Array.isArray(machines)).toBeTruthy();
  expect(machines.length).toBeGreaterThan(0);
  return machines;
}

async function getRuntimeCompatibleMachine(
  request: APIRequestContext,
  runtime: ManagedRuntime,
): Promise<MachineRecord> {
  const machines = await listMachines(request);
  const [firstMachine] = machines;
  if (!firstMachine) {
    throw new Error('Expected at least one machine');
  }

  const driftRes = await request.get('/api/runtime-config/drift');
  if (!driftRes.ok()) {
    return machines.find((m) => m.status === 'online') ?? firstMachine;
  }

  const drift = (await driftRes.json()) as RuntimeConfigDriftResponse;
  const compatibleIds = new Set(
    drift.items
      .filter((item) => item.runtime === runtime && item.isInstalled)
      .map((item) => item.machineId),
  );

  return (
    machines.find((m) => m.status === 'online' && compatibleIds.has(m.id)) ??
    machines.find((m) => compatibleIds.has(m.id)) ??
    machines.find((m) => m.status === 'online') ??
    firstMachine
  );
}

async function createAgentViaApi(
  request: APIRequestContext,
  machineId: string,
  runtime: ManagedRuntime,
  name: string,
): Promise<string> {
  const response = await request.post('/api/agents', {
    data: {
      machineId,
      name,
      type: 'adhoc',
      runtime,
      projectPath: '/tmp/agentctl-e2e-runtime-selector',
      config: {
        initialPrompt: 'Runtime selector E2E setup',
      },
    },
  });

  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { agentId: string };
  expect(body.agentId).toBeTruthy();
  return body.agentId;
}

async function deleteAgentQuietly(request: APIRequestContext, agentId: string): Promise<void> {
  try {
    await request.delete(`/api/agents/${agentId}`);
  } catch {
    // Best-effort cleanup for E2E data.
  }
}

async function deleteSessionQuietly(request: APIRequestContext, sessionId: string): Promise<void> {
  try {
    await request.delete(`/api/sessions/${sessionId}`);
  } catch {
    // Best-effort cleanup for E2E data.
  }
}

async function selectOptionFromAnyCombobox(
  scope: Locator,
  page: Page,
  optionName: string,
): Promise<void> {
  const comboboxes = scope.getByRole('combobox');
  const comboboxCount = await comboboxes.count();

  for (let i = 0; i < comboboxCount; i++) {
    const combo = comboboxes.nth(i);
    await combo.click();

    const option = page.getByRole('option', { name: optionName }).first();
    const optionVisible = await option.isVisible().catch(() => false);
    if (optionVisible) {
      await option.click();
      return;
    }

    await page.keyboard.press('Escape');
  }

  throw new Error(`Could not find option "${optionName}" in any combobox`);
}

test.describe('Runtime Selector', () => {
  test('create agent with codex runtime', async ({ page }) => {
    let agentId: string | null = null;

    try {
      await page.goto('/agents');
      await expect(page.getByRole('heading', { name: /agents/i })).toBeVisible({ timeout: 15_000 });

      await page.getByRole('button', { name: /new agent/i }).click();
      const dialog = page.getByRole('dialog', { name: /new agent/i });
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      await dialog
        .locator('textarea[aria-label="Agent prompt"]')
        .fill('Run codex runtime selector E2E test');
      await dialog.locator('#create-agent-project').fill('/tmp/agentctl-e2e-create-agent-codex');

      await dialog.getByRole('button', { name: /advanced/i }).click();
      const codexRadio = dialog.getByRole('radio', { name: 'Codex' });
      await codexRadio.click();
      await expect(codexRadio).toHaveAttribute('aria-checked', 'true');

      await selectOptionFromAnyCombobox(dialog, page, 'GPT-5 Codex');

      const createResponsePromise = page.waitForResponse(
        (res) => res.request().method() === 'POST' && res.url().includes('/api/agents'),
      );

      await dialog.getByRole('button', { name: 'Start Agent' }).click();

      const createResponse = await createResponsePromise;
      expect(createResponse.ok()).toBeTruthy();
      const createBody = (await createResponse.json()) as { agentId: string };
      expect(createBody.agentId).toBeTruthy();
      agentId = createBody.agentId;

      await expect(dialog).toBeHidden({ timeout: 10_000 });

      const getAgentResponse = await page.request.get(`/api/agents/${agentId}`);
      expect(getAgentResponse.ok()).toBeTruthy();
      const agent = (await getAgentResponse.json()) as { runtime?: string };
      expect(agent.runtime).toBe('codex');
    } finally {
      if (agentId) {
        await deleteAgentQuietly(page.request, agentId);
      }
    }
  });

  test('create session with codex runtime', async ({ page }) => {
    let sessionId: string | null = null;

    try {
      const codexMachine = await getRuntimeCompatibleMachine(page.request, 'codex');

      await page.goto('/sessions');
      await expect(
        page
          .locator('h1, h2')
          .filter({ hasText: /sessions/i })
          .first(),
      ).toBeVisible({
        timeout: 15_000,
      });

      const showCreateFormButton = page.getByRole('button', { name: /create new session/i });
      await showCreateFormButton.click();

      const createForm = page.locator('div').filter({ hasText: 'Create New Session' }).first();
      await expect(createForm.getByText('Create New Session')).toBeVisible({ timeout: 10_000 });

      const codexRadio = createForm.getByRole('radio', { name: 'Codex' });
      await codexRadio.click();
      await expect(codexRadio).toHaveAttribute('aria-checked', 'true');

      await selectOptionFromAnyCombobox(createForm, page, codexMachine.hostname);
      await selectOptionFromAnyCombobox(createForm, page, 'GPT-5 Codex');

      await createForm
        .locator('#create-session-project')
        .fill('/tmp/agentctl-e2e-create-session-codex');
      await createForm
        .locator('#create-session-prompt')
        .fill('Runtime selector E2E create session flow');

      const submitButton = createForm.getByRole('button', { name: 'Create Session' });
      await expect(submitButton).toBeEnabled({ timeout: 10_000 });

      const createRequestPromise = page.waitForRequest(
        (req) => req.method() === 'POST' && req.url().includes('/api/sessions'),
      );
      const createResponsePromise = page.waitForResponse(
        (res) => res.request().method() === 'POST' && res.url().includes('/api/sessions'),
      );

      await submitButton.click();

      const createRequest = await createRequestPromise;
      const createPayload = createRequest.postDataJSON() as { runtime?: string };
      expect(createPayload.runtime).toBe('codex');

      const createResponse = await createResponsePromise;
      expect(createResponse.ok()).toBeTruthy();
      const createBody = (await createResponse.json()) as { sessionId: string };
      expect(createBody.sessionId).toBeTruthy();
      sessionId = createBody.sessionId;
    } finally {
      if (sessionId) {
        await deleteSessionQuietly(page.request, sessionId);
      }
    }
  });

  test('discover page shows runtime badges', async ({ page }) => {
    await page.goto('/discover');
    await expect(page.getByRole('heading', { name: /discover sessions/i })).toBeVisible({
      timeout: 15_000,
    });

    const runtimeFilter = page
      .locator('select')
      .filter({ has: page.locator('option[value="claude-code"]') })
      .first();
    await expect(runtimeFilter).toBeVisible({ timeout: 10_000 });

    const discoverResponse = await page.request.get('/api/sessions/discover');
    expect(discoverResponse.ok()).toBeTruthy();

    const discoverBody = (await discoverResponse.json()) as {
      count: number;
      sessions: Array<{ runtime?: string }>;
    };

    if (discoverBody.count === 0) {
      await expect(page.getByText('No sessions discovered')).toBeVisible({ timeout: 10_000 });
      return;
    }

    const counts = {
      'claude-code': discoverBody.sessions.filter((session) => session.runtime === 'claude-code')
        .length,
      codex: discoverBody.sessions.filter((session) => session.runtime === 'codex').length,
      unknown: discoverBody.sessions.filter((session) => session.runtime == null).length,
    };

    const targetRuntime: 'claude-code' | 'codex' | 'unknown' =
      counts.codex > 0 ? 'codex' : counts['claude-code'] > 0 ? 'claude-code' : 'unknown';

    await runtimeFilter.selectOption(targetRuntime);

    const expectedFilteredCount = counts[targetRuntime];
    await expect(page.locator('input[aria-label^="Select session"]')).toHaveCount(
      expectedFilteredCount,
    );

    const expectedBadge =
      targetRuntime === 'codex'
        ? /^Codex$/
        : targetRuntime === 'claude-code'
          ? /^Claude$/
          : /^Unknown$/;

    await expect(page.locator('span').filter({ hasText: expectedBadge }).first()).toBeVisible();
  });

  test('agent settings runtime change shows confirmation', async ({ page }) => {
    let agentId: string | null = null;

    const observedSkillRuntimeRequests = new Set<string>();
    page.on('request', (request) => {
      if (request.method() !== 'GET' || !request.url().includes('/api/skills/discover')) return;
      const runtime = new URL(request.url()).searchParams.get('runtime');
      if (runtime) observedSkillRuntimeRequests.add(runtime);
    });

    try {
      const claudeMachine = await getRuntimeCompatibleMachine(page.request, 'claude-code');
      const agentName = uniqueName('pw-runtime-switch');

      agentId = await createAgentViaApi(page.request, claudeMachine.id, 'claude-code', agentName);

      await page.goto(`/agents/${agentId}/settings`);
      await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole('tab', { name: 'Skills' }).click();
      const skillsPanel = page
        .locator('div')
        .filter({ hasText: 'Skills discovered from machine config' })
        .first();
      await expect(skillsPanel).toBeVisible({ timeout: 10_000 });
      await skillsPanel.getByRole('button', { name: /^Skills/ }).click();

      await expect.poll(() => observedSkillRuntimeRequests.has('claude-code')).toBeTruthy();

      await page.getByRole('tab', { name: 'General' }).click();
      await selectOptionFromAnyCombobox(page.locator('body'), page, 'Codex');

      const saveButton = page.getByRole('button', { name: 'Save' }).first();
      await expect(saveButton).toBeEnabled({ timeout: 10_000 });
      await saveButton.click();

      await expect(
        page.getByRole('alert').filter({
          hasText: 'General settings saved. MCP/skill overrides cleared due to runtime change.',
        }),
      ).toBeVisible({ timeout: 10_000 });

      await page.getByRole('tab', { name: 'Skills' }).click();
      await skillsPanel.getByRole('button', { name: /^Skills/ }).click();

      await expect.poll(() => observedSkillRuntimeRequests.has('codex')).toBeTruthy();

      const getAgentResponse = await page.request.get(`/api/agents/${agentId}`);
      expect(getAgentResponse.ok()).toBeTruthy();
      const updatedAgent = (await getAgentResponse.json()) as {
        runtime?: string;
        config?: {
          mcpOverride?: unknown;
          skillOverride?: unknown;
        };
      };

      expect(updatedAgent.runtime).toBe('codex');
      expect(updatedAgent.config?.mcpOverride ?? null).toBeNull();
      expect(updatedAgent.config?.skillOverride ?? null).toBeNull();
    } finally {
      if (agentId) {
        await deleteAgentQuietly(page.request, agentId);
      }
    }
  });

  test('machine detail shows available runtimes', async ({ page }) => {
    const machine = await getRuntimeCompatibleMachine(page.request, 'claude-code');

    const driftResponse = await page.request.get(
      `/api/runtime-config/drift?machineId=${encodeURIComponent(machine.id)}`,
    );
    expect(driftResponse.ok()).toBeTruthy();
    const driftBody = (await driftResponse.json()) as RuntimeConfigDriftResponse;

    await page.goto(`/machines/${machine.id}`);
    await expect(page.getByRole('heading', { name: machine.hostname })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Available Runtimes')).toBeVisible({ timeout: 10_000 });

    if (driftBody.items.length === 0) {
      await expect(page.getByText('No runtime data available.')).toBeVisible();
      return;
    }

    for (const item of driftBody.items) {
      const runtimeLabel = item.runtime === 'claude-code' ? 'Claude Code' : 'Codex';
      await expect(page.getByText(runtimeLabel, { exact: true })).toBeVisible();
    }

    const installedCount = driftBody.items.filter((item) => item.isInstalled).length;
    const notInstalledCount = driftBody.items.filter((item) => !item.isInstalled).length;
    const authenticatedCount = driftBody.items.filter(
      (item) => item.isInstalled && item.isAuthenticated,
    ).length;
    const notAuthenticatedCount = driftBody.items.filter(
      (item) => item.isInstalled && !item.isAuthenticated,
    ).length;

    await expect(page.getByText(/^Installed$/)).toHaveCount(installedCount);
    await expect(page.getByText(/^Not installed$/)).toHaveCount(notInstalledCount);
    await expect(page.getByText(/^Authenticated$/)).toHaveCount(authenticatedCount);
    await expect(page.getByText(/^Not authenticated$/)).toHaveCount(notAuthenticatedCount);
  });
});
