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
  }>;
};

type AgentMcpOverride = {
  excluded?: string[];
  custom?: Array<{ name: string; command: string; args?: string[] }>;
};

type AgentSkillOverride = {
  excluded?: string[];
  custom?: Array<{ id: string; path: string; enabled?: boolean; name?: string }>;
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
  params: {
    machineId: string;
    runtime: ManagedRuntime;
    name: string;
    config?: Record<string, unknown>;
  },
): Promise<string> {
  const response = await request.post('/api/agents', {
    data: {
      machineId: params.machineId,
      name: params.name,
      type: 'adhoc',
      runtime: params.runtime,
      projectPath: '/tmp/agentctl-e2e-mcp-skill',
      ...(params.config ? { config: params.config } : {}),
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

async function selectOptionFromAnyCombobox(
  scope: Locator,
  page: Page,
  optionName: string,
): Promise<void> {
  const comboboxes = scope.getByRole('combobox');
  const count = await comboboxes.count();

  for (let i = 0; i < count; i++) {
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

test.describe('MCP & Skill Discovery', () => {
  test('create agent shows MCP picker with discovered servers', async ({ page }) => {
    let agentId: string | null = null;

    try {
      await page.goto('/agents');
      await expect(page.getByRole('heading', { name: /agents/i })).toBeVisible({ timeout: 15_000 });

      await page.getByRole('button', { name: /new agent/i }).click();
      const dialog = page.getByRole('dialog', { name: /new agent/i });
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      await dialog
        .locator('textarea[aria-label="Agent prompt"]')
        .fill('Validate MCP picker discovery flow');
      await dialog.locator('#create-agent-project').fill('/tmp/agentctl-e2e-mcp-create');

      const mcpPickerToggle = dialog.getByRole('button', { name: /^MCP Servers/ });
      await mcpPickerToggle.click();

      const scanning = dialog.getByText('Scanning for MCP servers...');
      await scanning.isVisible({ timeout: 5_000 }).catch(() => false);

      const serverToggles = dialog.locator('input[aria-label^="Toggle "]');
      await expect
        .poll(async () => await serverToggles.count(), { timeout: 15_000 })
        .toBeGreaterThan(0);

      const firstToggle = serverToggles.first();
      const firstToggleLabel = (await firstToggle.getAttribute('aria-label')) ?? '';
      const excludedServerName = firstToggleLabel.replace(/^Toggle\s+/, '').trim();
      expect(excludedServerName).toBeTruthy();

      await firstToggle.uncheck();
      await expect(dialog.getByText('excluded').first()).toBeVisible({ timeout: 10_000 });

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
      const agent = (await getAgentResponse.json()) as {
        config?: { mcpOverride?: AgentMcpOverride };
      };

      const excluded = agent.config?.mcpOverride?.excluded ?? [];
      expect(excluded).toContain(excludedServerName);

      const customServers = agent.config?.mcpOverride?.custom ?? [];
      expect(customServers).toEqual([]);
    } finally {
      if (agentId) {
        await deleteAgentQuietly(page.request, agentId);
      }
    }
  });

  test('edit agent MCP tab shows McpServerPicker instead of manual form', async ({ page }) => {
    let agentId: string | null = null;

    try {
      const machine = await getRuntimeCompatibleMachine(page.request, 'claude-code');
      agentId = await createAgentViaApi(page.request, {
        machineId: machine.id,
        runtime: 'claude-code',
        name: uniqueName('pw-mcp-settings'),
      });

      await page.goto(`/agents/${agentId}/settings`);
      await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole('tab', { name: 'MCP Servers' }).click();
      const mcpPanel = page
        .locator('div')
        .filter({
          hasText:
            'MCP servers discovered from machine config. Uncheck to exclude, or add custom servers.',
        })
        .first();
      await expect(mcpPanel).toBeVisible({ timeout: 10_000 });

      const mcpPickerToggle = mcpPanel.getByRole('button', { name: /^MCP Servers/ });
      await mcpPickerToggle.click();

      await expect(mcpPanel.getByRole('button', { name: '+ Custom Server' })).toBeVisible({
        timeout: 10_000,
      });
      await expect(mcpPanel.getByRole('button', { name: 'Refresh' })).toBeVisible({
        timeout: 10_000,
      });

      const serverToggles = mcpPanel.locator('input[aria-label^="Toggle "]');
      let excludedServerName: string | null = null;
      const discoveredCount = await serverToggles.count();
      if (discoveredCount > 0) {
        const firstToggle = serverToggles.first();
        if (!(await firstToggle.isDisabled())) {
          const firstToggleLabel = (await firstToggle.getAttribute('aria-label')) ?? '';
          excludedServerName = firstToggleLabel.replace(/^Toggle\s+/, '').trim();
          if (excludedServerName) {
            await firstToggle.uncheck();
          }
        }
      }

      const customServerName = uniqueName('custom-mcp');
      await mcpPanel.getByRole('button', { name: '+ Custom Server' }).click();
      await mcpPanel.locator('#custom-mcp-name').fill(customServerName);
      await mcpPanel.locator('#custom-mcp-cmd').fill('node');
      await mcpPanel.getByRole('button', { name: 'Add' }).click();

      await expect(mcpPanel.getByText('You have unsaved changes')).toBeVisible({ timeout: 10_000 });

      await mcpPanel.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'MCP servers saved' })).toBeVisible({
        timeout: 10_000,
      });

      await page.reload();
      await page.getByRole('tab', { name: 'MCP Servers' }).click();
      const refreshedPanel = page
        .locator('div')
        .filter({
          hasText:
            'MCP servers discovered from machine config. Uncheck to exclude, or add custom servers.',
        })
        .first();
      await refreshedPanel.getByRole('button', { name: /^MCP Servers/ }).click();
      await expect(refreshedPanel.getByText(customServerName)).toBeVisible({ timeout: 10_000 });

      const getAgentResponse = await page.request.get(`/api/agents/${agentId}`);
      expect(getAgentResponse.ok()).toBeTruthy();
      const agent = (await getAgentResponse.json()) as {
        config?: { mcpOverride?: AgentMcpOverride };
      };

      const customServers = agent.config?.mcpOverride?.custom ?? [];
      expect(customServers.some((server) => server.name === customServerName)).toBe(true);

      if (excludedServerName) {
        const excluded = agent.config?.mcpOverride?.excluded ?? [];
        expect(excluded).toContain(excludedServerName);
      }
    } finally {
      if (agentId) {
        await deleteAgentQuietly(page.request, agentId);
      }
    }
  });

  test('edit agent Skills tab shows SkillPicker with discovered skills', async ({ page }) => {
    let agentId: string | null = null;

    try {
      const machine = await getRuntimeCompatibleMachine(page.request, 'claude-code');
      agentId = await createAgentViaApi(page.request, {
        machineId: machine.id,
        runtime: 'claude-code',
        name: uniqueName('pw-skills-settings'),
      });

      await page.goto(`/agents/${agentId}/settings`);
      await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole('tab', { name: 'Skills' }).click();
      const skillsPanel = page
        .locator('div')
        .filter({
          hasText:
            'Skills discovered from machine config. Uncheck to exclude, or add custom skills.',
        })
        .first();
      await expect(skillsPanel).toBeVisible({ timeout: 10_000 });

      const skillsPickerToggle = skillsPanel.getByRole('button', { name: /^Skills/ });
      await skillsPickerToggle.click();

      const scanning = skillsPanel.getByText('Scanning for skills...');
      await scanning.isVisible({ timeout: 5_000 }).catch(() => false);

      const skillToggles = skillsPanel.locator('input[aria-label^="Toggle "]');
      let excludedSkillId: string | null = null;
      const discoveredCount = await skillToggles.count();
      if (discoveredCount > 0) {
        const firstToggle = skillToggles.first();
        if (!(await firstToggle.isDisabled())) {
          const firstToggleLabel = (await firstToggle.getAttribute('aria-label')) ?? '';
          excludedSkillId = firstToggleLabel.replace(/^Toggle\s+/, '').trim();
          if (excludedSkillId) {
            await firstToggle.uncheck();
          }
        }
      }

      const customSkillId = uniqueName('custom-skill');
      await skillsPanel.getByRole('button', { name: '+ Custom Skill' }).click();
      await skillsPanel.locator('#custom-skill-id').fill(customSkillId);
      await skillsPanel.locator('#custom-skill-path').fill(`/tmp/${customSkillId}/SKILL.md`);
      await skillsPanel.getByRole('button', { name: 'Add' }).click();

      await expect(skillsPanel.getByText('You have unsaved changes')).toBeVisible({
        timeout: 10_000,
      });

      await skillsPanel.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Skills saved' })).toBeVisible({
        timeout: 10_000,
      });

      await page.reload();
      await page.getByRole('tab', { name: 'Skills' }).click();
      const refreshedPanel = page
        .locator('div')
        .filter({
          hasText:
            'Skills discovered from machine config. Uncheck to exclude, or add custom skills.',
        })
        .first();
      await refreshedPanel.getByRole('button', { name: /^Skills/ }).click();
      await expect(refreshedPanel.getByText(customSkillId)).toBeVisible({ timeout: 10_000 });

      const getAgentResponse = await page.request.get(`/api/agents/${agentId}`);
      expect(getAgentResponse.ok()).toBeTruthy();
      const agent = (await getAgentResponse.json()) as {
        config?: { skillOverride?: AgentSkillOverride };
      };

      const customSkills = agent.config?.skillOverride?.custom ?? [];
      expect(customSkills.some((skill) => skill.id === customSkillId)).toBe(true);

      if (excludedSkillId) {
        const excluded = agent.config?.skillOverride?.excluded ?? [];
        expect(excluded).toContain(excludedSkillId);
      }
    } finally {
      if (agentId) {
        await deleteAgentQuietly(page.request, agentId);
      }
    }
  });

  test('switching runtime refreshes picker with new discovery results', async ({ page }) => {
    let agentId: string | null = null;

    const observedSkillRuntimeRequests = new Set<string>();
    page.on('request', (request) => {
      if (request.method() !== 'GET' || !request.url().includes('/api/skills/discover')) return;
      const runtime = new URL(request.url()).searchParams.get('runtime');
      if (runtime) observedSkillRuntimeRequests.add(runtime);
    });

    try {
      const machine = await getRuntimeCompatibleMachine(page.request, 'claude-code');
      agentId = await createAgentViaApi(page.request, {
        machineId: machine.id,
        runtime: 'claude-code',
        name: uniqueName('pw-runtime-refresh'),
        config: {
          mcpOverride: {
            excluded: ['seed-mcp-server'],
            custom: [{ name: 'seed-custom-mcp', command: 'node' }],
          },
          skillOverride: {
            excluded: ['seed-skill-id'],
            custom: [
              {
                id: 'seed-custom-skill',
                path: '/tmp/seed-custom-skill/SKILL.md',
                enabled: true,
                name: 'seed-custom-skill',
              },
            ],
          },
        },
      });

      await page.goto(`/agents/${agentId}/settings`);
      await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole('tab', { name: 'Skills' }).click();
      const skillsPanel = page
        .locator('div')
        .filter({
          hasText:
            'Skills discovered from machine config. Uncheck to exclude, or add custom skills.',
        })
        .first();
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

      await page.getByRole('tab', { name: 'MCP Servers' }).click();
      const mcpPanel = page
        .locator('div')
        .filter({
          hasText:
            'MCP servers discovered from machine config. Uncheck to exclude, or add custom servers.',
        })
        .first();
      await expect(mcpPanel).toBeVisible({ timeout: 10_000 });

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
});
