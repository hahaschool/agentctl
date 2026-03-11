import type { ExecutionEnvironmentCapability } from '@agentctl/shared';

import type {
  ExecutionEnvironment,
  ExecutionEnvironmentPreparation,
  PrepareExecutionEnvironmentInput,
} from './execution-environment.js';

const DIRECT_ENVIRONMENT_METADATA = {
  isolation: 'host',
  supportsPersistentWorktree: true,
  supportsContainerBoundary: false,
} as const;

export class DirectEnvironment implements ExecutionEnvironment {
  readonly id = 'direct' as const;
  readonly name = 'Direct Environment';

  async detect(): Promise<ExecutionEnvironmentCapability> {
    return {
      id: this.id,
      available: true,
      isDefault: true,
      isolation: 'host',
      reasonUnavailable: null,
      metadata: { ...DIRECT_ENVIRONMENT_METADATA },
    };
  }

  async prepare(input: PrepareExecutionEnvironmentInput): Promise<ExecutionEnvironmentPreparation> {
    return {
      environmentId: this.id,
      executionRoot: input.executionRoot,
      worktreePath: input.worktreePath ?? input.executionRoot,
      runtimeHomeDir: input.runtimeHomeDir ?? null,
      env: { ...(input.env ?? {}) },
      spawnContext: {
        cwd: input.executionRoot,
      },
      metadata: {
        ...DIRECT_ENVIRONMENT_METADATA,
        ...(input.metadata ?? {}),
      },
    };
  }

  async cleanup(_preparation: ExecutionEnvironmentPreparation): Promise<void> {}
}
