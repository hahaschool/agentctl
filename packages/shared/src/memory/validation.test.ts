import { describe, expect, it } from 'vitest';

import { MEMORY_NAME_MAX_LENGTH, sanitizeName } from './validation.js';

describe('sanitizeName', () => {
  it('trims names and caps them at the memory name length limit', () => {
    const value = sanitizeName(`  ${'a'.repeat(MEMORY_NAME_MAX_LENGTH + 10)}  `);

    expect(value).toHaveLength(MEMORY_NAME_MAX_LENGTH);
    expect(value).toBe('a'.repeat(MEMORY_NAME_MAX_LENGTH));
  });

  it.each([
    '../global',
    'project/agentctl',
    'project\\agentctl',
    'bad\u0000name',
    'bad\u001fname',
  ])('rejects unsafe name %s', (name) => {
    expect(() => sanitizeName(name)).toThrow(/unsafe memory name/i);
  });
});
