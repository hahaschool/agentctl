import type { ManagedRuntime } from '@agentctl/shared';

import type { RuntimeAdapter } from './runtime-adapter.js';

export class RuntimeRegistry {
  private readonly adapters = new Map<ManagedRuntime, RuntimeAdapter>();

  register(adapter: RuntimeAdapter): void {
    this.adapters.set(adapter.runtime, adapter);
  }

  get(runtime: ManagedRuntime): RuntimeAdapter | undefined {
    return this.adapters.get(runtime);
  }

  list(): RuntimeAdapter[] {
    return [...this.adapters.values()];
  }
}
