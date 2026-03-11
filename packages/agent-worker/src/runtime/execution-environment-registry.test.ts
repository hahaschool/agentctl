import { describe, expect, it } from 'vitest';

import { DirectEnvironment } from './direct-environment.js';
import { ExecutionEnvironmentRegistry } from './execution-environment-registry.js';

describe('ExecutionEnvironmentRegistry', () => {
  it('detects all registered execution environments', async () => {
    const registry = new ExecutionEnvironmentRegistry([new DirectEnvironment()]);

    await expect(registry.detectAll()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'direct', available: true })]),
    );
  });

  it('returns the available default execution environment', async () => {
    const registry = new ExecutionEnvironmentRegistry([new DirectEnvironment()]);

    await expect(registry.getDefault()).resolves.toMatchObject({ id: 'direct' });
  });

  it('resolves an environment implementation by id', () => {
    const environment = new DirectEnvironment();
    const registry = new ExecutionEnvironmentRegistry([environment]);

    expect(registry.get('direct')).toBe(environment);
    expect(registry.get('docker')).toBeUndefined();
  });
});
