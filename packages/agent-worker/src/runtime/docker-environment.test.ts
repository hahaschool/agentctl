import { describe, expect, it } from 'vitest';

import { buildRunArgs, containsBlockedPath, DockerEnvironment } from './docker-environment.js';

describe('DockerEnvironment', () => {
  it('builds run args with gVisor and security constraints', () => {
    const args = buildRunArgs({
      containerName: 'agentctl-test-abc12345',
      image: 'agentctl/agent-runner:latest',
      executionRoot: '/workspace/project',
      worktreePath: '/workspace/project/.trees/task-1',
      runtimeHomeDir: '/Users/runner',
      env: { AGENTCTL_MANAGED: '1' },
      enableGvisor: true,
      networkMode: 'none',
      extraDockerArgs: [],
    });

    expect(args).toContain('--runtime=runsc');
    expect(args).toContain('--cap-drop=ALL');
    expect(args).toContain('--security-opt=no-new-privileges');
    expect(args).toContain('--read-only');
    expect(args).toContain('--network=none');
    expect(args).toContain('--volume=/workspace/project/.trees/task-1:/workspace:rw');
    expect(args).toContain('--volume=/Users/runner:/home/agent:ro');
    expect(args).toContain('--env=AGENTCTL_MANAGED=1');
    expect(args).toContain('--workdir=/workspace');
    expect(args).toContain('agentctl/agent-runner:latest');
  });

  it('omits --runtime=runsc when gVisor is disabled', () => {
    const args = buildRunArgs({
      containerName: 'agentctl-test-abc12345',
      image: 'agentctl/agent-runner:latest',
      executionRoot: '/workspace/project',
      worktreePath: null,
      runtimeHomeDir: null,
      env: {},
      enableGvisor: false,
      networkMode: 'bridge',
      extraDockerArgs: [],
    });

    expect(args).not.toContain('--runtime=runsc');
    expect(args).toContain('--network=bridge');
    expect(args).toContain('--volume=/workspace/project:/workspace:rw');
  });

  it('rejects worktree paths containing blocked directories', () => {
    expect(containsBlockedPath('/home/user/.ssh/keys')).toBe(true);
    expect(containsBlockedPath('/home/user/.gnupg/key.gpg')).toBe(true);
    expect(containsBlockedPath('/home/user/.aws/config')).toBe(true);
    expect(containsBlockedPath('/workspace/project/src')).toBe(false);
  });

  it('prepare rejects a worktree with a blocked mount path', async () => {
    const env = new DockerEnvironment({ enableGvisor: false });

    await expect(
      env.prepare({
        executionRoot: '/home/user/.ssh',
        env: {},
      }),
    ).rejects.toThrow('security-sensitive directory');
  });

  it('prepare returns container-relative paths and cleanup token', async () => {
    const env = new DockerEnvironment({ enableGvisor: false, networkMode: 'none' });

    const preparation = await env.prepare({
      executionRoot: '/workspace/project',
      worktreePath: '/workspace/project/.trees/task-2',
      runtimeHomeDir: '/Users/runner',
      env: { KEY: 'val' },
      metadata: { project: 'agentctl' },
    });

    expect(preparation.environmentId).toBe('docker');
    expect(preparation.executionRoot).toBe('/workspace');
    expect(preparation.worktreePath).toBe('/workspace');
    expect(preparation.runtimeHomeDir).toBe('/home/agent');
    expect(preparation.metadata).toMatchObject({
      isolation: 'container',
      supportsContainerBoundary: true,
      project: 'agentctl',
    });
    expect(preparation.cleanupToken).toBeDefined();
    expect((preparation.cleanupToken as { containerName: string }).containerName).toMatch(
      /^agentctl-/,
    );
    expect(preparation.spawnContext).toMatchObject({
      image: 'agentctl/agent-runner:latest',
      hostWorkDir: '/workspace/project/.trees/task-2',
    });
  });
});
