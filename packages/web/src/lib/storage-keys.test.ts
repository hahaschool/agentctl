import { describe, expect, it } from 'vitest';

import { STORAGE_KEYS } from './storage-keys';

describe('STORAGE_KEYS', () => {
  it('exports all expected keys', () => {
    expect(STORAGE_KEYS.DEFAULT_MODEL).toBe('agentctl:defaultModel');
    expect(STORAGE_KEYS.AUTO_REFRESH_INTERVAL).toBe('agentctl:autoRefreshInterval');
    expect(STORAGE_KEYS.MAX_DISPLAY_MESSAGES).toBe('agentctl:maxDisplayMessages');
    expect(STORAGE_KEYS.LAST_MACHINE_ID).toBe('agentctl:lastMachineId');
  });

  it('has unique values (no accidental duplicates)', () => {
    const values = Object.values(STORAGE_KEYS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('all values are prefixed with agentctl:', () => {
    for (const value of Object.values(STORAGE_KEYS)) {
      expect(value).toMatch(/^agentctl:/);
    }
  });
});
