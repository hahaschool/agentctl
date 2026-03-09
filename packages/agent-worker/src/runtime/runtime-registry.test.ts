import { describe, expect, it } from 'vitest';

import type { RuntimeAdapter } from './runtime-adapter.js';
import { RuntimeRegistry } from './runtime-registry.js';

describe('RuntimeRegistry', () => {
  it('registers and returns runtime adapters by runtime id', () => {
    const registry = new RuntimeRegistry();
    const adapter = {
      runtime: 'claude-code',
      startSession: async () => {
        throw new Error('not needed');
      },
      resumeSession: async () => {
        throw new Error('not needed');
      },
      forkSession: async () => {
        throw new Error('not needed');
      },
      getCapabilities: async () => ({
        runtime: 'claude-code',
        supportsResume: true,
        supportsFork: false,
      }),
    } satisfies RuntimeAdapter;

    registry.register(adapter);

    expect(registry.get('claude-code')).toBe(adapter);
    expect(registry.list()).toHaveLength(1);
  });
});
