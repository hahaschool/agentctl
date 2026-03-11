import { describe, expect, it } from 'vitest';
import { DirectEnvironment } from './direct-environment.js';
import type {
  ExecutionEnvironmentPreparation,
  PrepareExecutionEnvironmentInput,
} from './execution-environment.js';

describe('execution-environment contracts', () => {
  it('describes preparation payloads for runtime launch', async () => {
    const environment = new DirectEnvironment();
    const input: PrepareExecutionEnvironmentInput = {
      executionRoot: '/workspace/project',
      worktreePath: '/workspace/project/.trees/task-1',
      runtimeHomeDir: '/Users/runner',
      env: { AGENTCTL_MANAGED: '1' },
      metadata: { project: 'agentctl' },
    };

    const preparation: ExecutionEnvironmentPreparation = await environment.prepare(input);

    expect(preparation.environmentId).toBe('direct');
    expect(preparation.executionRoot).toBe('/workspace/project');
    expect(preparation.worktreePath).toBe('/workspace/project/.trees/task-1');
    expect(preparation.env.AGENTCTL_MANAGED).toBe('1');
  });
});
