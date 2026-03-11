import type { ExecutionEnvironmentCapability, ExecutionEnvironmentId } from '@agentctl/shared';

export type PrepareExecutionEnvironmentInput = {
  executionRoot: string;
  worktreePath?: string | null;
  runtimeHomeDir?: string | null;
  env?: Record<string, string>;
  metadata?: Record<string, unknown>;
};

export type ExecutionEnvironmentPreparation = {
  environmentId: ExecutionEnvironmentId;
  executionRoot: string;
  worktreePath: string | null;
  runtimeHomeDir: string | null;
  env: Record<string, string>;
  spawnContext: Record<string, unknown>;
  metadata: Record<string, unknown>;
  cleanupToken?: Record<string, unknown>;
};

export interface ExecutionEnvironment {
  readonly id: ExecutionEnvironmentId;
  readonly name: string;
  detect(): Promise<ExecutionEnvironmentCapability>;
  prepare(input: PrepareExecutionEnvironmentInput): Promise<ExecutionEnvironmentPreparation>;
  cleanup(preparation: ExecutionEnvironmentPreparation): Promise<void>;
}
