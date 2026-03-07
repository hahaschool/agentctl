import { describe, expect, it } from 'vitest';

import { COPY_FEEDBACK_MS } from './ui-constants';

describe('ui-constants', () => {
  it('COPY_FEEDBACK_MS is a positive number', () => {
    expect(COPY_FEEDBACK_MS).toBeGreaterThan(0);
    expect(typeof COPY_FEEDBACK_MS).toBe('number');
  });
});
