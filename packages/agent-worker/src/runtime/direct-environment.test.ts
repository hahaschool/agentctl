import { describe, expect, it } from 'vitest';

import { DirectEnvironment } from './direct-environment.js';

describe('DirectEnvironment', () => {
  it('detects the host execution environment as available', async () => {
    const environment = new DirectEnvironment();

    await expect(environment.detect()).resolves.toMatchObject({
      id: 'direct',
      available: true,
      isDefault: true,
      isolation: 'host',
    });
  });

  it('prepares host execution without changing paths', async () => {
    const environment = new DirectEnvironment();

    const preparation = await environment.prepare({
      executionRoot: '/workspace/project',
      worktreePath: '/workspace/project/.trees/task-2',
      runtimeHomeDir: '/Users/runner',
      env: { AGENTCTL_MANAGED: '1' },
      metadata: { project: 'agentctl' },
    });

    expect(preparation).toMatchObject({
      environmentId: 'direct',
      executionRoot: '/workspace/project',
      worktreePath: '/workspace/project/.trees/task-2',
      runtimeHomeDir: '/Users/runner',
    });
    expect(preparation.spawnContext).toMatchObject({ cwd: '/workspace/project' });
    expect(preparation.metadata).toMatchObject({
      isolation: 'host',
      project: 'agentctl',
      supportsPersistentWorktree: true,
      supportsContainerBoundary: false,
    });
  });

  it('cleanup is a no-op for the compatibility environment', async () => {
    const environment = new DirectEnvironment();
    const preparation = await environment.prepare({ executionRoot: '/workspace/project' });

    await expect(environment.cleanup(preparation)).resolves.toBeUndefined();
  });
});
