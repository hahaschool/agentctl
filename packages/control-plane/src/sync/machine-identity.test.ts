import { afterEach, describe, expect, it } from 'vitest';

import { getMachineId } from './machine-identity.js';

describe('getMachineId', () => {
  const originalEnv = process.env.MACHINE_ID;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MACHINE_ID = originalEnv;
    } else {
      delete process.env.MACHINE_ID;
    }
  });

  it('returns MACHINE_ID from env when set', () => {
    process.env.MACHINE_ID = 'mac-local';
    expect(getMachineId()).toBe('mac-local');
  });

  it('derives from hostname when MACHINE_ID is not set', () => {
    delete process.env.MACHINE_ID;
    const id = getMachineId();
    // Should be lowercase, alphanumeric+hyphens, derived from os.hostname()
    expect(id).toMatch(/^[a-z0-9-]+$/);
    expect(id.length).toBeGreaterThan(0);
  });

  it('sanitizes hostname to valid ID format', () => {
    delete process.env.MACHINE_ID;
    // hostname() may contain dots, underscores — getMachineId strips them
    const id = getMachineId();
    expect(id).not.toMatch(/[^a-z0-9-]/);
  });
});
