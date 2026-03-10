import { describe, expect, it } from 'vitest';

import type {
  ApplyRuntimeConfigRequest,
  ApplyRuntimeConfigResponse,
  CreateManagedSessionRequest,
  HandoffManagedSessionRequest,
  RuntimeConfigSyncRequest,
} from './runtime-management.js';

describe('runtime-management protocol', () => {
  it('defines worker config apply payloads', () => {
    const request: ApplyRuntimeConfigRequest = {
      machineId: 'machine-1',
      config: {
        version: 2,
        hash: 'sha256:cfg',
        instructions: {
          userGlobal: 'Use managed runtime config.',
          projectTemplate: 'Follow repo conventions.',
        },
        mcpServers: [],
        skills: [],
        sandbox: 'workspace-write',
        approvalPolicy: 'on-request',
        environmentPolicy: {
          inherit: ['PATH'],
          set: { AGENTCTL_MANAGED: '1' },
        },
        runtimeOverrides: {},
      },
    };

    const response: ApplyRuntimeConfigResponse = {
      applied: true,
      machineId: 'machine-1',
      configVersion: 2,
      configHash: 'sha256:cfg',
      files: [{ path: '.codex/config.toml', hash: 'sha256:file-1' }],
      runtimes: {
        'claude-code': { installed: true, authenticated: true },
        codex: { installed: true, authenticated: true },
      },
    };

    expect(request.config.version).toBe(2);
    expect(response.files[0]?.path).toContain('config.toml');
  });

  it('defines managed session creation and handoff requests', () => {
    const createRequest: CreateManagedSessionRequest = {
      runtime: 'codex',
      machineId: 'machine-1',
      agentId: 'agent-1',
      projectPath: '/tmp/project',
      prompt: 'Investigate the failing tests.',
      model: 'gpt-5-codex',
    };

    const handoffRequest: HandoffManagedSessionRequest = {
      targetRuntime: 'claude-code',
      reason: 'manual',
      targetMachineId: 'machine-2',
      prompt: 'Continue from the snapshot.',
    };

    expect(createRequest.runtime).toBe('codex');
    expect(handoffRequest.reason).toBe('manual');
  });

  it('defines sync requests for machine-scoped config rollout', () => {
    const syncRequest: RuntimeConfigSyncRequest = {
      machineIds: ['machine-1', 'machine-2'],
      configVersion: 4,
    };

    expect(syncRequest.machineIds).toHaveLength(2);
    expect(syncRequest.configVersion).toBe(4);
  });
});
