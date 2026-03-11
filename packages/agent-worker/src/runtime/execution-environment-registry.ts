import type { ExecutionEnvironmentCapability, ExecutionEnvironmentId } from '@agentctl/shared';

import { DirectEnvironment } from './direct-environment.js';
import type { ExecutionEnvironment } from './execution-environment.js';

export class ExecutionEnvironmentRegistry {
  private readonly environments = new Map<ExecutionEnvironmentId, ExecutionEnvironment>();

  constructor(environments: ExecutionEnvironment[] = [new DirectEnvironment()]) {
    for (const environment of environments) {
      this.environments.set(environment.id, environment);
    }
  }

  get(id: ExecutionEnvironmentId): ExecutionEnvironment | undefined {
    return this.environments.get(id);
  }

  async detectAll(): Promise<ExecutionEnvironmentCapability[]> {
    return Promise.all([...this.environments.values()].map((environment) => environment.detect()));
  }

  async getDefault(): Promise<ExecutionEnvironmentCapability | null> {
    const capabilities = await this.detectAll();
    return (
      capabilities.find((capability) => capability.available && capability.isDefault) ??
      capabilities.find((capability) => capability.available) ??
      null
    );
  }
}
