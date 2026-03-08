import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_TERMINALS, DEFAULT_TERMINAL_COLS, DEFAULT_TERMINAL_ROWS } from './constants.js';

describe('Worker runtime constants', () => {
  it('DEFAULT_MAX_TERMINALS is 5', () => {
    expect(DEFAULT_MAX_TERMINALS).toBe(5);
  });

  it('DEFAULT_TERMINAL_COLS is 120', () => {
    expect(DEFAULT_TERMINAL_COLS).toBe(120);
  });

  it('DEFAULT_TERMINAL_ROWS is 30', () => {
    expect(DEFAULT_TERMINAL_ROWS).toBe(30);
  });
});
